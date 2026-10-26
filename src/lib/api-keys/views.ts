import "server-only";
import { todayISO } from "@/lib/domain/ids";
import { offerable, themeNeedsProof } from "@/components/playbook/model";
import { STAGE_LABELS, type Move, type Persona, type Workspace } from "@/lib/domain/types";
import { isSuppressed, normalizeDomain, normalizeEmail } from "@/lib/hub/records";
import { computeMoves, mergeMoves, visibleMoves } from "@/lib/moves/rules";
import { linkedinKey } from "@/lib/network/csv";
import { AI_VOCAB_FOR_PROMPT, BANNED_FOR_PROMPT, HYPE_FOR_PROMPT, LIMITS } from "@/lib/quality/lint";

/**
 * Read views for outside agents. Compact, snake_case JSON built in code from the workspace: an
 * agent reading the playbook costs Inroad zero tokens. Only approved facts leave: approved claims,
 * approved objection answers, approved assets. Unproven value themes are marked as such.
 */

const notReady = (ws: Workspace) => ({
  ready: false,
  message: "The founder hasn't finished the playbook yet. Don't prospect or write on their behalf until get_icp returns ready: true.",
  company: ws.company ? { name: ws.company.name, domain: ws.company.domain, one_liner: ws.company.plainOneLiner, who_its_for: ws.company.whoItsFor } : null,
});

function persona(p: Persona) {
  return { id: p.id, role: p.role, titles: p.titles, kpis: p.kpis, pains: p.pains, triggers: p.triggers, objections: p.objections, how_to_talk_to_them: p.line };
}

export function icpView(ws: Workspace) {
  const f = ws.foundation;
  if (!f) return notReady(ws);
  return {
    ready: true,
    company: ws.company ? { name: ws.company.name, domain: ws.company.domain, one_liner: ws.company.plainOneLiner, who_its_for: ws.company.whoItsFor, stage: ws.company.stage } : null,
    icp: {
      hypothesis: f.icp.hypothesis.sentence,
      primary_segment: f.icp.primarySegment,
      segment_locked: Boolean(f.icp.segmentLockedAt),
      employee_band: f.icp.employeeBand ?? null,
      criteria: f.icp.criteria.map((c) => ({ id: c.id, text: c.text, kind: c.kind, must_have: c.mustHave, status: c.status, how_detected: c.detection })),
      disqualifiers: f.icp.antiIcp.map((a) => ({ text: a.text, reason: a.reason })),
      triggers: f.icp.triggers.map((t) => ({ signal: t.type, window_days: t.windowDays, implication: t.implication })),
    },
    personas: f.personas.map(persona),
    tiers: {
      A: "Fit ≥70 and why-now ≥2 (a fresh, dated signal). Work these first.",
      B: "Fit ≥70, no fresh signal. Watch; don't cold-email yet.",
      C: "Fit 50–69 with a strong signal (why-now ≥3).",
      none: "Below that. Don't spend credits or outreach here.",
    },
    scoring: "fit = round(100 × Σ(w·m)/Σw); must-have w=3, nice-to-have w=1; met=1, unknown=0.5, not met=0. Use score_accounts to apply it.",
    do_not_contact_domains: ws.suppression.filter((s) => s.domain).length,
    confidence: f.confidence,
    updated_at: f.generatedAt,
  };
}

export type Channel = "email" | "linkedin" | "call";

