import "server-only";
import { applyAction } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import { normalizeHandle, partnerKey } from "@/lib/consumer/partners";
import { weekOf } from "@/lib/domain/ids";
import type { Activity, ActivityKind, DraftStep, GrowthWeek, OutreachPackage, Partner, PartnerKind, PartnerPlatform, Person, SkipReason, Workspace } from "@/lib/domain/types";
import { accountData, activityData, emitHubEvent, personData } from "@/lib/hub";
import { askedToBeDeleted, companyDomainOf, ensureAccount, ensurePerson, findPerson, isFreeMail, isSuppressed, normalizeDomain, normalizeEmail } from "@/lib/hub/records";
import { mergeMoves, computeMoves } from "@/lib/moves/rules";
import { lintStep } from "@/lib/quality/context";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { scoreAccount, scoringContext, type ScoreInput } from "./scoring";
import { markSeen, seenRecord, type ApiKey } from "./store";
import { draftActionId } from "./views";

/**
 * Writes from outside agents. Everything they push is untrusted data:
 *  - records are upserts that only fill empty fields (never overwrite the founder's or my work);
 *  - text is clipped and stored, shown with its origin, never executed;
 *  - nothing here sends, posts, changes a deal stage, writes to a CRM or fires a webhook. The only
 *    side effect beyond storage is a Slack alert to the founder for a positive reply.
 */

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 429 = 400,
  ) {
    super(message);
  }
}

