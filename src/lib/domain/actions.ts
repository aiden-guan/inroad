import type {
  Account,
  Activity,
  Asset,
  PovItem,
  Claim,
  Connector,
  Deal,
  EntityRef,
  GtmEvent,
  Guest,
  ID,
  IntegrationId,
  IntegrationState,
  Intro,
  IntroSide,
  IntroStage,
  Meeting,
  ObjectionCard,
  OutboundWebhook,
  Person,
  SkipReason,
  Stage,
  Suppression,
  Workspace,
} from "./types";
import { addBusinessDays, addDays, todayISO } from "./ids";
import { OPEN_STAGES } from "./types";
import { debriefReferrals } from "@/lib/deals/referrals";
import { newDeal } from "@/lib/deals/rules";
import { forgetPerson } from "@/lib/people/forget";

/**
 * Founder-initiated mutations. One pure reducer, used twice:
 *  - in the browser for instant (optimistic) updates
 *  - on the server as the source of truth (POST /api/workspace/actions)
 * Callers generate ids and timestamps so both sides compute the same result.
 * Agent workflows don't use actions; they write through `mutateWorkspace` on the server.
 */
export type Action =
  | { type: "founder.update"; patch: Partial<Workspace["founder"]> }
  | { type: "onboarding.update"; patch: Partial<Workspace["onboarding"]> }
  | { type: "sender.update"; patch: Partial<NonNullable<Workspace["sender"]>> }
  | { type: "goal.update"; patch: Partial<Workspace["goal"]> }
  | { type: "caps.update"; patch: Partial<Workspace["caps"]> }
  | { type: "voice.addSample"; text: string; kind: "email" | "post"; at: string }
  | { type: "voice.update"; patch: { summary?: string; signOff?: string }; at: string }
  | { type: "voice.removeSample"; index: number; at: string }
  | { type: "company.correctChip"; key: string; text: string | null }
  | { type: "foundation.set"; path: (string | number)[]; value: unknown }
  | { type: "foundation.answerQuestion"; questionId: ID; answer: string; at: string }
  | { type: "foundation.lockSegment"; at: string }
  | { type: "claim.upsert"; claim: Claim }
  | { type: "claim.remove"; id: ID }
  | { type: "objection.upsert"; objection: ObjectionCard }
  | { type: "objection.remove"; id: ID }
  | { type: "pov.upsert"; pov: PovItem }
  | { type: "pov.remove"; id: ID }
  | { type: "asset.upsert"; asset: Asset }
  | { type: "asset.remove"; id: ID }
  | { type: "connector.upsert"; connector: Connector }
  | { type: "connector.remove"; id: ID }
  /** Something the founder did for a connector: it balances the ledger against asks. */
  | { type: "connector.give"; id: ID; what: string; at: string }
  | { type: "intro.create"; intro: Intro }
  /** Move an intro to a stage (forward, or reopened). Dates, history and the intro_made activity follow in code. */
  | { type: "intro.advance"; id: ID; stage: IntroStage; at: string; declinedBy?: Intro["declinedBy"]; outcome?: Intro["outcome"]; note?: string; activityId?: ID }
  /** The founder sent the note behind a move: a nudge, the reply to the intro, the thank-you. Give: `side` asks or nudges one side. */
  | { type: "intro.mark"; id: ID; field: "nudgedOn" | "repliedOn" | "thankedOn" | "askedOn"; at: string; side?: 0 | 1 }
  /** Give: one side said yes or no. Nothing moves to the other side until both said yes. */
  | { type: "intro.consent"; id: ID; side: 0 | 1; consent: IntroSide["consent"]; at: string }
  | { type: "intro.remove"; id: ID }
  | { type: "evidence.flagWrong"; id: ID; note?: string; at: string }
  | { type: "account.add"; account: Account }
  | { type: "account.update"; domain: string; patch: Partial<Account> }
  | { type: "account.track"; domain: string; watch: boolean }
  | { type: "account.disqualify"; domain: string; reason: NonNullable<Account["disqualified"]>["reason"]; note?: string; at: string }
  | { type: "account.restore"; domain: string }
  | { type: "person.upsert"; person: Person }
  | { type: "person.remove"; id: ID }
  /** "Delete their details": the person and everything naming them, keeping only their email as `requested_delete`. */
  | { type: "person.forget"; id: ID; at: string; suppressionId: ID }
  | { type: "deal.create"; deal: Deal }
  | { type: "deal.update"; id: ID; patch: Partial<Deal>; at: string }
  | { type: "deal.setStage"; id: ID; stage: Stage; at: string; lossReason?: Deal["lossReason"]; nurtureUntil?: string }
  | { type: "deal.setNextStep"; id: ID; nextStep: Deal["nextStep"]; at: string }
  | { type: "meeting.upsert"; meeting: Meeting }
  /** Narrow meeting edits that patch the server's copy, so a stale client never overwrites a newer brief or debrief. */
  | { type: "meeting.toggleStar"; id: ID; briefAt: string; index: number }
  | { type: "meeting.patchDebrief"; id: ID; generatedAt: string; patch: { recap?: { subject: string; body: string }; appliedAt?: string; referralDomain?: { index: number; domain: string } } }
  | { type: "outreach.editStep"; packageId: ID; step: number; subject?: string | null; body?: string }
  | { type: "outreach.useAlternate"; packageId: ID; index: number }
  | { type: "outreach.approveStep"; packageId: ID; step: number; at: string; activityId: ID }
  | { type: "outreach.skipStep"; packageId: ID; step: number }
  /** Full swap of step 1 with an alternate angle (spans, POV, claims and angle travel with the text). */
  | { type: "outreach.swapAlternate"; packageId: ID; index: number }
  /** Edits the parts of a package that aren't steps: LinkedIn note/DM, warm-intro wrapper. */
  | { type: "outreach.editExtra"; packageId: ID; linkedinNote?: string | null; postAcceptDm?: string; introWrapper?: string }
  /**
   * Undo for "Mark as sent": back to draft, removes the logged activity, reopens its moves.
   * `moveIds`: the Today cards the approval finished (a reply card has no draft link), reopened too.
   */
  | { type: "outreach.unapproveStep"; packageId: ID; step: number; activityId: ID; moveIds?: ID[] }
  /** Points a draft at a person (drafts written to a role before anyone was known). */
  | { type: "outreach.setPerson"; packageId: ID; personId: ID }
  | { type: "activity.log"; activity: Activity }
  /** Undo for a logged activity (e.g. "Invite sent" on a LinkedIn draft). */
  | { type: "activity.remove"; id: ID }
  | { type: "move.done"; id: ID }
  | { type: "move.skip"; id: ID; reason: SkipReason }
  | { type: "move.snooze"; id: ID; until: string }
  /** Undo for done / skip / snooze. */
  | { type: "move.reopen"; id: ID }
  /** "Check replies": marks touches replied / no reply / bounced / not sent (null clears the mark). */
  | { type: "activity.markOutcome"; ids: ID[]; outcome: NonNullable<Activity["outcome"]> | null; at: string }
  /** Applies or dismisses a weekly-review proposal (the change itself is dispatched alongside). */
  | { type: "brief.setProposal"; date: string; proposalId: ID; status: "open" | "applied" | "dismissed"; at: string }
  | { type: "event.upsert"; event: GtmEvent }
  | { type: "event.remove"; id: ID }
  /** Shallow patch of one event (status, date, venue, or a whole new `plan` computed by the caller). */
  | { type: "event.update"; id: ID; patch: Partial<Omit<GtmEvent, "id" | "guests">> }
  | { type: "event.chooseTheme"; id: ID; index: number }
  /** Flips a timeline task, or sets it when `done` is given (idempotent, for Today's "Mark done"). */
  | { type: "event.toggleTask"; id: ID; index: number; done?: boolean }
  | { type: "guest.upsert"; eventId: ID; guest: Guest }
  | { type: "guest.remove"; eventId: ID; guestId: ID }
  | { type: "integration.update"; id: IntegrationId; patch: Partial<IntegrationState> }
  | { type: "webhook.add"; webhook: OutboundWebhook }
  | { type: "webhook.remove"; id: ID }
  | { type: "webhook.update"; id: ID; patch: Partial<Pick<OutboundWebhook, "url" | "label" | "events" | "paused">> }
  | { type: "suppression.add"; entry: Suppression }
  | { type: "suppression.remove"; id: ID }
  | { type: "run.markSeen"; id: ID };