function writingRules(channel: Channel, ws: Workspace) {
  if (channel === "linkedin") {
    return {
      connection_note_max_chars: LIMITS.liNoteChars,
      message_max_chars: LIMITS.liDmChars,
      rules: [
        "Send a blank invite unless you share strong context (their post, talk or community). No pitch in the note.",
        "After they accept: context, then one insight, then one question. No link, no calendar link.",
        "LinkedIn touches don't count toward the cold email cap.",
      ],
    };
  }
  if (channel === "call") {
    return {
      qualification: {
        dimensions: ["pain", "spend", "critical_event", "champion", "economic_buyer", "icp_fit"],
        scale: "Each scored 0–2. Qualified at 8 of 12. Also capture the decision and paper process.",
      },
      rules: [
        "Discovery is for learning, not pitching: their current workaround, what it costs, and what happens if nothing changes.",
        "A meeting without a dated next step the buyer agreed to has failed. Ask for one before hanging up.",
        "Disqualifying early is a good outcome. Say so out loud when the fit isn't there.",
        "Charge from day one: a paid pilot (7–14 days, success criteria in writing) or a paid design partnership with a conversion date.",
      ],
      commercial: ws.foundation ? { structure: ws.foundation.commercial.structure, terms: ws.foundation.commercial.terms, price_anchor: ws.foundation.commercial.priceAnchor } : null,
    };
  }
  return {
    limits: {
      first_touch_words: `${LIMITS.cold1.min}–${LIMITS.cold1.max} (never over ${LIMITS.cold1.hard})`,
      follow_up_words: `${LIMITS.followUp.min}–${LIMITS.followUp.max}`,
      final_touch_max_words: LIMITS.final.max,
      subject_words: `${LIMITS.subjectWords.min}–${LIMITS.subjectWords.max}, reads like an internal email, never "Re:" on a new thread`,
      reading_grade_max: LIMITS.fkEmail,
      question_marks_max: LIMITS.questionMarks,
      links_in_first_touch: 0,
    },
    structure: [
      "Line 1 is a dated, public fact about them (their job post, launch, filing, talk). If the rest could go to anyone, rewrite it.",
      "Then what that fact likely means for this person's role, in their own words. A hypothesis, not a claim.",
      "Then one of the founder's points of view (povs) or one approved credential. Never invent customers, metrics, logos or peers.",
      "End with exactly one question they can answer in a line. No calendar link and no meeting ask in the first touch.",
      "Sequence: day 0 new thread; day +3 same thread with a new angle, never 'just bumping'; day +8 ask who owns this or close the loop. Then stop.",
      "No exclamation marks, emoji, ALL CAPS, {placeholders}, or more than one em dash. Don't write a signature.",
    ],
    claims_rule: "Statements about the founder's company may only use approved_claims. Numbers need a source.",
    banned_phrases: BANNED_FOR_PROMPT,
    banned_hype: HYPE_FOR_PROMPT.split(/,\s*/),
    banned_ai_words: AI_VOCAB_FOR_PROMPT.split(/,\s*/),
  };
}

export function playbookView(ws: Workspace, args: { channel?: Channel; persona?: string }) {
  const f = ws.foundation;
  if (!f) return notReady(ws);
  const q = args.persona?.trim().toLowerCase();
  const personas = q ? f.personas.filter((p) => p.id.toLowerCase() === q || p.role === q || p.titles.some((t) => t.toLowerCase().includes(q))) : f.personas;
  const ids = new Set(personas.map((p) => p.id));
  const channel = args.channel ?? "email";
  return {
    ready: true,
    channel,
    one_liner: f.messaging.oneLiner,
    category: { name: f.positioning.category.name, style: f.positioning.category.style },
    alternatives: f.positioning.alternatives.map((a) => ({ name: a.name, kind: a.kind, why_chosen_today: a.whyChosenToday })),
    differentiators: f.positioning.differentiators.map((d) => ({ capability: d.capability, vs_alternative: d.vsAlternative, proven: d.status === "proven" })),
    value_themes: f.positioning.valueThemes.map((t) => ({ id: t.id, theme: t.theme, outcome: t.outcome, needs_proof: themeNeedsProof(ws, t) })),
    personas: personas.map((p) => ({ ...persona(p), message: f.messaging.byPersona.find((b) => b.personaId === p.id)?.line ?? p.line })),
    persona_filter_matched: q ? personas.length > 0 : undefined,
    signal_angles: f.messaging.bySignal.map((s) => ({ signal: s.signal, implication: s.implication })),
    customer_words: f.messaging.customerWords.map((w) => w.phrase),
    banned_words: f.messaging.bannedWords,
    approved_claims: ws.claims.filter((c) => c.approved).map((c) => ({ id: c.id, text: c.text, kind: c.kind, permission: c.permission })),
    povs: ws.povs.map((p) => ({ id: p.id, text: p.text, basis: p.evidence })),
    objections: ws.objections
      .filter((o) => o.approved)
      .slice(0, 12)
      .map((o) => ({ objection: o.objection, underlying_concern: o.underlyingConcern, clarifying_question: o.clarifyingQ, response: o.response, walk_away_if: o.walkAwayIf })),
    assets: ws.assets.filter(offerable).map((a) => ({ id: a.id, kind: a.kind, title: a.title, url: a.url ?? null })),
    competitors: f.competitors.slice(0, 8).map((c) => ({ name: c.name, domain: c.domain ?? null, when_we_win: c.whenWeWin, when_we_lose: c.whenWeLose })),
    voice: ws.voice ? { summary: ws.voice.summary, sign_off: ws.voice.signOff } : null,
    caps: {
      cold_first_touches_per_week: ws.caps.firstTouchesPerWeek,
      cold_first_touches_per_day_max: ws.caps.firstTouchesPerDayMax,
      contacts_per_company_per_week: ws.caps.contactsPerAccountPerWeek,
      note: "Fewer, better conversations. Never exceed these, whatever tool sends.",
    },
    writing_rules: writingRules(channel, ws),
    approval: "Inroad never sends. Use submit_draft for anything written in the founder's name; it waits for their approval.",
    ...(ids.size !== f.personas.length ? { personas_total: f.personas.length } : {}),
  };
}

