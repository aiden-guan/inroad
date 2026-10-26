import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/domain/ids";
import { computeMoves } from "@/lib/moves/rules";
import { NOW, TODAY, at, makeAccount, makePerson, makeWorkspace } from "@/test/factories";
import { askedForReferral, knownUsersKind, parseKnownUsers, referralAsk, referralCandidates } from "./known-users";

describe("the users a founder names at onboarding", () => {
  it("reads websites, names and 'person at company' from one line", () => {
    expect(parseKnownUsers("acme.com, northwind.io, Dana at Globex")).toEqual([
      { name: "Acme", domain: "acme.com" },
      { name: "Northwind", domain: "northwind.io" },
      { name: "Globex", person: "Dana" },
    ]);
    expect(parseKnownUsers("Priya from https://www.pavewise.com and Ledgerly; Tollgate & Gridmeter")).toEqual([
      { name: "Pavewise", domain: "pavewise.com", person: "Priya" },
      { name: "Ledgerly" },
      { name: "Tollgate" },
      { name: "Gridmeter" },
    ]);
  });

  it("ignores answers that name nobody", () => {
    expect(parseKnownUsers("no users yet")).toEqual([]);
    expect(parseKnownUsers("we have two design partners but can't share names")).toEqual([]);
    expect(parseKnownUsers(undefined)).toEqual([]);
    expect(parseKnownUsers("acme.com, acme.com, ACME.COM")).toHaveLength(1);
  });

  it("calls them design partners only when the founder did", () => {
    const ws = makeWorkspace();
    ws.onboarding.answers = { last3: "acme.com" };
    expect(knownUsersKind(ws)).toBe("past_user");
    ws.onboarding.answers = { last3: "Two design partners: acme.com, northwind.io" };
    expect(knownUsersKind(ws)).toBe("design_partner");
  });
});

describe("the referral ask", () => {
  function customers() {
    return makeWorkspace({
      founder: { name: "Sam Rivera" } as never,
      company: { name: "Ledgerline" } as never,
      accounts: {
        "acme.com": makeAccount("acme.com", { name: "Acme", status: "customer", addedAt: at(-2), tags: ["design_partner"], peopleIds: ["per_dana"] }),
        "old.io": makeAccount("old.io", { name: "Old", status: "customer", addedAt: at(-120) }),
        "prospect.io": makeAccount("prospect.io", { name: "Prospect", status: "new" }),
      },
      people: { per_dana: makePerson("per_dana", "acme.com", { name: "Dana Okafor", email: "dana@acme.com", champion: "untested" }) },
    });
  }

  it("is written in code, in the founder's voice, to the champion", () => {
    const ws = customers();
    ws.foundation = { icp: { hypothesis: { obstacle: "Reconciling usage with invoices by hand." } } } as never;
    const a = referralAsk(ws, "acme.com");
    expect(a).toMatchObject({ to: "dana@acme.com", subject: "Who else has this problem?", personName: "Dana Okafor" });
    expect(a.body).toBe(
      [
        "Hi Dana,",
        "",
        "Thanks again for being one of the first teams on Ledgerline. A quick ask: who else do you know who is dealing with reconciling usage with invoices by hand?",
        "",
        "If one or two people come to mind, an intro would mean a lot. I can send you a two-line note to forward, so it takes you a minute.",
        "",
        "Sam",
      ].join("\n"),
    );
    expect(a.body).not.toMatch(/[!—]/);
  });

  it("is suggested for customers not yet asked in their first 90 days, and asking closes it on Today", () => {
    const ws = customers();
    expect(referralCandidates(ws, TODAY).map((c) => c.acc.domain)).toEqual(["acme.com"]);
    const card = computeMoves(ws, NOW).find((m) => m.id === "mv_custref_acme.com")!;
    expect(card).toMatchObject({
      kind: "intro_ask",
      rule: "today.customer_referral",
      title: "Ask Dana at Acme who else has this problem",
      href: "/companies?view=customers&referral=acme.com",
      ref: { kind: "person", id: "per_dana" },
    });
    expect(card.why).toMatch(/^Acme is a design partner/);

    ws.activities.push({ id: "act_1", at: at(0, "09:00"), kind: "intro_requested", accountDomain: "acme.com", personId: "per_dana", summary: "Asked Dana Okafor who else has the problem" });
    expect(askedForReferral(ws, "acme.com", addDays(TODAY, -2))).toBe(true);
    expect(computeMoves(ws, NOW).some((m) => m.id === "mv_custref_acme.com")).toBe(false);
  });

  it("never goes to someone who opted out, or to an address that bounced", () => {
    const ws = customers();
    ws.people.per_lee = makePerson("per_lee", "acme.com", { name: "Lee Park", email: "lee@acme.com" });
    ws.accounts["acme.com"].peopleIds.push("per_lee");
    ws.suppression.push({ id: "sup_1", email: "dana@acme.com", reason: "unsubscribe", at: at(-1) });
    expect(referralAsk(ws, "acme.com")).toMatchObject({ to: "lee@acme.com", personName: "Lee Park" });

    // Lee's address bounced; the other path on file is used, and with none the note has no recipient.
    const path = (value: string, bounced = false) => ({ kind: "published_email" as const, value, verified: true, founderConfirmed: false, ...(bounced ? { bounced } : {}) });
    ws.people.per_lee.contactPaths = [path("lee@acme.com", true), path("lee.park@acme.com")];
    expect(referralAsk(ws, "acme.com").to).toBe("lee.park@acme.com");
    ws.people.per_lee.contactPaths = [path("lee@acme.com", true)];
    expect(referralAsk(ws, "acme.com").to).toBeNull();
  });

  it("skips a company that asked not to hear from you, but not one marked as a customer", () => {
    const ws = customers();
    ws.suppression.push({ id: "sup_1", domain: "acme.com", reason: "customer", at: at(-1) });
    expect(referralCandidates(ws, TODAY).map((c) => c.acc.domain)).toEqual(["acme.com"]);
    ws.suppression.push({ id: "sup_2", domain: "acme.com", reason: "manual", at: at(-1) });
    expect(referralCandidates(ws, TODAY)).toEqual([]);
  });
});
