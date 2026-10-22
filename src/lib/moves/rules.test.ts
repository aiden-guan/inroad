import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Meeting, Move, Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { DEAL, EVENT, MEETING, PACKAGE } from "@/lib/sample/ids";
import {
  NOW,
  TODAY,
  at,
  day,
  makeAccount,
  makeActivity,
  makeDeal,
  makeDossier,
  makeMeeting,
  makeMove,
  makePackage,
  makePerson,
  makeSignal,
  makeStep,
  makeWorkspace,
} from "@/test/factories";
import { DAILY_OPEN_MAX, computeMoves, isRuleMove, mergeMoves, ruleLabel, visibleMoves } from "./rules";

/** 20 Oct 2026 (a Tuesday) at hh:mm local. */
const tuesday = (hh: number, mm = 0) => new Date(2026, 9, 20, hh, mm);
const ofRule = (moves: Move[], rule: string) => moves.filter((m) => m.rule === `today.${rule}`);
const ids = (moves: Move[]) => moves.map((m) => m.id);

/** Fetches a computed move by id, failing with the ids that were there instead. */
function moveById(moves: Move[], id: string): Move {
  const m = moves.find((x) => x.id === id);
  if (!m) throw new Error(`no move ${id}; got ${ids(moves).join(", ")}`);
  return m;
}

