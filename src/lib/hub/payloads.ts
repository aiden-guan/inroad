import "server-only";
import type { Activity, DraftStep, OutreachPackage, Workspace } from "@/lib/domain/types";
import { STAGE_LABELS } from "@/lib/domain/types";
import { readHub } from "./store";

/**
 * Compact, stable JSON for outbound events (snake_case, like most webhook consumers expect).
 * Only what a downstream tool needs to act: ids, names, emails, stage, a link back.
 */

export function appUrl(): string {
  return readHub().appUrl ?? "http://localhost:3000";
}

export function companyUrl(domain: string): string {
  return `${appUrl()}/companies?c=${encodeURIComponent(domain)}`;
}

export function accountData(ws: Workspace, domain: string | undefined) {
  if (!domain) return undefined;
  const a = ws.accounts[domain];
  if (!a) return { domain };
  return {
    domain,
    name: a.name,
    status: a.status,
    tier: a.tier,
    fit_score: a.fitScore,
    why_now: a.whyNow,
    source: a.sourceDetail ?? a.source,
    url: companyUrl(domain),
  };
}

export function personData(ws: Workspace, id: string | undefined) {
  if (!id) return undefined;
  const p = ws.people[id];
  if (!p) return { id };
  return {
    id,
    name: p.name,
    title: p.title || null,
    email: p.email ?? null,
    linkedin_url: p.linkedinUrl ?? null,
    role: p.role ?? null,
    company_domain: p.accountDomain,
  };
}

export function dealData(ws: Workspace, id: string | undefined) {
  if (!id) return undefined;
  const d = ws.deals[id];
  if (!d) return { id };
  return {
    id,
    name: d.name,
    stage: d.stage,
    stage_label: STAGE_LABELS[d.stage],
    amount_usd: d.amountUsd ?? null,
    close_date: d.closeDate ?? null,
    next_step: d.nextStep ? { what: d.nextStep.what, date: d.nextStep.date } : null,
    company_domain: d.accountDomain,
    contacts: d.contacts.map((c) => personData(ws, c.personId)).filter(Boolean),
    url: companyUrl(d.accountDomain),
  };
}

export function draftData(pkg: OutreachPackage, step: DraftStep) {
  return {
    package_id: pkg.id,
    step: step.step,
    mode: pkg.mode,
    channel: pkg.mode === "linkedin" ? "linkedin" : "email",
    subject: step.subject,
    body: step.body,
    frame: step.frame,
    send_on: step.sendOn,
  };
}

export function activityData(a: Activity) {
  return {
    id: a.id,
    at: a.at,
    kind: a.kind,
    channel: a.channel ?? null,
    summary: a.summary,
    body: a.body ? a.body.slice(0, 2000) : null,
    sentiment: a.sentiment ?? null,
    source: a.source ?? null,
  };
}

/** Today's brief, for `brief.ready`: the greeting, the top moves and the week's numbers. */
export function briefData(ws: Workspace, date: string) {
  const b = ws.briefs[date];
  if (!b) return undefined;
  const moves = (b.moveIds ?? []).map((id) => ws.moves[id]).filter(Boolean);
  return {
    date,
    greeting: b.greeting,
    worth_knowing: b.matters.map((m) => ({ text: m.text, url: m.url ?? null })),
    moves: moves.map((m) => ({ id: m.id, kind: m.kind, title: m.title, due_on: m.dueOn })),
    scoreboard: b.scoreboard ?? null,
    url: `${appUrl()}/today`,
  };
}
