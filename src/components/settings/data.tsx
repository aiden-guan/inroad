"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Download, FileSpreadsheet, HardDrive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Menu, MenuItem } from "@/components/ui/menu";
import { CopyButton, Skeleton } from "@/components/ui/misc";
import type { Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { Group, Row, SettingsSection } from "./parts";

/* ───────────── Files ───────────── */

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** RFC 4180 quoting; a leading = + - @ is neutralized so spreadsheets don't run it as a formula. */
function csv(header: string[], rows: (string | number | boolean | undefined | null)[][]): string {
  const cell = (v: string | number | boolean | undefined | null) => {
    let s = v === undefined || v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

const EXPORTS = {
  companies: (ws: Workspace) =>
    csv(
      ["domain", "name", "status", "tier", "fit_score", "why_now", "source", "people", "deal_stage", "added_at"],
      Object.values(ws.accounts).map((a) => [a.domain, a.name, a.status, a.tier, a.fitScore, a.whyNow, a.sourceDetail ?? a.source, a.peopleIds.length, a.dealId ? ws.deals[a.dealId]?.stage : "", a.addedAt]),
    ),
  people: (ws: Workspace) =>
    csv(
      ["name", "title", "company_domain", "email", "linkedin_url", "location", "do_not_contact"],
      Object.values(ws.people).map((p) => [p.name, p.title, p.accountDomain, p.email, p.linkedinUrl, p.location, p.doNotContact]),
    ),
  deals: (ws: Workspace) =>
    csv(
      ["name", "company_domain", "stage", "amount_usd", "next_step", "next_step_date", "source", "created_at", "last_activity_at"],
      Object.values(ws.deals).map((d) => [d.name, d.accountDomain, d.stage, d.amountUsd, d.nextStep?.what, d.nextStep?.date, d.source, d.createdAt, d.lastActivityAt]),
    ),
};

/* ───────────── Section ───────────── */

export function DataSection({ ws, refresh, dataDir, today }: { ws: Workspace; refresh: () => Promise<void>; dataDir: string | null; today: string }) {
  const counts = { companies: Object.keys(ws.accounts).length, people: Object.keys(ws.people).length, deals: Object.keys(ws.deals).length };
  return (
    <SettingsSection id="data" title="Data" description="Your workspace is a set of files on this computer. Take it with you, try the sample, or start over.">
      <Group>
        <Row
          align="start"
          label={
            <span className="flex items-center gap-2">
              <HardDrive className="size-3.5 text-fg-3" aria-hidden />
              Data stays on this machine
            </span>
          }
          hint="Only two things leave it: calls to Anthropic with the context a task needs, and free public lookups that carry company names and domains. Connected tools get only what you push to them."
        />
        <div className="flex items-center gap-2 px-4 py-3">
          {dataDir ? (
            <>
              {/* RTL + an isolated LTR run keeps the end of a long path visible (the folder name matters most). */}
              <code className="min-w-0 flex-1 truncate rounded-xs bg-sunken px-2 py-1 text-left font-mono text-[12px] text-fg-2 ring-1 ring-inset ring-border [direction:rtl]" title={dataDir}>
                <bdi>{dataDir}</bdi>
              </code>
              <CopyButton text={dataDir} label="Copy path" />
            </>
          ) : (
            <Skeleton className="h-6 w-full" />
          )}
        </div>
      </Group>

      <Group title="Export">
        <Row label="Workspace" hint="Everything as one JSON file: playbook, companies, people, deals, drafts and run receipts. API keys and connector secrets are never included.">
          <div className="flex sm:justify-end">
            <Button
              icon={<Download className="size-3.5" />}
              onClick={() => {
                download(`inroad-workspace-${today}.json`, JSON.stringify(ws, null, 2), "application/json");
                toast("Workspace downloaded.");
              }}
            >
              Download .json
            </Button>
          </div>
        </Row>
        <Row label="Spreadsheets" hint="Companies, people and deals as CSV, for a spreadsheet or another CRM.">
          <div className="flex sm:justify-end">
            <Menu
              trigger={
                <Button icon={<FileSpreadsheet className="size-3.5" />}>
                  Download CSV <ChevronDown className="size-3.5 text-fg-3" aria-hidden />
                </Button>
              }
            >
              {(Object.keys(EXPORTS) as (keyof typeof EXPORTS)[]).map((k) => (
                <MenuItem key={k} hint={String(counts[k])} onSelect={() => download(`inroad-${k}-${today}.csv`, EXPORTS[k](ws), "text/csv")}>
                  {k[0].toUpperCase() + k.slice(1)}
                </MenuItem>
              ))}
            </Menu>
          </div>
        </Row>
      </Group>

      <WorkspaceActions ws={ws} refresh={refresh} />
    </SettingsSection>
  );
}

/* ───────────── Sample and reset (inline confirms, never a modal) ───────────── */

function holdsRealWork(ws: Workspace) {
  return !ws.sample && (ws.onboarding.status !== "new" || ws.company !== null || Object.keys(ws.accounts).length > 0);
}

function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.22, ease: ease.out }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function WorkspaceActions({ ws, refresh }: { ws: Workspace; refresh: () => Promise<void> }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"sample" | "reset" | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"sample" | "reset" | null>(null);

  const call = async (kind: "sample" | "reset") => {
    setBusy(kind);
    try {
      const res = await fetch(kind === "sample" ? "/api/workspace/sample" : "/api/workspace/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: kind === "sample" ? JSON.stringify({ replace: true }) : undefined,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't work. Try again.");
      await refresh();
      setConfirm(null);
      setTyped("");
      if (kind === "sample") {
        toast("Sample workspace loaded. Everything here is made up.");
        router.push("/today");
      } else {
        toast("Workspace reset. Let's start with your website.");
        router.push("/welcome");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const real = holdsRealWork(ws);

  return (
    <Group title="Start over">
      {ws.sample ? (
        <Row label="You're exploring the sample workspace" hint="Ledgerline is made up. Reset below to start on your own company." />
      ) : (
        <div>
          <Row label="Load the sample workspace" hint="See Inroad after a month of work: a playbook, deals in flight, drafts and receipts.">
            <div className="flex sm:justify-end">
              <Button
                loading={busy === "sample"}
                aria-expanded={confirm === "sample"}
                onClick={() => (real ? setConfirm(confirm === "sample" ? null : "sample") : void call("sample"))}
              >
                Load sample
              </Button>
            </div>
          </Row>
          <Expand open={confirm === "sample"}>
            <div className="flex flex-col gap-3 bg-warning-subtle/60 px-4 py-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-fg text-pretty">
                The sample replaces everything in your workspace. Your API key and connected tools stay. Download the JSON above first if you want a copy.
              </p>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" loading={busy === "sample"} onClick={() => void call("sample")}>
                  Replace with sample
                </Button>
              </div>
            </div>
          </Expand>
        </div>
      )}

      <div>
        <Row label="Reset workspace" hint="Deletes your playbook, companies, deals, drafts and history on this machine. Your API key and connected tools stay.">
          <div className="flex sm:justify-end">
            <Button
              variant="danger"
              className="ring-1 ring-inset ring-danger/30"
              aria-expanded={confirm === "reset"}
              onClick={() => {
                setConfirm(confirm === "reset" ? null : "reset");
                setTyped("");
              }}
            >
              Reset…
            </Button>
          </div>
        </Row>
        <Expand open={confirm === "reset"}>
          <form
            className="flex flex-col gap-2 bg-danger-subtle/60 px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim().toLowerCase() === "reset") void call("reset");
            }}
          >
            <label htmlFor="reset-confirm" className="text-[12.5px] leading-[18px] text-fg">
              This can&apos;t be undone. Type <span className="font-mono font-medium">reset</span> to confirm.
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="reset-confirm"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setConfirm(null);
                  }
                }}
                className="font-mono sm:max-w-[200px]"
              />
              <div className="flex gap-1.5">
                <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger" className="bg-surface ring-1 ring-inset ring-danger/40" disabled={typed.trim().toLowerCase() !== "reset"} loading={busy === "reset"}>
                  Reset workspace
                </Button>
              </div>
            </div>
          </form>
        </Expand>
      </div>
    </Group>
  );
}
