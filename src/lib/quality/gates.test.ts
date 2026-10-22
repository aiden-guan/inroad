import { describe, expect, it } from "vitest";
import type { ContactPath, Person, SenderIdentity, Workspace } from "@/lib/domain/types";
import { TODAY, at, makeAccount, makeActivity, makeDossier, makePackage, makePerson, makeStep, makeWorkspace } from "@/test/factories";
import { buildFooter, capUsage, footerPromisesDeletion, jurisdictionFor, outgoingText, preflight, resolveEmail, senderComplete, signOff, type Preflight } from "./gates";

const acme = "acme.example";
const SENDER: SenderIdentity = { name: "Priya Raman", title: "CEO", company: "Ledgerline", email: "priya@ledgerline.example", postalAddress: "450 Example St\n  San Francisco, CA" };

const path = (kind: ContactPath["kind"], value: string, patch: Partial<ContactPath> = {}): ContactPath => ({ kind, value, verified: false, founderConfirmed: false, ...patch });

/** A cold first touch to Ana at Acme, ready to approve. */
function desk(person: Partial<Person> = {}, patch: Partial<Workspace> = {}): Workspace {
  return makeWorkspace({
    sender: SENDER,
    accounts: { [acme]: makeAccount(acme) },
    people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima", email: undefined, contactPaths: [path("published_email", "ana@acme.example", { sourceUrl: "https://www.acme.example/team" })], ...person }) },
    outreach: { pkg: makePackage("pkg", acme, { personId: "per_ana" }) },
    ...patch,
  });
}

function check(ws: Workspace, pkgId = "pkg"): Preflight {
  const pkg = ws.outreach[pkgId];
  return preflight(ws, pkg, pkg.steps[0], TODAY);
}
const blockers = (p: Preflight) => p.blockers.map((b) => b.code);

describe("resolveEmail", () => {
  it("rates each kind of address", () => {
    expect(resolveEmail(undefined)).toEqual({ to: null, path: null, confidence: "none" });
    expect(resolveEmail(makePerson("p", acme, { email: "typed@acme.example" }))).toMatchObject({ to: "typed@acme.example", path: null, confidence: "verified" });
    const rate = (p: ContactPath) => resolveEmail(makePerson("p", acme, { email: undefined, contactPaths: [p] })).confidence;
    expect(rate(path("published_email", "a@acme.example"))).toBe("published");
    expect(rate(path("published_email", "a@acme.example", { verified: true }))).toBe("verified");
    expect(rate(path("role_inbox", "finance@acme.example"))).toBe("role");
    expect(rate(path("pattern_guess", "a@acme.example"))).toBe("guess");
    expect(rate(path("pattern_guess", "a@acme.example", { founderConfirmed: true }))).toBe("verified");
    expect(rate(path("integration", "a@acme.example", { via: "HubSpot" }))).toBe("verified");
    expect(rate(path("linkedin", "https://linkedin.com/in/a"))).toBe("none");
  });

  it("prefers the best kind of path and never uses a bounced one", () => {
    const person = makePerson("p", acme, { email: undefined, contactPaths: [path("pattern_guess", "g@acme.example"), path("published_email", "pub@acme.example")] });
    expect(resolveEmail(person).to).toBe("pub@acme.example");
    const bounced = makePerson("p", acme, { email: undefined, contactPaths: [path("pattern_guess", "g@acme.example", { bounced: true })] });
    expect(resolveEmail(bounced).confidence).toBe("none");
  });

  it("rates a stored email by the path it came from", () => {
    const person = makePerson("p", acme, { email: "G@acme.example", contactPaths: [path("pattern_guess", "g@acme.example")] });
    expect(resolveEmail(person)).toMatchObject({ to: "G@acme.example", confidence: "guess" });
  });
});

describe("jurisdictionFor", () => {
  it("uses the person's stated location, then the company HQ, then whatever the person has", () => {
    const ws = makeWorkspace({ accounts: { [acme]: makeAccount(acme, { dossier: makeDossier({ snapshot: { plainDescription: "", stage: "", jurisdiction: "UK" } }) }) } });
    expect(jurisdictionFor(ws, makePerson("p", acme, { location: "Lisbon", jurisdiction: "EU" }), acme)).toEqual({ value: "EU", basis: "person_location" });
    expect(jurisdictionFor(ws, makePerson("p", acme, { jurisdiction: "US" }), acme)).toEqual({ value: "UK", basis: "company_hq" });
    expect(jurisdictionFor(makeWorkspace(), makePerson("p", acme, { jurisdiction: "CA" }), acme)).toEqual({ value: "CA", basis: "person_location" });
    expect(jurisdictionFor(makeWorkspace(), undefined, acme)).toEqual({ value: "unknown", basis: "unknown" });
  });
});

describe("senderComplete", () => {
  it("needs a name, title, company and postal address", () => {
    expect(senderComplete(makeWorkspace({ sender: SENDER }))).toBe(true);
    expect(senderComplete(makeWorkspace({ sender: { ...SENDER, postalAddress: "  " } }))).toBe(false);
    expect(senderComplete(makeWorkspace())).toBe(false);
  });
});

