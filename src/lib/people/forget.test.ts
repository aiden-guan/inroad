import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/workspace/actions/route";
import { applyAction } from "@/lib/domain/actions";
import { handleMcpPost } from "@/lib/api-keys/mcp";
import { createKey } from "@/lib/api-keys/store";
import type { AskTurn, Connection, Person, RunStep, Workspace } from "@/lib/domain/types";
import { receiveInbound } from "@/lib/hub/inbound";
import { mutateHub, readHub } from "@/lib/hub/store";
import { computeMoves, mergeMoves } from "@/lib/moves/rules";
import { computeScoreboard, counters } from "@/lib/moves/scoreboard";
import { capUsage } from "@/lib/quality/cap";
import { readConnections, readNetwork, mutateNetwork, updateConnections } from "@/lib/network/store";
import type { ImportBatch } from "@/lib/network/types";
import { sampleWorkspace } from "@/lib/sample";
import { DOMAIN, PERSON } from "@/lib/sample/ids";
import { DATA_DIR } from "@/lib/store/settings";
import { getThread, putTurn, withThread } from "@/lib/store/threads";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { NOW, TODAY, at, makeAccount, makeActivity, makeDeal, makeMeeting, makePackage, makePerson, makeWorkspace } from "@/test/factories";
import { connectionIsPerson, emailsOf, forgetInImports, forgetInThread, hubRefsOf, namesPerson, redactRunSteps, threadMentions, type ForgettableThread } from "./forget";

/**
 * "Delete their details" is a promise made in writing (the EU/UK cold-email footer), so these
 * tests check the outcome the way a regulator would: after it runs, the workspace and the files
 * beside it hold nothing about the person except their email on the suppression list.
 */

let sample: Workspace;
beforeAll(() => {
  sample = sampleWorkspace(NOW);
  sample.moves = mergeMoves({}, computeMoves(sample, NOW), TODAY);
});

const DANA = "dana@northwind.example";
const forget = (ws: Workspace, id: string = PERSON.dana) => applyAction(ws, { type: "person.forget", id, at: at(0), suppressionId: "sup_forget" });
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Writes runs.json the way the run registry would find it (its cached copy dropped first). */
function writeRunSteps(steps: Record<string, RunStep[]>) {
  (globalThis as unknown as { __fileDBs?: Map<string, unknown> }).__fileDBs?.delete("runs.json");
  fs.writeFileSync(path.join(DATA_DIR, "runs.json"), JSON.stringify(steps));
}

/** The sample, plus a draft to Dana, its card and an intro: everything a deletion has to reach. */
function withDanaEverywhere(): Workspace {
  const s = structuredClone(sample);
  s.outreach.out_dana = makePackage("out_dana", DOMAIN.northwind, { personId: PERSON.dana, mode: "cold" });
  s.moves.mv_draft_out_dana_1 = { ...s.moves.mv_reply_act_034, id: "mv_draft_out_dana_1", ref: { kind: "account", id: DOMAIN.northwind }, draft: { packageId: "out_dana", step: 1 } };
  s.activities.push({ id: "act_dana_touch", at: at(-1), kind: "touch_sent", personId: PERSON.dana, accountDomain: DOMAIN.northwind, channel: "email", draftRef: { packageId: "out_dana", step: 1 }, summary: "First touch to Dana Okafor", body: "Hi Dana, ..." });
  s.intros.intro_dana = { id: "intro_dana", kind: "ask", stage: "asked", personId: PERSON.dana, accountDomain: DOMAIN.northwind, targetName: "Dana Okafor, Controller", askedOn: TODAY, history: [], createdAt: at(0), updatedAt: at(0) };
  s.evidence.ev_named = { id: "ev_named", claim: "Dana Okafor spoke at the close roundtable", quote: "Dana Okafor, Controller at Northwind", url: "https://events.example/close", host: "events.example", sourceType: "press", retrievedAt: at(-3), confidence: "high" };
  s.accounts[DOMAIN.northwind].signals.push({ id: "sig_named", type: "persona_post", headline: "Dana Okafor posted about usage tie-outs", date: TODAY, url: "https://x.example", host: "x.example", evidenceId: "ev_named", strength: 2, usableInOutreach: true, implication: "" });
  // Named as a referral on another company's call.
  const other = Object.values(s.meetings).find((m) => m.debrief && s.deals[m.dealId]?.accountDomain !== DOMAIN.northwind)!;
  other.debrief!.referrals = ["Dana Okafor at Northwind"];
  other.debrief!.referralPeople = [{ name: "Dana Okafor", company: "Northwind" }, { name: "Sam Ortiz" }];
  return s;
}

