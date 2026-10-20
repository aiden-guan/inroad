import "server-only";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type OutreachPackage, type Workspace } from "@/lib/domain/types";
import { isSuppressed } from "@/lib/hub/records";
import { capUsage } from "@/lib/quality/gates";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { toCsv } from "./csv";

/**
 * CSV exports. Accounts, people and deals are plain snapshots. The sequencer file carries approved
 * first touches in the column names Instantly, Smartlead and lemlist map on upload (email,
 * first_name, company_name…), with the copy as custom variables, so the sequencer sends the
 * founder's exact words. Follow-ups are drafted on Today when they're due, never pre-filled blank.
 */

export type ExportKind = "accounts" | "people" | "deals" | "sequencer";

const date = (iso?: string) => (iso ? iso.slice(0, 10) : "");

function accountsCsv(ws: Workspace, base: string): string {
  const rows = Object.values(ws.accounts)
    .sort((a, b) => b.fitScore - a.fitScore || a.name.localeCompare(b.name))
    .map((a) => [
      a.domain,
      a.name,
      a.status,
      a.tier,
      a.fitScore,
      a.whyNowScore,
      a.whyNow ?? "",
      a.watch ? "yes" : "",
      a.warmPathCount,
      a.peopleIds.length,
      a.dealId ? STAGE_LABELS[ws.deals[a.dealId]?.stage ?? "talking"] : "",
      a.hqCity ?? "",
      a.source,
      a.sourceDetail ?? "",
      (a.tags ?? []).join("; "),
      date(a.addedAt),
      `${base}/companies?c=${encodeURIComponent(a.domain)}`,
    ]);
  return toCsv(
    ["Domain", "Company", "Status", "Tier", "Fit score", "Why-now score", "Why now", "Tracked", "Warm paths", "People", "Deal stage", "HQ city", "Source", "Source detail", "Tags", "Added", "Inroad link"],
    rows,
  );
}

function peopleCsv(ws: Workspace): string {
  const rows = Object.values(ws.people)
    .sort((a, b) => a.accountDomain.localeCompare(b.accountDomain) || a.name.localeCompare(b.name))
    .map((p) => {
      const [first, ...rest] = p.name.trim().split(/\s+/);
      const email = p.email ?? p.contactPaths.find((c) => /@/.test(c.value) && !c.bounced)?.value ?? "";
      return [
        p.name,
        first ?? "",
        rest.join(" "),
        p.title,
        email,
        p.linkedinUrl ?? "",
        ws.accounts[p.accountDomain]?.name ?? "",
        p.accountDomain,
        p.role ?? "",
        p.doNotContact || isSuppressed(ws, email || undefined, undefined) ? "yes" : "",
        p.champion ?? "",
        p.location ?? "",
        p.source ?? "",
        p.lastSeen ?? "",
      ];
    });
  return toCsv(["Name", "First name", "Last name", "Title", "Email", "LinkedIn URL", "Company", "Domain", "Role", "Do not contact", "Champion", "Location", "Source", "Last seen"], rows);
}

function dealsCsv(ws: Workspace): string {
  const rows = Object.values(ws.deals)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((d) => [
      d.name,
      ws.accounts[d.accountDomain]?.name ?? "",
      d.accountDomain,
      STAGE_LABELS[d.stage],
      d.amountUsd ?? "",
      d.closeDate ?? "",
      d.nextStep?.what ?? "",
      d.nextStep?.date ?? "",
      d.nextStep ? (d.nextStep.buyerAgreed ? "yes" : "no") : "",
      d.qualification ? `${d.qualification.total}/12` : "",
      d.qualification?.qualified ? "yes" : "",
      d.source,
      d.lossReason ?? "",
      date(d.createdAt),
      date(d.lastActivityAt),
    ]);
  return toCsv(
    ["Deal", "Company", "Domain", "Stage", "Amount (USD)", "Close date", "Next step", "Next step date", "Buyer agreed", "Qualification", "Qualified", "Source", "Loss reason", "Created", "Last activity"],
    rows,
  );
}

/**
 * Cold first touches ready for a sequencer: step 1 still a draft that passes every check, no reply
 * yet, an email to send to, not suppressed, not already handed off. Follow-up packages are same-thread
 * replies with no subject, so they never go out as new leads. The founder ticks which ones go
 * (within the cold cap); exporting is the approval.
 */
