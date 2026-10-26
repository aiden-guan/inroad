import { daysBetween, todayISO } from "@/lib/domain/ids";
import type { DraftStep, Evidence, OutreachPackage, Workspace } from "@/lib/domain/types";
import { isFlaggedTerm, lintDraft, mergeLint, type LintInput } from "./lint";
import type { RecentDraft } from "./similarity";

/**
 * Everything lint needs from the workspace, built the same way on the server (compose workflow)
 * and in the browser (live editor), so "Ready" means the same thing in both places.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Vocabulary the ICP legitimately uses: persona titles, customer words, category, tech. */
export function allowWordsFor(ws: Workspace): string[] {
  const out: string[] = [];
  const f = ws.foundation;
  if (f) {
    for (const p of f.personas) out.push(...p.titles);
    for (const w of f.messaging.customerWords) out.push(w.phrase);
    out.push(f.positioning.category.name);
    for (const c of f.icp.criteria) for (const w of c.text.split(/[^\p{L}-]+/u)) if (w.length > 3 && isFlaggedTerm(w)) out.push(w);
  }
  out.push(...(ws.company?.tech ?? []));
  return [...new Set(out.filter(Boolean))];
}

/** Quote + date words for a span's evidence; null when the id doesn't resolve or was flagged wrong. */
export function spanSupport(ev: Evidence | undefined): string | null {
  if (!ev || ev.flaggedWrong) return null;
  const date = ev.publishedAt ? new Date(`${ev.publishedAt.slice(0, 10)}T12:00:00`) : null;
  const when = date && !Number.isNaN(date.getTime()) ? ` ${MONTHS[date.getMonth()]} ${date.getFullYear()}` : "";
  return `${ev.quote} ${ev.host}${when}`;
}

/** Text a claim number may come from: cited quotes, approved claims, the founder's POVs and answers. */
export function sourcedTextFor(ws: Workspace, step: Pick<DraftStep, "evidenceIds" | "personalizedSpans">): string {
  const ids = new Set([...(step.evidenceIds ?? []), ...(step.personalizedSpans ?? []).map((s) => s.evidenceId)]);
  const parts: string[] = [];
  for (const id of ids) {
    const ev = ws.evidence[id];
    if (ev && !ev.flaggedWrong) parts.push(ev.quote);
  }
  for (const c of ws.claims) if (c.approved) parts.push(c.text);
  for (const p of ws.povs) parts.push(p.text, p.evidence);
  if (ws.company?.founderNote) parts.push(ws.company.founderNote);
  for (const q of ws.foundation?.founderQuestions ?? []) if (q.answer) parts.push(q.answer);
  return parts.join("\n");
}

export function knownNamesFor(ws: Workspace, pkg: Pick<OutreachPackage, "accountDomain" | "personId">): string[] {
  const acc = ws.accounts[pkg.accountDomain];
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  return [acc?.name, pkg.accountDomain.split(".")[0], person?.name, ws.company?.name, ws.founder.name, ws.sender?.company].filter(Boolean) as string[];
}

/** Cold first touches from the last 14 days (excluding this package), for convergence checks. */
export function recentDraftsFor(ws: Workspace, excludeId: string | null, accountDomain: string, today = todayISO()): RecentDraft[] {
  const out: RecentDraft[] = [];
  for (const pkg of Object.values(ws.outreach)) {
    if (pkg.id === excludeId || pkg.mode !== "cold") continue;
    const ageDays = daysBetween(pkg.createdAt.slice(0, 10), today);
    if (ageDays > 14) continue;
    const s1 = pkg.steps.find((s) => s.step === 1);
    if (!s1 || !s1.body.trim()) continue;
    out.push({
      body: s1.body,
      sameAccount: pkg.accountDomain === accountDomain,
      ageDays,
      label: `your draft to ${ws.accounts[pkg.accountDomain]?.name ?? pkg.accountDomain}`,
    });
  }
  return out;
}

export function lintKindFor(pkg: Pick<OutreachPackage, "mode">): LintInput["kind"] {
  if (pkg.mode === "linkedin") return "linkedin_dm";
  if (pkg.mode === "warm_intro") return "intro_forwardable";
  return "email";
}

export interface LintOverrides {
  subject?: string | null;
  body?: string;
  linkedinNote?: string | null;
  introWrapper?: string;
}

/** Lints one step of a package exactly as the workflow did, with optional live edits applied. */
export function lintStep(ws: Workspace, pkg: OutreachPackage, step: DraftStep, edits: LintOverrides = {}): ReturnType<typeof lintDraft> {
  const base: Omit<LintInput, "subject" | "body" | "kind"> = {
    frame: step.frame,
    step: step.step,
    thread: step.thread,
    allowWords: allowWordsFor(ws),
    sourcedText: sourcedTextFor(ws, step),
    assetId: step.assetId,
    requirePov: pkg.mode === "cold" && step.step === 1,
    povId: step.povId ?? null,
    credentialId: step.credentialClaimId ?? null,
    spans: step.personalizedSpans.map((s) => ({ text: s.text, support: spanSupport(ws.evidence[s.evidenceId]) })),
    knownNames: knownNamesFor(ws, pkg),
    recent: pkg.mode === "cold" && step.step === 1 ? recentDraftsFor(ws, pkg.id, pkg.accountDomain) : undefined,
    badExamples: pkg.mode === "cold" || pkg.mode === "follow_up" ? ws.voice?.badExamples?.map((b) => b.text) : undefined,
  };
  const main = lintDraft({
    ...base,
    kind: lintKindFor(pkg),
    subject: edits.subject !== undefined ? edits.subject : step.subject,
    body: edits.body ?? step.body,
  });
  const extra: ReturnType<typeof lintDraft>[] = [];
  if (pkg.linkedin) {
    const note = edits.linkedinNote !== undefined ? edits.linkedinNote : pkg.linkedin.note;
    if (note) extra.push(lintDraft({ ...base, requirePov: false, recent: undefined, kind: "linkedin_note", subject: null, body: note }));
  }
  if (pkg.intro) {
    const wrapper = edits.introWrapper ?? pkg.intro.wrapper;
    extra.push(lintDraft({ ...base, requirePov: false, spans: undefined, recent: undefined, kind: "intro_wrapper", subject: null, body: wrapper }));
  }
  return extra.length ? { ...mergeLint([main, ...extra]), stats: main.stats } : main;
}

/** The step a surface should show by default: the first open draft, else the last one. */
export function currentStep(pkg: OutreachPackage, step?: number): DraftStep | undefined {
  if (step !== undefined) return pkg.steps.find((s) => s.step === step);
  return pkg.steps.find((s) => s.status === "draft") ?? pkg.steps[pkg.steps.length - 1];
}