const clip = (s: string | undefined | null, n: number) => {
  const t = s?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1)}…` : t) : undefined;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Idempotency keys reserved inside the serialized workspace write but not yet in keys.json, so two
 * concurrent deliveries of one event (a retry overlapping a slow first try, a batch with the same
 * call twice) can't both pass the check.
 */
const pendingSeen = (() => {
  const g = globalThis as unknown as { __inroadPendingSeen?: Map<string, string> };
  return (g.__inroadPendingSeen ??= new Map<string, string>());
})();
const sourceLabel = (key: ApiKey, source?: string) => clip(source && source.toLowerCase() !== key.name.toLowerCase() ? `${key.name} (${source})` : key.name, 60)!;

/* ───────────── add_accounts ───────────── */

export interface PersonIn {
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  location?: string;
}

export interface AccountIn extends Omit<ScoreInput, "signals"> {
  external_id?: string;
  linkedin_url?: string;
  people?: PersonIn[];
}

function personName(p: PersonIn): string | undefined {
  return clip([p.first_name, p.last_name].filter(Boolean).join(" ") || p.name, 120);
}

export async function addAccounts(key: ApiKey, args: { source: string; accounts: AccountIn[] }) {
  const at = nowISO();
  const via = sourceLabel(key, args.source);
  const results: { index: number; domain: string | null; status: "created" | "updated" | "unchanged" | "skipped"; reason?: string; tier?: string; fit_score?: number; people_added?: number; people_skipped?: number; people_skipped_reason?: string }[] = [];
  let created = 0;
  let updated = 0;
  let people = 0;
  await mutateWorkspace((ws) => {
    const scoring = scoringContext(ws);
    const own = ws.company?.domain?.toLowerCase();
    args.accounts.forEach((a, index) => {
      const email0 = a.people?.map((p) => normalizeEmail(p.email)).find(Boolean);
      const domain = normalizeDomain(a.domain) ?? companyDomainOf(email0 ?? null);
      if (!domain || isFreeMail(domain) || /(^|\.)linkedin\.com$/.test(domain)) {
        results.push({ index, domain: null, status: "skipped", reason: "Needs a company website or a work email." });
        return;
      }
      if (own && (domain === own || domain.endsWith(`.${own}`))) {
        results.push({ index, domain, status: "skipped", reason: "That's the founder's own company." });
        return;
      }
      if (isSuppressed(ws, undefined, domain)) {
        results.push({ index, domain, status: "skipped", reason: "On the founder's do-not-contact list." });
        return;
      }
      // Score a new company before its placeholder exists, so the placeholder can't score itself.
      const s = ws.accounts[domain] ? null : scoreAccount(scoring, { ...a, domain });
      if (s?.disqualified) {
        results.push({ index, domain, status: "skipped", reason: s.disqualified });
        return;
      }
      const before = ws.accounts[domain] ? JSON.stringify(ws.accounts[domain]) : null;
      const { account, created: isNew } = ensureAccount(
        ws,
        { domain, name: clip(a.name, 120), city: clip(a.location, 80) },
        { source: "integration", sourceDetail: `${via} via agent key`, at, tag: `via:agent` },
      );
      if (account.status === "disqualified") {
        results.push({ index, domain, status: "skipped", reason: "The founder disqualified this company." });
        return;
      }
      if (!account.oneLiner && a.description) account.oneLiner = clip(a.description, 160);
      for (const t of (a.tags ?? []).slice(0, 5)) {
        const tag = clip(t, 30)?.toLowerCase();
        if (tag && !(account.tags ?? []).includes(tag) && (account.tags?.length ?? 0) < 12) account.tags = [...(account.tags ?? []), tag];
      }
      // Same rules score_accounts uses. Undescribed leads stay on the unscored B placeholder.
      if (isNew && s && scoring.ready && s.reasons.length && !s.reasons[0].startsWith("Not enough data")) {
        account.fitScore = s.fit_score;
        account.tier = s.tier === "none" ? "C" : s.tier;
      }
      let added = 0;
      let skippedDnc = 0;
      for (const p of (a.people ?? []).slice(0, 10)) {
        const email = normalizeEmail(p.email);
        const name = personName(p);
        const linkedin = p.linkedin_url && /linkedin\.com\//i.test(p.linkedin_url) ? clip(p.linkedin_url, 300) : undefined;
        if (!email && !name && !linkedin) continue;
        if (email && isSuppressed(ws, email, undefined)) {
          skippedDnc++;
          continue;
        }
        const r = ensurePerson(ws, { domain, email, name, title: clip(p.title, 120), linkedinUrl: linkedin, location: clip(p.location, 80) }, { via, source: "integration" });
        if (r.created) added++;
      }
      people += added;
      if (isNew) created++;
      else if (before !== JSON.stringify(account) || added) updated++;
      results.push({
        index,
        domain,
        status: isNew ? "created" : before !== JSON.stringify(account) || added ? "updated" : "unchanged",
        tier: account.tier,
        fit_score: account.fitScore,
        ...(added ? { people_added: added } : {}),
        ...(skippedDnc ? { people_skipped: skippedDnc, people_skipped_reason: "do_not_contact" } : {}),
      });
    });
  });
  const skipped = results.filter((r) => r.status === "skipped").length;
  const parts = [created && `${created} new`, updated && `${updated} updated`, skipped && `${skipped} skipped`].filter(Boolean).join(", ");
  return {
    data: { created, updated, skipped, people_added: people, results },
    summary: `Added ${plural(args.accounts.length, "company", "companies")}${parts ? ` (${parts})` : ""}${people ? ` and ${plural(people, "person", "people")}` : ""}`,
    records: created + people,
  };
}

/* ───────────── log_activity ───────────── */

export type ActivityType = "email_sent" | "reply" | "linkedin" | "call" | "meeting" | "note" | "bounce" | "unsubscribe";

const KIND: Record<ActivityType, ActivityKind> = {
  email_sent: "touch_sent",
  reply: "reply_received",
  linkedin: "linkedin_dm",
  call: "meeting_held",
  meeting: "meeting_held",
  note: "note",
  bounce: "bounce",
  unsubscribe: "unsubscribe",
};
const CHANNEL: Record<ActivityType, Activity["channel"]> = {
  email_sent: "email",
  reply: "email",
  linkedin: "linkedin",
  call: "phone",
  meeting: "in_person",
  note: "integration",
  bounce: "email",
  unsubscribe: "email",
};

export interface LogActivityIn {
  type: ActivityType;
  email?: string;
  linkedin_url?: string;
  domain?: string;
  person_name?: string;
  occurred_at?: string;
  summary: string;
  body?: string;
  sentiment?: NonNullable<Activity["sentiment"]>;
  source_tool: string;
  external_id: string;
}

function resolvePerson(ws: Workspace, input: { email?: string; linkedin_url?: string; name?: string; domain?: string; title?: string }, via: string): { person?: Person; domain?: string; created: boolean } {
  const email = normalizeEmail(input.email) ?? undefined;
  const linkedin = input.linkedin_url && /linkedin\.com\//i.test(input.linkedin_url) ? clip(input.linkedin_url, 300) : undefined;
  const name = clip(input.name, 120);
  const domain = normalizeDomain(input.domain) ?? companyDomainOf(email) ?? undefined;
  const found = findPerson(ws, { email, linkedinUrl: linkedin, name, domain });
  if (found) return { person: found, domain: found.accountDomain, created: false };
  if (!domain || isFreeMail(domain)) return { domain, created: false };
  ensureAccount(ws, { domain }, { source: "integration", sourceDetail: `${via} via agent key`, at: nowISO(), tag: "via:agent" });
  if (!email && !linkedin && !name) return { domain, created: false };
  // They asked for their details to be deleted: log against the company, without bringing them back.
  if (askedToBeDeleted(ws, email)) return { domain, created: false };
  const made = ensurePerson(ws, { domain, email, name, linkedinUrl: linkedin, title: clip(input.title, 120) }, { via, source: "integration" });
  return { person: made.person, domain, created: made.created };
}

export async function logActivity(key: ApiKey, args: LogActivityIn) {
  const idem = `${key.id}:act:${args.source_tool.toLowerCase()}:${args.external_id}`;
  const duplicate = (id: string) => ({ data: { status: "duplicate", activity_id: id }, summary: `Skipped a repeat ${args.type.replace(/_/g, " ")} (${args.external_id.slice(0, 40)})` });
  const prior = seenRecord(idem) ?? pendingSeen.get(idem);
  if (prior) return duplicate(prior);

  const via = sourceLabel(key, args.source_tool);
  const t = args.occurred_at ? Date.parse(args.occurred_at) : NaN;
  const at = Number.isNaN(t) ? nowISO() : new Date(Math.min(t, Date.now())).toISOString();
  const kind = KIND[args.type];
  const alerts: Activity[] = [];

  // The key stays reserved until keys.json has it (or the write failed), then the ledger answers.
  let reserved = false;
  let activity: Activity;
  try {
    const out = (
      await mutateWorkspace((ws) => {
        const dup = seenRecord(idem) ?? pendingSeen.get(idem);
        if (dup) return { dup };
        const { person, domain } = resolvePerson(ws, { email: args.email, linkedin_url: args.linkedin_url, name: args.person_name, domain: args.domain }, via);
        if (!person && !domain) throw new ToolError("Couldn't tell who this is about. Send an email, a LinkedIn URL, or a domain.");
        const sentiment = args.type === "unsubscribe" ? "unsubscribe" : args.type === "reply" ? (args.sentiment ?? "neutral") : args.sentiment;
        const a: Activity = {
          id: newId("act"),
          at,
          kind,
          personId: person?.id,
          accountDomain: person?.accountDomain ?? domain,
          dealId: ws.accounts[person?.accountDomain ?? domain ?? ""]?.dealId,
          channel: CHANNEL[args.type],
          summary: `${clip(args.summary, 160)} · via ${via}`,
          ...(args.body ? { body: clip(args.body, 4000) } : {}),
          ...(sentiment ? { sentiment } : {}),
          source: "mcp",
        };
        // The reducer cancels the rest of that person's sequence on a reply and bumps the deal.
        applyAction(ws, { type: "activity.log", activity: a });
        if (person) {
          const email = person.email ?? normalizeEmail(args.email) ?? undefined;
          if (kind === "bounce") {
            for (const c of person.contactPaths) if (email && c.value.toLowerCase() === email) c.bounced = true;
            if (email && !ws.suppression.some((s) => s.email?.toLowerCase() === email)) ws.suppression.push({ id: newId("sup"), email, reason: "bounce", at });
          }
          if (kind === "unsubscribe" || sentiment === "unsubscribe") {
            person.doNotContact = true;
            if (email && !ws.suppression.some((s) => s.email?.toLowerCase() === email)) ws.suppression.push({ id: newId("sup"), email, reason: "unsubscribe", at });
            for (const pkg of Object.values(ws.outreach)) if (pkg.personId === person.id) for (const s of pkg.steps) if (s.status === "draft") s.status = "skipped";
          }
        }
        if (kind === "reply_received" && (sentiment === "positive" || sentiment === "referral")) alerts.push(a);
        pendingSeen.set(idem, a.id);
        reserved = true;
        return { activity: a };
      })
    ).value;
    if (out.dup) return duplicate(out.dup);
    activity = out.activity!;
    await markSeen({ [idem]: activity.id });
  } finally {
    if (reserved) pendingSeen.delete(idem);
  }

  for (const alert of alerts) {
    // The founder's own Slack only; inbound origin never fires webhooks or CRM writes.
    const ws = readWorkspace();
    void emitHubEvent("reply.logged", { activity: activityData(alert), person: personData(ws, alert.personId), account: accountData(ws, alert.accountDomain), __activity: alert, __via: via }, { origin: "inbound" });
  }
  const who = activity.personId ? readWorkspace().people[activity.personId]?.name : activity.accountDomain;
  return {
    data: { status: "logged", activity_id: activity.id, person_id: activity.personId ?? null, account_domain: activity.accountDomain ?? null },
    summary: `Logged ${args.type === "email_sent" ? "an email" : args.type === "reply" ? `a ${activity.sentiment ?? ""} reply`.replace("  ", " ") : `a ${args.type.replace(/_/g, " ")}`}${who ? ` with ${who}` : ""}`,
    records: 1,
  };
}

/* ───────────── submit_draft ───────────── */

export interface SubmitDraftIn {
  to: { email?: string; linkedin_url?: string; name?: string; title?: string; domain?: string };
  channel: "email" | "linkedin";
  kind: "cold" | "follow_up" | "reply";
  subject?: string;
  body: string;
  note?: string;
  external_id?: string;
  /** Evidence ids from get_account the draft relies on. */
  evidence_ids?: string[];
  /** The founder POV (get_playbook povs) the draft rests on. */
  pov_id?: string;
}

const MAX_PENDING_PER_KEY = 25;

export async function submitDraft(key: ApiKey, args: SubmitDraftIn, base: string) {
  const idem = args.external_id ? `${key.id}:draft:${args.external_id}` : null;
  const duplicate = (id: string) => ({ data: { status: "duplicate", draft_id: id, review_url: `${base}/today` }, summary: "Skipped a repeat draft" });
  const prior = idem ? (seenRecord(idem) ?? pendingSeen.get(idem)) : undefined;
  if (prior) return duplicate(prior);

  const via = key.name;
  const today = todayISO();
  let reserved = false;
  let result: { pkg: OutreachPackage; step: DraftStep; person: Person; domain: string };
  try {
    const out = (
      await mutateWorkspace((ws) => {
        const dup = idem ? (seenRecord(idem) ?? pendingSeen.get(idem)) : undefined;
        if (dup) return { dup };
        const pending = Object.values(ws.outreach).filter((p) => p.origin?.keyId === key.id && p.steps.some((s) => s.status === "draft")).length;
        if (pending >= MAX_PENDING_PER_KEY) throw new ToolError(`${MAX_PENDING_PER_KEY} drafts from ${via} are already waiting for the founder. Wait until they review those.`, 429);
        const { person, domain } = resolvePerson(ws, { ...args.to, name: args.to.name }, via);
        if (!person || !domain) throw new ToolError("Say who it's for: a work email, a LinkedIn URL, or a name plus the company domain.");
        const email = person.email ?? normalizeEmail(args.to.email) ?? undefined;
        if (person.doNotContact || isSuppressed(ws, email, domain)) throw new ToolError(`${person.name} is on the founder's do-not-contact list. Don't contact them.`, 409);
        if (ws.accounts[domain]?.status === "disqualified") throw new ToolError(`The founder disqualified ${ws.accounts[domain].name}. Don't contact them.`, 409);
        if (args.channel === "linkedin" && !person.linkedinUrl) throw new ToolError("A LinkedIn draft needs the person's LinkedIn URL.");

        const mode: OutreachPackage["mode"] = args.channel === "linkedin" ? "linkedin" : args.kind;
        const stepNo = args.kind === "follow_up" ? 2 : 1;
        const step: DraftStep = {
          step: stepNo,
          personalizedSpans: [],
          sendOn: today,
          thread: args.kind === "cold" ? "new" : "reply",
          subject: args.channel === "linkedin" ? null : clip(args.subject, 120) ?? null,
          body: clip(args.body, 3000) ?? "",
          frame: args.kind === "reply" ? "reply" : "4t",
          // Cited evidence counts as a source for the number checks; unknown or flagged ids are dropped.
          evidenceIds: [...new Set(args.evidence_ids ?? [])].filter((id) => ws.evidence[id] && !ws.evidence[id].flaggedWrong),
          ...(args.pov_id && ws.povs.some((p) => p.id === args.pov_id) ? { povId: args.pov_id } : {}),
          claimIds: [],
          lint: { passed: true, violations: [], stats: { words: 0, fkGrade: 0, you: 0, iWe: 0, questionMarks: 0, links: 0 } },
          status: "draft",
        };
        const pkg: OutreachPackage = {
          id: newId("pkg"),
          mode,
          personId: person.id,
          accountDomain: domain,
          createdAt: nowISO(),
          steps: [step],
          alternates: [],
          ...(mode === "linkedin" ? { linkedin: { note: null, recommendNoNote: true, postAcceptDm: step.body } } : {}),
          blockers: [],
          warnings: [`Written by ${via}, not by me. Check every fact and claim before you approve it.`],
          origin: { kind: "agent", keyId: key.id, keyName: key.name, ...(args.external_id ? { externalId: clip(args.external_id, 120) } : {}), ...(args.note ? { note: clip(args.note, 300) } : {}) },
        };
        // Same deterministic checks as my own drafts (length, banned phrases, unsourced numbers…).
        step.lint = lintStep(ws, pkg, step);
        ws.outreach[pkg.id] = pkg;

        // Cold and LinkedIn drafts surface through Today's own rules (and the weekly cold cap).
        // Follow-ups and replies from outside have no rule, so they get a review card.
        if (mode === "follow_up" || mode === "reply") {
          const id = `mv_agent_${pkg.id}`;
          ws.moves[id] = {
            id,
            createdAt: nowISO(),
            dueOn: today,
            kind: mode === "reply" ? "reply" : "follow_up",
            title: `Review ${via}'s ${mode === "reply" ? "reply" : "follow-up"} to ${person.name.split(/\s+/)[0]} at ${ws.accounts[domain]?.name ?? domain}`,
            why: args.note ? clip(args.note, 120)! : `Drafted by ${via} · waiting for your approval`,
            minutes: 2,
            ref: { kind: "person", id: person.id },
            draft: { packageId: pkg.id, step: stepNo },
            evidenceIds: [],
            priority: mode === "reply" ? 95 : 60,
            rule: "agent.submit_draft",
            status: "open",
            href: `/companies?c=${encodeURIComponent(domain)}`,
          };
        }
        if (idem) {
          pendingSeen.set(idem, pkg.id);
          reserved = true;
        }
        return { result: { pkg, step, person, domain } };
      })
    ).value;
    if (out.dup) return duplicate(out.dup);
    result = out.result!;
    if (idem) await markSeen({ [idem]: result.pkg.id });
  } finally {
    if (reserved && idem) pendingSeen.delete(idem);
  }

  const issues = result.step.lint.violations.map((v) => ({ code: v.code, severity: v.severity, detail: v.detail }));
  return {
    data: {
      status: "awaiting_founder_review",
      draft_id: result.pkg.id,
      action_id: draftActionId(result.pkg.id, result.step.step),
      review_url: `${base}/companies?c=${encodeURIComponent(result.domain)}`,
      checks: { passed: result.step.lint.passed, issues },
      note: "Nothing was sent. The founder reviews it in Inroad. Fix the issues listed and submit again only if they ask.",
    },
    summary: `Submitted a ${args.channel === "linkedin" ? "LinkedIn message" : args.kind.replace("_", "-")} draft for ${result.person.name}${result.step.lint.passed ? "" : ` · ${plural(issues.filter((i) => i.severity === "error").length, "issue")}`}`,
    records: 1,
  };
}

