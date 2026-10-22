import { describe, expect, it } from "vitest";
import type { MeetingBrief, RunSummary, Workspace } from "@/lib/domain/types";
import { NOW, TODAY, at, day, makeAccount, makeActivity, makeDeal, makeDossier, makeMeeting, makePackage, makePerson, makeSignal, makeStep, makeWorkspace } from "@/test/factories";
import { AHEAD_DRAFTS_PER_DAY, AHEAD_PREPS_PER_DAY, draftsToStart, meetingsToPrep, networkToScreen, planAhead } from "./ahead";
import { computeMoves, mergeMoves } from "./rules";

const acme = "acme.example";
const brief = (generatedAt: string) => ({ generatedAt, callType: "first_discovery" }) as MeetingBrief;
const run = (workflow: RunSummary["workflow"], ref: RunSummary["ref"], startedAt: string, status: RunSummary["status"] = "done"): RunSummary => ({ id: `run_${startedAt}`, workflow, title: "", ref, startedAt, status });

function calendar(patch: Partial<Workspace> = {}): Workspace {
  return makeWorkspace({
    accounts: { [acme]: makeAccount(acme, { dealId: "deal_acme", status: "in_pipeline" }) },
    deals: { deal_acme: makeDeal("deal_acme", acme) },
    meetings: {
      soon: makeMeeting("soon", "deal_acme", { startsAt: at(0, "14:00") }),
      tomorrow: makeMeeting("tomorrow", "deal_acme", { startsAt: at(1, "08:00") }),
      later: makeMeeting("later", "deal_acme", { startsAt: at(2, "10:00") }),
      past: makeMeeting("past", "deal_acme", { startsAt: at(0, "08:00") }),
    },
    ...patch,
  });
}

describe("meeting briefs prepared ahead", () => {
  it("briefs every meeting in the next 24 hours, soonest first", () => {
    expect(meetingsToPrep(calendar(), NOW)).toEqual(["soon", "tomorrow"]);
  });

  it("skips a brief that is newer than the dossier and the last touch, and briefs again when either moved on", () => {
    const ws = calendar();
    ws.meetings.soon.brief = brief(at(-1));
    expect(meetingsToPrep(ws, NOW)).toEqual(["tomorrow"]);
    ws.activities.push(makeActivity("r", { kind: "reply_received", accountDomain: acme, at: at(0, "08:00") }));
    expect(meetingsToPrep(ws, NOW)).toEqual(["soon", "tomorrow"]);
    ws.activities = [];
    ws.accounts[acme].dossier = makeDossier({ generatedAt: at(0, "07:00") });
    expect(meetingsToPrep(ws, NOW)).toEqual(["soon", "tomorrow"]);
  });

  it("doesn't start a second prep while one runs or soon after one finished or failed", () => {
    const ws = calendar({ runs: [run("prep", { kind: "meeting", id: "soon" }, at(0, "07:00"), "error"), run("prep", { kind: "meeting", id: "tomorrow" }, at(-1), "running")] });
    expect(meetingsToPrep(ws, NOW)).toEqual([]);
    ws.runs[0].startedAt = at(0, "03:00");
    expect(meetingsToPrep(ws, NOW)).toEqual(["soon"]);
  });
});

describe("drafts prepared ahead", () => {
  /** A cold package to Ana sent four days ago (step 2 due) and a fresh signal at a researched A-tier company. */
  function desk(): Workspace {
    const ws = makeWorkspace({
      accounts: {
        [acme]: makeAccount(acme, { peopleIds: ["per_ana"] }),
        "beta.example": makeAccount("beta.example", { signals: [makeSignal("sig_b", { strength: 3 })], dossier: makeDossier(), peopleIds: ["per_bo"] }),
      },
      people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima" }), per_bo: makePerson("per_bo", "beta.example", { name: "Bo Chen", role: "champion" }) },
      outreach: { pkg_a: makePackage("pkg_a", acme, { personId: "per_ana", createdAt: at(-5), steps: [makeStep(1, { status: "sent", sentAt: at(-4) })] }) },
    });
    ws.moves = mergeMoves({}, computeMoves(ws, NOW), TODAY);
    return ws;
  }

  it("drafts due follow-ups first, then first touches on a researched signal", () => {
    expect(draftsToStart(desk(), NOW)).toEqual([
      { moveId: "mv_followup_pkg_a_2", args: { domain: acme, personId: "per_ana", mode: "follow_up", packageId: "pkg_a" } },
      { moveId: "mv_signal_beta.example_sig_b", args: { domain: "beta.example", personId: "per_bo", mode: "cold" } },
    ]);
  });

  it("leaves alone a card that has its draft, a person the founder knows, and a company with a compose run in flight", () => {
    const ws = desk();
    ws.outreach.pkg_a.steps.push(makeStep(2, { sendOn: day(-1) }));
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, NOW), TODAY);
    ws.people.per_bo.source = "founder_network";
    expect(draftsToStart(ws, NOW)).toEqual([]);
    const busy = desk();
    busy.runs = [run("compose", { kind: "account", id: acme }, at(0, "09:00"), "running")];
    expect(draftsToStart(busy, NOW).map((d) => d.moveId)).toEqual(["mv_signal_beta.example_sig_b"]);
  });
});

