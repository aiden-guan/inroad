import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import network from "@/lib/workflows/network";
import { NOW, makeAccount, makePerson, makeWorkspace } from "@/test/factories";
import { runWorkflow } from "@/test/run-workflow";
import { applyListImport, importConnections, knowsProduct, undoImport } from "./import";
import { autoMap, presetById } from "./presets";
import { parseCsv } from "./csv";
import { searchConnections, setRelationshipTags, taggingStart } from "./relationships";
import { readConnections, updateConnections } from "./store";

/**
 * Relationship tags (SPEC W2): the founder says who knows them, and the next re-import turns a job change
 * by one of those people into champion_job_change, the strongest signal. Signup and user lists tag the
 * same people among the connections. No network, no model.
 */

vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn(async () => null), fetchJSON: vi.fn(async () => null) }));

const HEADER = "First Name,Last Name,URL,Email Address,Company,Position,Connected On";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const DANA_AT = (company: string, position = "Head of Finance") => `Dana,Okafor,https://www.linkedin.com/in/dana-okafor,,${company},${position},12 Mar 2023`;
const LEE = "Lee,Park,https://www.linkedin.com/in/lee-park,lee@ledgerly.io,Ledgerly,Controller,02 Jan 2024";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(fetchText).mockResolvedValue(null);
  vi.mocked(fetchJSON).mockResolvedValue(null);
  await updateConnections((rows) => void rows.splice(0, rows.length));
  await replaceWorkspace(makeWorkspace({ accounts: { "northwind.io": makeAccount("northwind.io", { name: "Northwind", status: "new" }) } }));
});
afterEach(() => vi.useRealTimers());

const conn = (first: string) => readConnections().find((c) => c.firstName === first)!;