describe("person.forget", () => {
  it("removes them and everything that names them, keeping only their email as requested_delete", () => {
    const s = withDanaEverywhere();
    const dana = s.people[PERSON.dana];
    const activities = s.activities.length;
    const before = JSON.stringify(s);
    expect(count(before, "Dana Okafor")).toBeGreaterThan(5);
    expect(dana.evidenceIds.length).toBeGreaterThan(0);

    forget(s);

    expect(s.people[PERSON.dana]).toBeUndefined();
    expect(s.accounts[DOMAIN.northwind].peopleIds).not.toContain(PERSON.dana);
    for (const id of [...dana.evidenceIds, "ev_named"]) expect(s.evidence[id]).toBeUndefined();
    expect(s.accounts[DOMAIN.northwind].signals.map((x) => x.id)).not.toContain("sig_named");
    // Drafts, their cards and the intro go; the reply card about them too.
    expect(Object.values(s.outreach).filter((p) => p.personId === PERSON.dana)).toEqual([]);
    expect(s.moves.mv_draft_out_dana_1).toBeUndefined();
    expect(s.moves.mv_reply_act_034).toBeUndefined();
    expect(s.intros.intro_dana).toBeUndefined();
    // History stays as counts, without who or what.
    expect(s.activities).toHaveLength(activities);
    const theirs = s.activities.filter((a) => a.id === "act_dana_touch" || a.id === "act_034");
    expect(theirs).toHaveLength(2);
    for (const a of theirs) {
      expect(a.personId).toBeUndefined();
      expect(a.body).toBeUndefined();
      expect(a.draftRef).toBeUndefined();
      expect(a.summary).toBe("Details deleted at their request");
    }
    expect(Object.values(s.deals).flatMap((d) => d.contacts.map((c) => c.personId))).not.toContain(PERSON.dana);
    expect(Object.values(s.meetings).flatMap((m) => m.attendees.map((x) => x.personId))).not.toContain(PERSON.dana);
    expect(Object.values(s.events).flatMap((e) => Object.values(e.guests).map((g) => g.personId))).not.toContain(PERSON.dana);
    const other = Object.values(s.meetings).find((m) => m.debrief?.referralPeople)!;
    expect(other.debrief!.referralPeople).toEqual([{ name: "Sam Ortiz" }]);
    expect(other.debrief!.referrals).toEqual([]);

    // The suppression entry holds the email and nothing else about them.
    expect(s.suppression.at(-1)).toEqual({ id: "sup_forget", email: DANA, reason: "requested_delete", at: at(0) });
    const after = JSON.stringify(s);
    expect(count(after, "Dana Okafor")).toBe(0);
    expect(count(after, DANA)).toBe(1);
    expect(after).not.toContain(PERSON.dana);
    expect(after).not.toContain("linkedin.example/in/dana-okafor");
  });

  it("gives the same result in the browser and on the server, and is a no-op the second time", () => {
    const a = withDanaEverywhere();
    const b = withDanaEverywhere();
    forget(a);
    forget(b);
    expect(a).toEqual(b);
    const once = structuredClone(a);
    forget(a);
    expect(a).toEqual(once);
  });

  it("upgrades an existing suppression for their address instead of adding a second one", () => {
    const s = structuredClone(sample);
    s.suppression.push({ id: "sup_old", email: "Dana@Northwind.example", reason: "unsubscribe", at: at(-2) });
    forget(s);
    expect(s.suppression.filter((x) => x.email?.toLowerCase() === DANA)).toEqual([{ id: "sup_old", email: "Dana@Northwind.example", reason: "requested_delete", at: at(-2) }]);
  });

  it("suppresses every address on file, and no address when there is none", () => {
    const s = structuredClone(sample);
    s.people.per_two = makePerson("per_two", DOMAIN.northwind, {
      name: "Rui Two",
      email: "rui@northwind.example",
      contactPaths: [
        { kind: "pattern_guess", value: "r.two@northwind.example", verified: false, founderConfirmed: false },
        { kind: "linkedin", value: "https://linkedin.example/in/rui", verified: false, founderConfirmed: false },
      ],
    });
    s.people.per_none = makePerson("per_none", DOMAIN.northwind, { name: "No Mail", email: undefined });
    const n = s.suppression.length;
    forget(s, "per_two");
    forget(s, "per_none");
    expect(s.suppression.slice(n)).toEqual([
      { id: "sup_forget", email: "rui@northwind.example", reason: "requested_delete", at: at(0) },
      { id: "sup_forget_2", email: "r.two@northwind.example", reason: "requested_delete", at: at(0) },
    ]);
    expect(s.people.per_none).toBeUndefined();
  });

  it("takes their first name out of a next step on a deal they were a contact on", () => {
    const s = structuredClone(sample);
    const deal = Object.values(s.deals).find((d) => d.contacts.some((c) => c.personId === PERSON.dana))!;
    deal.nextStep = { what: "Call with Dana", date: TODAY, buyerAgreed: true };
    forget(s);
    expect(s.deals[deal.id].nextStep?.what).toBe("Call with a deleted contact");
  });

  it("drops a warm path that ran through them", () => {
    const s = structuredClone(sample);
    s.people.per_other = makePerson("per_other", DOMAIN.northwind, { contactPaths: [{ kind: "warm_intro", value: "x", via: "Dana Okafor", verified: true, founderConfirmed: true }] });
    forget(s);
    expect(s.people.per_other.contactPaths).toEqual([]);
  });

  it("takes their address out of other records, and deletes a source that quotes it", () => {
    const s = structuredClone(sample);
    s.activities.push({ id: "act_cc", at: at(-1), kind: "note", accountDomain: DOMAIN.northwind, summary: "Looped in finance", body: `cc ${DANA.toUpperCase()} on the pricing thread`, source: "founder" });
    s.evidence.ev_mail = { id: "ev_mail", claim: "Finance inbox on the contact page", quote: `Questions? Write to ${DANA}`, url: "https://northwind.example/contact", host: "northwind.example", sourceType: "first_party", retrievedAt: at(-3), confidence: "high" };
    forget(s);
    expect(s.activities.find((a) => a.id === "act_cc")?.body).toBe("cc a deleted contact on the pricing thread");
    expect(s.evidence.ev_mail).toBeUndefined();
    expect(count(JSON.stringify(s).toLowerCase(), DANA)).toBe(1);
  });
});