/* ───────────── search_records ───────────── */

export function searchView(ws: Workspace, args: { query?: string; domain?: string; email?: string; linkedin_url?: string; limit?: number }) {
  const limit = Math.min(25, Math.max(1, args.limit ?? 10));
  const domain = args.domain ? normalizeDomain(args.domain) : null;
  const email = args.email ? normalizeEmail(args.email) : null;
  const li = args.linkedin_url ? linkedinKey(args.linkedin_url) : "";
  const q = args.query?.trim().toLowerCase() ?? "";
  const emailDomain = email ? normalizeDomain(email.split("@")[1]) : null;
  // The suppression list holds opt-outs and erasure requests that may have no record left.
  const hit = ws.suppression.find((s) => (email && s.email?.toLowerCase() === email) || [domain, emailDomain].some((d) => d && s.domain?.toLowerCase() === d));

  const people = Object.values(ws.people).filter((p) => {
    if (email && p.email?.toLowerCase() === email) return true;
    if (li && p.linkedinUrl && linkedinKey(p.linkedinUrl) === li) return true;
    if (domain && p.accountDomain === domain) return true;
    if (q && q.length >= 2 && (p.name.toLowerCase().includes(q) || p.title.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q))) return true;
    return false;
  });
  const accountDomains = new Set<string>();
  if (domain && ws.accounts[domain]) accountDomains.add(domain);
  if (emailDomain && ws.accounts[emailDomain]) accountDomains.add(emailDomain);
  if (q.length >= 2) for (const a of Object.values(ws.accounts)) if (a.name.toLowerCase().includes(q) || a.domain.includes(q)) accountDomains.add(a.domain);
  for (const p of people) accountDomains.add(p.accountDomain);

  const accounts = [...accountDomains]
    .map((d) => ws.accounts[d])
    .filter(Boolean)
    .slice(0, limit)
    .map((a) => {
      const deal = a.dealId ? ws.deals[a.dealId] : undefined;
      return {
        domain: a.domain,
        name: a.name,
        status: a.status,
        tier: a.tier,
        fit_score: a.fitScore,
        why_now: a.whyNow,
        why_now_score: a.whyNowScore,
        tracked: a.watch,
        warm_paths: a.warmPathCount,
        people: a.peopleIds.length,
        deal_stage: deal ? STAGE_LABELS[deal.stage] : null,
        do_not_contact: isSuppressed(ws, undefined, a.domain) || a.status === "disqualified",
        source: a.sourceDetail ?? a.source,
      };
    });
  const deals = Object.values(ws.deals)
    .filter((d) => accountDomains.has(d.accountDomain) || (q.length >= 2 && d.name.toLowerCase().includes(q)))
    .slice(0, limit)
    .map((d) => ({ id: d.id, name: d.name, account_domain: d.accountDomain, stage: STAGE_LABELS[d.stage], next_step: d.nextStep?.what ?? null, next_step_date: d.nextStep?.date ?? null, last_activity_at: d.lastActivityAt }));
  return {
    accounts,
    people: people.slice(0, limit).map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      account_domain: p.accountDomain,
      email: p.email ?? null,
      linkedin_url: p.linkedinUrl ?? null,
      role: p.role ?? null,
      do_not_contact: p.doNotContact || isSuppressed(ws, p.email, p.accountDomain),
    })),
    deals,
    exists: accounts.length > 0 || people.length > 0,
    do_not_contact: Boolean(hit),
    do_not_contact_reason: hit ? hit.reason : null,
  };
}

/* ───────────── get_account ───────────── */

