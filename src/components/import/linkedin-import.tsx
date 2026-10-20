"use client";

import { ArrowLeft, ArrowUpRight, Lock, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useActiveRuns, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { WorkLog } from "@/components/ui/work-log";
import { isLinkedInHeader, isRealCompany, normalizeCompany, parseCsv, headerKey } from "@/lib/network/csv";
import { buyerTitleMatcher, isBuyerRole } from "@/lib/network/titles";
import type { ImportResponse } from "@/lib/network/types";
import { shortDate } from "@/lib/client/format";
import { postJson } from "./api";
import { DropZone } from "./drop-zone";
import { NetworkResult } from "./network-result";

/**
 * Warm before cold: the founder's LinkedIn Connections.csv. Parsed here for a preview, stored
 * locally on import (never sent to Claude in bulk), diffed against the last import for job
 * changes, then screened by the `network` workflow with a live work log.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const EXPORT_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";

interface FileIn {
  name: string;
  text: string;
}

interface Preview {
  rows: number;
  companies: number;
  withEmail: number;
  buyers: number;
}

function previewOf(text: string, match: (p: string) => { role: Parameters<typeof isBuyerRole>[0] } | null): Preview | string {
  const p = parseCsv(text, { isHeader: isLinkedInHeader });
  if (!isLinkedInHeader(p.headers)) return "This doesn't look like LinkedIn's Connections.csv. It needs First Name, Last Name, URL, Company and Position columns.";
  if (!p.rows.length) return "That file has LinkedIn's columns but no connections in it.";
  const keys = p.headers.map(headerKey);
  const company = keys.indexOf("company");
  const position = keys.indexOf("position");
  const email = keys.findIndex((k) => k === "emailaddress" || k === "email");
  const companies = new Set<string>();
  let withEmail = 0;
  let buyers = 0;
  for (const r of p.rows) {
    const n = normalizeCompany(r[company] ?? "");
    if (isRealCompany(n)) companies.add(n);
    if (email >= 0 && /@/.test(r[email] ?? "")) withEmail++;
    if (isBuyerRole(match(r[position] ?? "")?.role)) buyers++;
  }
  return { rows: p.rows.length, companies: companies.size, withEmail, buyers };
}

export function LinkedInImport({ initial, onList, onDone }: { initial?: FileIn | null; onList: (file: FileIn) => void; onDone?: () => void }) {
  const { ws, refresh } = useWorkspace();
  const { runs, start } = useRuns();
  const active = useActiveRuns().find((r) => r.workflow === "network");
  const matcher = useMemo(() => (ws ? buyerTitleMatcher(ws) : () => null), [ws]);
  const [file, setFile] = useState<FileIn | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [diff, setDiff] = useState<ImportResponse["batch"]["linkedin"] | null>(null);
  const [phase, setPhase] = useState<"pick" | "screening" | "result">("pick");

  const preview = useMemo(() => (file ? previewOf(file.text, matcher) : null), [file, matcher]);
  const run = runId ? runs[runId] : active;
  const net = ws?.network;

  function pick(name: string, text: string) {
    const p = parseCsv(text, { isHeader: isLinkedInHeader });
    if (!isLinkedInHeader(p.headers) && p.headers.length >= 2) {
      // A regular list dropped here by mistake: hand it to the list importer.
      onList({ name, text });
      return;
    }
    setError(null);
    setFile({ name, text });
  }

  async function screen(reason: "import" | "rescreen", importId?: string) {
    const r = await start("network", { reason, ...(importId ? { importId } : {}) }, { notify: false, onResult: () => void refresh().then(() => setPhase("result")) });
    if (r) {
      setRunId(r.id);
      setPhase("screening");
    } else {
      setPhase("result");
    }
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await postJson<ImportResponse>("/api/import/linkedin", { fileName: file.name, text: file.text, screen: false });
      setDiff(r.batch.linkedin ?? null);
      await refresh();
      await screen("import", r.batch.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  /* ── Screening (also when the dialog reopens mid-run) ── */
  if (run && (phase === "screening" || (phase === "pick" && !file && (run.status === "running" || run.status === "queued")))) {
    const done = run.status !== "running" && run.status !== "queued";
    return (
      <div className="grid gap-4">
        {diff && (
          <p className="text-[13px] leading-[19px] text-fg-2">
            Imported {fmt(diff.total)} connections
            {diff.added && diff.added !== diff.total ? ` · ${fmt(diff.added)} new` : ""}
            {diff.changed ? ` · ${fmt(diff.changed)} changed jobs or titles` : ""}
            {diff.removed ? ` · ${fmt(diff.removed)} no longer connected` : ""}. Now screening them against your ICP.
          </p>
        )}
        <WorkLog run={run} defaultOpen />
        {done && (
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setPhase("result")}>
              See the result
            </Button>
          </div>
        )}
        {!done && <p className="text-[12px] text-fg-3">You can close this. Screening keeps going, and the result lands on Integrations and Today.</p>}
      </div>
    );
  }

  /* ── Result ── */
  if (phase === "result" && net) {
    return (
      <NetworkResult
        key={net.screenedAt ?? net.importedAt}
        network={net}
        onDone={onDone}
        rescreenBusy={Boolean(run && (run.status === "running" || run.status === "queued"))}
        onRescreen={() => void screen("rescreen")}
      />
    );
  }

  /* ── Pick a file ── */
  if (file && preview && typeof preview !== "string") {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={() => setFile(null)} className="inline-flex items-center gap-1 rounded-sm text-[13px] text-fg-3 transition-colors hover:text-fg">
            <ArrowLeft className="size-3.5" aria-hidden /> Other file
          </button>
          <span className="min-w-0 truncate font-mono text-[12px] text-fg-2">{file.name}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-bg-subtle px-3.5 py-3 ring-1 ring-border sm:grid-cols-4">
          {[
            [preview.rows, "connections"],
            [preview.companies, "companies"],
            [preview.buyers, ws?.foundation ? "buyer titles" : "buyer titles (needs ICP)"],
            [preview.withEmail, "with an email"],
          ].map(([v, l]) => (
            <div key={l as string} className="min-w-0">
              <p className="font-mono text-[18px] leading-6 tnum text-fg">{fmt(v as number)}</p>
              <p className="text-[12px] leading-4 text-fg-3">{l}</p>
            </div>
          ))}
        </div>
        <p className="flex gap-2 text-[12.5px] leading-[18px] text-fg-3">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Names, emails and profile links stay on this computer. To judge fit I send Claude only company names and job titles, once per company, which usually costs a few cents.
            {preview.withEmail < preview.rows / 2 ? " Most connections hide their email, so warm paths start with a LinkedIn message or an intro." : ""}
          </span>
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="agent" onClick={() => void submit()} loading={busy}>
            Import and screen {fmt(preview.rows)} connections
          </Button>
          {net && <p className="text-[12px] text-fg-3">I&apos;ll compare it with your import from {shortDate(net.importedAt)} to find job changes.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {net && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bg-subtle px-3.5 py-2.5 ring-1 ring-border">
          <p className="text-[13px] text-fg-2">
            Last import {shortDate(net.importedAt)} · {fmt(net.total)} connections. Re-import monthly to catch people who changed jobs.
          </p>
          {net.topCompanies?.length ? (
            <Button size="xs" variant="ghost" onClick={() => setPhase("result")}>
              See last result
            </Button>
          ) : null}
        </div>
      )}
      <ol className="grid gap-2.5">
        {[
          <>
            On LinkedIn, open{" "}
            <a href={EXPORT_URL} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 font-medium text-fg underline decoration-border-strong underline-offset-[3px] hover:decoration-fg">
              Get a copy of your data <ArrowUpRight className="size-3 text-fg-3" aria-hidden />
            </a>
            , choose <span className="font-medium text-fg">Connections</span> only, and request the archive.
          </>,
          "LinkedIn emails you a download link, usually within 10 minutes.",
          "Unzip it and drop Connections.csv below.",
        ].map((s, i) => (
          <li key={i} className="flex gap-3 text-[13px] leading-[20px] text-fg-2">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-bg-subtle font-mono text-[11px] text-fg-3 ring-1 ring-border">{i + 1}</span>
            <span className="min-w-0 text-pretty">{s}</span>
          </li>
        ))}
      </ol>
      <DropZone
        title="Drop Connections.csv, or choose it"
        hint="People who already know you are the fastest way to a first conversation."
        icon={<Users className="size-4" aria-hidden />}
        onFile={pick}
        error={error ?? (typeof preview === "string" ? preview : null)}
      />
    </div>
  );
}