describe("Ask conversations", () => {
  const dana = makePerson(PERSON.dana, DOMAIN.northwind, { name: "Dana Okafor", email: DANA, linkedinUrl: "https://www.linkedin.com/in/dana-okafor/" });
  const turn = (id: string, role: AskTurn["role"], text: string, patch: Partial<AskTurn> = {}): AskTurn => ({ id, role, text, at: at(0), ...patch });

  /** A conversation on Northwind that reached Dana through a lookup, a web page and the model's own thinking. */
  function aboutNorthwind(): ForgettableThread {
    return {
      title: "Who should I write to at Northwind? Dana Okafor?",
      context: { kind: "account", id: DOMAIN.northwind },
      contextLabel: "Northwind",
      noted: { contextKey: `account:${DOMAIN.northwind}`, digestHash: "abc" },
      turns: [
        turn("t1", "founder", "Who should I write to at Northwind? Dana Okafor?"),
        turn("t2", "agent", `Dana Okafor (${DANA}) owns the close. Marcus is the champion.`, {
          records: [
            { ref: { kind: "person", id: PERSON.dana }, label: "Dana Okafor" },
            { ref: { kind: "account", id: DOMAIN.northwind }, label: "Northwind" },
          ],
          proposals: [
            { id: "p1", kind: "start_workflow", summary: "Draft to her", reason: "", payload: { workflow: "compose", args: { domain: DOMAIN.northwind, personId: PERSON.dana } }, status: "proposed" },
            { id: "p2", kind: "start_workflow", summary: "Draft to Marcus", reason: "", payload: { workflow: "compose", args: { domain: DOMAIN.northwind, personId: "per_marcus" } }, status: "proposed" },
            { id: "p3", kind: "suppress", summary: "Suppress her", reason: "", payload: { email: DANA }, status: "proposed" },
          ],
          citations: [{ url: "https://www.linkedin.com/in/dana-okafor/", title: "Profile" }, { url: "https://northwind.example/about", title: "About Northwind" }],
        }),
        turn("t3", "founder", "And their CFO?"),
        turn("t4", "agent", "", { error: { code: "unknown", message: "Something went wrong." } }),
        turn("t5", "founder", "Try again: their CFO?"),
        turn("t6", "agent", "Nobody on file yet.", { instant: { title: "People at Northwind", rows: [{ label: "Dana Okafor", ref: { kind: "person", id: PERSON.dana } }, { label: "Marcus Lindqvist" }] } }),
      ],
      messages: [
        { role: "user", content: [{ type: "text", text: "Who should I write to at Northwind? Dana Okafor?" }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "Dana Okafor is the controller.", signature: "sig" }, { type: "tool_use", id: "tu_1", name: "search", input: { q: "Dana Okafor" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: `{"id":"${PERSON.dana}","email":"${DANA}"}` }] },
        { role: "assistant", content: [{ type: "text", text: "Dana Okafor owns the close." }] },
      ],
    };
  }

  it("deletes a conversation opened on their record", () => {
    expect(forgetInThread({ ...aboutNorthwind(), context: { kind: "person", id: PERSON.dana } }, dana)).toBe("delete");
  });

  it("redacts the founder's view and rebuilds the model's history from it, without tool results or thinking", () => {
    const t = aboutNorthwind();
    expect(threadMentions(t, dana)).toBe(true);
    expect(forgetInThread(t, dana)).toBe(true);
    expect(t.title).toBe("Who should I write to at Northwind? a deleted contact?");
    expect(t.turns[1].text).toBe("a deleted contact (a deleted contact) owns the close. Marcus is the champion.");
    expect(t.turns[1].records?.map((r) => r.label)).toEqual(["Northwind"]);
    expect(t.turns[1].proposals?.map((p) => p.id)).toEqual(["p2"]);
    expect(t.turns[1].citations?.map((c) => c.title)).toEqual(["About Northwind"]);
    expect(t.turns[5].instant?.rows).toEqual([{ label: "Marcus Lindqvist" }]);
    // Plain text, alternating, starting with the founder and ending on an answer; the failed answer is skipped.
    expect(t.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Who should I write to at Northwind? a deleted contact?" }] },
      { role: "assistant", content: [{ type: "text", text: "a deleted contact (a deleted contact) owns the close. Marcus is the champion." }] },
      { role: "user", content: [{ type: "text", text: "And their CFO?\n\nTry again: their CFO?" }] },
      { role: "assistant", content: [{ type: "text", text: "Nobody on file yet." }] },
    ]);
    expect(t.noted).toBeUndefined();
    const all = JSON.stringify(t);
    expect(all).not.toContain("Okafor");
    expect(all).not.toContain(DANA);
    expect(all).not.toContain(PERSON.dana);
    expect(threadMentions(t, dana)).toBe(false);
  });

  it("leaves a conversation that never mentions them exactly as it was", () => {
    const t: ForgettableThread = { title: "Pricing", turns: [turn("t1", "founder", "How should I price?")], messages: [{ role: "user", content: "How should I price?" }], noted: { date: TODAY } };
    const before = structuredClone(t);
    expect(forgetInThread(t, dana)).toBe(false);
    expect(t).toEqual(before);
  });

  it("finds their CRM links by address", () => {
    const refs = { [`hubspot:person:${DANA}`]: { id: "1", at: at(0) }, "attio:person:sam@elsewhere.example": { id: "2", at: at(0) }, [`hubspot:company:${DOMAIN.northwind}`]: { id: "3", at: at(0) } };
    expect(hubRefsOf(refs, dana)).toEqual([`hubspot:person:${DANA}`]);
  });
});

