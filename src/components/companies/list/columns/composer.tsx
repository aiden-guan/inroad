"use client";

import * as RP from "@radix-ui/react-popover";
import { Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useRuns } from "@/components/providers/runs-provider";
import { Button, Spinner } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { newId, nowISO } from "@/lib/domain/ids";
import { LIMITS, type ColumnType, type ColumnsResponse, type ResearchColumn } from "@/lib/columns/types";
import { costLabel, durationLabel, estimateRest, shortQuestion, suggestType } from "@/lib/columns/values";
import { ResearchCell } from "./cell";

/**
 * "+ Column": ask every company one question. Write it, pick the answer type (proposed from how it's worded),
 * try it on the first 5 rows, see what that actually cost and what the rest would, then run it on the rest.
 */

type Measurable = { getBoundingClientRect: () => DOMRect };
export interface ComposerRow {
  domain: string;
  name: string;
}

const PREVIEW_ROWS = 5;

const STARTERS: { question: string; type: ColumnType; options?: string[] }[] = [
  { question: "Do they bill on usage?", type: "yes_no" },
  { question: "Which billing system do they use?", type: "pick_one", options: ["Stripe", "Chargebee", "Recurly", "Orb", "Metronome", "In-house"] },
  { question: "Are they hiring in finance?", type: "yes_no" },
  { question: "Do they have a public security or trust page?", type: "yes_no" },
];

const TYPES: { value: ColumnType; label: string }[] = [
  { value: "yes_no", label: "Yes / no" },
  { value: "pick_one", label: "Pick one" },
  { value: "number", label: "Number" },
  { value: "text", label: "Text" },
];

interface Preview {
  columnId: string;
  runId: string | null;
  domains: string[];
  error?: string;
}

export function ColumnComposer({
  open,
  onOpenChange,
  trigger,
  anchor,
  rows,
  scope,
  data,
  editing,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  anchor?: RefObject<Measurable>;
  rows: ComposerRow[];
  /** "visible" (the table as filtered) or "selected" (the bulk bar's selection). */
  scope: "visible" | "selected";
  data: ColumnsResponse | null;
  editing?: ResearchColumn | null;
  onCreate: (column: ResearchColumn) => Promise<boolean>;
  onUpdate: (column: ResearchColumn, patch: Pick<ResearchColumn, "question" | "type" | "options" | "instructions">) => Promise<boolean>;
}) {
  return (
    <RP.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <RP.Trigger asChild>{trigger}</RP.Trigger> : anchor ? <RP.Anchor virtualRef={anchor} /> : null}
      <RP.Portal>
        <RP.Content
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          className="z-[70] max-h-[var(--radix-popover-content-available-height)] w-[min(420px,calc(100vw-24px))] origin-[var(--radix-popover-content-transform-origin)] overflow-y-auto overscroll-contain rounded-xl bg-surface-raised p-4 shadow-lg ring-1 ring-inset ring-border outline-none data-[state=closed]:animate-[pop-out_100ms_var(--ease-out)] data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
        >
          {open && <Body rows={rows} scope={scope} data={data} editing={editing ?? null} onCreate={onCreate} onUpdate={onUpdate} onClose={() => onOpenChange(false)} />}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}