describe("moves on the sample workspace", () => {
  const ws = sampleWorkspace(NOW);
  const moves = computeMoves(ws, NOW);

  it("is deterministic: the same state at the same time gives the same moves", () => {
    expect(computeMoves(sampleWorkspace(NOW), NOW)).toEqual(moves);
  });

  it("has unique ids that stay the same through the day, so decisions stick", () => {
    expect(new Set(ids(moves)).size).toBe(moves.length);
    expect(moves.every((m) => m.id.startsWith("mv_") && isRuleMove(m))).toBe(true);
    expect(ids(computeMoves(ws, tuesday(13, 15))).sort()).toEqual(ids(moves).sort());
  });

  it("ranks the desk (id, rule, priority, due date)", () => {
    expect(moves.map((m) => `${m.id} ${m.rule} ${m.priority} ${m.dueOn}`)).toMatchInlineSnapshot(`
      [
        "mv_prep_mtg_lumenwire_checkin today.meeting_prep 126 2026-10-20",
        "mv_reply_act_034 today.reply 120 2026-10-20",
        "mv_nextstep_deal_rowanstack_2026-10-18 today.next_step 107.5 2026-10-20",
        "mv_replies_2026-10-20 today.check_replies 92 2026-10-20",
        "mv_signal_glassmoor.example_sig_gm_job today.signal 73 2026-10-20",
        "mv_signal_hollowpine.example_sig_hp_job today.signal 73 2026-10-20",
        "mv_nextstep_deal_saltmarsh_none today.next_step 71.5 2026-10-20",
        "mv_followup_pkg_driftglass_cold_2 today.follow_up 70 2026-10-20",
        "mv_event_nearby_evt_nyc_dinner today.event_nearby 60 2026-10-20",
        "mv_intro_intro_ines_cinderpath_nudge today.intro_nudge 58.7 2026-10-20",
        "mv_connector_con_claire_donovan_2026-10-19 today.intro_draft 58 2026-10-20",
        "mv_review_monday_2026-10-19 today.review_monday 56 2026-10-20",
        "mv_signal_fernwick.example_sig_fw_jd today.cold_draft 55 2026-10-21",
        "mv_li_pkg_bramblecast_linkedin today.linkedin 50 2026-10-21",
        "mv_research_ashgrove.example today.research 50 2026-10-21",
        "mv_research_bramblecast.example today.research 50 2026-10-21",
        "mv_research_glassmoor.example today.research 50 2026-10-21",
        "mv_review_monthly_2026-10 today.review_monthly 46 2026-10-21",
        "mv_questions_fq_soc2 today.questions 35 2026-10-21",
        "mv_discover_2026-10-19 today.discover 28 2026-10-21",
      ]
    `);
  });

  it("scores priority as base × stage multiplier + overdue boost", () => {
    // Meeting prep (90) for a pilot (×1.4).
    expect(moveById(moves, `mv_prep_${MEETING.lumenwireToday}`).priority).toBe(126);
    // A reply (100) from a qualified deal (×1.2).
    expect(moveById(moves, "mv_reply_act_034").priority).toBe(120);
    // A proposal's (×1.5) next step (65) that slipped 2 days (+5 a day).
    const slipped = moveById(moves, `mv_nextstep_${DEAL.rowanstack}_${day(-2)}`);
    expect(slipped).toMatchObject({ priority: 107.5, overdueDays: 2 });
    expect(moves.map((m) => m.priority)).toEqual([...moves.map((m) => m.priority)].sort((a, b) => b - a));
  });

  it(`keeps at most ${DAILY_OPEN_MAX} open moves today and moves the overflow to tomorrow`, () => {
    const today = moves.filter((m) => m.dueOn === TODAY);
    const tomorrow = moves.filter((m) => m.dueOn === day(1));
    expect(today).toHaveLength(DAILY_OPEN_MAX);
    expect(today.length + tomorrow.length).toBe(moves.length);
    expect(Math.min(...today.map((m) => m.priority))).toBeGreaterThanOrEqual(Math.max(...tomorrow.map((m) => m.priority)));
    expect(visibleMoves(mergeMoves({}, moves, TODAY), TODAY)).toHaveLength(DAILY_OPEN_MAX);
  });

  it("frees a slot for each move the founder finishes or skips", () => {
    const s = sampleWorkspace(NOW);
    s.moves = mergeMoves({}, computeMoves(s, NOW), TODAY);
    const [a, b, c] = visibleMoves(s.moves, TODAY);
    applyAction(s, { type: "move.done", id: a.id });
    applyAction(s, { type: "move.done", id: b.id });
    applyAction(s, { type: "move.skip", id: c.id, reason: "not_relevant_now" });
    s.moves = mergeMoves(s.moves, computeMoves(s, NOW), TODAY);
    const visible = visibleMoves(s.moves, TODAY);
    expect(visible).toHaveLength(DAILY_OPEN_MAX);
    expect(ids(visible)).not.toContain(a.id);
    expect(s.moves[a.id].status).toBe("done");
    expect(s.moves[c.id]).toMatchObject({ status: "skipped", skipReason: "not_relevant_now" });
    // The first three that overflowed this morning moved up into today.
    expect(ids(visible)).toEqual(expect.arrayContaining(ids(moves.slice(DAILY_OPEN_MAX, DAILY_OPEN_MAX + 3))));
  });

  it("after 16:30 folds the missing-next-step cards into one close-out", () => {
    const evening = computeMoves(ws, tuesday(17));
    expect(ofRule(evening, "next_step")).toEqual([]);
    // Two deals lack a dated next step; the proposal among them adds 10.
    expect(moveById(evening, `mv_closeout_${TODAY}`)).toMatchObject({ priority: 70, subjectIds: [DEAL.rowanstack, DEAL.saltmarsh], kind: "close_out" });
  });

  it("turns a meeting's prep card into a debrief card once the call is over", () => {
    const evening = computeMoves(ws, tuesday(17));
    expect(ids(evening)).not.toContain(`mv_prep_${MEETING.lumenwireToday}`);
    expect(moveById(evening, `mv_debrief_${MEETING.lumenwireToday}`)).toMatchObject({ rule: "today.debrief", priority: 123.2 }); // 88 × 1.4
  });

  it("schedules the weekly reviews", () => {
    // Monday's review stays all week, losing 6 a day (Tuesday: 62 − 6).
    expect(moveById(moves, "mv_review_monday_2026-10-19").priority).toBe(56);
    expect(ofRule(moves, "review_friday")).toEqual([]);
    const friday = sampleWorkspace(new Date(2026, 9, 23, 9, 0));
    expect(ofRule(computeMoves(friday, new Date(2026, 9, 23, 13, 0)), "review_friday")).toEqual([]);
    expect(ofRule(computeMoves(friday, new Date(2026, 9, 23, 15, 0)), "review_friday").map((m) => m.id)).toEqual(["mv_review_friday_2026-10-19"]);
  });

  it("raises an overdue event task", () => {
    const s = sampleWorkspace(NOW);
    const task = s.events[EVENT.dinner].plan!.timeline.findIndex((t) => t.owner === "founder" && t.due === day(-2));
    s.events[EVENT.dinner].plan!.timeline[task].done = false;
    expect(moveById(computeMoves(s, NOW), `mv_event_${EVENT.dinner}_${task}`)).toMatchObject({ priority: 50, overdueDays: 2, kind: "event_task" });
  });
});

