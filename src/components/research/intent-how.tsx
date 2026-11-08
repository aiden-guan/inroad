"use client";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime, usd } from "@/lib/client/format";
import { SOURCE_LABEL, type IntentQuery, type IntentScan, type IntentSourceId, type IntentState } from "@/lib/intent/types";
import { intentAction, type IntentStatus } from "./use-intent";

const STATE_TONE = { ready: "success", setup: "warning", off: "neutral" } as const;
const STATE_LABEL = { ready: "On", setup: "Needs setup", off: "Off" } as const;

/** "$0.0021" for fractions of a cent, so a cheap scan never reads as free. */
/** Requests that went out (not cached) in a scan, across sources. */
export const scanRequests = (scan: IntentScan) => Object.values(scan.requests).reduce((n, r) => n + (r?.made ?? 0), 0);

export const money = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : usd(n));

/** One line for the last scan: what it asked, read, judged and kept, and what it cost. */
export function scanLine(scan: IntentScan): string {
  const req = Object.values(scan.requests).reduce((n, r) => n + (r?.made ?? 0), 0);
  const cached = Object.values(scan.requests).reduce((n, r) => n + (r?.cached ?? 0), 0);
  const paid = scan.requests.reddit?.made ?? 0;
  return [
    `${req} requests${paid ? ` (${paid} through your search provider)` : ""}${cached ? `, ${cached} from cache` : ""}`,
    `${scan.fetched} posts read`,
    `${scan.judged} judged by the fast model${scan.reused ? `, ${scan.reused} remembered` : ""}`,
    `${scan.kept} kept`,
    money(scan.costUsd),
  ].join(" · ");
}

/**
 * How the radar works, in the open: each source and its limits, the exact queries the playbook gives, the ones the
 * founder's "Not relevant" retired (with a way back), and what the scans have cost.
 */
export function IntentHow({ status, state, consumer }: { status: IntentStatus | null; state: IntentState | undefined; consumer: boolean }) {
  const { refresh } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const scans = state?.scans ?? [];
  const month = new Date().toISOString().slice(0, 7);
  const monthCost = scans.filter((s) => s.at.startsWith(month)).reduce((n, s) => n + s.costUsd, 0);
  const bySource = new Map<IntentSourceId, IntentQuery[]>();
  for (const q of status?.queries ?? []) bySource.set(q.source, [...(bySource.get(q.source) ?? []), q]);

  async function retry(q: IntentQuery) {
    setBusy(q.key);
    try {
      await intentAction({ action: "retry_query", key: q.key });
      await refresh();
      toast(`I'll search “${q.query}” on ${SOURCE_LABEL[q.source]} again.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't bring that query back.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="group rounded-xl ring-1 ring-inset ring-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-[13px] text-fg-2 hover:bg-bg-subtle/60 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="font-medium text-fg">How this works</span>
          {scans[0] ? <span className="text-fg-3"> · last scan {relativeTime(scans[0].at)}, {money(scans[0].costUsd)}</span> : <span className="text-fg-3"> · sources, queries and cost</span>}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-fg-3 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border px-4 py-4 text-[12.5px] leading-[19px] text-fg-2">
        <section>
          <h3 className="mb-2 text-[12px] font-medium text-fg-3">Sources</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(status?.sources ?? []).map((s) => (
              <li key={s.id} className="flex items-start gap-2">
                <Badge tone={STATE_TONE[s.state]} className="mt-px">
                  {STATE_LABEL[s.state]}
                </Badge>
                <span className="min-w-0">
                  <span className="font-medium text-fg">{s.label}</span> · {s.note}{" "}
                  {s.state === "setup" && s.href && (
                    <Link href={s.href} className="text-fg underline underline-offset-2">
                      Set up
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-[12px] font-medium text-fg-3">Queries from your playbook</h3>
          {!status?.queries.length ? (
            <p className="text-fg-3">
              None yet. They come from your buyer&apos;s words, category, obstacle and competitors.{" "}
              <Link href="/playbook" className="text-fg underline underline-offset-2">
                Open the playbook
              </Link>
            </p>
          ) : (
            <ul className="space-y-1.5">
              {[...bySource.entries()].map(([source, qs]) => (
                <li key={source} className="[overflow-wrap:anywhere]">
                  <span className="font-medium text-fg">{SOURCE_LABEL[source]}</span>{" "}
                  {qs.map((q, i) => {
                    const fb = state?.feedback[q.key];
                    return (
                      <span key={q.key}>
                        {i > 0 && <span className="text-fg-4"> · </span>}
                        <span className="font-mono text-[12px]">{q.query}</span>
                        {q.site && <span className="text-fg-3"> on {q.site}</span>}
                        {fb && (fb.hits || fb.misses) ? (
                          <span className="text-fg-3">
                            {" "}
                            ({fb.hits} kept, {fb.misses} not relevant)
                          </span>
                        ) : null}
                      </span>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
          {!!status?.retired.length && (
            <div className="mt-3 space-y-1.5">
              {status.retired.map((q) => {
                const fb = state?.feedback[q.key];
                return (
                  <p key={q.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-3">
                    <span className="[overflow-wrap:anywhere]">
                      Stopped searching <span className="font-mono text-[12px] text-fg-2">{q.query}</span> on {SOURCE_LABEL[q.source]}
                      {q.site ? ` (${q.site})` : ""}: you marked {fb?.misses ?? 3} of its posts not relevant
                      {fb?.hits ? ` and kept ${fb.hits}` : ""}.
                    </span>
                    <Button size="xs" variant="ghost" loading={busy === q.key} onClick={() => void retry(q)}>
                      Search it again
                    </Button>
                  </p>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[12px] font-medium text-fg-3">What it costs</h3>
          {scans[0] ? (
            <>
              <p>Last scan: {scanLine(scans[0])}.</p>
              <p className="mt-1 text-fg-3">
                This month: {money(monthCost)} across {scans.filter((s) => s.at.startsWith(month)).length} scans. A post the model has read is remembered for four
                weeks, so a second scan only pays for new posts. Reply drafts are separate runs on your usage page.
              </p>
              {scans[0].warnings.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-warning">
                  {scans[0].warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-fg-3">
              Searching is free. Only the posts that mention your playbook go to the fast model, at most 60 a scan, each judged once.{" "}
              {consumer ? "" : "The developer radar uses no AI."}
            </p>
          )}
        </section>
        <p className="text-[12px] text-fg-3">
          Inroad never posts or replies for you. It drafts; you post, as yourself, in the thread.
        </p>
      </div>
    </details>
  );
}