/* ───────────── complete_action ───────────── */

export type Outcome = "done" | "booked" | "replied" | "skipped" | "not_relevant";

export async function completeAction(key: ApiKey, args: { action_id: string; outcome: Outcome; note?: string }) {
  const now = new Date();
  const at = now.toISOString();
  const note = clip(args.note, 300);
  const res = (
    await mutateWorkspace((ws) => {
      // Moves Today would show right now, persisted so the decision sticks.
      ws.moves = mergeMoves(ws.moves, computeMoves(ws, now), todayISO(now));
      const draftRef = args.action_id.match(/^draft:([\w-]+):(\d+)$/);
      const move = draftRef ? undefined : ws.moves[args.action_id];
      if (!draftRef && !move) throw new ToolError("No action with that id. Call get_next_actions for current ids.", 404);
      if (move && move.status !== "open" && move.status !== "snoozed") throw new ToolError(`That action is already ${move.status}.`, 409);

      const pkgId = draftRef?.[1] ?? move?.draft?.packageId;
      const stepNo = draftRef ? Number(draftRef[2]) : move?.draft?.step;
      const pkg = pkgId ? ws.outreach[pkgId] : undefined;
      const step = pkg?.steps.find((s) => s.step === stepNo);
      if (draftRef && (!pkg || !step)) throw new ToolError("That draft no longer exists.", 404);

      if (args.outcome === "skipped" || args.outcome === "not_relevant") {
        if (!move) throw new ToolError("Drafts are skipped by the founder, not by agents.", 403);
        const reason: SkipReason = args.outcome === "not_relevant" ? "not_relevant_now" : "other";
        applyAction(ws, { type: "move.skip", id: move.id, reason });
      } else if (move) {
        applyAction(ws, { type: "move.done", id: move.id });
      }
      const title = move?.title ?? `Draft step ${stepNo}`;
      const personId = move?.ref?.kind === "person" ? move.ref.id : pkg?.personId;
      ws.activities.push({
        id: newId("act"),
        at,
        kind: "note",
        personId,
        accountDomain: pkg?.accountDomain ?? (personId ? ws.people[personId]?.accountDomain : move?.ref?.kind === "account" ? move.ref.id : undefined),
        channel: "integration",
        summary: `${key.name} marked "${clip(title, 80)}" ${args.outcome.replace("_", " ")}${note ? `: ${note}` : ""}`,
        source: "mcp",
      });
      return { title };
    })
  ).value;
  return { data: { status: "recorded", action_id: args.action_id, outcome: args.outcome }, summary: `Marked "${clip(res.title, 60)}" ${args.outcome.replace("_", " ")}`, records: 1 };
}

