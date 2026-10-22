import { describe, expect, it } from "vitest";
import type { Connection, Workspace } from "@/lib/domain/types";
import { NOW, at, makeAccount, makeActivity, makePerson, makeWorkspace } from "@/test/factories";
import { matchSender, ownIdentity, parseSender, replyBody, type OwnIdentity } from "./sender";

const own: OwnIdentity = { emails: ["priya@ledgerline.io"], domains: ["ledgerline.io"] };

function conn(id: string, patch: Partial<Connection> = {}): Connection {
  return { id, firstName: "Lena", lastName: "Fischer", url: `https://www.linkedin.com/in/${id}`, company: "Glassmoor", position: "Head of Billing Ops", companyNorm: "glassmoor", ...patch };
}

function workspace(): Workspace {
  const ws = makeWorkspace({ founder: { name: "Priya Raman", email: "priya@ledgerline.io" } });
  ws.accounts["northwind.io"] = makeAccount("northwind.io", { name: "Northwind Metrics", peopleIds: ["per_dana", "per_sam"] });
  ws.people.per_dana = makePerson("per_dana", "northwind.io", { name: "Dana Kim", title: "VP Finance", email: "dana@northwind.io" });
  ws.people.per_sam = makePerson("per_sam", "northwind.io", { name: "Sam Ortiz", email: undefined, contactPaths: [] });
  ws.accounts["pave.io"] = makeAccount("pave.io", { name: "Pave", peopleIds: ["per_dana2"] });
  ws.people.per_dana2 = makePerson("per_dana2", "pave.io", { name: "Dana Lopez", email: "dlopez@pave.io" });
  return ws;
}

describe("parseSender", () => {
  it("reads a mail client's From: header", () => {
    const text = "From: Dana Kim <dana@northwind.io>\nSent: Tuesday, October 20, 2026 2:14 PM\nTo: Priya Raman <priya@ledgerline.io>\nSubject: Re: close\n\nSounds good.";
    expect(parseSender(text, own)).toEqual({ email: "dana@northwind.io", name: "Dana Kim" });
  });

  it("reads Gmail's first line and turns 'Last, First' around", () => {
    expect(parseSender("Dana Kim <dana@northwind.io>\n2:14 PM (5 minutes ago)\nto me\n\nYes, Thursday works.", own)).toEqual({ email: "dana@northwind.io", name: "Dana Kim" });
    expect(parseSender('From: "Kim, Dana" <Dana@Northwind.io>\n\nOk', own)).toEqual({ email: "dana@northwind.io", name: "Dana Kim" });
  });

  it("never takes the founder's own address from the quoted original", () => {
    const text = "Happy to chat next week.\n\nBest,\nDana\n\nOn Tue, Oct 20, 2026 at 9:02 AM Priya Raman <priya@ledgerline.io> wrote:\n> Hi Dana,";
    expect(parseSender(text, own)).toEqual({ name: "Dana" });
  });

  it("falls back to any other address, and to the name under a sign-off or a dash", () => {
    expect(parseSender("Let's talk. Reach me at sam.ortiz@northwind.io\n\nThanks,\nSam Ortiz", own)).toEqual({ email: "sam.ortiz@northwind.io", name: "Sam Ortiz" });
    expect(parseSender("Not right now, maybe Q1.\n— Lena", own)).toEqual({ name: "Lena" });
    expect(parseSender("ok", own)).toEqual({});
  });

  it("knows the founder from the workspace", () => {
    const ws = workspace();
    ws.company = { domain: "ledgerline.io" } as Workspace["company"];
    expect(ownIdentity(ws)).toEqual({ emails: ["priya@ledgerline.io"], domains: ["ledgerline.io"] });
  });
});

describe("replyBody", () => {
  it("keeps their words and drops copied headers and the quoted thread", () => {
    const text = "From: Dana Kim <dana@northwind.io>\nTo: Priya <priya@ledgerline.io>\nSubject: Re: close\n\nYes, Thursday works.\n\nDana\n\nOn Tue, Oct 20, 2026 at 9:02 AM Priya Raman <priya@ledgerline.io> wrote:\n> Hi Dana,\n> quick question";
    expect(replyBody(text)).toBe("Yes, Thursday works.\n\nDana");
    expect(replyBody("Dana Kim <dana@northwind.io>\n2:14 PM (5 minutes ago)\nto me\n\nSure.\n> quoted")).toBe("Sure.");
  });

  it("keeps the whole paste when there's nothing to strip", () => {
    expect(replyBody("Sounds great, send times.")).toBe("Sounds great, send times.");
  });
});

