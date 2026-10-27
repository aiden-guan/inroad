"use client";

import { motion } from "motion/react";
import { ArrowLeft, Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Num } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { CSV_LIMITS, parseCsv, type ParsedCsv } from "@/lib/network/csv";
import { planImport, readListRows, skipSummary } from "@/lib/network/plan";
import { autoMap, detectPreset, FIELDS, looksLikeConnections, presetById, PRESETS, type FieldKey, type Mapping, type PresetId } from "@/lib/network/presets";
import type { ImportResponse, UndoResponse } from "@/lib/network/types";
import { ease } from "@/lib/motion";
import { postJson } from "./api";
import { DropZone } from "./drop-zone";
import { ExportPanel } from "./export-panel";

/**
 * A list of companies and people from any tool: drop → columns map themselves (presets for Apollo,
 * Clay, Sales Navigator, HubSpot, Instantly, Smartlead, Muse, Stripe, signups) → a dedupe report
 * computed live against the workspace → import → undo. Zero tokens.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function ColumnSelect({ value, headers, onChange, label }: { value: number | null; headers: string[]; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="relative min-w-0">
      <select
        aria-label={label}
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={cn(
          "h-8 w-full min-w-0 appearance-none truncate rounded-sm bg-surface pl-2.5 pr-8 text-[13px] ring-1 ring-border-strong/70",
          "transition-[box-shadow] duration-150 hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          value === null ? "text-fg-3" : "text-fg",
        )}
      >
        <option value="">Don&apos;t import</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
    </div>
  );
}

function sampleOf(parsed: ParsedCsv, i: number | null): string {
  if (i === null) return "";
  return parsed.rows.slice(0, 30).find((r) => r[i]?.trim())?.[i]?.trim() ?? "";
}

function Stat({ value, label, muted }: { value: number; label: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={cn("font-mono text-[20px] leading-7 tnum", muted ? "text-fg-3" : "text-fg")}>
        <Num value={value} />
      </p>
      <p className="text-[12px] leading-4 text-fg-3">{label}</p>
    </div>
  );
}

interface FileIn {
  name: string;
  text: string;
}

interface Loaded {
  file: FileIn;
  parsed: ParsedCsv;
  presetId: PresetId;
  mapping: Mapping;
}

/** Reads a dropped file: a LinkedIn export goes to the network import; anything else gets a preset and a mapping. */
function analyze(name: string, text: string): { loaded?: Loaded; error?: string; linkedin?: boolean } {
  const p = parseCsv(text);
  if (looksLikeConnections(p.headers)) return { linkedin: true };
  if (!p.headers.length) return { error: "I couldn't find a header row. Export with column names in the first row." };
  if (!p.rows.length) return { error: `${name} has column names but no rows.` };
  if (p.rows.length > CSV_LIMITS.listRows) {
    return { error: `${name} has ${plural(p.rows.length, "row")}. Imports stop at ${CSV_LIMITS.listRows.toLocaleString("en-US")} so every company gets real attention. Filter it to your ICP first.` };
  }
  const preset = detectPreset(p.headers);
  return { loaded: { file: { name, text }, parsed: p, presetId: preset.id, mapping: autoMap(p.headers, preset, p.rows.slice(0, 20)) } };
}