describe("move rules", () => {
  const acme = "acme.example";

  /** An open proposal at Acme with Ana as the contact. */
  function pipeline(patch: Partial<Workspace> = {}): Workspace {
    return makeWorkspace({
      accounts: { [acme]: makeAccount(acme, { status: "in_pipeline", dealId: "deal_acme", peopleIds: ["per_ana", "per_bo"] }) },
      people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima" }), per_bo: makePerson("per_bo", acme) },
      deals: {
        deal_acme: makeDeal("deal_acme", acme, {
          stage: "proposal",
          nextStep: { what: "Order form", date: day(3), buyerAgreed: true },
          contacts: [{ personId: "per_ana" }, { personId: "per_bo" }],
        }),
      },
      ...patch,
    });
  }

  describe("replies", () => {
    const reply = (patch = {}) => makeActivity("act_r", { kind: "reply_received", personId: "per_ana", accountDomain: acme, at: at(-2), sentiment: "positive", ...patch });

    it("asks for an answer, weighted by the deal's stage and how long it has waited", () => {
      const m = moveById(computeMoves(pipeline({ activities: [reply()] }), NOW), "mv_reply_act_r");
      expect(m).toMatchObject({ kind: "reply", title: "Reply to Ana at Acme", priority: 100 * 1.5 + 10, activityId: "act_r", receivedAt: at(-2), href: `/companies?c=${acme}` });
      expect(m.why).toBe("Positive · replied 2d ago");
    });

    it("skips replies that were answered, out-of-office, older than 14 days, or already on a webhook card", () => {
      const answered = pipeline({ activities: [reply(), makeActivity("act_t", { kind: "touch_sent", personId: "per_ana", at: at(-1) })] });
      expect(ofRule(computeMoves(answered, NOW), "reply")).toEqual([]);
      expect(ofRule(computeMoves(pipeline({ activities: [reply({ sentiment: "ooo" })] }), NOW), "reply")).toEqual([]);
      expect(ofRule(computeMoves(pipeline({ activities: [reply({ at: at(-15) })] }), NOW), "reply")).toEqual([]);
      const inbound = makeMove("mv_inbound", { rule: "inbound.reply", kind: "reply", activityId: "act_r", status: "done" });
      expect(ofRule(computeMoves(pipeline({ activities: [reply()], moves: { mv_inbound: inbound } }), NOW), "reply")).toEqual([]);
    });

    it("tells the founder to stop when someone unsubscribes", () => {
      const m = moveById(computeMoves(pipeline({ activities: [reply({ sentiment: "unsubscribe" })] }), NOW), "mv_reply_act_r");
      expect(m).toMatchObject({ title: "Stop contacting Ana", minutes: 1 });
    });
  });

  describe("cold first touches", () => {
    /** Five companies, each with a cold draft to one person, fit 90 down to 50. */
    function coldDesk(caps: Partial<Workspace["caps"]> = {}, extra: Partial<Workspace> = {}): Workspace {
      const base = makeWorkspace();
      const ws = makeWorkspace({ caps: { ...base.caps, ...caps }, ...extra });
      [90, 80, 70, 60, 50].forEach((fit, i) => {
        const domain = `c${i}.example`;
        ws.accounts[domain] = makeAccount(domain, { fitScore: fit, peopleIds: [`per_${i}`] });
        ws.people[`per_${i}`] = makePerson(`per_${i}`, domain);
        ws.outreach[`pkg_${i}`] = makePackage(`pkg_${i}`, domain, { personId: `per_${i}` });
      });
      return ws;
    }
    const drafts = (ws: Workspace) => ofRule(computeMoves(ws, NOW), "cold_draft").map((m) => m.draft?.packageId);

    it("offers ready drafts best fit first, within the daily cap", () => {
      expect(drafts(coldDesk({ firstTouchesPerDayMax: 2 }))).toEqual(["pkg_0", "pkg_1"]);
      expect(drafts(coldDesk())).toEqual(["pkg_0", "pkg_1", "pkg_2", "pkg_3", "pkg_4"]);
    });

    it("counts this week's cold first touches against the weekly cap", () => {
      const ws = coldDesk({ firstTouchesPerWeek: 3 });
      for (const n of [5, 6]) {
        ws.accounts[`s${n}.example`] = makeAccount(`s${n}.example`);
        ws.outreach[`pkg_sent_${n}`] = makePackage(`pkg_sent_${n}`, `s${n}.example`, { steps: [makeStep(1, { status: "sent", sentAt: at(-1) })] });
        ws.activities.push(makeActivity(`act_${n}`, { kind: "touch_sent", at: at(-1), draftRef: { packageId: `pkg_sent_${n}`, step: 1 } }));
      }
      expect(drafts(ws)).toEqual(["pkg_0"]);
      // A touch marked "didn't send" gives its slot back.
      ws.activities[0].outcome = "not_sent";
      expect(drafts(ws)).toEqual(["pkg_0", "pkg_1"]);
    });

    it("counts first touches handed to a sequencer and cold dinner invites against the same cap", () => {
      const ws = coldDesk({ firstTouchesPerWeek: 3 });
      ws.accounts["s.example"] = makeAccount("s.example");
      ws.outreach.pkg_pushed = makePackage("pkg_pushed", "s.example", { steps: [makeStep(1, { status: "approved", sentAt: at(-1) })] });
      ws.activities.push(makeActivity("act_push", { kind: "pushed", channel: "integration", at: at(-1), draftRef: { packageId: "pkg_pushed", step: 1 } }));
      expect(drafts(ws)).toEqual(["pkg_0", "pkg_1"]);
      ws.events.ev = {
        id: "ev",
        kind: "dinner",
        title: "Dinner",
        status: "inviting",
        createdAt: at(-5),
        guests: { g: { id: "g", personId: "per_g", title: "CFO", accountDomain: "g.example", role: "prospect", score: 1, personalLine: "", status: "invited" } },
      };
      ws.activities.push(makeActivity("act_inv", { kind: "event_invited", channel: "email", eventId: "ev", personId: "per_g", at: at(0) }));
      expect(drafts(ws)).toEqual(["pkg_0"]);
    });

    it("skips suppressed companies and accounts already at the per-account weekly limit", () => {
      const ws = coldDesk({}, { suppression: [{ id: "sup", domain: "c0.example", reason: "competitor", at: at(-9) }] });
      ws.activities.push(
        makeActivity("act_x", { kind: "touch_sent", accountDomain: "c1.example", personId: "per_x", at: at(-1) }),
        makeActivity("act_y", { kind: "touch_sent", accountDomain: "c1.example", personId: "per_y", at: at(-1) }),
      );
      expect(drafts(ws)).toEqual(["pkg_2", "pkg_3", "pkg_4"]);
    });

    it("asks for a point of view while cold drafts have none to lean on", () => {
      expect(ids(computeMoves(coldDesk(), NOW))).toContain("mv_setup_pov");
      expect(ids(computeMoves(coldDesk({}, { povs: [{ id: "pov", text: "x", evidence: "y", createdAt: at(-1), uses: 0 }] }), NOW))).not.toContain("mv_setup_pov");
    });
  });

  describe("signals", () => {
    function watched(signal = makeSignal("sig_1", { strength: 3 }), patch = {}): Workspace {
      return makeWorkspace({
        accounts: { [acme]: makeAccount(acme, { signals: [signal], dossier: makeDossier(), peopleIds: ["per_ana"], ...patch }) },
        people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima", role: "champion" }) },
      });
    }

    it("turns a fresh signal at a tracked A-tier account with a dossier into a first touch", () => {
      const m = moveById(computeMoves(watched(), NOW), `mv_signal_${acme}_sig_1`);
      expect(m).toMatchObject({ kind: "first_touch", title: "Write to Ana at Acme", priority: 55, ref: { kind: "person", id: "per_ana" } });
      expect(m.source).toEqual({ url: "https://jobs.ashbyhq.com/acme/1", date: day(-3) });
    });

    it("ignores stale, weak, unusable and B-tier signals", () => {
      expect(ofRule(computeMoves(watched(makeSignal("s", { date: day(-15) })), NOW), "signal")).toEqual([]);
      expect(ofRule(computeMoves(watched(makeSignal("s", { strength: 1 })), NOW), "signal")).toEqual([]);
      expect(ofRule(computeMoves(watched(makeSignal("s", { usableInOutreach: false })), NOW), "signal")).toEqual([]);
      expect(ofRule(computeMoves(watched(undefined, { tier: "B" }), NOW), "signal")).toEqual([]);
    });

    it("treats a champion who changed jobs as warm, whatever the tier", () => {
      const m = moveById(computeMoves(watched(makeSignal("sig_job", { type: "champion_job_change", strength: 3 }), { tier: "C" }), NOW), `mv_signal_${acme}_sig_job`);
      expect(m.priority).toBe(73);
      expect(m.why).toContain("they know you");
    });

    it("sends community requests to the thread, not the inbox", () => {
      const sig = makeSignal("sig_c", { type: "community_request", host: "news.ycombinator.com", url: "https://news.ycombinator.com/item?id=1" });
      expect(moveById(computeMoves(watched(sig), NOW), `mv_signal_${acme}_sig_c`)).toMatchObject({ kind: "signal", title: "Answer the thread on news.ycombinator.com", href: sig.url });
    });
  });

  describe("cold sequences", () => {
    /** A cold package to Ana whose step 1 went out `daysAgo` days ago. */
    function sent(daysAgo: number, patch: Partial<Workspace> = {}, steps = [makeStep(1, { status: "sent", sentAt: at(-daysAgo) })]): Workspace {
      return makeWorkspace({
        accounts: { [acme]: makeAccount(acme, { peopleIds: ["per_ana"] }) },
        people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima", linkedinUrl: "https://linkedin.com/in/ana" }) },
        outreach: { pkg_a: makePackage("pkg_a", acme, { personId: "per_ana", createdAt: at(-daysAgo - 1), steps }) },
        ...patch,
      });
    }

    it("raises step 2 three days after the first touch, with an overdue boost", () => {
      expect(ofRule(computeMoves(sent(2), NOW), "follow_up")).toEqual([]);
      const m = moveById(computeMoves(sent(4), NOW), "mv_followup_pkg_a_2");
      expect(m).toMatchObject({ priority: 75, overdueDays: 1, draft: undefined });
      expect(m.why).toBe("Step 2 of 3 · a new angle, never just bumping");
    });

    it("points at a follow-up that is already drafted", () => {
      const ws = sent(4, {}, [makeStep(1, { status: "sent", sentAt: at(-4) }), makeStep(2, { sendOn: day(-1) })]);
      expect(moveById(computeMoves(ws, NOW), "mv_followup_pkg_a_2").draft).toEqual({ packageId: "pkg_a", step: 2 });
    });

    it("stops on a reply and when a sequencer owns the follow-ups", () => {
      expect(ofRule(computeMoves(sent(4, { activities: [makeActivity("act_r", { kind: "reply_received", personId: "per_ana", at: at(-1) })] }), NOW), "follow_up")).toEqual([]);
      const pushed = sent(4);
      pushed.outreach.pkg_a.pushedTo = [{ integrationId: "csv", at: at(-4) }];
      expect(ofRule(computeMoves(pushed, NOW), "follow_up")).toEqual([]);
    });

    it("switches to one blank LinkedIn invite after three unanswered emails", () => {
      const three = [1, 2, 3].map((n) => makeStep(n, { status: "sent", sentAt: at(-12 + (n - 1) * 4) }));
      expect(moveById(computeMoves(sent(12, {}, three), NOW), "mv_switch_pkg_a")).toMatchObject({ kind: "linkedin", href: "https://linkedin.com/in/ana" });
    });
  });

  describe("LinkedIn", () => {
    function invite(daysAgo: number | null, more: Workspace["activities"] = []): Workspace {
      return makeWorkspace({
        accounts: { [acme]: makeAccount(acme) },
        people: { per_ana: makePerson("per_ana", acme, { name: "Ana Lima" }) },
        outreach: { pkg_li: makePackage("pkg_li", acme, { mode: "linkedin", personId: "per_ana", createdAt: at(-3) }) },
        activities: [...(daysAgo === null ? [] : [makeActivity("act_inv", { kind: "linkedin_connect", personId: "per_ana", at: at(-daysAgo), draftRef: { packageId: "pkg_li", step: 1 } })]), ...more],
      });
    }
    const li = (ws: Workspace) => computeMoves(ws, NOW).filter((m) => m.kind === "linkedin").map((m) => m.id);

    it("asks for the invite, then for the message from day 2 to day 21 after it", () => {
      expect(li(invite(null))).toEqual(["mv_li_pkg_li"]);
      expect(li(invite(1))).toEqual([]);
      expect(li(invite(2))).toEqual(["mv_li_dm_pkg_li"]);
      expect(li(invite(21))).toEqual(["mv_li_dm_pkg_li"]);
      expect(li(invite(22))).toEqual([]);
      expect(li(invite(5, [makeActivity("act_dm", { kind: "linkedin_dm", personId: "per_ana", at: at(-1) })]))).toEqual([]);
    });
  });

  describe("deals and meetings", () => {
    it("brings a parked deal back on its date", () => {
      const ws = pipeline();
      Object.assign(ws.deals.deal_acme, { stage: "nurture", nurtureUntil: day(-14) });
      expect(moveById(computeMoves(ws, NOW), `mv_nurture_deal_acme_${day(-14)}`)).toMatchObject({ priority: 70, overdueDays: 14 });
    });

    it("asks to decide on a deal with no dated next step for two weeks", () => {
      const ws = pipeline();
      Object.assign(ws.deals.deal_acme, { stage: "talking", nextStep: undefined, lastActivityAt: at(-15) });
      const m = moveById(computeMoves(ws, NOW), "mv_nextstep_deal_acme_none");
      expect(m.title).toBe("Decide on Acme: book it, nurture or close");
      expect(m.priority).toBe(65 * 1.1 + 10);
    });

    it("flags single-threaded and unpaid pilots", () => {
      const ws = pipeline();
      Object.assign(ws.deals.deal_acme, { stage: "pilot", contacts: [{ personId: "per_ana" }], pilot: { criteria: "x", paid: false, startedOn: day(-31) } });
      const moves = computeMoves(ws, NOW);
      expect(moveById(moves, "mv_thread_deal_acme_pilot").why).toContain("single-threaded through Ana");
      expect(moveById(moves, "mv_unpaid_deal_acme").why).toBe("Unpaid for 31 days · agree a fee or a conversion date");
    });

    it("asks for notes after a call, then for the recap once a debrief exists", () => {
      const ws = pipeline({ meetings: { mtg_1: makeMeeting("mtg_1", "deal_acme", { startsAt: at(-1, "11:00") }) } });
      expect(moveById(computeMoves(ws, NOW), "mv_debrief_mtg_1").priority).toBe(88 * 1.5);
      // Only the timestamps matter to the rule.
      ws.meetings.mtg_1.debrief = { generatedAt: at(-1, "12:00") } as NonNullable<Meeting["debrief"]>;
      const moves = computeMoves(ws, NOW);
      expect(ids(moves)).not.toContain("mv_debrief_mtg_1");
      expect(moveById(moves, "mv_recap_mtg_1").rule).toBe("today.recap");
    });

    it("leaves a meeting to the prep card another surface already made", () => {
      const ws = pipeline({ meetings: { mtg_1: makeMeeting("mtg_1", "deal_acme") } });
      expect(ids(computeMoves(ws, NOW))).toContain("mv_prep_mtg_1");
      ws.moves.mv_booking = makeMove("mv_booking", { rule: "inbound.booking", kind: "meeting_prep", ref: { kind: "meeting", id: "mtg_1" } });
      expect(ids(computeMoves(ws, NOW))).not.toContain("mv_prep_mtg_1");
    });
  });
});

