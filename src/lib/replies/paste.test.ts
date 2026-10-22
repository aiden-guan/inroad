import { describe, expect, it } from "vitest";
import type { Connection, Workspace } from "@/lib/domain/types";
import { awaitingOutcome } from "@/lib/moves/replies";
import { NOW, at, makeAccount, makeActivity, makePackage, makePerson, makeStep, makeWorkspace } from "@/test/factories";
import { PasteError, logPastedReply } from "./paste";
import { targetOf } from "./sender";

function workspace(): Workspace {
  const ws = makeWorkspace();
  ws.accounts["northwind.io"] = makeAccount("northwind.io", { name: "Northwind Metrics", peopleIds: ["per_dana"] });
  ws.people.per_dana = makePerson("per_dana", "northwind.io", { name: "Dana Kim", email: "dana@northwind.io" });
  ws.outreach.pkg_1 = makePackage("pkg_1", "northwind.io", { mode: "cold", personId: "per_dana", steps: [makeStep(1, { status: "sent", sentAt: at(-4) }), makeStep(2, { status: "draft" })] });
  ws.activities.push(makeActivity("t1", { kind: "touch_sent", personId: "per_dana", accountDomain: "northwind.io", channel: "email", at: at(-4), draftRef: { packageId: "pkg_1", step: 1 } }));
  return ws;
}

const TEXT = "From: Dana Kim <dana@northwind.io>\nSubject: Re: close\n\nYes, Thursday works.\n\nOn Tue, Oct 20, 2026 at 9:02 AM Priya <priya@ledgerline.io> wrote:\n> Hi Dana";

describe("logPastedReply", () => {
  it("logs their own words, cancels the rest of the sequence and answers Check replies for them", () => {
    const ws = workspace();
    expect(awaitingOutcome(ws, NOW).map((p) => p.personId)).toEqual(["per_dana"]);
    const out = logPastedReply(ws, [], { text: TEXT, target: { personId: "per_dana" } }, NOW);
    expect(out).toMatchObject({ personId: "per_dana", domain: "northwind.io", marked: 1, createdPerson: false, createdAccount: false });
    const reply = ws.activities.find((a) => a.id === out.activityId)!;
    expect(reply).toMatchObject({ kind: "reply_received", personId: "per_dana", accountDomain: "northwind.io", channel: "email", body: "Yes, Thursday works.", source: "founder", at: NOW.toISOString() });
    expect(ws.outreach.pkg_1.steps[1].status).toBe("cancelled_by_reply");
    expect(ws.activities.find((a) => a.id === "t1")?.outcome).toBe("replied");
    expect(awaitingOutcome(ws, NOW)).toEqual([]);
  });

  it("files a new person at their company, adding the company when it's new", () => {
    const ws = workspace();
    const out = logPastedReply(ws, [], { text: "Sure, send times.", target: targetOf({ kind: "new", name: "Ana Ruiz", email: "ana@cinderpath.com", domain: "cinderpath.com", company: "Cinderpath", knownCompany: false, why: "domain" }) }, NOW);
    expect(out).toMatchObject({ domain: "cinderpath.com", createdAccount: true, createdPerson: true, marked: 0 });
    expect(ws.accounts["cinderpath.com"]).toMatchObject({ name: "Cinderpath", status: "new" });
    expect(ws.people[out.personId]).toMatchObject({ name: "Ana Ruiz", email: "ana@cinderpath.com", accountDomain: "cinderpath.com" });
    expect(ws.accounts["cinderpath.com"].peopleIds).toContain(out.personId);
  });

  it("files a LinkedIn connection as a person at their company", () => {
    const ws = workspace();
    const lena: Connection = { id: "c_lena", firstName: "Lena", lastName: "Fischer", url: "https://www.linkedin.com/in/lena", company: "Glassmoor", position: "Head of Billing Ops", companyNorm: "glassmoor", matchedDomain: "glassmoor.com" };
    const out = logPastedReply(ws, [lena], { text: "Happy to help.", target: { connectionId: "c_lena" } }, NOW);
    expect(ws.people[out.personId]).toMatchObject({ name: "Lena Fischer", title: "Head of Billing Ops", linkedinUrl: "https://www.linkedin.com/in/lena", accountDomain: "glassmoor.com" });
    expect(() => logPastedReply(ws, [{ ...lena, id: "c_x", matchedDomain: undefined }], { text: "Hi", target: { connectionId: "c_x" } }, NOW)).toThrow(PasteError);
  });

  it("doesn't file someone who asked to have their details deleted, by address or as a connection", () => {
    const ws = workspace();
    ws.suppression.push({ id: "sup_ana", email: "ana@cinderpath.com", reason: "requested_delete", at: at(-2) });
    const before = { people: Object.keys(ws.people).length, accounts: Object.keys(ws.accounts).length, activities: ws.activities.length };
    const asNew = targetOf({ kind: "new", name: "Ana Ruiz", email: "ana@cinderpath.com", domain: "cinderpath.com", company: "Cinderpath", knownCompany: false, why: "domain" });
    expect(() => logPastedReply(ws, [], { text: "Did you delete me?", target: asNew }, NOW)).toThrow("Ana asked you to delete their details, so I won't keep their reply.");
    const ana: Connection = { id: "c_ana", firstName: "Ana", lastName: "Ruiz", url: "https://www.linkedin.com/in/ana", email: "Ana@cinderpath.com", company: "Cinderpath", position: "CFO", companyNorm: "cinderpath", matchedDomain: "cinderpath.com" };
    expect(() => logPastedReply(ws, [ana], { text: "Did you delete me?", target: { connectionId: "c_ana" } }, NOW)).toThrow(PasteError);
    expect({ people: Object.keys(ws.people).length, accounts: Object.keys(ws.accounts).length, activities: ws.activities.length }).toEqual(before);
    // An unsubscribe alone doesn't stop the founder logging what they said.
    ws.suppression[0].reason = "unsubscribe";
    expect(logPastedReply(ws, [], { text: "Please stop.", target: asNew }, NOW).createdPerson).toBe(true);
  });

  it("keeps a received time from the past, and refuses what it can't file", () => {
    const ws = workspace();
    const out = logPastedReply(ws, [], { text: "Yes", target: { personId: "per_dana" }, receivedAt: at(-1) }, NOW);
    expect(ws.activities.find((a) => a.id === out.activityId)?.at).toBe(at(-1));
    expect(() => logPastedReply(ws, [], { text: " ", target: { personId: "per_dana" } }, NOW)).toThrow("Paste their reply first.");
    expect(() => logPastedReply(ws, [], { text: "Yes", target: { personId: "per_gone" } }, NOW)).toThrow(PasteError);
    expect(() => logPastedReply(ws, [], { text: "Yes", target: { domain: "not a site", name: "X" } }, NOW)).toThrow(PasteError);
  });
});