/* ───────────── log_growth_week ───────────── */

export interface GrowthWeekIn {
  week_of?: string;
  signups?: number;
  activated?: number;
  active?: number;
  retained_pct?: number;
  paying?: number;
  new_paying?: number;
  churned_paying?: number;
  revenue_usd?: number;
  spend_usd?: number;
  referred?: number;
  top_channel?: string;
  source_tool: string;
}

/**
 * One week of numbers from a tool (PostHog, RevenueCat, Shopify through Zapier or n8n). Fields merge onto the week
 * already logged, so two tools can each send their part. The founder's own numbers are never overwritten.
 */
export async function logGrowthWeek(key: ApiKey, args: GrowthWeekIn, via: "mcp" | "rest") {
  const week = weekOf(args.week_of && /^\d{4}-\d{2}-\d{2}$/.test(args.week_of) ? args.week_of : todayISO());
  if (week > weekOf(todayISO())) throw new ToolError("week_of is in the future.");
  const fields: [keyof GrowthWeekIn, keyof GrowthWeek][] = [
    ["signups", "signups"],
    ["activated", "activated"],
    ["active", "active"],
    ["retained_pct", "retainedPct"],
    ["paying", "paying"],
    ["new_paying", "newPaying"],
    ["churned_paying", "churnedPaying"],
    ["revenue_usd", "revenueUsd"],
    ["spend_usd", "spendUsd"],
    ["referred", "referred"],
  ];
  const sent = fields.filter(([k]) => typeof args[k] === "number");
  if (!sent.length && !args.top_channel) throw new ToolError("Send at least one number.");
  const kept: string[] = [];
  await mutateWorkspace((ws) => {
    const prior = ws.growthLog?.find((w) => w.weekOf === week);
    if (!prior && typeof args.signups !== "number") throw new ToolError("The first numbers for a week need signups.");
    const next: GrowthWeek = prior ? { ...prior } : { weekOf: week, signups: args.signups!, source: via === "mcp" ? "mcp" : "webhook_in", loggedAt: nowISO() };
    for (const [k, field] of sent) {
      // A value the founder typed in wins over a tool's.
      if (prior?.source === "founder" && prior[field] !== undefined) {
        kept.push(String(k));
        continue;
      }
      const v = Math.max(0, args[k] as number);
      (next as unknown as Record<string, number>)[field] = field === "retainedPct" ? Math.min(100, v) : v;
    }
    if (args.top_channel && !(prior?.source === "founder" && prior.topChannel)) next.topChannel = clip(args.top_channel, 60);
    next.loggedAt = nowISO();
    applyAction(ws, { type: "growth.log", week: next });
  });
  return {
    data: { status: "logged", week_of: week, kept_founder_values: kept },
    summary: `Logged numbers for the week of ${week} from ${sourceLabel(key, args.source_tool)}${kept.length ? ` (kept the founder's ${kept.join(", ")})` : ""}`,
  };
}

/* ───────────── add_partners ───────────── */

export interface PartnerIn {
  kind: PartnerKind;
  name: string;
  platform?: PartnerPlatform;
  handle?: string;
  url?: string;
  audience?: string;
  followers?: number;
  engagement_rate?: number;
  fit: string;
}

/** Creators and communities from a creator tool or another agent. Upserts that only fill empty fields; stage stays the founder's. */
export async function addPartners(key: ApiKey, args: { source: string; partners: PartnerIn[] }) {
  const via = sourceLabel(key, args.source);
  let added = 0;
  let updated = 0;
  await mutateWorkspace((ws) => {
    ws.partners ??= {};
    const byKey = new Map(Object.values(ws.partners).map((p) => [partnerKey(p), p]));
    for (const raw of args.partners) {
      const candidate = { name: clip(raw.name, 80)!, handle: raw.handle ? normalizeHandle(raw.handle) : undefined, url: clip(raw.url, 400), platform: raw.platform };
      const existing = byKey.get(partnerKey(candidate));
      const at = nowISO();
      if (existing) {
        existing.audience ??= clip(raw.audience, 80);
        existing.followers ??= raw.followers;
        existing.engagementRate ??= raw.engagement_rate;
        existing.url ??= candidate.url;
        existing.updatedAt = at;
        updated++;
        continue;
      }
      const p: Partner = {
        id: newId("ptn"),
        kind: raw.kind,
        ...candidate,
        audience: clip(raw.audience, 80),
        followers: raw.followers,
        engagementRate: raw.engagement_rate,
        fit: clip(raw.fit, 160) ?? "",
        source: "integration",
        notes: `Added by ${via}`,
        stage: "shortlist",
        stageHistory: [{ stage: "shortlist", at }],
        createdAt: at,
        updatedAt: at,
      };
      ws.partners[p.id] = p;
      byKey.set(partnerKey(p), p);
      added++;
    }
  });
  return { data: { added, updated }, summary: `${plural(added, "creator or community", "creators and communities")} added${updated ? `, ${updated} updated` : ""} from ${via}`, records: added + updated };
}