export function ListImport({ initial, onLinkedIn, onDone }: { initial?: FileIn | null; onLinkedIn: (file: FileIn) => void; onDone?: () => void }) {
  const { ws, refresh } = useWorkspace();
  const [first] = useState(() => (initial ? analyze(initial.name, initial.text) : {}));
  const [sel, setSel] = useState<Loaded | null>(first.loaded ?? null);
  const [error, setError] = useState<string | null>(first.error ?? null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResponse["batch"] | null>(null);
  const [undone, setUndone] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  function load(name: string, text: string) {
    const r = analyze(name, text);
    if (r.linkedin) return onLinkedIn({ name, text });
    setError(r.error ?? null);
    if (r.loaded) setSel(r.loaded);
  }

  const file = sel?.file ?? null;
  const parsed = sel?.parsed ?? null;
  const mapping = sel?.mapping ?? null;
  const presetId = sel?.presetId ?? "generic";
  const setMapping = (m: Mapping) => sel && setSel({ ...sel, mapping: m });
  const plan = useMemo(() => (ws && parsed && mapping ? planImport(ws, readListRows(parsed.rows, mapping, parsed.headers)) : null), [ws, parsed, mapping]);
  const preset = presetById(presetId);
  const detected = parsed ? detectPreset(parsed.headers).id : "generic";
  const keyed = mapping && (mapping.domain !== null || mapping.email !== null);

  async function submit() {
    if (!file || !mapping || !plan) return;
    setBusy(true);
    try {
      const r = await postJson<ImportResponse>("/api/import", { fileName: file.name, text: file.text, preset: presetId, mapping });
      setResult(r.batch);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The import didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!result) return;
    setBusy(true);
    try {
      const r = await postJson<UndoResponse>("/api/import/undo", { batchId: result.id });
      setUndone(r.message);
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't undo that import.");
    } finally {
      setBusy(false);
    }
  }

  /* ── Done ── */
  if (result) {
    const c = result.counts;
    const made = [c.accountsCreated && plural(c.accountsCreated, "company", "companies"), c.peopleCreated && plural(c.peopleCreated, "person", "people")].filter(Boolean).join(" and ");
    return (
      <div className="grid gap-4 py-2">
        <div className="flex items-start gap-3">
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: ease.out }}
            className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", undone ? "bg-bg-subtle text-fg-3" : "bg-success-subtle text-success")}
          >
            <Check className="size-4" aria-hidden />
          </motion.span>
          <div className="min-w-0" aria-live="polite">
            <p className="text-[15px] font-medium text-fg">{undone ? "Import undone" : made ? `Imported ${made}` : "Nothing new to add"}</p>
            <p className="mt-1 text-[13px] leading-[19px] text-fg-2 text-pretty">
              {undone ??
                [
                  `From ${result.presetLabel === "Spreadsheet" ? result.fileName : `your ${result.presetLabel}`}.`,
                  c.accountsUpdated ? `${plural(c.accountsUpdated, "company", "companies")} you already had only got empty fields filled.` : null,
                  c.peopleUpdated ? `${plural(c.peopleUpdated, "known person", "known people")} got missing details.` : null,
                  result.skipped ? `${plural(result.skipped, "row")} skipped.` : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!undone && (
            <Link
              href={result.preset === "stripe" ? "/companies?view=customers" : "/companies?view=prospects"}
              onClick={onDone}
              className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.97]"
            >
              See them in Companies
            </Link>
          )}
          {!undone && (
            <Button variant="ghost" onClick={() => void undo()} loading={busy}>
              Undo import
            </Button>
          )}
          <Button variant={undone ? "primary" : "secondary"} onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  /* ── Drop ── */
  if (!parsed || !mapping || !file) {
    return (
      <div className="grid gap-5">
        <DropZone
          title="Drop a CSV, or choose a file"
          hint="From Apollo, Clay, Sales Navigator, HubSpot, Instantly, Smartlead, a Muse spreadsheet, Stripe customers or a signup list. Columns map themselves."
          onFile={load}
          error={error}
        />
        <ExportPanel />
      </div>
    );
  }

  /* ── Map and preview ── */
  const skips = plan ? skipSummary(plan.skipped) : [];
  const groups: { title: string; keys: FieldKey[] }[] = [
    { title: "Company", keys: FIELDS.filter((f) => f.group === "company").map((f) => f.key) },
    { title: "Person", keys: FIELDS.filter((f) => f.group === "person").map((f) => f.key) },
  ];
  const newCompanies = plan?.newAccounts.length ?? 0;
  const mappedLabels = FIELDS.filter((f) => mapping[f.key] !== null).map((f) => f.label.replace(/^Website or domain$/, "Website"));
  const cta =
    newCompanies || plan?.newPeople
      ? `Import ${[newCompanies && plural(newCompanies, "company", "companies"), plan?.newPeople && plural(plan.newPeople, "person", "people")].filter(Boolean).join(" and ")}`
      : plan?.existingAccounts.length
        ? `Update ${plural(plan.existingAccounts.length, "company", "companies")}`
        : "Nothing to import";

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={() => setSel(null)}
          className="inline-flex items-center gap-1 rounded-sm text-[13px] text-fg-3 transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Other file
        </button>
        <span className="min-w-0 truncate font-mono text-[12px] text-fg-2">{file.name}</span>
        <span className="text-[12px] text-fg-3">{plural(parsed.rows.length, "row")}</span>
        <span className="flex-1" />
        {detected !== "generic" && detected === presetId && <Badge tone="neutral">{preset.detected}</Badge>}
      </div>

      <div className="grid gap-1.5 sm:grid-cols-[1fr_200px] sm:items-center">
        <p className="text-[13px] text-fg-2">
          {preset.kind === "customers"
            ? "These are paying customers. They're marked as customers and never prospected."
            : preset.kind === "signups"
              ? "These people already used your product: your warmest leads."
              : "Prospects to research and work."}
        </p>
        <div className="relative">
          <select
            aria-label="What kind of list is this"
            value={presetId}
            onChange={(e) => {
              const p = presetById(e.target.value);
              setSel({ ...sel!, presetId: p.id, mapping: autoMap(parsed.headers, p, parsed.rows.slice(0, 20)) });
            }}
            className="h-8 w-full appearance-none rounded-sm bg-surface pl-2.5 pr-8 text-[13px] text-fg ring-1 ring-border-strong/70 hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
        </div>
      </div>

      {!keyed ? (
        <p role="alert" className="text-[13px] text-danger">
          Choose the column with the company website or a work email. I match companies by domain.
        </p>
      ) : plan ? (
        <div className="rounded-lg bg-bg-subtle p-3.5 ring-1 ring-border">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Stat value={plan.newAccounts.length} label="new companies" />
            <Stat value={plan.existingAccounts.length} label="already in Inroad" muted={!plan.existingAccounts.length} />
            <Stat value={plan.newPeople} label="new people" />
            <Stat value={plan.existingPeople} label="people you have" muted={!plan.existingPeople} />
          </div>
          <p className="mt-3 text-[12.5px] leading-[18px] text-fg-3">
            Matched by domain, email and LinkedIn URL. Existing records only get empty fields filled.
            {skips.length > 0 && (
              <>
                {" "}
                <button type="button" onClick={() => setShowSkipped((s) => !s)} aria-expanded={showSkipped} className="font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:decoration-fg">
                  {plural(plan.skipped.length, "row")} skipped
                </button>
              </>
            )}
          </p>
          {showSkipped && (
            <ul className="mt-2 grid gap-1 animate-[rise-in_180ms_var(--ease-out)]">
              {skips.map((s) => (
                <li key={s.reason} className="flex gap-2 text-[12.5px] leading-[18px]">
                  <span className="w-8 shrink-0 text-right font-mono tnum text-fg-2">{s.count}</span>
                  <span className="min-w-0 text-fg-2">
                    {s.label}
                    <span className="ml-1.5 font-mono text-[11px] text-fg-3">
                      {s.lines.length === 1 ? "row" : "rows"} {s.lines.slice(0, 6).join(", ")}
                      {s.lines.length > 6 ? "…" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!keyed || !plan || (!plan.rows.length && !plan.existingAccounts.length)}>
          {cta}
        </Button>
        <p className="text-[12px] text-fg-3">Code only, no AI. You can undo it.</p>
      </div>
      <div className="border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="min-w-0 text-[12.5px] leading-[18px] text-fg-3">
            <span className="font-medium text-fg-2">Columns</span> · {mappedLabels.length ? mappedLabels.join(", ") : "none mapped yet"}
          </p>
          <button
            type="button"
            aria-expanded={columnsOpen}
            onClick={() => setColumnsOpen((o) => !o)}
            className="shrink-0 text-[12.5px] font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:decoration-fg"
          >
            {columnsOpen ? "Hide columns" : "Edit columns"}
          </button>
        </div>
        {(columnsOpen || !keyed) && (
          <div className="mt-3 grid gap-4 animate-[rise-in_180ms_var(--ease-out)] sm:grid-cols-2 sm:gap-6">
        {groups.map((g) => (
          <div key={g.title} className="min-w-0">
            <p className="mb-2 text-[12px] font-medium text-fg-3">{g.title}</p>
            <div className="grid gap-2">
              {g.keys.map((k) => {
                const f = FIELDS.find((x) => x.key === k)!;
                const sample = sampleOf(parsed, mapping[k]);
                return (
                  <div key={k} className="min-w-0">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="shrink-0 text-[12.5px] text-fg-2">{f.label}</span>
                      {sample && <span className="min-w-0 truncate font-mono text-[11px] text-fg-3">{sample}</span>}
                    </div>
                    <ColumnSelect value={mapping[k]} headers={parsed.headers} label={f.label} onChange={(v) => setMapping({ ...mapping, [k]: v })} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

        )}
      </div>
    </div>
  );
}
