import { describe, expect, it, vi } from "vitest";
import { parseInbound } from "@/lib/hub/inbound";
import { dueConnectors } from "@/lib/hub/poll";
import type { HubState } from "@/lib/hub/store";
import { makeWorkspace } from "@/test/factories";
import { calcom } from "./calcom";
import { calendly } from "./calendly";
import { lemlist } from "./lemlist";

/**
 * Polling for the tools whose webhooks can't reach a local app: lemlist replies, and Calendly and
 * Cal.com bookings. Each poll hands back payloads shaped like the tool's own webhook, so the same
 * parser (and dedupe) takes them. The vendors are faked at fetch: nothing here touches the network.
 */

type Route = (url: URL, init: RequestInit | undefined) => { status?: number; body: unknown } | undefined;

function fakeVendor(route: Route) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const r = route(url, init) ?? { status: 404, body: { message: "Not found" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
const ahead = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

describe("lemlist polling", () => {
  it("reads replies, labels, bounces and unsubscribes newer than the cursor, as webhook activities", async () => {
    const since = ago(60);
    const calls = fakeVendor((url) => {
      if (url.pathname !== "/api/activities") return undefined;
      const type = url.searchParams.get("type");
      if (type === "emailsReplied")
        return { body: [{ _id: "act_2", type, createdAt: ago(5), leadEmail: "dana@northwind.io", leadFirstName: "Dana", text: "Worth a look. Tuesday?" }, { _id: "act_1", type, createdAt: ago(90), leadEmail: "old@northwind.io" }] };
      if (type === "emailsInterested") return { body: [{ _id: "act_3", type, createdAt: ago(4), leadEmail: "dana@northwind.io" }] };
      if (type === "emailsBounced") return { body: [{ _id: "act_4", type, createdAt: ago(3), leadEmail: "gone@rowan.io" }] };
      if (type === "entityUnsubscribed") return { status: 400, body: { message: "Unknown type" } };
      return { body: [] };
    });

    const r = await lemlist("lm_test_key_1234", {}).sequencer!.pollEvents!({ since });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.events.map((e) => e._id)).toEqual(["act_2", "act_3", "act_4"]);
    expect(r.value.cursor.since).toBe(r.value.events.map((e) => e.createdAt as string).sort().at(-1));
    // A type the API refuses is a note, not a failed poll.
    expect(r.value.warnings?.[0]).toMatch(/^entityUnsubscribed:/);
    expect(calls.every((c) => c.headers.authorization === `Basic ${Buffer.from(":lm_test_key_1234").toString("base64")}`)).toBe(true);

    const n = parseInbound("lemlist", r.value.events);
    expect(n.activities.map((a) => [a.kind, a.email, a.labelOnly ?? false, a.sentiment ?? null])).toEqual([
      ["reply_received", "dana@northwind.io", false, null],
      ["reply_received", "dana@northwind.io", true, "positive"],
      ["bounce", "gone@rowan.io", false, null],
    ]);
    expect(n.activities[0].body).toBe("Worth a look. Tuesday?");
  });

  it("stops at a key lemlist rejects", async () => {
    fakeVendor(() => ({ status: 401, body: { message: "Unauthorized" } }));
    const r = await lemlist("lm_bad_key_12345", {}).sequencer!.pollEvents!({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("auth");
  });
});

describe("Calendly polling", () => {
  it("validates the token and keeps the user to read bookings for", async () => {
    fakeVendor((url) => (url.pathname === "/users/me" ? { body: { resource: { uri: "https://api.calendly.com/users/U1", name: "Priya Shah" } } } : undefined));
    const r = await calendly("cal_pat_123456", {}).validate();
    expect(r).toMatchObject({ ok: true, value: { accountLabel: "Priya Shah", config: { userUri: "https://api.calendly.com/users/U1" } } });
  });

  it("turns changed bookings into the invitee webhooks Calendly would have sent", async () => {
    const since = ago(30);
    const ev = (id: string, patch: Record<string, unknown>) => ({ uri: `https://api.calendly.com/scheduled_events/${id}`, name: "Intro call", start_time: ahead(26), ...patch });
    const calls = fakeVendor((url) => {
      if (url.pathname === "/scheduled_events")
        return { body: { collection: [ev("E1", { status: "active", updated_at: ago(5) }), ev("E0", { status: "active", updated_at: ago(300) }), ev("E2", { status: "canceled", updated_at: ago(4) })] } };
      if (url.pathname === "/scheduled_events/E1/invitees")
        return { body: { collection: [{ uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1", email: "dana@northwind.io", name: "Dana Reyes", status: "active", old_invitee: "https://api.calendly.com/scheduled_events/E9/invitees/I9" }] } };
      if (url.pathname === "/scheduled_events/E2/invitees")
        return { body: { collection: [{ uri: "https://api.calendly.com/scheduled_events/E2/invitees/I2", email: "lena@glassmoor.com", status: "canceled", rescheduled: false }] } };
      return undefined;
    });

    const r = await calendly("cal_pat_123456", { userUri: "https://api.calendly.com/users/U1" }).booking!.pollEvents({ since });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // E0 didn't change since the last poll, so its invitees aren't read.
    expect(calls.some((c) => c.url.pathname.includes("/E0/"))).toBe(false);
    expect(calls[0].url.searchParams.get("user")).toBe("https://api.calendly.com/users/U1");

    const n = parseInbound("calendly", r.value.events);
    expect(n.bookings).toEqual([
      expect.objectContaining({ externalId: "https://api.calendly.com/scheduled_events/E1", action: "rescheduled", replaces: "https://api.calendly.com/scheduled_events/E9", attendees: [{ email: "dana@northwind.io", name: "Dana Reyes" }] }),
      expect.objectContaining({ externalId: "https://api.calendly.com/scheduled_events/E2", action: "canceled" }),
    ]);
  });

  it("asks to reconnect when it doesn't know whose bookings to read", async () => {
    const r = await calendly("cal_pat_123456", {}).booking!.pollEvents({});
    expect(r.ok).toBe(false);
  });
});

describe("Cal.com polling", () => {
  it("reads new, moved and canceled bookings, with the API version header", async () => {
    const calls = fakeVendor((url) => {
      if (url.pathname === "/v2/me") return { body: { data: { name: "Priya Shah" } } };
      if (url.pathname !== "/v2/bookings") return undefined;
      if (url.searchParams.get("status") === "upcoming")
        return {
          body: {
            data: [
              { uid: "B1", title: "Intro", start: ahead(30), attendees: [{ email: "dana@northwind.io", name: "Dana" }], createdAt: ago(5) },
              { uid: "B3", title: "Intro", start: ahead(50), attendees: [{ email: "kim@kite.io" }], rescheduledFromUid: "B2", createdAt: ago(4) },
            ],
          },
        };
      return {
        body: {
          data: [
            // B2 was moved to B3: its webhook would only say "rescheduled", so it isn't a cancellation.
            { uid: "B2", title: "Intro", start: ahead(20), attendees: [{ email: "kim@kite.io" }], updatedAt: ago(4) },
            { uid: "B4", title: "Demo", start: ahead(10), attendees: [{ email: "lena@glassmoor.com" }], updatedAt: ago(3) },
          ],
        },
      };
    });

    expect(await calcom("cal_live_123456", {}).validate()).toMatchObject({ ok: true, value: { accountLabel: "Priya Shah" } });
    const r = await calcom("cal_live_123456", {}).booking!.pollEvents({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls.every((c) => c.headers["cal-api-version"])).toBe(true);
    const n = parseInbound("calcom", r.value.events);
    expect(n.bookings.map((b) => [b.externalId, b.action, b.replaces ?? null])).toEqual([
      ["B1", "created", null],
      ["B3", "rescheduled", "B2"],
      ["B4", "canceled", null],
    ]);
  });
});

describe("what's polled", () => {
  const hub = (patch: Partial<HubState> = {}): HubState => ({ refs: {}, seen: {}, inbound: [], deliveries: [], sync: [], slack: {}, ...patch });
  const on = { enabled: true, config: {} };

  it("polls lemlist and booking tools connected with a key while no webhook can reach the app", () => {
    const ws = makeWorkspace({ integrations: { lemlist: { id: "lemlist", ...on }, calendly: { id: "calendly", ...on }, calcom: { id: "calcom", ...on } } });
    expect(dueConnectors(ws, hub(), Date.now())).toEqual(["lemlist", "calendly", "calcom"]);
  });

  it("leaves a tool alone while its webhooks arrive at a public URL", () => {
    const ws = makeWorkspace({ integrations: { calendly: { id: "calendly", ...on }, webhook_in: { id: "webhook_in", enabled: true, config: { publicUrl: "https://inroad.example.com" } } } });
    const fresh = hub({ inbound: [{ id: "inb_1", source: "calendly", at: new Date().toISOString(), status: "ok", summary: "1 booking", counts: { accounts: 0, people: 0, activities: 0, meetings: 1, skipped: 0 } }] });
    expect(dueConnectors(ws, fresh, Date.now())).toEqual([]);
    expect(dueConnectors(ws, hub(), Date.now())).toEqual(["calendly"]);
  });
});