describe("tagging who knows you", () => {
  it("saves tags on the connection and on the person it became, and lists investors and connectors in Intros", async () => {
    await importConnections({ fileName: "Connections.csv", text: csv(DANA_AT("Pavewise"), LEE) });
    await replaceWorkspace({
      ...readWorkspace(),
      people: { per_lee: makePerson("per_lee", "ledgerly.io", { name: "Lee Park", linkedinUrl: "https://www.linkedin.com/in/lee-park", email: "lee@ledgerly.io" }) },
    });

    expect(await setRelationshipTags({ connectionId: conn("Dana").id, tags: ["design_partner", "nonsense"] })).toEqual({ tags: ["design_partner"] });
    expect(conn("Dana").tags).toEqual(["design_partner"]);

    // Tagging the person finds their connection by profile URL.
    await setRelationshipTags({ personId: "per_lee", tags: ["ex_colleague", "connector"] });
    expect(conn("Lee").tags).toEqual(["ex_colleague", "connector"]);
    const ws = readWorkspace();
    expect(ws.people.per_lee.tags).toEqual(["ex_colleague", "connector"]);
    expect(ws.connectors).toEqual([expect.objectContaining({ name: "Lee Park", relationship: "connection", linkedinUrl: "https://www.linkedin.com/in/lee-park", company: "Ledgerly" })]);

    // Clearing removes them everywhere.
    await setRelationshipTags({ personId: "per_lee", tags: [] });
    expect(conn("Lee").tags).toBeUndefined();
    expect(readWorkspace().people.per_lee.tags).toBeUndefined();
    await expect(setRelationshipTags({ personId: "per_gone", tags: ["past_user"] })).rejects.toThrow(/isn't in your workspace/);
  });

  it("finds connections by name, company or title, and starts with the tagged and the people at your users", async () => {
    await importConnections({ fileName: "Connections.csv", text: csv(DANA_AT("Pavewise"), LEE) });
    await replaceWorkspace({ ...readWorkspace(), accounts: { ...readWorkspace().accounts, "ledgerly.io": makeAccount("ledgerly.io", { name: "Ledgerly", status: "customer" }) } });
    expect(searchConnections("okafor pave").map((p) => p.name)).toEqual(["Dana Okafor"]);
    expect(searchConnections("controller")).toEqual([expect.objectContaining({ name: "Lee Park", company: "Ledgerly", position: "Controller", tags: [] })]);
    expect(searchConnections("x")).toEqual([]);

    expect(taggingStart()).toEqual({ tagged: [], suggested: [expect.objectContaining({ name: "Lee Park" })] });
    await setRelationshipTags({ connectionId: conn("Dana").id, tags: ["past_user"] });
    expect(taggingStart().tagged.map((p) => [p.name, p.tags])).toEqual([["Dana Okafor", ["past_user"]]]);
  });
});

describe("knowing the product", () => {
  it("comes from a tag on the connection or the person, or from having worked at a company you named as your users", async () => {
    await importConnections({ fileName: "Connections.csv", text: csv(DANA_AT("Pavewise")) });
    const ws = readWorkspace();
    const dana = conn("Dana");
    expect(knowsProduct(ws, dana)).toBe(false);
    expect(knowsProduct(ws, { ...dana, tags: ["investor"] })).toBe(false);
    expect(knowsProduct(ws, { ...dana, tags: ["past_user"] })).toBe(true);

    ws.people.per_dana = makePerson("per_dana", "pavewise.com", { name: "Dana Okafor", linkedinUrl: dana.url, tags: ["design_partner"] });
    expect(knowsProduct(ws, dana)).toBe(true);
    delete ws.people.per_dana;

    // Moved from Pavewise, which the founder marked as a design partner.
    const moved = { ...dana, company: "Northwind", previous: { company: "Pavewise", position: "Head of Finance", changedOn: "2026-10-20" } };
    expect(knowsProduct(ws, moved)).toBe(false);
    ws.accounts["pavewise.com"] = makeAccount("pavewise.com", { name: "Pavewise", status: "customer", tags: ["design_partner"] });
    expect(knowsProduct(ws, moved)).toBe(true);
  });

  it("turns a tagged design partner's move into a champion job change on re-import", async () => {
    await importConnections({ fileName: "Connections.csv", text: csv(DANA_AT("Pavewise"), LEE) });
    await setRelationshipTags({ connectionId: conn("Dana").id, tags: ["design_partner"] });
    // A month later Dana is at Northwind, a company the founder tracks.
    const batch = await importConnections({ fileName: "Connections.csv", text: csv(DANA_AT("Northwind", "VP Finance"), LEE) });
    expect(conn("Dana").tags).toEqual(["design_partner"]);

    const { summary } = await runWorkflow(network, { reason: "import", importId: batch.id });
    expect(summary.status).toBe("done");
    const acc = readWorkspace().accounts["northwind.io"];
    const sig = acc.signals.find((s) => s.type === "champion_job_change")!;
    expect(sig).toMatchObject({ strength: 3, headline: "Dana, who knows your product, joined as VP Finance", url: "https://www.linkedin.com/in/dana-okafor" });
    expect(Object.values(readWorkspace().people).find((p) => p.name === "Dana Okafor")).toMatchObject({ accountDomain: "northwind.io", champion: "untested" });
  });

  it("leaves the same move untagged as no signal at all", async () => {
    await importConnections({ fileName: "Connections.csv", text: csv(DANA_AT("Pavewise")) });
    const batch = await importConnections({ fileName: "Connections.csv", text: csv(DANA_AT("Northwind", "VP Finance")) });
    await runWorkflow(network, { reason: "import", importId: batch.id });
    expect(readWorkspace().accounts["northwind.io"].signals).toEqual([]);
  });
});

describe("signup and user lists", () => {
  it("tag the people on them, and the same people among your connections by email or profile URL", async () => {
    await importConnections({ fileName: "Connections.csv", text: csv(DANA_AT("Pavewise"), LEE) });
    const text = ["email,name,signed_up_at,linkedin", "lee@ledgerly.io,Lee Park,2026-08-01,", "dana@pavewise.com,Dana Okafor,2026-08-03,https://linkedin.com/in/dana-okafor/"].join("\n");
    const parsed = parseCsv(text);
    const batch = await applyListImport({ fileName: "users.csv", text, preset: "signups", mapping: autoMap(parsed.headers, presetById("signups"), parsed.rows) });

    const people = Object.values(readWorkspace().people);
    expect(people.map((p) => [p.name, p.tags])).toEqual([
      ["Lee Park", ["signup"]],
      ["Dana Okafor", ["signup"]],
    ]);
    expect(conn("Lee").tags).toEqual(["signup"]);
    expect(conn("Dana").tags).toEqual(["signup"]);
    expect(knowsProduct(readWorkspace(), conn("Lee"))).toBe(true);

    await undoImport(batch.id);
    expect(Object.values(readWorkspace().people)).toEqual([]);
  });

  it("date a prospect on a customer list from the import, not from when discovery found it", async () => {
    const text = ["id,email,name,created (utc),delinquent,card last4", "cus_1,ap@northwind.io,Northwind,2026-03-01,false,4242"].join("\n");
    const parsed = parseCsv(text);
    await applyListImport({ fileName: "customers.csv", text, preset: "stripe", mapping: autoMap(parsed.headers, presetById("stripe"), parsed.rows) });
    expect(readWorkspace().accounts["northwind.io"]).toMatchObject({ status: "customer", customerAt: NOW.toISOString() });
  });
});