describe("matchSender", () => {
  it("matches a person on file by email first", () => {
    const ws = workspace();
    expect(matchSender(ws, [], { email: "dana@northwind.io", name: "Dana Kim" }, NOW)[0]).toMatchObject({ kind: "person", personId: "per_dana", why: "email", company: "Northwind Metrics" });
    // A contact path counts as their address too.
    ws.people.per_sam.contactPaths = [{ kind: "published_email", value: "sam@northwind.io", verified: true, founderConfirmed: false }];
    expect(matchSender(ws, [], { email: "SAM@northwind.io" }, NOW)[0]).toMatchObject({ kind: "person", personId: "per_sam" });
  });

  it("at a known company with a new address, finds them by name, else offers them as someone new there", () => {
    const ws = workspace();
    expect(matchSender(ws, [], { email: "sam.ortiz@northwind.io", name: "Sam Ortiz" }, NOW)[0]).toMatchObject({ kind: "person", personId: "per_sam", why: "name" });
    expect(matchSender(ws, [], { email: "jo.lee@northwind.io" }, NOW)[0]).toEqual({
      kind: "new",
      name: "Jo Lee",
      email: "jo.lee@northwind.io",
      domain: "northwind.io",
      company: "Northwind Metrics",
      knownCompany: true,
      why: "domain",
    });
  });

  it("offers a company it hasn't seen from a work address, never from a personal mailbox", () => {
    const ws = workspace();
    expect(matchSender(ws, [], { email: "ana@cinderpath.com", name: "Ana Ruiz" }, NOW)).toEqual([
      { kind: "new", name: "Ana Ruiz", email: "ana@cinderpath.com", domain: "cinderpath.com", company: "Cinderpath", knownCompany: false, why: "domain" },
    ]);
    expect(matchSender(ws, [], { email: "ana.ruiz@gmail.com" }, NOW)).toEqual([]);
  });

  it("matches a name alone among people on file, a first name among people recently written to", () => {
    const ws = workspace();
    expect(matchSender(ws, [], { name: "Dana Kim" }, NOW).map((m) => m.kind === "person" && m.personId)).toEqual(["per_dana"]);
    // Two Danas on file and neither written to: both are offered.
    expect(matchSender(ws, [], { name: "Dana" }, NOW).map((m) => m.kind === "person" && m.personId).sort()).toEqual(["per_dana", "per_dana2"]);
    ws.activities.push(makeActivity("t1", { kind: "touch_sent", personId: "per_dana2", at: at(-3) }));
    expect(matchSender(ws, [], { name: "Dana" }, NOW).map((m) => m.kind === "person" && m.personId)).toEqual(["per_dana2"]);
  });

  it("falls back to a LinkedIn connection whose company is known", () => {
    const ws = workspace();
    const lena = conn("c_lena", { matchedDomain: "glassmoor.com", email: "lena@glassmoor.com" });
    expect(matchSender(ws, [lena], { name: "Lena Fischer" }, NOW)).toEqual([
      { kind: "connection", connectionId: "c_lena", name: "Lena Fischer", title: "Head of Billing Ops", domain: "glassmoor.com", company: "Glassmoor", why: "name" },
    ]);
    expect(matchSender(ws, [lena], { email: "lena@glassmoor.com" }, NOW)[0]).toMatchObject({ kind: "connection", why: "email" });
    // Without a company website there's nothing to file them under.
    expect(matchSender(ws, [conn("c_x")], { name: "Lena Fischer" }, NOW)).toEqual([]);
    // A connection already on file under that company, or by profile, is that person, offered once.
    const dana = conn("c_dana", { firstName: "Dana", lastName: "Kim", matchedDomain: "northwind.io", company: "Northwind" });
    expect(matchSender(ws, [dana], { name: "Dana Kim" }, NOW)).toEqual([expect.objectContaining({ kind: "person", personId: "per_dana" })]);
    ws.people.per_sam.linkedinUrl = "https://linkedin.com/in/sam-o/";
    expect(matchSender(ws, [conn("c_sam", { firstName: "Samuel", lastName: "Ortiz", url: "https://www.linkedin.com/in/sam-o" })], { name: "Samuel Ortiz" }, NOW)).toEqual([
      expect.objectContaining({ kind: "person", personId: "per_sam" }),
    ]);
    // A connection already filed as a person resolves to that person.
    ws.people.per_lena = makePerson("per_lena", "glassmoor.com", { name: "Lena Fischer" });
    expect(matchSender(ws, [{ ...lena, personId: "per_lena" }], { email: "lena@glassmoor.com" }, NOW)[0]).toMatchObject({ kind: "person", personId: "per_lena" });
  });
});