/** One company's research for an agent that writes outreach itself: built from stored data, zero tokens. Null when unknown. */
export function accountView(ws: Workspace, input: string, base: string) {
  const domain = normalizeDomain(input);
  const a = domain ? ws.accounts[domain] : undefined;
  if (!a) return null;
  const cited = new Set<string>();
  const ids = (list: (string | undefined)[]) => {
    const ok = list.filter((id): id is string => Boolean(id && ws.evidence[id] && !ws.evidence[id].flaggedWrong));
    for (const id of ok) cited.add(id);
    return ok;
  };
  const signals = a.signals
    .filter((s) => s.usableInOutreach)
    .map((s) => ({ type: s.type, headline: s.headline, date: s.date, url: s.url, implication: s.implication, evidence_id: ids([s.evidenceId])[0] ?? null }));
  const d = a.dossier;
  const dossier = d
    ? {
        generated_at: d.generatedAt,
        stale: d.staleAfter < todayISO(),
        description: d.snapshot.plainDescription,
        facts: d.facts.map((f) => ({ text: f.text, evidence_ids: ids(f.evidenceIds) })),
        pain_hypotheses: d.painHypotheses.map((p) => ({ pain: p.pain, evidence_ids: ids(p.evidenceIds) })),
        angles: d.angles.map((x) => ({
          id: x.id,
          title: x.title,
          signal: x.signal,
          interpretation: x.interpretation,
          pov: x.pov,
          pov_id: x.povId ?? null,
          ask: x.ask,
          best_for: x.bestFor,
          evidence_ids: ids(x.evidenceIds),
        })),
        recommendation: { move: d.recommendation.move, why: d.recommendation.why },
      }
    : null;
  return {
    domain: a.domain,
    name: a.name,
    tier: a.tier,
    fit_score: a.fitScore,
    why_now: a.whyNow,
    why_now_score: a.whyNowScore,
    do_not_contact: isSuppressed(ws, undefined, a.domain) || a.status === "disqualified",
    signals,
    dossier,
    evidence: [...cited].map((id) => {
      const e = ws.evidence[id];
      return { id, quote: e.quote, url: e.url, published_at: e.publishedAt ?? null };
    }),
    people: a.peopleIds
      .map((id) => ws.people[id])
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, title: p.title, role: p.role ?? null, email: p.email ?? null, linkedin_url: p.linkedinUrl ?? null, do_not_contact: p.doNotContact || isSuppressed(ws, p.email, p.accountDomain) })),
    url: `${base}/companies?c=${encodeURIComponent(a.domain)}`,
  };
}

/* ───────────── get_next_actions ───────────── */

/** The founder's moves as Today would show them right now (computed, not persisted). */
export function currentMoves(ws: Workspace, now = new Date()): Move[] {
  const today = todayISO(now);
  return visibleMoves(mergeMoves(ws.moves, computeMoves(ws, now), today), today);
}

export const draftActionId = (packageId: string, step: number) => `draft:${packageId}:${step}`;

export function nextActionsView(ws: Workspace, args: { limit?: number; channel?: "email" | "linkedin" | "any" }, base: string) {
  const limit = Math.min(25, Math.max(1, args.limit ?? 10));
  const moves = currentMoves(ws);
  const byChannel = (kind: Move["kind"]) => (args.channel === "linkedin" ? kind === "linkedin" : args.channel === "email" ? kind !== "linkedin" : true);
  const personOf = (id?: string) => {
    const p = id ? ws.people[id] : undefined;
    return p ? { id: p.id, name: p.name, title: p.title, email: p.email ?? null, linkedin_url: p.linkedinUrl ?? null, do_not_contact: p.doNotContact || isSuppressed(ws, p.email, p.accountDomain) } : null;
  };
  const actions: Record<string, unknown>[] = [];
  for (const m of moves) {
    if (!byChannel(m.kind)) continue;
    const pkg = m.draft ? ws.outreach[m.draft.packageId] : undefined;
    const step = pkg?.steps.find((s) => s.step === m.draft?.step);
    const personId = m.ref?.kind === "person" ? m.ref.id : pkg?.personId;
    const domain = pkg?.accountDomain ?? (m.ref?.kind === "account" ? m.ref.id : personId ? ws.people[personId]?.accountDomain : undefined);
    actions.push({
      action_id: m.id,
      kind: m.kind,
      title: m.title,
      why: m.why,
      due_on: m.dueOn,
      minutes: m.minutes,
      overdue_days: m.overdueDays ?? 0,
      company: domain ? { domain, name: ws.accounts[domain]?.name ?? domain } : null,
      person: personOf(personId),
      draft: pkg && step ? draftView(pkg.id, step, pkg.mode) : null,
      source_url: m.source?.url ?? null,
      url: `${base}${m.href && m.href.startsWith("/") ? m.href : "/today"}`,
    });
  }
  return {
    actions: actions.slice(0, limit),
    total: actions.length,
    rules: "Inroad never sends. Drafts are for the founder to review and send in Inroad. Use submit_draft to propose one.",
  };
}

function draftView(packageId: string, step: Workspace["outreach"][string]["steps"][number], mode: string) {
  const approved = step.status === "approved";
  return {
    draft_id: packageId,
    step: step.step,
    channel: mode === "linkedin" ? "linkedin" : "email",
    status: approved ? "approved" : step.status === "draft" ? "awaiting_founder_review" : step.status,
    // Text only travels once the founder approved it.
    subject: approved ? step.subject : null,
    body: approved ? step.body : null,
    thread: step.thread,
  };
}