describe("mergeMoves", () => {
  const computed = (id: string, patch: Partial<Move> = {}) => makeMove(id, { createdAt: NOW.toISOString(), ...patch });

  it("keeps the founder's decisions and the card's first-seen time", () => {
    const existing = {
      done: makeMove("done", { status: "done", createdAt: at(-2) }),
      skipped: makeMove("skipped", { status: "skipped", skipReason: "tone_off" }),
      snoozed: makeMove("snoozed", { status: "snoozed", snoozedUntil: day(1) }),
    };
    const next = mergeMoves(existing, [computed("done", { title: "New copy" }), computed("skipped"), computed("snoozed"), computed("fresh")], TODAY);
    expect(next.done).toMatchObject({ status: "done", createdAt: at(-2), title: "New copy" });
    expect(next.skipped).toMatchObject({ status: "skipped", skipReason: "tone_off" });
    expect(next.snoozed).toMatchObject({ status: "snoozed", snoozedUntil: day(1) });
    expect(next.fresh.status).toBe("open");
  });

  it("wakes snoozed cards on their date and auto-done cards when their condition returns", () => {
    const existing = {
      snoozed: makeMove("snoozed", { status: "snoozed", snoozedUntil: TODAY }),
      auto: makeMove("auto", { status: "done", autoDone: true }),
    };
    const next = mergeMoves(existing, [computed("snoozed"), computed("auto")], TODAY);
    expect(next.snoozed.status).toBe("open");
    expect(next.snoozed).not.toHaveProperty("snoozedUntil");
    expect(next.auto.status).toBe("open");
  });

  it("records a vanished open card as done by the engine, keeps recent history and drops the old", () => {
    const existing = {
      resolved: makeMove("resolved", { dueOn: TODAY }),
      waiting: makeMove("waiting", { dueOn: day(1) }),
      history: makeMove("history", { status: "done", createdAt: at(-20) }),
      ancient: makeMove("ancient", { status: "skipped", createdAt: at(-31) }),
    };
    const next = mergeMoves(existing, [], TODAY);
    expect(next.resolved).toMatchObject({ status: "done", autoDone: true });
    expect(next.history.status).toBe("done");
    expect(Object.keys(next).sort()).toEqual(["history", "resolved"]);
  });

  it("leaves other surfaces' cards alone, except that webhook cards expire", () => {
    const inbound = { rule: "inbound.reply", kind: "reply" as const };
    const existing = {
      onboarding: makeMove("onboarding", { rule: "onboarding.import", createdAt: at(-90) }),
      fresh_reply: makeMove("fresh_reply", { ...inbound, receivedAt: at(-3) }),
      old_reply: makeMove("old_reply", { ...inbound, receivedAt: at(-15) }),
      old_done: makeMove("old_done", { ...inbound, status: "done", createdAt: at(-31) }),
      booking: makeMove("booking", { rule: "inbound.booking", kind: "meeting_prep", dueOn: day(-1) }),
    };
    const next = mergeMoves(existing, [], TODAY);
    expect(next.onboarding).toEqual(existing.onboarding);
    expect(next.fresh_reply.status).toBe("open");
    expect(next.old_reply).toMatchObject({ status: "done", autoDone: true });
    expect(next.booking).toMatchObject({ status: "done", autoDone: true });
    expect(next.old_done).toBeUndefined();
  });

  it("keeps a snooze across days until it wakes", () => {
    const ws = sampleWorkspace(NOW);
    ws.moves = mergeMoves({}, computeMoves(ws, NOW), TODAY);
    applyAction(ws, { type: "move.snooze", id: "mv_reply_act_034", until: day(1) });
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, NOW), TODAY);
    expect(ids(visibleMoves(ws.moves, TODAY))).not.toContain("mv_reply_act_034");
    const tomorrow = new Date(2026, 9, 21, 9, 0);
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, tomorrow), day(1));
    expect(ws.moves.mv_reply_act_034.status).toBe("open");
    expect(ids(visibleMoves(ws.moves, day(1)))).toContain("mv_reply_act_034");
  });

  it("closes a draft's card when it is approved, and it stays closed", () => {
    const ws = sampleWorkspace(NOW);
    ws.moves = mergeMoves({}, computeMoves(ws, NOW), TODAY);
    const card = Object.values(ws.moves).find((m) => m.draft?.packageId === PACKAGE.fernwickCold)!;
    applyAction(ws, { type: "outreach.approveStep", packageId: PACKAGE.fernwickCold, step: 1, at: at(0, "09:40"), activityId: "act_new" });
    ws.moves = mergeMoves(ws.moves, computeMoves(ws, tuesday(10)), TODAY);
    expect(ws.moves[card.id].status).toBe("done");
    expect(ids(visibleMoves(ws.moves, TODAY))).not.toContain(card.id);
  });
});

describe("visibleMoves", () => {
  it("shows open and woken cards due today, best first", () => {
    const moves = {
      a: makeMove("a", { priority: 50, title: "b" }),
      b: makeMove("b", { priority: 50, title: "a" }),
      c: makeMove("c", { priority: 90 }),
      later: makeMove("later", { dueOn: day(1), priority: 99 }),
      done: makeMove("done", { status: "done", priority: 99 }),
      woke: makeMove("woke", { status: "snoozed", snoozedUntil: TODAY, priority: 10 }),
      sleeping: makeMove("sleeping", { status: "snoozed", snoozedUntil: day(1) }),
    };
    expect(ids(visibleMoves(moves, TODAY))).toEqual(["c", "b", "a", "woke"]);
  });
});

describe("ruleLabel", () => {
  it("explains a rule on hover, with or without its prefix", () => {
    expect(ruleLabel("today.reply")).toBe("A reply is waiting for an answer");
    expect(ruleLabel("linkedin_dm")).toBe("LinkedIn invite sent, message not sent yet");
    expect(ruleLabel("inbound.reply")).toBeUndefined();
  });
});