function Body({
  rows,
  scope,
  data,
  editing,
  onCreate,
  onUpdate,
  onClose,
}: {
  rows: ComposerRow[];
  scope: "visible" | "selected";
  data: ColumnsResponse | null;
  editing: ResearchColumn | null;
  onCreate: (column: ResearchColumn) => Promise<boolean>;
  onUpdate: (column: ResearchColumn, patch: Pick<ResearchColumn, "question" | "type" | "options" | "instructions">) => Promise<boolean>;
  onClose: () => void;
}) {
  const { start, runs } = useRuns();
  const [question, setQuestion] = useState(editing?.question ?? "");
  const [picked, setPicked] = useState<ColumnType | null>(editing?.type ?? null);
  const [options, setOptions] = useState<string[]>(editing?.options?.length ? editing.options : ["", ""]);
  const [instructions, setInstructions] = useState(editing?.instructions ?? "");
  const [showHow, setShowHow] = useState(!!editing?.instructions);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [current, setCurrent] = useState<ResearchColumn | null>(editing);
  const optionRefs = useRef<(HTMLInputElement | null)[]>([]);

  const type = picked ?? suggestType(question);
  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  const validate = (): string | null => {
    const q = question.trim();
    if (q.length < 3) return "Write the question you want answered for every company.";
    if (type === "pick_one") {
      if (cleanOptions.length < 2) return "Give at least two options to pick from.";
      if (new Set(cleanOptions.map((o) => o.toLowerCase())).size !== cleanOptions.length) return "Each option needs to be different.";
    }
    if (!rows.length) return scope === "selected" ? "Select a few companies first." : "No companies in this view. Clear a filter first.";
    return null;
  };

  const startPreview = async (column: ResearchColumn) => {
    const domains = rows.slice(0, PREVIEW_ROWS).map((r) => r.domain);
    setPreview({ columnId: column.id, runId: null, domains });
    const run = await start("research_column", { columnId: column.id, domains, preview: true }, { notify: false, onError: (e) => setPreview((p) => (p ? { ...p, error: e.message } : p)) });
    if (run) setPreview((p) => (p && p.columnId === column.id ? { ...p, runId: run.id } : p));
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const bad = validate();
    if (bad) return setProblem(bad);
    setProblem(null);
    setBusy(true);
    const fields = {
      question: question.trim().replace(/\s+/g, " "),
      type,
      ...(type === "pick_one" ? { options: cleanOptions } : {}),
      ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    };
    try {
      if (current) {
        const changed =
          current.question !== fields.question || current.type !== fields.type || (current.options ?? []).join("|") !== (fields.options ?? []).join("|") || (current.instructions ?? "") !== (fields.instructions ?? "");
        if (!changed) {
          void startPreview(current);
          return;
        }
        // "" (not undefined) clears instructions on the server too: JSON drops undefined keys.
        const ok = await onUpdate(current, { question: fields.question, type: fields.type, options: fields.options, instructions: fields.instructions ?? "" });
        if (!ok) return;
        const next: ResearchColumn = { id: current.id, createdAt: current.createdAt, ...fields };
        setCurrent(next);
        void startPreview(next);
      } else {
        const column: ResearchColumn = { id: newId("col"), createdAt: nowISO(), ...fields };
        const ok = await onCreate(column);
        if (!ok) return;
        setCurrent(column);
        void startPreview(column);
      }
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  if (preview && current) {
    return <PreviewStep column={current} preview={preview} rows={rows} scope={scope} data={data} runs={runs} start={start} onEdit={() => setPreview(null)} onClose={onClose} />;
  }

  const search = data?.search;
  const left = search ? Math.max(0, search.limit - search.used) : 0;
  return (
    <form onSubmit={submit} onKeyDown={onKeyDown}>
      <p className="font-serif text-[19px] leading-[24px] tracking-[-0.01em] text-fg">{current ? "Edit the question" : "Ask every company"}</p>
      <p className="mt-1 text-[12.5px] leading-[18px] text-fg-2">
        {current ? "Changing it clears its answers, then tries the new one on the first 5." : `One question, answered for each ${scope === "selected" ? "selected" : "visible"} company with sources. Unknown when nothing says.`}
      </p>

      <Label htmlFor="col-question" className="mt-4">
        Question
      </Label>
      <Input
        id="col-question"
        value={question}
        maxLength={LIMITS.question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Do they bill on usage?"
        autoComplete="off"
      />
      {!question && !current && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STARTERS.map((s) => (
            <button
              key={s.question}
              type="button"
              onClick={() => {
                setQuestion(s.question);
                setPicked(s.type);
                if (s.options) setOptions(s.options);
              }}
              className="rounded-full px-2.5 py-1 text-[12px] text-fg-2 ring-1 ring-inset ring-border transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              {s.question}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-fg-2">Answer</span>
        <Segmented value={type} onChange={(v) => setPicked(v)} layoutId="column-type" className="h-7 [&_button]:h-6 [&_button]:px-2 [&_button]:text-[12px]" options={TYPES} />
      </div>
      {!picked && question.trim().length > 2 && <p className="mt-1 text-right text-[11.5px] text-fg-3">Proposed from how it&rsquo;s worded. Change it if it&rsquo;s wrong.</p>}

      {type === "pick_one" && (
        <div className="mt-3 space-y-1.5">
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                value={o}
                maxLength={LIMITS.option}
                aria-label={`Option ${i + 1}`}
                placeholder={i === 0 ? "Stripe" : i === 1 ? "Chargebee" : "Another option"}
                onChange={(e) => setOptions((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && o.trim() && i === options.length - 1 && options.length < LIMITS.options) {
                    e.preventDefault();
                    setOptions((all) => [...all, ""]);
                    setTimeout(() => optionRefs.current[i + 1]?.focus(), 0);
                  }
                }}
                className="h-8"
              />
              <button
                type="button"
                aria-label={`Remove option ${i + 1}`}
                disabled={options.length <= 2}
                onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg disabled:opacity-30"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {options.length < LIMITS.options && (
            <button type="button" onClick={() => setOptions((all) => [...all, ""])} className="inline-flex h-7 items-center gap-1 rounded-sm px-1 text-[12.5px] text-fg-2 hover:text-fg">
              <Plus className="size-3.5" /> Add option
            </button>
          )}
          <p className="text-[11.5px] leading-[16px] text-fg-3">If none fits what the sources show, the answer is Unknown.</p>
        </div>
      )}

      {showHow ? (
        <div className="mt-3">
          <Label htmlFor="col-how" hint="Optional">
            How to decide
          </Label>
          <Textarea
            id="col-how"
            value={instructions}
            maxLength={LIMITS.instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Yes only if their pricing page shows a metered unit."
            className="min-h-16"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setShowHow(true)} className="mt-3 inline-flex h-7 items-center gap-1 rounded-sm px-1 text-[12.5px] text-fg-2 hover:text-fg">
          <Plus className="size-3.5" /> How to decide
        </button>
      )}

      <div className="mt-3.5 rounded-md bg-bg-subtle px-3 py-2.5 text-[12px] leading-[17px] text-fg-2">
        <p>
          <span className="font-medium text-fg">Where I look:</span> what I already know and their own site (free), then{" "}
          {search?.provider ? (
            <>
              one {search.provider} search if needed ({left} of {search.limit} left today).
            </>
          ) : (
            <>
              nothing else: web search isn&rsquo;t set up.{" "}
              <Link href="/settings#web-search" className="text-accent-text underline-offset-2 hover:underline">
                Set it up
              </Link>
            </>
          )}
        </p>
        <p className="mt-1 text-fg-3">The try runs on your cheapest model. You&rsquo;ll see what it cost before anything else runs.</p>
      </div>

      {problem && <p className="mt-2.5 text-[12px] text-danger">{problem}</p>}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="agent" size="sm" loading={busy} icon={<Sparkles className="size-3.5" />} kbd="⌘↵">
          Try on {Math.min(PREVIEW_ROWS, rows.length) || PREVIEW_ROWS}
        </Button>
      </div>
    </form>
  );
}

function PreviewStep({
  column,
  preview,
  rows,
  scope,
  data,
  runs,
  start,
  onEdit,
  onClose,
}: {
  column: ResearchColumn;
  preview: Preview;
  rows: ComposerRow[];
  scope: "visible" | "selected";
  data: ColumnsResponse | null;
  runs: ReturnType<typeof useRuns>["runs"];
  start: ReturnType<typeof useRuns>["start"];
  onEdit: () => void;
  onClose: () => void;
}) {
  const [running, setRunning] = useState(false);
  const cells = data?.cells[column.id] ?? {};
  const job = data?.jobs.find((j) => j.runId === preview.runId);
  const run = preview.runId ? runs[preview.runId] : undefined;
  // The try runs quietly (no toast), so a failure is said here.
  const failure = preview.error ?? (run?.status === "error" ? (run.error?.message ?? "The try didn't finish.") : undefined);
  const finished = !!failure || (run ? run.status !== "running" && run.status !== "queued" : false) || preview.domains.every((d) => cells[d] && !job?.active.includes(d));
  const names = new Map(rows.map((r) => [r.domain, r.name]));
  const previewCells = preview.domains.map((d) => cells[d]).filter((c) => !!c);
  const answered = previewCells.filter((c) => c.value !== null && !c.error).length;
  const unknown = previewCells.filter((c) => c.value === null && !c.error).length;
  const failedRows = previewCells.filter((c) => c.error).length;

  const queuedElsewhere = new Set((data?.jobs ?? []).filter((j) => j.columnId === column.id && j.runId !== preview.runId).flatMap((j) => j.domains));
  const rest = rows.filter((r) => (!cells[r.domain] || cells[r.domain].error) && !preview.domains.includes(r.domain) && !queuedElsewhere.has(r.domain));
  const capped = rest.slice(0, LIMITS.domains);
  const ms = run?.endedAt ? run.endedAt - run.startedAt : undefined;
  const est = estimateRest(previewCells, capped.length, ms);
  const search = data?.search;
  const left = search ? Math.max(0, search.limit - search.used) : 0;
  const free = est.rows - est.modelRows;

  const runRest = async () => {
    setRunning(true);
    const ok = await start("research_column", { columnId: column.id, domains: capped.map((r) => r.domain) });
    setRunning(false);
    if (ok) onClose();
  };

  return (
    <div>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-serif text-[17px] leading-[23px] tracking-[-0.01em] text-fg">
          {finished ? "Here's what I found" : "Trying it on"} {preview.domains.length === 1 ? "1 company" : `${preview.domains.length} companies`}
        </p>
        {!finished && <Spinner className="mt-1.5 size-3.5 text-fg-3" />}
      </div>
      <p className="mt-0.5 truncate text-[12px] text-fg-3" title={column.question}>
        {shortQuestion(column.question, 70)}
      </p>

      <ul className="mt-3 divide-y divide-border rounded-md ring-1 ring-border">
        {preview.domains.map((d) => (
          <li key={d} className="flex h-10 items-center gap-2.5 px-2.5">
            <Favicon domain={d} name={names.get(d)} size={16} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{names.get(d) ?? d}</span>
            <span className="flex w-[132px] min-w-0 shrink-0 justify-end">
              <ResearchCell
                column={column}
                cell={cells[d]}
                company={names.get(d) ?? d}
                run={!cells[d] || job?.active.includes(d) ? (job?.active.includes(d) ? "running" : finished ? null : "queued") : null}
                onAsk={(force) => void start("research_column", { columnId: column.id, domains: [d], force }, { notify: false })}
                className="justify-end"
              />
            </span>
          </li>
        ))}
      </ul>

      {failure && !previewCells.length ? (
        <p className="mt-3 text-[12.5px] leading-[18px] text-danger">{failure}</p>
      ) : finished ? (
        <div className="mt-3 space-y-1.5 rounded-md bg-bg-subtle px-3 py-2.5 text-[12.5px] leading-[18px] text-fg-2">
          <p>
            {answered} answered{unknown ? `, ${unknown} unknown` : ""}
            {failedRows ? `, ${failedRows} didn't finish` : ""}. These cost <span className="font-medium text-fg">{costLabel(est.previewUsd)}</span> on your key
            {free > 0 ? `, ${free} with no AI at all` : ""}.
          </p>
          {capped.length > 0 ? (
            <p>
              The other {capped.length}
              {rest.length > capped.length ? ` (the first ${capped.length} of ${rest.length})` : ""}: about <span className="font-medium text-fg">{costLabel(est.restUsd)}</span>
              {est.restSearches ? ` and up to ${est.restSearches} ${est.restSearches === 1 ? "search" : "searches"}` : ""}
              {est.restMs ? `, ${durationLabel(est.restMs)}` : ""}. Based on what these {est.rows} actually cost.
            </p>
          ) : (
            <p>Every {scope === "selected" ? "selected" : "visible"} company has an answer or is being asked.</p>
          )}
          {est.unpriced && <p className="text-warning">Your model has no price on file, so these figures count nothing. Add its price in Settings → AI.</p>}
          {!est.unpriced && est.previewUsd === 0 && est.modelRows > 0 && <p>Your model didn&rsquo;t charge for these.</p>}
          {search?.provider && est.restSearches > left && (
            <p className="text-warning">That&rsquo;s more searches than today&rsquo;s limit has left ({left}). After that, answers come from their site and what I know.</p>
          )}
          {failure && <p className="text-danger">{failure}</p>}
        </div>
      ) : (
        <p className="mt-3 text-[12.5px] leading-[18px] text-fg-3">Answers land here as each company finishes. Hover one to see its source.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit question
        </Button>
        {finished && capped.length > 0 ? (
          <Button variant="agent" size="sm" loading={running} icon={<Sparkles className="size-3.5" />} onClick={() => void runRest()}>
            Run on {capped.length} {capped.length === 1 ? "company" : "companies"}
          </Button>
        ) : (
          <Button variant={finished ? "primary" : "secondary"} size="sm" onClick={onClose} className={cn(!finished && "text-fg-2")}>
            {finished ? "Done" : "Close, keep going"}
          </Button>
        )}
      </div>
    </div>
  );
}