describe("matching", () => {
  const dana: Person = makePerson(PERSON.dana, DOMAIN.northwind, { name: "Dana Okafor", email: DANA, linkedinUrl: "https://www.linkedin.com/in/dana-okafor/" });
  const row = (patch: Partial<Connection>): Connection => ({ id: "c1", firstName: "Sam", lastName: "Lee", url: "https://www.linkedin.com/in/sam", company: "Elsewhere", position: "CFO", companyNorm: "elsewhere", ...patch });

  it("names a person only by their whole full name", () => {
    expect(namesPerson("Met dana okafor at the roundtable", dana)).toBe(true);
    expect(namesPerson("Dana Okaforson", dana)).toBe(false);
    expect(namesPerson("Dana said yes", dana)).toBe(false);
    expect(namesPerson("Cher", makePerson("p", "x.example", { name: "Cher" }))).toBe(false);
    expect(emailsOf({ ...dana, contactPaths: [{ kind: "linkedin", value: "https://linkedin.com/in/x@y", verified: false, founderConfirmed: false }] })).toEqual([DANA]);
  });

  it("finds their connection row by id, profile, email, or name at the same company", () => {
    expect(connectionIsPerson(row({ personId: PERSON.dana }), dana)).toBe(true);
    expect(connectionIsPerson(row({ url: "linkedin.com/in/dana-okafor" }), dana)).toBe(true);
    expect(connectionIsPerson(row({ email: "DANA@northwind.example" }), dana)).toBe(true);
    expect(connectionIsPerson(row({ firstName: "Dana", lastName: "Okafor", company: "Northwind, Inc." }), dana, "Northwind")).toBe(true);
    expect(connectionIsPerson(row({ firstName: "Dana", lastName: "Okafor", matchedDomain: DOMAIN.northwind }), dana)).toBe(true);
    // Someone else with the same name, somewhere else.
    expect(connectionIsPerson(row({ firstName: "Dana", lastName: "Okafor" }), dana, "Northwind")).toBe(false);
  });

  it("clears them from import history and run logs", () => {
    const batch = { created: { accounts: [], people: [PERSON.dana, "per_x"] }, filled: [{ kind: "person", id: PERSON.dana, field: "email", value: DANA }, { kind: "account", id: DOMAIN.northwind, field: "hqCity", value: "NYC" }] } as unknown as ImportBatch;
    expect(forgetInImports([batch], PERSON.dana)).toBe(true);
    expect(batch.created.people).toEqual(["per_x"]);
    expect(batch.filled).toHaveLength(1);
    expect(forgetInImports([batch], PERSON.dana)).toBe(false);

    const steps: Record<string, RunStep[]> = { run_a: [{ at: at(0), type: "status", text: "Reading Dana's reply" }], run_b: [{ at: at(0), type: "status", text: "Dana elsewhere" }] };
    expect(redactRunSteps(steps, ["run_a"], dana)).toBe(true);
    expect(steps.run_a[0].text).toBe("Reading a deleted contact's reply");
    expect(steps.run_b[0].text).toBe("Dana elsewhere");
  });
});

