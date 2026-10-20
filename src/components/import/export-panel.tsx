"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SubLabel } from "@/components/agents/bits";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { downloadResponse, getJson } from "./api";

/**
 * Data out: companies, people and deals as CSV, and ready cold first touches as a sequencer CSV
 * (Instantly, Smartlead and lemlist column names, the copy as custom variables). Exporting drafts is
 * the founder's approval to hand them to that sequencer, and the cold cap applies whatever tool
 * sends: only as many as it leaves today are ticked, and Export stays off past it.
 */

interface SeqDraft {
  id: string;
  person: string;
  title: string;
  company: string;
  domain: string;
  subject: string | null;
  steps: number;
  mode: string;
}

const link =
  "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[12.5px] font-medium text-fg-2 ring-1 ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle hover:text-fg active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function ExportPanel({ className }: { className?: string }) {
  const { ws, refresh } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<SeqDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [capLeft, setCapLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await getJson<{ drafts: SeqDraft[]; capLeft: number }>("/api/import/export?kind=sequencer");
      let left = r.capLeft;
      setDrafts(r.drafts);
      setCapLeft(r.capLeft);
      setPicked(new Set(r.drafts.filter((d) => d.mode !== "cold" || left-- > 0).map((d) => d.id)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load drafts.");
    }
  }

  async function exportDrafts() {
    setBusy(true);
    try {
      const res = await fetch("/api/import/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ packageIds: [...picked] }) });
      const rows = await downloadResponse(res, "inroad-sequencer.csv");
      const held = Number(res.headers.get("x-skipped") ?? 0);
      toast(
        `Exported ${rows} draft${rows === 1 ? "" : "s"}${held ? `, ${held} held back by your cap` : ""}. Upload the file to your sequencer; follow-ups will show up on Today when they're due.`,
      );
      void refresh();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  const counts = ws ? { accounts: Object.keys(ws.accounts).length, people: Object.keys(ws.people).length, deals: Object.keys(ws.deals).length } : null;
  const coldPicked = drafts?.filter((d) => d.mode === "cold" && picked.has(d.id)).length ?? 0;
  const overCap = capLeft !== null && coldPicked > capLeft;

  return (
    <div className={cn("border-t border-border pt-4", className)}>
      <SubLabel>Export</SubLabel>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["accounts", "Companies"],
            ["people", "People"],
            ["deals", "Deals"],
          ] as const
        ).map(([kind, label]) => {
          const n = counts?.[kind] ?? 0;
          return n ? (
            <a key={kind} className={link} href={`/api/import/export?kind=${kind}`} download>
              <Download className="size-3.5 text-fg-3" aria-hidden /> {label}
              <span className="font-mono text-[11px] text-fg-3">{n.toLocaleString("en-US")}</span>
            </a>
          ) : (
            <span key={kind} className={cn(link, "pointer-events-none opacity-50")} aria-disabled="true" title={`No ${label.toLowerCase()} to export yet`}>
              <Download className="size-3.5 text-fg-3" aria-hidden /> {label}
            </span>
          );
        })}
        <button
          type="button"
          aria-expanded={open}
          className={cn(link, open && "bg-bg-subtle text-fg")}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) void load();
          }}
        >
          Drafts for a sequencer
        </button>
      </div>

      {open && (
        <div className="mt-3 rounded-lg ring-1 ring-border animate-[rise-in_180ms_var(--ease-out)]">
          {error ? (
            <p className="px-3 py-3 text-[13px] text-danger">{error}</p>
          ) : !drafts ? (
            <div className="grid gap-2 px-3 py-3">
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3.5 w-36" />
            </div>
          ) : !drafts.length ? (
            <p className="px-3 py-3 text-[13px] leading-[19px] text-fg-2">
              No drafts are ready. A draft is ready when it passes every check, hasn&apos;t been sent, and has an email to send to.
            </p>
          ) : (
            <>
              <ul className="max-h-56 divide-y divide-border overflow-y-auto">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-bg-subtle/60">
                      <input
                        type="checkbox"
                        checked={picked.has(d.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(d.id);
                          else next.delete(d.id);
                          setPicked(next);
                        }}
                        className="size-3.5 shrink-0 accent-[var(--primary)]"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-fg">{d.person || "Unnamed"}</span>
                        <span className="text-fg-3"> · {d.company}</span>
                      </span>
                      <span className="hidden shrink-0 truncate text-[12px] text-fg-3 sm:block sm:max-w-[40%]">{d.subject ?? ""}</span>
                      {d.steps > 1 && <span className="shrink-0 font-mono text-[11px] text-fg-3">{d.steps} steps</span>}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-2.5">
                <Button size="sm" variant="primary" disabled={!picked.size || overCap} loading={busy} onClick={() => void exportDrafts()} icon={<Download className="size-3.5" />}>
                  Export {picked.size} draft{picked.size === 1 ? "" : "s"}
                </Button>
                {capLeft !== null && (
                  <span className={cn("text-[12px] leading-[17px]", overCap ? "text-warning" : "text-fg-3")} aria-live="polite">
                    <span className="font-mono tnum">{capLeft}</span> cold first touch{capLeft === 1 ? "" : "es"} left today
                    {overCap ? ` · untick ${coldPicked - capLeft} to stay within your cap` : ""}
                  </span>
                )}
                <p className="min-w-0 basis-full text-[12px] leading-[17px] text-fg-3">
                  Exporting counts as approving them. Use a one-step campaign with <code className="font-mono text-[11.5px]">{"{{subject}}"}</code> and{" "}
                  <code className="font-mono text-[11.5px]">{"{{body}}"}</code>; I draft each follow-up on Today when it&apos;s due.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
