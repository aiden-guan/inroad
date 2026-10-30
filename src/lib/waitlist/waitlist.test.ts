import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCompany } from "@/test/factories";
import { emptyWorkspace, getSecret, readWorkspace, replaceWorkspace, setSecrets } from "@/lib/store/workspace";
import { cleanCredential, convexConnection, countSql, discoverTables, postgresConnection, readWaitlist } from "./databases";
import { connectWaitlist, disconnectWaitlist, setWaitlistGoal, syncWaitlist } from "./sync";
import { detectWaitlist, recordWaitlist, waitlistChange, type WaitlistReading, type WaitlistTracking } from "./types";
import { POST as connectRoute, PATCH as goalRoute } from "@/app/api/waitlist/route";

const pg = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), end: vi.fn(), options: vi.fn(), lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: pg.lookup }));
vi.mock("pg", () => ({ Client: class { constructor(options: unknown) { pg.options(options); } on() {} connect = pg.connect; end = pg.end; query = pg.query; } }));
const fetcher = vi.fn<typeof fetch>();
const KEY = "prod:careful-otter-123|synthetic_test_key";
const PG = "postgresql://reader:p%40ssword@db.example.net/app?sslmode=disable&options=-c%20default_transaction_read_only%3Doff";
const reply = (value: unknown, status = 200) => fetcher.mockResolvedValueOnce(Response.json(status === 200 ? { status: "success", value } : value, { status }));
const tables = (names = ["waitlist"]) => reply({ page: names.map((name) => ({ name })), isDone: true });
const connect = async (total = 12) => { tables(); reply(total); return connectWaitlist("convex", KEY); };

beforeEach(async () => {
  await replaceWorkspace({ ...emptyWorkspace(), company: makeCompany({ market: "consumer" }) });
  setSecrets("waitlist", { credential: null });
  fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
  pg.query.mockReset(); pg.connect.mockReset(); pg.options.mockReset(); pg.end.mockReset().mockResolvedValue(undefined);
  pg.lookup.mockReset().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
});