describe("POST /api/workspace/actions with person.forget", () => {
  it("also clears their connection row, import history and run logs", async () => {
    const s = structuredClone(sample);
    s.runs.unshift({ id: "run_dana", workflow: "compose", title: "Reading Dana's reply", ref: { kind: "account", id: DOMAIN.northwind }, startedAt: at(0), status: "done" });
    await replaceWorkspace(s);
    await updateConnections((rows) => {
      rows.splice(0, rows.length, { id: "c_dana", firstName: "Dana", lastName: "Okafor", url: "https://linkedin.example/in/dana-okafor", company: "Northwind", position: "Controller", companyNorm: "northwind" }, { id: "c_other", firstName: "Sam", lastName: "Lee", url: "https://linkedin.example/in/sam", company: "Elsewhere", position: "CFO", companyNorm: "elsewhere" });
    });
    await mutateNetwork((n) => {
      n.imports = [{ id: "imp_1", kind: "csv", fileName: "list.csv", importedAt: at(-5), rows: 1, skipped: 0, counts: { accountsCreated: 0, accountsUpdated: 0, peopleCreated: 1, peopleUpdated: 0 }, created: { accounts: [], people: [PERSON.dana] }, filled: [], statusChanged: [] }];
    });
    fs.writeFileSync(path.join(DATA_DIR, "runs.json"), JSON.stringify({ run_dana: [{ at: at(0), type: "status", text: "Reading Dana's reply" }] }));

    const res = await POST(new Request("http://localhost/api/workspace/actions", { method: "POST", body: JSON.stringify({ actions: [{ type: "person.forget", id: PERSON.dana, at: at(0), suppressionId: "sup_api" }] }) }));
    expect(res.status).toBe(200);
    const ws = (await res.json()) as Workspace;
    expect(ws.people[PERSON.dana]).toBeUndefined();
    expect(readWorkspace().people[PERSON.dana]).toBeUndefined();
    expect(ws.runs.find((r) => r.id === "run_dana")?.title).toBe("Reading a deleted contact's reply");
    expect(readConnections().map((r) => r.id)).toEqual(["c_other"]);
    expect(readNetwork().imports[0].created.people).toEqual([]);
    expect(fs.readFileSync(path.join(DATA_DIR, "runs.json"), "utf8")).not.toContain("Dana");
  });

  it("takes their full name out of an Ask run's log too, which quotes the question that named them", async () => {
    const s = structuredClone(sample);
    s.runs.unshift({ id: "run_ask", workflow: "ask", title: "Answering your question", startedAt: at(0), status: "done" });
    await replaceWorkspace(s);
    writeRunSteps({
      run_ask: [{ at: at(0), type: "thinking", text: "Reading what was asked: Should I email Dana Okafor at Northwind this week?" }],
      run_other: [{ at: at(0), type: "status", text: "Dana elsewhere" }],
    });

    const res = await POST(new Request("http://localhost/api/workspace/actions", { method: "POST", body: JSON.stringify({ actions: [{ type: "person.forget", id: PERSON.dana, at: at(0), suppressionId: "sup_ask" }] }) }));
    expect(res.status).toBe(200);
    const steps = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "runs.json"), "utf8")) as Record<string, RunStep[]>;
    expect(steps.run_ask[0].text).toBe("Reading what was asked: Should I email a deleted contact at Northwind this week?");
    // A first name alone, in a run that isn't about them, may be someone else.
    expect(steps.run_other[0].text).toBe("Dana elsewhere");
  });

  it("also reaches their Ask conversations and their CRM links, and leaves the rest alone", async () => {
    await replaceWorkspace(structuredClone(sample));
    const init = (title: string, context?: { kind: "person" | "account"; id: string }) => () => ({ title, context, createdAt: at(0), updatedAt: at(0) });
    await withThread("thr_dana", init("About Dana", { kind: "person", id: PERSON.dana }), (t) => putTurn(t, { id: "t1", role: "founder", text: "Is Dana Okafor the buyer?", at: at(0) }));
    await withThread("thr_acct", init("Northwind", { kind: "account", id: DOMAIN.northwind }), (t) => {
      putTurn(t, { id: "t1", role: "founder", text: "Should I loop in Dana Okafor?", at: at(0) });
      putTurn(t, { id: "t2", role: "agent", text: "Yes, she owns the close.", at: at(0) });
      t.messages.push({ role: "user", content: "Should I loop in Dana Okafor?" }, { role: "assistant", content: [{ type: "thinking", thinking: `${DANA}`, signature: "s" }, { type: "text", text: "Yes, she owns the close." }] });
    });
    await withThread("thr_other", init("Pricing"), (t) => putTurn(t, { id: "t1", role: "founder", text: "How should I price?", at: at(0) }));
    await mutateHub((h) => {
      h.refs[`hubspot:person:${DANA}`] = { id: "hs_1", at: at(0) };
      h.refs[`hubspot:company:${DOMAIN.northwind}`] = { id: "hs_2", at: at(0) };
    });

    const res = await POST(new Request("http://localhost/api/workspace/actions", { method: "POST", body: JSON.stringify({ actions: [{ type: "person.forget", id: PERSON.dana, at: at(0), suppressionId: "sup_api2" }] }) }));
    expect(res.status).toBe(200);
    expect(getThread("thr_dana")).toBeUndefined();
    expect(getThread("thr_acct")?.turns[0].text).toBe("Should I loop in a deleted contact?");
    expect(getThread("thr_acct")?.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Should I loop in a deleted contact?" }] },
      { role: "assistant", content: [{ type: "text", text: "Yes, she owns the close." }] },
    ]);
    expect(getThread("thr_other")?.turns[0].text).toBe("How should I price?");
    const file = fs.readFileSync(path.join(DATA_DIR, "threads.json"), "utf8");
    expect(file).not.toContain("Okafor");
    expect(file).not.toContain(DANA);
    expect(Object.keys(readHub().refs)).toEqual([`hubspot:company:${DOMAIN.northwind}`]);
  });
});