export class ActionError extends Error {}

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new ActionError(`${what} not found`);
  return value;
}

/** An approved intro ask becomes a tracked intro (stage "asked"). Idempotent per package; the id is derived so both sides agree. */
function openIntroFromAsk(ws: Workspace, packageId: ID, at: string) {
  const pkg = ws.outreach[packageId];
  if (!pkg) return;
  ws.intros ??= {};
  const id = `intro_${pkg.id}`;
  if (ws.intros[id]) return;
  const connector = ws.connectors.find((c) => c.id === pkg.connectorId) ?? ws.connectors.find((c) => !!pkg.intro?.connectorName && c.name === pkg.intro.connectorName);
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  const acc = ws.accounts[pkg.accountDomain];
  const on = todayISO(new Date(at));
  ws.intros[id] = {
    id,
    kind: "ask",
    stage: "asked",
    connectorId: connector?.id,
    connectorName: pkg.intro?.connectorName || connector?.name,
    personId: person?.id,
    accountDomain: pkg.accountDomain,
    targetName: person ? `${person.name}${person.title ? `, ${person.title}` : ""}` : `the right person at ${acc?.name ?? pkg.accountDomain}`,
    packageId: pkg.id,
    askedOn: on,
    history: [{ at, stage: "asked" }],
    createdAt: at,
    updatedAt: at,
    ...(connector?.lastAskedOn ? { priorAskedOn: connector.lastAskedOn } : {}),
  };
  if (connector) connector.lastAskedOn = on;
}