export function sequencerCandidates(ws: Workspace): OutreachPackage[] {
  return Object.values(ws.outreach)
    .filter((pkg) => {
      if (pkg.mode !== "cold") return false;
      const first = [...pkg.steps].sort((a, b) => a.step - b.step)[0];
      if (!first || first.status !== "draft" || !first.lint.passed) return false;
      if (pkg.steps.some((s) => s.status === "cancelled_by_reply") || pkg.pushedTo?.length) return false;
      const person = pkg.personId ? ws.people[pkg.personId] : undefined;
      const email = person?.email ?? person?.contactPaths.find((c) => /@/.test(c.value) && !c.bounced)?.value;
      return Boolean(person && email && !person.doNotContact && !isSuppressed(ws, email, pkg.accountDomain));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sequencerRows(ws: Workspace, pkgs: OutreachPackage[]): unknown[][] {
  return pkgs.map((pkg) => {
    const person = ws.people[pkg.personId!];
    const email = person.email ?? person.contactPaths.find((c) => /@/.test(c.value) && !c.bounced)!.value;
    const [first, ...rest] = person.name.trim().split(/\s+/);
    const steps = [...pkg.steps].filter((s) => s.status !== "skipped" && s.status !== "cancelled_by_reply").sort((a, b) => a.step - b.step);
    const s1 = steps[0];
    const opener = s1?.body.split(/\n+/).find((l) => l.trim() && !/^(hi|hey|hello|dear)\b/i.test(l.trim())) ?? "";
    const sig = [ws.voice?.signOff, ws.sender?.name || ws.founder.name].filter(Boolean).join("\n");
    return [
      email,
      first ?? "",
      rest.join(" "),
      ws.accounts[pkg.accountDomain]?.name ?? pkg.accountDomain,
      `https://${pkg.accountDomain}`,
      person.title,
      person.linkedinUrl ?? "",
      s1?.subject ?? "",
      opener,
      s1?.body ?? "",
      sig,
      pkg.id,
    ];
  });
}

const SEQ_HEADERS = ["email", "first_name", "last_name", "company_name", "website", "title", "linkedin_url", "subject", "opener", "body", "signature", "inroad_draft_id"];

export function buildExport(kind: Exclude<ExportKind, "sequencer">, base: string): { csv: string; fileName: string; rows: number } {
  const ws = readWorkspace();
  const stamp = todayISO();
  if (kind === "accounts") return { csv: accountsCsv(ws, base), fileName: `inroad-companies-${stamp}.csv`, rows: Object.keys(ws.accounts).length };
  if (kind === "people") return { csv: peopleCsv(ws), fileName: `inroad-people-${stamp}.csv`, rows: Object.keys(ws.people).length };
  return { csv: dealsCsv(ws), fileName: `inroad-deals-${stamp}.csv`, rows: Object.keys(ws.deals).length };
}

/** Cold first touches left under both the weekly and the daily cap. */
export function coldCapLeft(ws: Workspace): number {
  const cu = capUsage(ws);
  return Math.min(cu.remainingWeek, cu.remainingToday);
}

/**
 * The founder's chosen drafts as a sequencer CSV, up to what the cold cap allows today. Their steps
 * become "approved" (handed to a sender outside Inroad) with step 1 dated today; the sequencer's own
 * later steps are the follow-ups, so Today drafts none. A "pushed" activity is logged, and they won't
 * be offered again.
 */
export async function exportSequencer(packageIds: string[]): Promise<{ csv: string; fileName: string; rows: number; skipped: number }> {
  const at = nowISO();
  return (
    await mutateWorkspace((ws) => {
      const wanted = new Set(packageIds);
      const pkgs = sequencerCandidates(ws).filter((p) => wanted.has(p.id));
      // Whatever tool sends, a cold first touch uses the cap.
      let left = coldCapLeft(ws);
      const kept = pkgs.filter((p) => p.mode !== "cold" || left-- > 0);
      const csv = toCsv(SEQ_HEADERS, sequencerRows(ws, kept));
      for (const pkg of kept) {
        for (const s of pkg.steps) {
          if (s.status !== "draft") continue;
          s.status = "approved";
          if (s.step === 1) s.sentAt ??= at;
        }
        pkg.pushedTo = [...(pkg.pushedTo ?? []), { integrationId: "csv", at }];
        const person = pkg.personId ? ws.people[pkg.personId] : undefined;
        ws.activities.push({
          id: newId("act"),
          at,
          kind: "pushed",
          personId: pkg.personId,
          accountDomain: pkg.accountDomain,
          dealId: ws.accounts[pkg.accountDomain]?.dealId,
          channel: "integration",
          draftRef: { packageId: pkg.id, step: 1 },
          angleId: pkg.angleId,
          summary: `Exported ${pkg.steps.length > 1 ? `${pkg.steps.length} steps` : "a draft"} for ${person?.name ?? pkg.accountDomain} to a sequencer CSV`,
          source: "csv",
        });
      }
      return { csv, fileName: `inroad-sequencer-${todayISO()}.csv`, rows: kept.length, skipped: pkgs.length - kept.length };
    })
  ).value;
}