describe("their history still counts", () => {
  it("keeps the cold cap, the per-company contact count and the scoreboard where they were", () => {
    const ws = makeWorkspace();
    ws.caps.firstTouchesPerDayMax = 1;
    ws.accounts["eu.example"] = makeAccount("eu.example", { peopleIds: ["per_e"] });
    ws.people.per_e = makePerson("per_e", "eu.example", { jurisdiction: "EU" });
    ws.outreach.pkg_c = makePackage("pkg_c", "eu.example", { personId: "per_e", mode: "cold" });
    const now = new Date();
    applyAction(ws, { type: "outreach.approveStep", packageId: "pkg_c", step: 1, at: now.toISOString(), activityId: "act_1" });
    const before = { cap: capUsage(ws), first: computeScoreboard(ws, now).firstTouches, people: counters(ws, now).peopleThisWeek.get("eu.example")?.size };
    expect(before.cap).toMatchObject({ today: 1, remainingToday: 0 });

    applyAction(ws, { type: "person.forget", id: "per_e", at: now.toISOString(), suppressionId: "sup_e" });
    expect(ws.activities[0]).toMatchObject({ summary: "Details deleted at their request", forgotten: { who: "sup_e", draft: { packageId: "pkg_c", step: 1, mode: "cold" } } });
    expect(ws.activities[0].personId).toBeUndefined();
    expect({ cap: capUsage(ws), first: computeScoreboard(ws, now).firstTouches, people: counters(ws, now).peopleThisWeek.get("eu.example")?.size }).toEqual(before);
  });
});