/** The deal an approved "yes, let's talk" reply opens. Derived from the package so both sides agree. */
const replyDealId = (packageId: ID) => `deal_${packageId}`;

/**
 * A yes the founder answered is a conversation under way: without an open deal it becomes one at
 * Talking, its next step booking the call, so it sits in the pipeline (and Today's booking card
 * chases it) until a meeting is on the calendar or it's parked or closed. An open deal just gains the contact.
 */
function openDealFromReply(ws: Workspace, pkg: Workspace["outreach"][string], at: string) {
  const acc = ws.accounts[pkg.accountDomain];
  if (!acc) return;
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  const current = acc.dealId ? ws.deals[acc.dealId] : undefined;
  if (current && OPEN_STAGES.includes(current.stage)) {
    if (person && !current.contacts.some((c) => c.personId === person.id)) current.contacts.push({ personId: person.id, role: person.role });
    return;
  }
  const id = replyDealId(pkg.id);
  if (ws.deals[id]) return;
  const first = person?.name.trim().split(/\s+/)[0];
  ws.deals[id] = {
    ...newDeal(acc, id, at),
    contacts: person ? [{ personId: person.id, role: person.role }] : [],
    nextStep: { what: first ? `Book the call with ${first}` : "Book the first call", date: addBusinessDays(todayISO(new Date(at)), 2), buyerAgreed: false },
  };
  acc.dealId = id;
  acc.status = "in_pipeline";
}

function advanceIntro(ws: Workspace, intro: Intro, a: Extract<Action, { type: "intro.advance" }>) {
  if (intro.stage === a.stage && a.outcome === undefined) return;
  const on = todayISO(new Date(a.at));
  const was = intro.stage;
  intro.stage = a.stage;
  intro.history.push({ at: a.at, stage: a.stage, ...(a.note ? { note: a.note.slice(0, 200) } : {}) });
  intro.updatedAt = a.at;
  if (a.outcome) intro.outcome = a.outcome;
  if (a.stage === "forwarded") intro.forwardedOn ??= on;
  if (a.stage === "meeting") intro.meetingOn ??= on;
  if (a.stage === "done" || a.stage === "declined" || a.stage === "no_answer") intro.closedOn = on;
  else delete intro.closedOn;
  if (a.stage === "declined") intro.declinedBy = a.declinedBy ?? intro.declinedBy;
  if (a.stage === "introduced" && !intro.introducedOn) {
    intro.introducedOn = on;
    const connector = ws.connectors.find((c) => c.id === intro.connectorId);
    if (intro.kind === "ask" && connector) connector.introsMade += 1;
    const sides = intro.sides?.map((s) => s.name).join(" and ");
    ws.activities.push({
      id: a.activityId ?? `act_${intro.id}_introduced`,
      at: a.at,
      kind: "intro_made",
      personId: intro.personId,
      accountDomain: intro.accountDomain,
      dealId: intro.accountDomain ? ws.accounts[intro.accountDomain]?.dealId : undefined,
      channel: "intro",
      summary: intro.kind === "give" ? `You introduced ${sides}` : `${intro.connectorName ?? "Your connector"} introduced you to ${intro.targetName}`,
      source: "founder",
    });
  }
  // Reopening (a "no answer" that came back) keeps the original dates; only a fresh forward restarts its clock.
  if (was === "no_answer" && a.stage === "forwarded") intro.forwardedOn = on;
}

function upsertBy<T extends { id: string }>(list: T[], item: T) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) list.push(item);
  else list[i] = item;
}