describe("buildFooter", () => {
  const ws = makeWorkspace({ sender: SENDER });
  const footer = (jurisdiction: "US" | "EU" | "UK" | "unknown", sourceHost: string | null, guessed = false) => buildFooter(ws, { jurisdiction, sourceHost, guessed, companyName: "Acme" });

  it("adds the sender, a one-line postal address and an opt-out to every email", () => {
    expect(footer("US", "acme.example")).toBe(`Priya Raman · CEO, Ledgerline · 450 Example St, San Francisco, CA\nIf this isn't relevant, reply "no" and I won't follow up.`);
  });

  it("says where the address came from in the EU, the UK, or when the location is unknown", () => {
    expect(footer("EU", "acme.example")?.split("\n")[2]).toBe(`I found your work email on acme.example. Reply "stop" and I'll delete your details.`);
    expect(footer("UK", null, true)?.split("\n")[2]).toBe(`I guessed your work email from Acme's address format. Reply "stop" and I'll delete your details.`);
    expect(footer("unknown", null)?.split("\n")[2]).toBe(`Reply "stop" and I'll delete your details.`);
  });

  it("promises deletion exactly where the stop flows offer it first", () => {
    for (const j of ["US", "EU", "UK", "unknown"] as const) expect(footerPromisesDeletion(j)).toBe(!!footer(j, null)?.includes("delete your details"));
    expect(footerPromisesDeletion("US")).toBe(false);
  });

  it("is withheld until the sender details are complete", () => {
    expect(buildFooter(makeWorkspace({ sender: { ...SENDER, title: "" } }), { jurisdiction: "US", sourceHost: null, guessed: false, companyName: "Acme" })).toBeNull();
  });
});

describe("capUsage", () => {
  it("counts cold first touches sent by hand or handed to a sequencer, this week and today", () => {
    const ws = desk();
    ws.caps = { ...ws.caps, firstTouchesPerWeek: 5, firstTouchesPerDayMax: 3 };
    ws.outreach.follow = makePackage("follow", acme, { mode: "follow_up" });
    for (const id of ["a", "b", "c", "d"]) ws.outreach[`pkg_${id}`] = makePackage(`pkg_${id}`, acme);
    const send = (id: string, n: number, kind: "touch_sent" | "pushed" = "touch_sent", pkg = `pkg_${id}`, step = 1) =>
      makeActivity(id, { kind, channel: kind === "touch_sent" ? "email" : "integration", at: at(n), draftRef: { packageId: pkg, step } });
    ws.activities = [send("a", 0), send("b", 0, "pushed"), send("c", -1), send("d", -3), send("e", 0, "touch_sent", "pkg_a", 2), send("f", 0, "touch_sent", "follow")];
    expect(capUsage(ws, TODAY)).toEqual({ thisWeek: 3, today: 2, remainingWeek: 2, remainingToday: 1 });
    // One package's first touch is one send, even when it was pushed to a sequencer and then marked sent.
    ws.activities.push(send("b2", 0, "touch_sent", "pkg_b"));
    expect(capUsage(ws, TODAY).thisWeek).toBe(3);
  });
});