describe("two people with the same name", () => {
  /** Sam Lee at a.com asked to be deleted; another Sam Lee is the CFO and champion at b.com. */
  function twoSams(): Workspace {
    const ws = makeWorkspace();
    ws.accounts["a.com"] = makeAccount("a.com", { name: "Alpha", peopleIds: ["per_1"], dealId: "deal_a" });
    ws.accounts["b.com"] = makeAccount("b.com", {
      name: "Bravo",
      peopleIds: ["per_2"],
      dealId: "deal_b",
      signals: [{ id: "sig_b", type: "persona_post", headline: "Sam Lee posted about month-end at Bravo", date: TODAY, url: "https://x.example/b", host: "x.example", strength: 2, usableInOutreach: true, implication: "" }],
    });
    ws.people.per_1 = makePerson("per_1", "a.com", { name: "Sam Lee", email: "sam@a.com", jurisdiction: "EU" });
    ws.people.per_2 = makePerson("per_2", "b.com", { name: "Sam Lee", email: "sam.lee@b.com", title: "CFO", notes: "Sam Lee wants a usage report" });
    ws.deals.deal_a = makeDeal("deal_a", "a.com", { contacts: [{ personId: "per_1" }], card: { champion: { name: "Sam Lee" }, economicBuyer: {} } as never });
    ws.deals.deal_b = makeDeal("deal_b", "b.com", { contacts: [{ personId: "per_2", role: "champion" }], card: { champion: { name: "Sam Lee" }, economicBuyer: { name: "Sam Lee" } } as never });
    ws.meetings.m_a = makeMeeting("m_a", "deal_a", { attendees: [{ name: "Sam Lee" }], notesRaw: "Sam Lee said the close takes a week" });
    ws.meetings.m_b = makeMeeting("m_b", "deal_b", { attendees: [{ personId: "per_2", name: "Sam Lee" }], notesRaw: "Sam Lee owns the budget" });
    ws.activities.push(makeActivity("act_b", { kind: "meeting_held", personId: "per_2", accountDomain: "b.com", summary: "Call with Sam Lee at Bravo" }));
    return ws;
  }

  it("deletes only the one asked for, by id and address, and leaves the other's records alone", () => {
    const ws = twoSams();
    const other = structuredClone({ person: ws.people.per_2, deal: ws.deals.deal_b, meeting: ws.meetings.m_b, account: ws.accounts["b.com"], act: ws.activities.at(-1) });
    applyAction(ws, { type: "person.forget", id: "per_1", at: at(0), suppressionId: "sup_sam" });

    expect(ws.people.per_1).toBeUndefined();
    expect({ person: ws.people.per_2, deal: ws.deals.deal_b, meeting: ws.meetings.m_b, account: ws.accounts["b.com"], act: ws.activities.find((a) => a.id === "act_b") }).toEqual(other);
    // Their own company's records still lose their name.
    expect(ws.deals.deal_a.card?.champion.name).toBeUndefined();
    expect(ws.meetings.m_a.attendees).toEqual([]);
    expect(ws.meetings.m_a.notesRaw).toBe("a deleted contact said the close takes a week");
    expect(count(JSON.stringify(ws), "sam@a.com")).toBe(1);
    expect(ws.suppression.map((x) => x.email)).toEqual(["sam@a.com"]);
  });

  it("leaves the other's Ask conversation alone", async () => {
    await replaceWorkspace(twoSams());
    await withThread("thr_b", () => ({ title: "Sam Lee at Bravo", context: { kind: "person" as const, id: "per_2" }, createdAt: at(0), updatedAt: at(0) }), (t) => putTurn(t, { id: "t1", role: "founder", text: "Is Sam Lee the buyer?", at: at(0) }));
    const res = await POST(new Request("http://localhost/api/workspace/actions", { method: "POST", body: JSON.stringify({ actions: [{ type: "person.forget", id: "per_1", at: at(0), suppressionId: "sup_sam" }] }) }));
    expect(res.status).toBe(200);
    expect(getThread("thr_b")?.turns[0].text).toBe("Is Sam Lee the buyer?");
    expect(readWorkspace().people.per_2.name).toBe("Sam Lee");
  });

  it("leaves the other's name in run logs", async () => {
    await replaceWorkspace(twoSams());
    writeRunSteps({ run_ask: [{ at: at(0), type: "thinking", text: "Reading what was asked: Is Sam Lee the buyer at Bravo?" }] });
    const res = await POST(new Request("http://localhost/api/workspace/actions", { method: "POST", body: JSON.stringify({ actions: [{ type: "person.forget", id: "per_1", at: at(0), suppressionId: "sup_sam2" }] }) }));
    expect(res.status).toBe(200);
    expect(fs.readFileSync(path.join(DATA_DIR, "runs.json"), "utf8")).toContain("Is Sam Lee the buyer at Bravo?");
  });
});

