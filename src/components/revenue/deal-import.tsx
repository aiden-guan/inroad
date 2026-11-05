"use client";

import { ArrowLeft, Check } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { DropZone } from "@/components/import/drop-zone";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Num } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { nowISO } from "@/lib/domain/ids";
import type { ISODate } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { parseCsv, type ParsedCsv } from "@/lib/network/csv";
import { looksLikeConnections } from "@/lib/network/presets";
import {
  autoMapDeals,
  DEAL_FIELDS,
  dealImportActions,
  defaultStageMap,
  guessStage,
  planDealImport,
  SKIP_LABELS,
  STAGE_CHOICES,
  stageKey,
  stageValues,
  type DealFieldKey,
  type DealMapping,
  type DealSkip,
  type StageChoice,
} from "@/lib/revenue/deal-import";
import { money } from "@/lib/revenue/forecast";

/** Generous for a deals export (closed history included); the drop zone already caps the file at 8 MB. */
const MAX_ROWS = 20_000;

export interface DealImportSummary {
  from: string;
  open: number;
  openUsd: number;
  won: number;
  wonUsd: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Stat({ value, label, usd, muted }: { value: number; label: string; usd?: number; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={cn("font-mono text-[20px] leading-7 tnum", muted ? "text-fg-3" : "text-fg")}>
        <Num value={value} />
        {usd !== undefined && usd > 0 && <span className="ml-1.5 text-[13px] text-fg-3">{money(usd)}</span>}
      </p>
      <p className="text-[12px] leading-4 text-fg-3">{label}</p>
    </div>
  );
}

/** What the file has no column for, said once, with what Inroad does instead. */
function absentLine(a: ReturnType<typeof planDealImport>["absent"]): string | null {
  const parts = [
    a.closeDate && "close dates (I'll estimate them from a typical cycle and mark them est.)",
    a.amount && "amounts (the typical deal stands in, marked est.)",
    a.contacts && "contacts",
    a.activity && "last-activity dates",
    a.created && "created dates",
  ].filter((x): x is string => !!x);
  if (!parts.length) return null;
  return `This file has no ${parts.join(", ")}. The X-ray says what it can't check instead of guessing.`;
}

/**
 * Open deals from a CRM export, previewed before anything is written: columns and stage names map themselves (and
 * can be changed), every row left out says why, and the import runs through the ordinary workspace actions. Wins
 * count only inside `period`, as its closed won. Zero tokens.
 */
export function DealImport({ period, onDone, className }: { period: { start: ISODate; end: ISODate; label: string }; onDone?: (s: DealImportSummary) => void; className?: string }) {
  const { ws, dispatch } = useWorkspace();
  const [file, setFile] = useState<{ name: string; parsed: ParsedCsv } | null>(null);
  const [mapping, setMapping] = useState<DealMapping | null>(null);
  const [stages, setStages] = useState<Record<string, StageChoice>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<DealImportSummary | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [skippedOpen, setSkippedOpen] = useState(false);

  const plan = useMemo(() => (ws && file && mapping ? planDealImport(ws, file.parsed, mapping, stages, period) : null), [ws, file, mapping, stages, period]);
  const values = useMemo(() => (file && mapping ? stageValues(file.parsed, mapping) : []), [file, mapping]);

  function load(name: string, text: string) {
    const parsed = parseCsv(text);
    if (looksLikeConnections(parsed.headers)) return setError("That's a LinkedIn connections file. Drop a deals export instead: one row per deal, with its stage.");
    if (!parsed.headers.length) return setError("I couldn't find a header row. Export with column names in the first row.");
    if (!parsed.rows.length) return setError(`${name} has column names but no rows.`);
    if (parsed.rows.length > MAX_ROWS) return setError(`${name} has ${plural(parsed.rows.length, "row")}. Filter the export to open deals and this quarter's wins, then drop it again.`);
    const m = autoMapDeals(parsed.headers);
    setError(null);
    setFile({ name, parsed });
    setMapping(m);
    setStages(defaultStageMap(stageValues(parsed, m)));
    // A file with no stage or no way to name the company opens the columns, since that's the fix.
    setColumnsOpen((m.stage === null && m.status === null) || (m.domain === null && m.contacts === null && m.contactEmail === null));
  }

  function remap(key: DealFieldKey, index: number | null) {
    if (!mapping || !file) return;
    const next = { ...mapping, [key]: index };
    setMapping(next);
    if (key === "stage" || key === "status") setStages((prev) => ({ ...defaultStageMap(stageValues(file.parsed, next)), ...prev }));
  }

  async function submit() {
    if (!ws || !plan || !file || !plan.deals.length) return;
    setBusy(true);
    const ok = await dispatch(dealImportActions(ws, plan, { at: nowISO(), from: file.name }));
    setBusy(false);
    if (!ok) return;
    const summary = { from: file.name, open: plan.open.count, openUsd: plan.open.usd, won: plan.won.count, wonUsd: plan.won.usd };
    setDone(summary);
    onDone?.(summary);
  }

  /* ── Done ── */
  if (done) {
    return (
      <div className={cn("flex items-start gap-3", className)} aria-live="polite">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: ease.out }}
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success"
        >
          <Check className="size-4" aria-hidden />
        </motion.span>
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-fg">
            {plural(done.open, "open deal")} in{done.openUsd ? `, ${money(done.openUsd)}` : ""}
          </p>
          <p className="mt-0.5 break-words text-[13px] leading-5 text-fg-2">
            From {done.from}.{done.won ? ` ${plural(done.won, "deal")} won in ${period.label} (${money(done.wonUsd)}) ${done.won === 1 ? "counts" : "count"} as closed won.` : ""} Deals already here were left as they were.
          </p>
        </div>
      </div>
    );
  }

  /* ── Drop ── */
  if (!file || !mapping || !plan) {
    return (
      <div className={className}>
        <DropZone
          title="Drop a CSV of your deals, or choose a file"
          hint="An export from HubSpot, Salesforce, Attio or Pipedrive works as it is: open deals come in, with this quarter's wins as closed won."
          onFile={load}
          error={error}
          compact
        />
      </div>
    );
  }

  /* ── Preview ── */
  const keyed = mapping.domain !== null || mapping.contacts !== null || mapping.contactEmail !== null || mapping.company !== null;
  const staged = mapping.stage !== null || mapping.status !== null;
  const reasons = Object.entries(
    plan.skipped.reduce<Partial<Record<DealSkip, number[]>>>((acc, s) => ({ ...acc, [s.reason]: [...(acc[s.reason] ?? []), s.line] }), {}),
  ) as [DealSkip, number[]][];
  const mapped = DEAL_FIELDS.filter((f) => mapping[f.key] !== null).map((f) => f.label);
  const absent = absentLine(plan.absent);

  return (
    <div className={cn("grid gap-5", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => {
            setFile(null);
            setMapping(null);
          }}
          className="inline-flex items-center gap-1 rounded-sm text-[13px] text-fg-3 transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Other file
        </button>
        <span className="min-w-0 truncate font-mono text-[12px] text-fg-2">{file.name}</span>
        <span className="text-[12px] text-fg-3">{plural(file.parsed.rows.length, "row")}</span>
      </div>

      {!staged ? (
        <p role="alert" className="text-[13px] text-danger">
          Choose the column with each deal&apos;s stage. The forecast is called from it.
        </p>
      ) : !keyed ? (
        <p role="alert" className="text-[13px] text-danger">
          Choose the column with the company website or a contact&apos;s work email. I match companies by domain.
        </p>
      ) : (
        <div className="rounded-lg bg-bg-subtle p-3.5 ring-1 ring-border">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Stat value={plan.open.count} usd={plan.open.usd} label="open deals" />
            <Stat value={plan.won.count} usd={plan.won.usd} label={`won in ${period.label}`} muted={!plan.won.count} />
            <Stat value={plan.skipped.length} label="left out" muted={!plan.skipped.length} />
          </div>
          {reasons.length > 0 && (
            <div className="mt-3">
              <button type="button" onClick={() => setSkippedOpen((o) => !o)} aria-expanded={skippedOpen} className="text-[12.5px] font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:decoration-fg">
                {skippedOpen ? "Hide why rows were left out" : "Why rows were left out"}
              </button>
              {skippedOpen && (
                <ul className="mt-2 grid gap-1">
                  {reasons.map(([reason, lines]) => (
                    <li key={reason} className="flex gap-2 text-[12.5px] leading-[18px]">
                      <span className="w-8 shrink-0 text-right font-mono tnum text-fg-2">{lines.length}</span>
                      <span className="min-w-0 text-fg-2">
                        {SKIP_LABELS[reason]}
                        <span className="ml-1.5 font-mono text-[11px] text-fg-3">
                          {lines.length === 1 ? "row" : "rows"} {lines.slice(0, 6).join(", ")}
                          {lines.length > 6 ? "…" : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {(absent || plan.otherCurrency > 0 || plan.open.unpriced > 0) && (
            <div className="mt-3 space-y-1 text-[12.5px] leading-[18px] text-fg-3">
              {absent && <p>{absent}</p>}
              {plan.otherCurrency > 0 && <p>{plural(plan.otherCurrency, "deal")} had amounts in another currency, so they came in without one: Inroad forecasts in USD and never converts.</p>}
              {!plan.absent.amount && plan.open.unpriced > 0 && <p>{plural(plan.open.unpriced, "open deal")} had no amount; the typical deal stands in, marked est.</p>}
            </div>
          )}
        </div>
      )}

      {values.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-[12.5px] font-medium text-fg-2">Your stages, read as Inroad&apos;s</legend>
          <p className="mb-2 text-[12px] leading-[18px] text-fg-3">Commit and best case are called from the stage and the evidence on each deal, so check any marked &ldquo;guess&rdquo;.</p>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {values.map((v) => {
              const k = stageKey(v.label);
              const guess = guessStage(v.label);
              return (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3">
                  <span className="min-w-0 truncate text-[13px] text-fg">
                    {v.label} <span className="font-mono text-[11.5px] text-fg-3">{v.count}</span>
                    {!guess.sure && stages[k] === guess.stage && <span className="ml-1.5 text-[11.5px] text-warning">guess</span>}
                  </span>
                  <Select aria-label={`Inroad stage for ${v.label}`} value={stages[k] ?? guess.stage} onChange={(e) => setStages((s) => ({ ...s, [k]: e.target.value as StageChoice }))} className="h-8 w-full text-[13px]">
                    {STAGE_CHOICES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="min-w-0 text-[12.5px] leading-[18px] text-fg-3">
            <span className="font-medium text-fg-2">Columns</span> · {mapped.length ? mapped.join(", ") : "none mapped yet"}
          </p>
          <button type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((o) => !o)} className="shrink-0 text-[12.5px] font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:decoration-fg">
            {columnsOpen ? "Hide columns" : "Edit columns"}
          </button>
        </div>
        {columnsOpen && (
          <div className="mt-3 grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
            {DEAL_FIELDS.map((f) => (
              <div key={f.key} className="min-w-0">
                <span className="mb-1 block text-[12px] text-fg-2">{f.label}</span>
                <Select aria-label={f.label} value={mapping[f.key] === null ? "" : String(mapping[f.key])} onChange={(e) => remap(f.key, e.target.value === "" ? null : Number(e.target.value))} className="h-8 w-full min-w-0 text-[13px]">
                  <option value="">Not in this file</option>
                  {file.parsed.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!staged || !keyed || !plan.deals.length}>
          {plan.deals.length ? `Import ${plural(plan.deals.length, "deal")}` : "Nothing to import"}
        </Button>
        <p className="text-[12px] text-fg-3">Code only, no AI. Deals already in Inroad are skipped.</p>
      </div>
    </div>
  );
}