describe("waitlist database imports", () => {
  it("connects a clearly named Convex waitlist with one credential, storing only metadata and counts", async () => {
    expect(await connect()).toEqual({ status: "done" });
    const state = readWorkspace().waitlist!;
    expect(state.current.total).toBe(12);
    expect(state.source.label).toBe("Convex · waitlist");
    expect(getSecret("waitlist", "credential")).toBe(KEY);
    expect(JSON.stringify(readWorkspace())).not.toContain(KEY);
    expect(fetcher.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body)).path])).toEqual([
      ["https://careful-otter-123.convex.cloud/api/query", "_system/cli/tables:default"],
      ["https://careful-otter-123.convex.cloud/api/query", "_system/cli/tableSize:default"],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).args).toEqual([{ tableName: "waitlist" }]);
  });

  it("asks for a named table when ambiguous and does not save the credential yet", async () => {
    tables(["waitlist", "earlyAccess", "users"]);
    expect(await connectWaitlist("convex", KEY)).toEqual({ status: "choose", tables: [{ name: "earlyAccess" }, { name: "users" }, { name: "waitlist" }] });
    expect(readWorkspace().waitlist).toBeUndefined();
    expect(getSecret("waitlist", "credential")).toBeUndefined();
    tables(["waitlist", "earlyAccess"]); reply(0);
    expect(await connectWaitlist("convex", KEY, { name: "earlyAccess" })).toEqual({ status: "done" });
    expect(readWorkspace().waitlist?.current.total).toBe(0);
  });

  it("does not guess from a single unrelated table or accept a table outside discovery", async () => {
    tables(["users"]);
    expect((await connectWaitlist("convex", KEY)).status).toBe("choose");
    tables();
    await expect(connectWaitlist("convex", KEY, { name: "users" })).rejects.toThrow("no longer available");
  });

  it.each([null, -1, 1.5, "12", Number.MAX_SAFE_INTEGER + 1])("rejects an invalid count (%s) and preserves a working connection", async (bad) => {
    await connect(); const before = structuredClone(readWorkspace().waitlist);
    tables(); reply(bad);
    await expect(connectWaitlist("convex", KEY.replace("careful", "other"))).rejects.toThrow();
    expect(readWorkspace().waitlist).toEqual(before);
    expect(getSecret("waitlist", "credential")).toBe(KEY);
  });

  it("keeps the last good total after a failed sync, backs off, and recovers", async () => {
    await connect(); const before = structuredClone(readWorkspace().waitlist!.current);
    reply({ errorMessage: `private diagnostics ${KEY}` }, 400);
    expect((await syncWaitlist())?.ok).toBe(false);
    expect(readWorkspace().waitlist?.current).toEqual(before);
    expect(readWorkspace().waitlist?.lastError).not.toMatch(/private diagnostics|synthetic_test_key/);
    expect(await syncWaitlist(false)).toBeNull();
    reply(18); expect((await syncWaitlist())?.ok).toBe(true);
    expect(readWorkspace().waitlist?.current.total).toBe(18);
    expect(readWorkspace().waitlist?.lastError).toBeUndefined();
  });

  it("disconnects after an in-flight sync without resurrecting credentials or losing history", async () => {
    await connect(); await setWaitlistGoal(100);
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const syncing = syncWaitlist();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const disconnecting = disconnectWaitlist();
    resolve(Response.json({ status: "success", value: 14 }));
    await Promise.all([syncing, disconnecting]);
    expect(readWorkspace().waitlist).toMatchObject({ enabled: false, goal: 100, current: { total: 14 } });
    expect(readWorkspace().waitlist!.history.length).toBeGreaterThan(0);
    expect(getSecret("waitlist", "credential")).toBeUndefined();
    expect(await syncWaitlist(false)).toBeNull();
  });

  it("never queries a provider from a sample or business workspace", async () => {
    await replaceWorkspace({ ...emptyWorkspace(), company: makeCompany({ market: "consumer" }), sample: true });
    await expect(connectWaitlist("convex", KEY)).rejects.toThrow("sample workspace");
    await replaceWorkspace({ ...emptyWorkspace(), company: makeCompany({ market: "b2b" }) });
    await expect(connectWaitlist("convex", KEY)).rejects.toThrow("consumer companies");
    expect(await syncWaitlist(false)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not write an old response into a workspace restored during the sync", async () => {
    await connect();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const syncing = syncWaitlist();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await replaceWorkspace({ ...emptyWorkspace(), company: makeCompany({ market: "consumer" }) });
    resolve(Response.json({ status: "success", value: 999 }));
    expect(await syncing).toMatchObject({ changed: false });
    expect(readWorkspace().waitlist).toBeUndefined();
  });

  it("validates targets and keeps errors and credentials out of API responses", async () => {
    await connect();
    const request = (body: unknown) => new Request("http://localhost/api/waitlist", { method: "POST", body: JSON.stringify(body) });
    expect((await goalRoute(request({ goal: -1 }))).status).toBe(400);
    expect((await goalRoute(request({ goal: 250 }))).status).toBe(200);
    expect(readWorkspace().waitlist?.goal).toBe(250);
    expect((await goalRoute(request({ goal: null }))).status).toBe(200);
    expect(readWorkspace().waitlist?.goal).toBeUndefined();
    reply({ detail: `raw server error ${KEY}` }, 400);
    const response = await connectRoute(request({ provider: "convex", credential: KEY }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toMatch(/raw server error|synthetic_test_key/);
  });

  it("counts PostgreSQL rows in a read-only transaction with verified TLS and safely quoted names", async () => {
    pg.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT count") ? { rows: [{ total: "2345" }] } : { rows: [] });
    const result = await readWaitlist("postgres", PG, { schema: "private", name: 'waitlist"; DROP TABLE users; --' });
    expect(result.total).toBe(2345);
    expect(pg.query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN READ ONLY", "SET LOCAL statement_timeout = '8s'", "SET LOCAL lock_timeout = '2s'", 'SELECT count(*)::text AS total FROM "private"."waitlist""; DROP TABLE users; --"', "ROLLBACK"]);
    expect(pg.options).toHaveBeenCalledWith(expect.objectContaining({ host: "8.8.8.8", password: "p@ssword", ssl: { rejectUnauthorized: true, servername: "db.example.net" } }));
    expect(pg.options.mock.calls[0][0]).not.toHaveProperty("connectionString");
    expect(pg.end).toHaveBeenCalled();
  });

  it("blocks private or rebinding database hosts before connecting", async () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "169.254.169.254", "db.internal"]) expect(() => postgresConnection(PG.replace("db.example.net", host))).toThrow("hosted database");
    pg.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(discoverTables("postgres", PG)).rejects.toThrow("publicly reachable");
    expect(pg.connect).not.toHaveBeenCalled();
  });

  it("closes failed PostgreSQL reads and hides driver diagnostics", async () => {
    pg.query.mockRejectedValue(Object.assign(new Error(`secret ${PG}`), { code: "42501" }));
    await expect(readWaitlist("postgres", PG, { schema: "public", name: "waitlist" })).rejects.toThrow("SELECT access");
    expect(pg.end).toHaveBeenCalled();
  });

  it("recognizes copied env assignments and only allows derived Convex hosts", () => {
    expect(cleanCredential(`export CONVEX_DEPLOY_KEY='${KEY}'`)).toBe(KEY);
    expect(convexConnection(KEY).url).toBe("https://careful-otter-123.convex.cloud");
    expect(() => convexConnection("https://attacker.com|key")).toThrow();
    expect(() => convexConnection("prod:localhost|key")).toThrow();
    expect(countSql({ schema: 'a"b', name: "waitlist" })).toBe('SELECT count(*)::text AS total FROM "a""b"."waitlist"');
  });
});

describe("waitlist history", () => {
  const reading = (at: string, total: number, sourceId = "one"): WaitlistReading => ({ at: `${at}T12:00:00.000Z`, total, sourceId });
  it("keeps the baseline, compacts later daily updates and preserves other sources", () => {
    let history = [reading("2026-10-01", 10), reading("2026-10-01", 99, "other")];
    history = recordWaitlist(history, { ...reading("2026-10-01", 12), at: "2026-10-01T13:00:00.000Z" });
    history = recordWaitlist(history, { ...reading("2026-10-01", 15), at: "2026-10-01T14:00:00.000Z" });
    expect(history.map((r) => r.total)).toEqual([10, 99, 15]);
    expect(detectWaitlist([{ name: "users" }])).toBeUndefined();
    expect(detectWaitlist([{ name: "waitlist" }, { name: "early_access" }])).toBeUndefined();
    expect(detectWaitlist([{ name: "waitlist_signups" }, { name: "users" }])).toEqual({ name: "waitlist_signups" });
  });
  it("reports net decreases, labels short history honestly and isolates sources", () => {
    const state: WaitlistTracking = { enabled: true, connectedAt: "2026-10-01", source: { id: "one", provider: "convex", label: "test", table: { name: "waitlist" } }, current: reading("2026-10-09", 12), history: [reading("2026-10-01", 20), reading("2026-10-08", 100, "other")] };
    expect(waitlistChange(state)).toEqual({ value: -8, since: "2026-10-01T12:00:00.000Z" });
    state.current = reading("2026-10-02", 12);
    expect(waitlistChange(state)?.since).toBe("2026-10-01T12:00:00.000Z");
    state.history = [];
    expect(waitlistChange(state)).toBeNull();
  });
});