describe("planAhead", () => {
  it("claims each meeting and card once a day, within the daily caps", () => {
    const ws = calendar();
    const plan = planAhead(ws, NOW);
    expect(plan.keys).toEqual(["mtg:soon:none", "mtg:tomorrow:none"]);
    ws.briefs[TODAY] = { date: TODAY, kind: "daily", greeting: "", matters: [], generatedAt: at(0, "08:00"), ahead: plan.keys };
    expect(planAhead(ws, NOW).keys).toEqual([]);
    // A brief that changed since (a re-prep after a new touch) can be claimed once more.
    ws.meetings.soon.brief = brief(at(0, "08:30"));
    ws.activities.push(makeActivity("r", { kind: "reply_received", accountDomain: acme, at: at(0, "09:00") }));
    expect(planAhead(ws, NOW).preps).toEqual(["soon"]);
  });

  it("stops at the caps", () => {
    const ws = calendar();
    ws.briefs[TODAY] = {
      date: TODAY,
      kind: "daily",
      greeting: "",
      matters: [],
      generatedAt: at(0, "08:00"),
      ahead: [...Array.from({ length: AHEAD_PREPS_PER_DAY }, (_, i) => `mtg:x${i}:none`), ...Array.from({ length: AHEAD_DRAFTS_PER_DAY }, (_, i) => `acc:x${i}:mv`)],
    };
    expect(planAhead(ws, NOW)).toEqual({ preps: [], drafts: [], keys: [] });
  });
});

describe("the network screen", () => {
  const foundation = (generatedAt: string) => ({ generatedAt, icp: { criteria: [{ id: "c1" }] } }) as unknown as Workspace["foundation"];
  const net = (patch: Partial<NonNullable<Workspace["network"]>> = {}): Workspace["network"] => ({ importedAt: at(-1), total: 1240, atIcpCompanies: 0, buyerTitles: 0, jobChanges: 0, ...patch });

  it("screens a list dropped in before the bet existed, and again when the bet changes", () => {
    expect(networkToScreen(makeWorkspace({ network: net() }), NOW)).toBeNull();
    expect(networkToScreen(makeWorkspace({ network: net(), foundation: foundation(at(0, "08:00")) }), NOW)).toMatchObject({ reason: "import" });
    expect(networkToScreen(makeWorkspace({ network: net({ screenedAt: at(-1, "11:00") }), foundation: foundation(at(0, "08:00")) }), NOW)).toMatchObject({ reason: "rescreen" });
    expect(networkToScreen(makeWorkspace({ network: net({ screenedAt: at(0, "09:00") }), foundation: foundation(at(0, "08:00")) }), NOW)).toBeNull();
  });

  it("waits for a screen already running, and is claimed once a day", () => {
    const ws = makeWorkspace({ network: net(), foundation: foundation(at(0, "08:00")), runs: [run("network", undefined, at(0, "09:00"), "running")] });
    expect(networkToScreen(ws, NOW)).toBeNull();
    ws.runs = [];
    const plan = planAhead(ws, NOW);
    expect(plan.screen).toBe("import");
    ws.briefs[TODAY] = { date: TODAY, kind: "daily", greeting: "", matters: [], generatedAt: at(0, "08:00"), ahead: plan.keys };
    expect(planAhead(ws, NOW).screen).toBeUndefined();
  });
});