describe("after deletion", () => {
  it("a connected tool or an agent doesn't bring them back", async () => {
    const s = structuredClone(sample);
    forget(s);
    await replaceWorkspace(s);
    const people = Object.keys(s.people).length;
    const isDana = (p: Person) => p.email === DANA || p.contactPaths.some((c) => c.value === DANA);

    // A CRM or Clay row with their address, and their sequencer's late unsubscribe.
    const synced = await receiveInbound("zapier", { people: [{ email: DANA, first_name: "Dana", last_name: "Okafor", company_domain: DOMAIN.northwind }] }, "dlv_forget_1");
    expect(synced.counts).toMatchObject({ people: 0, skipped: 1 });
    const late = await receiveInbound("zapier", { activities: [{ type: "unsubscribe", email: DANA, id: "evt_unsub" }] }, "dlv_forget_2");
    expect(late.counts).toMatchObject({ people: 0, activities: 0, skipped: 1 });

    // An agent logging a reply from them: kept on the company, without a person.
    const { token } = await createKey({ name: "Agent", client: "other", scopes: ["write_records"] });
    const res = await handleMcpPost(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { host: "localhost:3000", "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "log_activity", arguments: { type: "reply", email: DANA, summary: "Replied", source_tool: "muse", external_id: "m_1" } } }),
      }),
    );
    expect(res.status).toBe(200);
    const after = readWorkspace();
    expect(Object.keys(after.people)).toHaveLength(people);
    expect(Object.values(after.people).filter(isDana)).toEqual([]);
    expect(after.activities.at(-1)).toMatchObject({ kind: "reply_received", accountDomain: DOMAIN.northwind });
    expect(after.activities.at(-1)?.personId).toBeUndefined();
  });
});