/**
 * A logged answer (a touch from a sequencer, a LinkedIn message, an intro ask) closes reply cards that
 * came in by webhook, as the moves engine does for its own. Approving a reply draft closes its linked card already.
 */
function closeAnsweredReplies(ws: Workspace, a: Activity) {
  if (!a.personId || (a.kind !== "touch_sent" && a.kind !== "linkedin_dm" && a.kind !== "intro_requested")) return;
  for (const m of Object.values(ws.moves)) {
    if (m.status === "open" && m.rule === "inbound.reply" && m.ref?.kind === "person" && m.ref.id === a.personId && a.at > (m.receivedAt ?? "")) m.status = "done";
  }
}

function setPath(target: unknown, path: (string | number)[], value: unknown) {
  if (!path.length) throw new ActionError("Empty path");
  let node = target as Record<string | number, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (key === "__proto__" || key === "constructor" || key === "prototype") throw new ActionError("Invalid path");
    node = need(node[key] as Record<string | number, unknown>, `Path ${path.slice(0, i + 1).join(".")}`);
  }
  const last = path[path.length - 1];
  if (last === "__proto__" || last === "constructor" || last === "prototype") throw new ActionError("Invalid path");
  node[last] = value;
}

/** Applies an action to a mutable draft. Throws ActionError on invalid input. */
export function applyAction(ws: Workspace, action: Action): void {
  switch (action.type) {
    case "founder.update":
      Object.assign(ws.founder, action.patch);
      return;
    case "onboarding.update":
      Object.assign(ws.onboarding, action.patch);
      return;
    case "sender.update":
      ws.sender = {
        name: ws.founder.name,
        title: ws.founder.title ?? "Founder",
        company: ws.company?.name ?? "",
        email: ws.founder.email ?? "",
        postalAddress: "",
        ...(ws.sender ?? {}),
        ...action.patch,
      };
      return;
    case "goal.update":
      Object.assign(ws.goal, action.patch);
      return;
    case "caps.update":
      Object.assign(ws.caps, action.patch);
      return;
    case "voice.addSample": {
      ws.voice ??= { samples: [], summary: "", signOff: "", updatedAt: action.at };
      ws.voice.samples.push({ text: action.text.slice(0, 4000), kind: action.kind });
      ws.voice.samples = ws.voice.samples.slice(-5);
      ws.voice.updatedAt = action.at;
      return;
    }
    case "voice.update": {
      ws.voice ??= { samples: [], summary: "", signOff: "", updatedAt: action.at };
      if (action.patch.summary !== undefined) ws.voice.summary = action.patch.summary.slice(0, 600);
      if (action.patch.signOff !== undefined) ws.voice.signOff = action.patch.signOff.slice(0, 80);
      ws.voice.updatedAt = action.at;
      return;
    }
    case "voice.removeSample": {
      if (!ws.voice) return;
      ws.voice.samples = ws.voice.samples.filter((_, i) => i !== action.index);
      ws.voice.updatedAt = action.at;
      return;
    }
    case "company.correctChip": {
      const company = need(ws.company, "Company");
      const chip = need(
        company.chips.find((c) => c.key === action.key),
        "Chip",
      );
      // Wrong chips are kept and marked, so the strategist hears it and the model can't share the key again.
      if (action.text === null) Object.assign(chip, { rejected: true, corrected: false });
      else if (chip.rejected && action.text === chip.text) chip.rejected = false; // undo
      else Object.assign(chip, { text: action.text, corrected: true, confidence: "high", rejected: false });
      return;
    }
    case "foundation.set":
      setPath(need(ws.foundation, "Playbook"), action.path, action.value);
      return;
    case "foundation.answerQuestion": {
      const q = need(
        need(ws.foundation, "Playbook").founderQuestions.find((x) => x.id === action.questionId),
        "Question",
      );
      q.answer = action.answer;
      q.answeredAt = action.at;
      return;
    }
    case "foundation.lockSegment":
      need(ws.foundation, "Playbook").icp.segmentLockedAt = action.at;
      return;
    case "claim.upsert":
      upsertBy(ws.claims, action.claim);
      return;
    case "claim.remove":
      ws.claims = ws.claims.filter((c) => c.id !== action.id);
      return;
    case "objection.upsert":
      upsertBy(ws.objections, action.objection);
      return;
    case "objection.remove":
      ws.objections = ws.objections.filter((o) => o.id !== action.id);
      return;
    case "pov.upsert":
      upsertBy(ws.povs, action.pov);
      return;
    case "pov.remove":
      ws.povs = ws.povs.filter((p) => p.id !== action.id);
      return;
    case "asset.upsert":
      upsertBy(ws.assets, action.asset);
      return;
    case "asset.remove":
      ws.assets = ws.assets.filter((a) => a.id !== action.id);
      return;
    case "connector.upsert":
      upsertBy(ws.connectors, action.connector);
      return;
    case "connector.remove":
      ws.connectors = ws.connectors.filter((c) => c.id !== action.id);
      return;
    case "connector.give": {
      const c = need(ws.connectors.find((x) => x.id === action.id), "Connector");
      (c.gives ??= []).push({ at: todayISO(new Date(action.at)), what: action.what.trim().slice(0, 140) });
      return;
    }
    case "intro.create":
      ws.intros ??= {};
      if (!ws.intros[action.intro.id]) ws.intros[action.intro.id] = action.intro;
      return;
    case "intro.advance": {
      const intro = need(ws.intros?.[action.id], "Intro");
      advanceIntro(ws, intro, action);
      return;
    }
    case "intro.mark": {
      const intro = need(ws.intros?.[action.id], "Intro");
      const on = todayISO(new Date(action.at));
      if (action.side !== undefined) {
        const side = need(intro.sides?.[action.side], "Side");
        if (action.field === "askedOn" || action.field === "nudgedOn") side[action.field] = on;
      } else if (action.field !== "askedOn") {
        intro[action.field] = on;
      }
      intro.updatedAt = action.at;
      return;
    }
    case "intro.consent": {
      const intro = need(ws.intros?.[action.id], "Intro");
      const side = need(intro.sides?.[action.side], "Side");
      side.consent = action.consent;
      side.askedOn ??= todayISO(new Date(action.at));
      if (action.consent === "no" && intro.stage === "asked") {
        intro.stage = "declined";
        intro.closedOn = todayISO(new Date(action.at));
        intro.history.push({ at: action.at, stage: "declined", note: `${side.name} passed` });
      }
      intro.updatedAt = action.at;
      return;
    }
    case "intro.remove":
      if (ws.intros) delete ws.intros[action.id];
      return;
    case "evidence.flagWrong": {
      const ev = need(ws.evidence[action.id], "Evidence");
      ev.flaggedWrong = { at: action.at, note: action.note };
      return;
    }
    case "account.add":
      if (!ws.accounts[action.account.domain]) ws.accounts[action.account.domain] = action.account;
      return;
    case "account.update":
      Object.assign(need(ws.accounts[action.domain], "Account"), action.patch);
      return;
    case "account.track": {
      const acc = need(ws.accounts[action.domain], "Account");
      acc.watch = action.watch;
      if (action.watch && acc.status === "new") acc.status = "tracked";
      if (!action.watch && acc.status === "tracked") acc.status = "new";
      return;
    }
    case "account.disqualify": {
      const acc = need(ws.accounts[action.domain], "Account");
      acc.status = "disqualified";
      acc.watch = false;
      acc.disqualified = { reason: action.reason, note: action.note, at: action.at };
      return;
    }
    case "account.restore": {
      const acc = need(ws.accounts[action.domain], "Account");
      acc.status = acc.dealId ? "in_pipeline" : "new";
      delete acc.disqualified;
      return;
    }
    case "person.upsert": {
      ws.people[action.person.id] = action.person;
      const acc = ws.accounts[action.person.accountDomain];
      if (acc && !acc.peopleIds.includes(action.person.id)) acc.peopleIds.push(action.person.id);
      return;
    }
    case "person.remove": {
      const person = ws.people[action.id];
      if (!person) return;
      delete ws.people[action.id];
      const acc = ws.accounts[person.accountDomain];
      if (acc) acc.peopleIds = acc.peopleIds.filter((id) => id !== action.id);
      for (const deal of Object.values(ws.deals)) deal.contacts = deal.contacts.filter((c) => c.personId !== action.id);
      return;
    }
    case "person.forget":
      // Unknown ids are a no-op: two tabs may delete the same person.
      forgetPerson(ws, action.id, action.at, action.suppressionId);
      return;
    case "deal.create": {
      ws.deals[action.deal.id] = action.deal;
      const acc = ws.accounts[action.deal.accountDomain];
      if (acc) {
        acc.dealId = action.deal.id;
        acc.status = "in_pipeline";
      }
      return;
    }
    case "deal.update": {
      const deal = need(ws.deals[action.id], "Deal");
      Object.assign(deal, action.patch, { updatedAt: action.at });
      return;
    }
    case "deal.setStage": {
      const deal = need(ws.deals[action.id], "Deal");
      if (deal.stage === action.stage) return;
      deal.stage = action.stage;
      deal.stageHistory.push({ stage: action.stage, at: action.at });
      deal.updatedAt = deal.lastActivityAt = action.at;
      if (action.stage === "lost") deal.lossReason = action.lossReason ?? deal.lossReason;
      if (action.stage === "nurture") deal.nurtureUntil = action.nurtureUntil ?? addDays(todayISO(), 60);
      const acc = ws.accounts[deal.accountDomain];
      if (acc) acc.status = action.stage === "won" ? "customer" : "in_pipeline";
      return;
    }
    case "deal.setNextStep": {
      const deal = need(ws.deals[action.id], "Deal");
      deal.nextStep = action.nextStep;
      deal.updatedAt = action.at;
      return;
    }
    case "meeting.upsert": {
      ws.meetings[action.meeting.id] = action.meeting;
      const deal = ws.deals[action.meeting.dealId];
      if (deal && !deal.meetingIds.includes(action.meeting.id)) deal.meetingIds.push(action.meeting.id);
      return;
    }
    case "meeting.toggleStar": {
      const m = ws.meetings[action.id];
      if (!m?.brief || m.brief.generatedAt !== action.briefAt) return; // brief was regenerated or meeting gone
      const s = new Set(m.starred ?? []);
      if (s.has(action.index)) s.delete(action.index);
      else s.add(action.index);
      m.starred = [...s].sort((a, b) => a - b);
      return;
    }
    case "meeting.patchDebrief": {
      const d = ws.meetings[action.id]?.debrief;
      if (!d || d.generatedAt !== action.generatedAt) return; // a newer debrief replaced it
      if (action.patch.recap) d.recap = action.patch.recap;
      if (action.patch.appliedAt) d.appliedAt = action.patch.appliedAt;
      // A referral's company, once the founder added it: the lead finds it by domain from then on.
      const rd = action.patch.referralDomain;
      if (rd) {
        d.referralPeople ??= debriefReferrals(d);
        const r = d.referralPeople[rd.index];
        if (r) r.domain = rd.domain;
      }
      return;
    }
    case "outreach.editStep": {
      const pkg = need(ws.outreach[action.packageId], "Draft");
      const step = need(
        pkg.steps.find((s) => s.step === action.step),
        "Step",
      );
      if (action.subject !== undefined) step.subject = action.subject;
      if (action.body !== undefined) step.body = action.body;
      step.edited = true;
      return;
    }
    case "outreach.useAlternate": {
      const pkg = need(ws.outreach[action.packageId], "Draft");
      const alt = need(pkg.alternates[action.index], "Alternate");
      const first = pkg.steps.find((s) => s.step === 1);
      if (!first) return;
      pkg.alternates[action.index] = { ...first };
      Object.assign(first, { subject: alt.subject, body: alt.body, frame: alt.frame, evidenceIds: alt.evidenceIds, lint: alt.lint });
      return;
    }
    case "outreach.approveStep": {
      const pkg = need(ws.outreach[action.packageId], "Draft");
      const step = need(
        pkg.steps.find((s) => s.step === action.step),
        "Step",
      );
      // A double click must not log the send twice ("approved" steps, handed off by an agent, still get marked sent).
      if (step.status === "sent") return;
      step.status = "sent";
      step.sentAt = action.at;
      const person = pkg.personId ? ws.people[pkg.personId] : undefined;
      ws.activities.push({
        id: action.activityId,
        at: action.at,
        kind: pkg.mode === "linkedin" ? "linkedin_dm" : pkg.mode === "warm_intro" ? "intro_requested" : "touch_sent",
        personId: pkg.personId,
        accountDomain: pkg.accountDomain,
        dealId: ws.accounts[pkg.accountDomain]?.dealId,
        channel: pkg.mode === "linkedin" ? "linkedin" : pkg.mode === "warm_intro" ? "intro" : "email",
        draftRef: { packageId: pkg.id, step: step.step },
        angleId: pkg.angleId,
        summary: `${pkg.mode === "reply" ? "Replied" : step.step === 1 ? "First touch" : `Follow-up ${step.step - 1}`} to ${person?.name ?? pkg.accountDomain}`,
        body: step.body,
        source: "founder",
      });
      const acc = ws.accounts[pkg.accountDomain];
      if (acc && acc.status === "new") acc.status = "tracked";
      if (pkg.mode === "warm_intro") openIntroFromAsk(ws, pkg.id, action.at);
      if (pkg.mode === "reply" && pkg.replyAction === "book") openDealFromReply(ws, pkg, action.at);
      for (const move of Object.values(ws.moves)) {
        if (move.status === "open" && move.draft?.packageId === pkg.id && move.draft.step === step.step) move.status = "done";
      }
      return;
    }
    case "outreach.skipStep": {
      const pkg = need(ws.outreach[action.packageId], "Draft");
      const step = need(
        pkg.steps.find((s) => s.step === action.step),
        "Step",
      );
      step.status = "skipped";
      return;
    }
    case "outreach.swapAlternate": {
      const pkg = need(ws.outreach[action.packageId], "Draft");
      const alt = need(pkg.alternates[action.index], "Alternate");
      const i = pkg.steps.findIndex((s) => s.step === 1);
      if (i === -1 || pkg.steps[i].status !== "draft") return;
      const current = pkg.steps[i];
      // The text and everything it rests on travel together; schedule and status stay with the slot.
      pkg.steps[i] = { ...alt, step: 1, sendOn: current.sendOn, thread: current.thread, status: "draft" };
      pkg.alternates[action.index] = { ...current };
      pkg.angleId = alt.angleId ?? pkg.angleId;
      return;
    }
    case "outreach.editExtra": {
      const pkg = need(ws.outreach[action.packageId], "Draft");
      if (pkg.linkedin) {
        if (action.linkedinNote !== undefined) pkg.linkedin.note = action.linkedinNote;
        if (action.postAcceptDm !== undefined) pkg.linkedin.postAcceptDm = action.postAcceptDm;
      }
      if (pkg.intro && action.introWrapper !== undefined) pkg.intro.wrapper = action.introWrapper;
      return;
    }
    case "outreach.unapproveStep": {
      const pkg = need(ws.outreach[action.packageId], "Draft");
      const step = need(
        pkg.steps.find((s) => s.step === action.step),
        "Step",
      );
      step.status = "draft";
      delete step.sentAt;
      ws.activities = ws.activities.filter((a) => a.id !== action.activityId);
      for (const move of Object.values(ws.moves)) {
        if (move.status === "done" && move.draft?.packageId === pkg.id && move.draft.step === step.step) move.status = "open";
      }
      // The card the founder finished by approving, whether or not it carried the draft link (gone moves are skipped).
      for (const id of action.moveIds ?? []) {
        const move = ws.moves[id];
        if (move?.status === "done") {
          move.status = "open";
          delete move.autoDone;
        }
      }
      // Undoing an intro ask also undoes the intro it opened, if nothing has happened on it since.
      const intro = ws.intros?.[`intro_${pkg.id}`];
      if (intro && intro.stage === "asked" && intro.history.length <= 1 && !intro.nudgedOn) {
        const connector = ws.connectors.find((c) => c.id === intro.connectorId);
        if (connector && connector.lastAskedOn === intro.askedOn) {
          if (intro.priorAskedOn) connector.lastAskedOn = intro.priorAskedOn;
          else delete connector.lastAskedOn;
        }
        delete ws.intros[intro.id];
      }
      // Undoing a "yes" reply takes back the deal it opened, if nothing has happened on it since.
      const opened = ws.deals[replyDealId(pkg.id)];
      if (opened && opened.stage === "talking" && opened.stageHistory.length <= 1 && !opened.meetingIds.length) {
        delete ws.deals[opened.id];
        const acc = ws.accounts[opened.accountDomain];
        if (acc?.dealId === opened.id) {
          const prior = Object.values(ws.deals)
            .filter((d) => d.accountDomain === acc.domain)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          if (prior) {
            acc.dealId = prior.id;
            acc.status = prior.stage === "won" ? "customer" : "in_pipeline";
          } else {
            delete acc.dealId;
            acc.status = "tracked";
          }
        }
      }
      return;
    }
    case "outreach.setPerson": {
      const pkg = need(ws.outreach[action.packageId], "Draft");
      need(ws.people[action.personId], "Person");
      pkg.personId = action.personId;
      return;
    }
    case "activity.log": {
      ws.activities.push(action.activity);
      const a = action.activity;
      // A reply cancels the rest of that person's open sequence.
      if (a.kind === "reply_received" && a.personId) {
        for (const pkg of Object.values(ws.outreach)) {
          if (pkg.personId !== a.personId) continue;
          for (const s of pkg.steps) if (s.status === "draft") s.status = "cancelled_by_reply";
        }
      }
      if (a.dealId && ws.deals[a.dealId]) ws.deals[a.dealId].lastActivityAt = a.at;
      closeAnsweredReplies(ws, a);
      return;
    }
    case "activity.remove":
      ws.activities = ws.activities.filter((a) => a.id !== action.id);
      return;
    case "move.done":
      need(ws.moves[action.id], "Move").status = "done";
      return;
    case "move.skip": {
      const move = need(ws.moves[action.id], "Move");
      move.status = "skipped";
      move.skipReason = action.reason;
      return;
    }
    case "move.snooze": {
      const move = need(ws.moves[action.id], "Move");
      move.status = "snoozed";
      move.snoozedUntil = action.until;
      return;
    }
    case "move.reopen": {
      const move = need(ws.moves[action.id], "Move");
      move.status = "open";
      delete move.skipReason;
      delete move.snoozedUntil;
      return;
    }
    case "activity.markOutcome": {
      const ids = new Set(action.ids);
      for (const a of ws.activities) {
        if (!ids.has(a.id)) continue;
        if (action.outcome === null) {
          delete a.outcome;
          delete a.outcomeAt;
        } else {
          a.outcome = action.outcome;
          a.outcomeAt = action.at;
        }
      }
      return;
    }
    case "brief.setProposal": {
      // Reviews live in their own records (keyed by week and kind), so find the proposal by id, not by date.
      const proposal = need(
        Object.values(ws.briefs)
          .flatMap((b) => b.proposals ?? [])
          .find((p) => p.id === action.proposalId),
        "Proposal",
      );
      proposal.status = action.status;
      proposal.decidedAt = action.at;
      return;
    }
    case "event.upsert":
      ws.events[action.event.id] = action.event;
      return;
    case "event.remove":
      delete ws.events[action.id];
      return;
    case "event.update":
      Object.assign(need(ws.events[action.id], "Event"), action.patch);
      return;
    case "event.chooseTheme":
      need(ws.events[action.id], "Event").chosenThemeIdx = action.index;
      return;
    case "event.toggleTask": {
      const task = need(need(ws.events[action.id], "Event").plan?.timeline[action.index], "Task");
      task.done = action.done ?? !task.done;
      return;
    }
    case "guest.upsert":
      need(ws.events[action.eventId], "Event").guests[action.guest.id] = action.guest;
      return;
    case "guest.remove":
      delete need(ws.events[action.eventId], "Event").guests[action.guestId];
      return;
    case "integration.update": {
      const current = ws.integrations[action.id] ?? { id: action.id, enabled: false, config: {} };
      ws.integrations[action.id] = {
        ...current,
        ...action.patch,
        config: { ...current.config, ...(action.patch.config ?? {}) },
      };
      return;
    }
    case "webhook.add":
      ws.webhooks.push(action.webhook);
      return;
    case "webhook.remove":
      ws.webhooks = ws.webhooks.filter((w) => w.id !== action.id);
      return;
    case "webhook.update":
      Object.assign(need(ws.webhooks.find((w) => w.id === action.id), "Webhook"), action.patch);
      return;
    case "suppression.add":
      ws.suppression.push(action.entry);
      return;
    case "suppression.remove":
      ws.suppression = ws.suppression.filter((s) => s.id !== action.id);
      return;
    case "run.markSeen": {
      const run = ws.runs.find((r) => r.id === action.id);
      if (run) run.seen = true;
      return;
    }
  }
}

/** Convenience for components: an EntityRef → its route. Pass `ws` so deals, people and meetings resolve to their company sheet. */
export function hrefFor(ref: EntityRef | undefined, ws?: Workspace): string | undefined {
  if (!ref) return undefined;
  const sheet = (domain: string | undefined) => (domain ? `/companies?c=${encodeURIComponent(domain)}` : undefined);
  switch (ref.kind) {
    case "account":
      return sheet(ref.id);
    case "deal":
      return sheet(ws?.deals[ref.id]?.accountDomain) ?? "/companies?view=talking";
    case "person":
      return sheet(ws?.people[ref.id]?.accountDomain);
    case "meeting": {
      const m = ws?.meetings[ref.id];
      return sheet(m ? ws?.deals[m.dealId]?.accountDomain : undefined);
    }
    case "event":
      return `/events/${encodeURIComponent(ref.id)}`;
    case "playbook":
      return `/playbook#${ref.id}`;
    default:
      return undefined;
  }
}
