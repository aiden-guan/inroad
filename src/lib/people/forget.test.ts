import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/workspace/actions/route";
import { applyAction } from "@/lib/domain/actions";
import type { Connection, Person, RunStep, Workspace } from "@/lib/domain/types";
import { computeMoves, mergeMoves } from "@/lib/moves/rules";
import { readConnections, readNetwork, mutateNetwork, updateConnections } from "@/lib/network/store";
import type { ImportBatch } from "@/lib/network/types";
import { sampleWorkspace } from "@/lib/sample";
import { DOMAIN, PERSON } from "@/lib/sample/ids";
import { DATA_DIR } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { NOW, TODAY, at, makePackage, makePerson } from "@/test/factories";
import { connectionIsPerson, emailsOf, forgetInImports, namesPerson, redactRunSteps } from "./forget";

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

/** The sample, plus a draft to Dana, its card and an intro: everything a deletion has to reach. */
function withDanaEverywhere(): Workspace {
  const s = structuredClone(sample);
  s.outreach.out_dana = makePackage("out_dana", DOMAIN.northwind, { personId: PERSON.dana, mode: "cold" });
  s.moves.mv_draft_out_dana_1 = { ...s.moves.mv_reply_act_034, id: "mv_draft_out_dana_1", ref: { kind: "account", id: DOMAIN.northwind }, draft: { packageId: "out_dana", step: 1 } };
  s.activities.push({ id: "act_dana_touch", at: at(-1), kind: "touch_sent", personId: PERSON.dana, accountDomain: DOMAIN.northwind, channel: "email", draftRef: { packageId: "out_dana", step: 1 }, summary: "First touch to Dana Okafor", body: "Hi Dana, ..." });
  s.intros.intro_dana = { id: "intro_dana", kind: "ask", stage: "asked", personId: PERSON.dana, accountDomain: DOMAIN.northwind, targetName: "Dana Okafor, Controller", askedOn: TODAY, history: [], createdAt: at(0), updatedAt: at(0) };
  s.evidence.ev_named = { id: "ev_named", claim: "Dana Okafor spoke at the close roundtable", quote: "Dana Okafor, Controller at Northwind", url: "https://events.example/close", host: "events.example", sourceType: "press", retrievedAt: at(-3), confidence: "high" };
  s.accounts[DOMAIN.northwind].signals.push({ id: "sig_named", type: "persona_post", headline: "Dana Okafor posted about usage tie-outs", date: TODAY, url: "https://x.example", host: "x.example", evidenceId: "ev_named", strength: 2, usableInOutreach: true, implication: "" });
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

  it("suppresses every address on file, and keeps nothing when there is none", () => {
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

  it("drops a warm path that ran through them", () => {
    const s = structuredClone(sample);
    s.people.per_other = makePerson("per_other", DOMAIN.northwind, { contactPaths: [{ kind: "warm_intro", value: "x", via: "Dana Okafor", verified: true, founderConfirmed: true }] });
    forget(s);
    expect(s.people.per_other.contactPaths).toEqual([]);
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
});