describe("preflight", () => {
  it("passes a published address with a complete sender and adds the footer", () => {
    const p = check(desk());
    expect(p).toMatchObject({ channel: "email", to: "ana@acme.example", emailConfidence: "published", sourceHost: "acme.example", blockers: [], warnings: [] });
    expect(p.footer).toContain("Priya Raman · CEO, Ledgerline");
  });

  it("blocks suppressed and do-not-contact people before anything else", () => {
    expect(blockers(check(desk({}, { suppression: [{ id: "s", domain: "ACME.example", reason: "competitor", at: at(-1) }], sender: null })))).toEqual(["suppressed"]);
    expect(blockers(check(desk({}, { suppression: [{ id: "s", email: "Ana@acme.example", reason: "unsubscribe", at: at(-1) }] })))).toEqual(["suppressed"]);
    expect(blockers(check(desk({ doNotContact: true })))).toEqual(["do_not_contact"]);
  });

  it("asks for a recipient, an address and the sender details", () => {
    const noPerson = desk();
    delete noPerson.outreach.pkg.personId;
    expect(blockers(check(noPerson))).toEqual(["no_recipient"]);
    expect(check(desk({ contactPaths: [] })).blockers).toEqual([{ code: "no_email", text: "No email for Ana Lima yet.", fix: "email" }]);
    expect(check(desk({}, { sender: null }))).toMatchObject({ blockers: [{ code: "sender_incomplete", fix: "sender" }], footer: null });
  });

  it("skips the sender and footer for replies, which answer in the prospect's own thread", () => {
    const ws = desk({}, { sender: null });
    ws.outreach.pkg.mode = "reply";
    expect(check(ws)).toMatchObject({ blockers: [], footer: null });
  });

  it("needs a guessed address verified, and never emails a guess in the EU or UK", () => {
    const guess = { contactPaths: [path("pattern_guess", "ana@acme.example")] };
    expect(check(desk(guess)).blockers).toEqual([expect.objectContaining({ code: "guess_unverified", fix: "verify" })]);
    expect(check(desk({ ...guess, location: "Berlin", jurisdiction: "EU" })).blockers).toEqual([expect.objectContaining({ code: "guess_blocked", fix: "linkedin" })]);
    expect(blockers(check(desk({ ...guess, contactPaths: [path("pattern_guess", "ana@acme.example", { verified: true })] })))).toEqual([]);
  });

  it("pauses guessed addresses when recent bounces pass 2%", () => {
    const ws = desk({ contactPaths: [path("pattern_guess", "ana@acme.example")] });
    for (let i = 0; i < 20; i++) ws.activities.push(makeActivity(`s${i}`, { kind: "touch_sent", channel: "email", at: at(-10 + i * 0.1) }));
    ws.activities.push(makeActivity("bounce", { kind: "bounce", at: at(-2) }));
    expect(check(ws).blockers).toEqual([expect.objectContaining({ code: "guess_blocked", text: expect.stringContaining("bounce rate is over 2%") })]);
  });

  it("allows Canadian addresses only when published on the company's own site", () => {
    const ca = { location: "Toronto", jurisdiction: "CA" as const };
    expect(blockers(check(desk(ca)))).toEqual([]);
    expect(blockers(check(desk({ ...ca, contactPaths: [path("published_email", "ana@acme.example", { sourceUrl: "https://directory.example/acme" })] })))).toEqual(["ca_unpublished"]);
  });

  it("warns about unsourced EU addresses, personal inboxes and role inboxes", () => {
    expect(check(desk({ email: "ana@acme.example", contactPaths: [], location: "Paris", jurisdiction: "EU" })).warnings).toEqual([expect.stringContaining("GDPR Art. 14")]);
    expect(check(desk({ email: "ana.lima@gmail.com", contactPaths: [] })).warnings).toEqual([expect.stringContaining("Personal address")]);
    expect(check(desk({ contactPaths: [path("role_inbox", "finance@acme.example")] })).warnings).toEqual([expect.stringContaining("Role inbox")]);
  });

  it("holds cold first touches to the weekly, daily and per-account caps", () => {
    const sentCold = (ws: Workspace, n: number, when: string, personId?: string) => {
      ws.outreach[`old${n}`] = makePackage(`old${n}`, `o${n}.example`, { steps: [makeStep(1, { status: "sent", sentAt: when })] });
      ws.activities.push(makeActivity(`a${n}`, { kind: "touch_sent", channel: "email", at: when, personId, accountDomain: personId ? acme : `o${n}.example`, draftRef: { packageId: `old${n}`, step: 1 } }));
    };
    const week = desk();
    week.caps = { ...week.caps, firstTouchesPerWeek: 2 };
    sentCold(week, 1, at(-1));
    sentCold(week, 2, at(-1));
    expect(check(week)).toMatchObject({ capRemainingThisWeek: 0, blockers: [expect.objectContaining({ code: "cap_week" })] });

    const today = desk();
    today.caps = { ...today.caps, firstTouchesPerDayMax: 1 };
    sentCold(today, 1, at(0, "08:00"));
    expect(blockers(check(today))).toEqual(["cap_day"]);

    const account = desk();
    sentCold(account, 1, at(-1), "per_bo");
    sentCold(account, 2, at(-1), "per_cy");
    expect(blockers(check(account))).toEqual(["account_week"]);
  });

  it("blocks a second cold first touch to someone emailed in the last 60 days", () => {
    const ws = desk();
    ws.outreach.earlier = makePackage("earlier", acme, { personId: "per_ana", steps: [makeStep(1, { status: "sent", sentAt: at(-10) })] });
    expect(check(ws).blockers).toEqual([expect.objectContaining({ code: "already_contacted", text: expect.stringContaining("Oct 10") })]);
    ws.outreach.earlier.steps[0].sentAt = at(-61);
    expect(blockers(check(ws))).toEqual([]);
  });

  it("runs no email checks for LinkedIn drafts or steps that already went out", () => {
    const li = desk({ contactPaths: [] }, { sender: null });
    li.outreach.pkg.mode = "linkedin";
    expect(check(li)).toMatchObject({ channel: "linkedin", blockers: [], footer: null });
    const sent = desk({ contactPaths: [] });
    sent.outreach.pkg.steps[0].status = "sent";
    expect(blockers(check(sent))).toEqual([]);
  });
});

describe("outgoing text", () => {
  it("signs off with the founder's own sign-off, else their first name", () => {
    const ws = makeWorkspace({ sender: SENDER, founder: { name: "Priya Raman" } });
    expect(signOff(ws)).toBe("Priya");
    ws.voice = { samples: [], summary: "", signOff: "— P", updatedAt: at(-1) };
    expect(signOff(ws)).toBe("— P");
    expect(outgoingText(ws, "  Body.\n", "Footer")).toBe("Body.\n\n— P\n\nFooter");
    expect(outgoingText(makeWorkspace(), "Body.", null)).toBe("Body.");
  });
});
