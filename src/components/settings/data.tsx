"use client";

import { ChevronDown, Download, FileSpreadsheet, HardDrive } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Menu, MenuItem } from "@/components/ui/menu";
import { CopyButton, Skeleton } from "@/components/ui/misc";
import type { Workspace } from "@/lib/domain/types";
import { useLeaveSample } from "@/components/shell/sample-banner";
import { BackupsGroup } from "./backups";
import { Expand, Group, Row, SettingsSection } from "./parts";

/* ───────────── Files ───────────── */

function download(name: string, body: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof body === "string" ? new Blob([body], { type }) : body);
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

/** The whole workspace as one backup file (GET /api/workspace/export), named by the server. */
async function downloadBackup(today: string) {
  try {
    const res = await fetch("/api/workspace/export", { cache: "no-store" });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The backup didn't download. Try again.");
    const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `inroad-backup-${today}.json`;
    download(name, await res.blob(), "application/json");
    toast("Backup downloaded. Restore it from Backups below, here or on another computer.");
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "The backup didn't download. Try again.");
  }
}

export function DataSection({
  ws,
  refresh,
  dataDir,
  dataDirInApp = false,
  today,
}: {
  ws: Workspace;
  refresh: () => Promise<void>;
  dataDir: string | null;
  dataDirInApp?: boolean;
  today: string;
}) {
  const counts = { companies: Object.keys(ws.accounts).length, people: Object.keys(ws.people).length, deals: Object.keys(ws.deals).length };
  const [downloading, setDownloading] = useState(false);
  return (
    <SettingsSection id="data" title="Data & backups" description="Your workspace is a set of files on this computer. Take it with you, restore a backup, try the sample, or start over.">
      <Group>
        <Row
          align="start"
          label={
            <span className="flex items-center gap-2">
              <HardDrive className="size-3.5 text-fg-3" aria-hidden />
              Data stays on this machine
            </span>
          }
          hint="What leaves it: calls to your AI provider with the context a task needs (none with Ollama), and free public lookups that carry company names and domains (and place names for the map, unless you turn that off in Data sources). Connected tools get only what you push to them."
        />
        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
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
          {dataDirInApp && (
            <p className="mt-2 text-[12px] leading-[17px] text-fg-3 text-pretty">
              <span className="font-medium text-warning">This is inside Inroad&apos;s own folder,</span> so deleting or re-cloning Inroad deletes your data
              with it. To keep it safe, start Inroad with <span className="font-mono text-[11.5px] text-fg-2">GTM_DATA_DIR</span> set to a folder of its
              own; the README shows how.
            </p>
          )}
        </div>
      </Group>

      <Group id="export" title="Export">
        <Row
          label="Everything"
          hint="One backup file with every part of your workspace: playbook, companies, people, deals, drafts, Ask threads, LinkedIn connections, imports and run history. API keys and connector secrets are never in it."
        >
          <div className="flex sm:justify-end">
            <Button
              icon={<Download className="size-3.5" />}
              loading={downloading}
              onClick={() => {
                setDownloading(true);
                void downloadBackup(today).finally(() => setDownloading(false));
              }}
            >
              Download backup
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

      <BackupsGroup refresh={refresh} version={ws.createdAt} />

      <WorkspaceActions ws={ws} refresh={refresh} />
    </SettingsSection>
  );
}

/* ───────────── Sample and reset (inline confirms, never a modal) ───────────── */

function holdsRealWork(ws: Workspace) {
  return !ws.sample && (ws.onboarding.status !== "new" || ws.company !== null || Object.keys(ws.accounts).length > 0);
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
  const { leave, busy: leaving } = useLeaveSample();

  return (
    <Group id="reset" title="Start over">
      {ws.sample ? (
        <Row label="You're exploring the sample workspace" hint={`${ws.company?.name ?? "This company"} and everyone in it are made up. Nothing here is yours, so leaving takes one click.`}>
          <div className="flex sm:justify-end">
            <Button variant="primary" loading={leaving} onClick={() => void leave()}>
              Start with my company
            </Button>
          </div>
        </Row>
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
                The sample replaces everything in your workspace. I&apos;ll save a backup of it first, so you can restore it from Backups above. Your API key and connected tools stay.
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

      {!ws.sample && (
        <div>
          <Row label="Reset workspace" hint="Clears your playbook, companies, deals, drafts and history on this machine, after saving a backup. Your API key and connected tools stay.">
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
                I&apos;ll save a backup first, so you can restore this from Backups above. Type <span className="font-mono font-medium">reset</span> to confirm.
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
      )}
    </Group>
  );
}
