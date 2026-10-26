"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import { PMF_SURVEY } from "@/lib/consumer/benchmarks";
import { lastWeekOf, type Verdict } from "@/lib/consumer/growth";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { GrowthWeek, Workspace } from "@/lib/domain/types";

type NumField = "signups" | "activated" | "active" | "retainedPct" | "paying" | "newPaying" | "churnedPaying" | "revenueUsd" | "spendUsd" | "referred";

const FIELDS: { key: NumField; label: string; hint?: string; dtcLabel?: string }[] = [
  { key: "signups", label: "Signups", dtcLabel: "First-time buyers" },
  { key: "activated", label: "Reached the first win", hint: "Of those signups" },
  { key: "active", label: "Active this week", dtcLabel: "Buyers this week" },
  { key: "retainedPct", label: "Week-4 retention, %", hint: "Signed up 4 weeks ago, active this week", dtcLabel: "Repeat within 90 days, %" },
  { key: "paying", label: "Paying at week end" },
  { key: "newPaying", label: "New paying" },
  { key: "churnedPaying", label: "Stopped paying" },
  { key: "revenueUsd", label: "Revenue, $" },
  { key: "spendUsd", label: "Paid ad spend, $" },
  { key: "referred", label: "Came from a friend", hint: "Invite, referral link or “a friend told me”" },
];

function shortWeek(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Last week's numbers, two minutes. Only signups is required; every blank stays unknown, never zero. */
export function GrowthLogForm({ ws, today, onSaved, compact }: { ws: Workspace; today: string; onSaved?: () => void; compact?: boolean }) {
  const { dispatch } = useWorkspace();
  const weekOf = lastWeekOf(today);
  const existing = ws.growthLog?.find((w) => w.weekOf === weekOf);
  const dtc = ws.company?.consumerModel === "dtc";
  const [values, setValues] = useState<Record<NumField, string>>(() => {
    const out = {} as Record<NumField, string>;
    for (const f of FIELDS) out[f.key] = existing?.[f.key] !== undefined ? String(existing[f.key]) : "";
    return out;
  });
  const [topChannel, setTopChannel] = useState(existing?.topChannel ?? "");
  const [error, setError] = useState<string | null>(null);
  const shown = compact ? FIELDS.filter((f) => ["signups", "activated", "active", "retainedPct", "spendUsd", "referred"].includes(f.key)) : FIELDS;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const num = (k: NumField): number | undefined => {
      const v = values[k].trim().replace(/[$,%\s]/g, "");
      if (!v) return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : NaN;
    };
    const signups = num("signups");
    if (signups === undefined || Number.isNaN(signups)) {
      setError("Signups is the one number I need. A rough count is fine.");
      return;
    }
    const week: GrowthWeek = { weekOf, signups, source: "founder", loggedAt: nowISO() };
    for (const f of FIELDS) {
      if (f.key === "signups") continue;
      const n = num(f.key);
      if (Number.isNaN(n)) {
        setError(`“${f.label}” isn't a number.`);
        return;
      }
      if (n !== undefined) week[f.key] = f.key === "retainedPct" ? Math.min(100, n) : n;
    }
    if (week.activated !== undefined && week.activated > signups) {
      setError("More users reached the first win than signed up. Check the two numbers.");
      return;
    }
    if (topChannel.trim()) week.topChannel = topChannel.trim().slice(0, 60);
    setError(null);
    if (await dispatch({ type: "growth.log", week })) {
      toast(`Saved the week of ${shortWeek(weekOf)}.`);
      onSaved?.();
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-[12.5px] text-fg-3">
        Week of {shortWeek(weekOf)}. Leave anything you don&apos;t know blank: blank means unknown, not zero.
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
        {shown.map((f) => (
          <div key={f.key} className="min-w-0">
            <Label htmlFor={`gl-${f.key}`} className="mb-1 text-[11.5px]">
              {(dtc && f.dtcLabel) || f.label}
            </Label>
            <Input
              id={`gl-${f.key}`}
              inputMode="decimal"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              title={f.hint}
              className="font-mono text-[16px] sm:text-[13px]"
            />
          </div>
        ))}
        <div className="col-span-2 min-w-0 sm:col-span-3">
          <Label htmlFor="gl-channel" className="mb-1 text-[11.5px]">
            Where most came from
          </Label>
          <Input id="gl-channel" value={topChannel} onChange={(e) => setTopChannel(e.target.value)} placeholder="TikTok, r/running, a newsletter" maxLength={60} className="text-[16px] sm:text-[13px]" />
        </div>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <Button type="submit" variant="primary" size="sm" kbd="↵">
        {existing ? "Update the week" : "Save the week"}
      </Button>
    </form>
  );
}

/** What the numbers say. Color encodes risk only: block = danger, warn = warning. */
export function VerdictList({ verdicts, className }: { verdicts: Verdict[]; className?: string }) {
  if (!verdicts.length) return null;
  return (
    <ul className={cn("space-y-2.5", className)}>
      {verdicts.map((v) => (
        <li key={v.id} className="flex gap-2.5">
          <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", v.severity === "block" ? "bg-danger" : v.severity === "warn" ? "bg-warning" : "bg-fg-4")} />
          <div className="min-w-0">
            <p className={cn("text-pretty text-[13.5px] font-medium leading-5", v.severity === "block" ? "text-danger" : "text-fg")}>{v.title}</p>
            <p className="text-pretty text-[13px] leading-5 text-fg-2">{v.detail}</p>
            {v.source && <p className="mt-0.5 text-pretty text-[11.5px] leading-4 text-fg-3">{v.source}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Sean Ellis's question, logged as counts. Read only with 40+ answers. */
export function PmfSurveyForm({ onSaved }: { onSaved?: () => void }) {
  const { dispatch } = useWorkspace();
  const [answers, setAnswers] = useState("");
  const [very, setVery] = useState("");
  const [segment, setSegment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const a = Number(answers);
    const v = Number(very);
    if (!Number.isInteger(a) || a <= 0 || !Number.isInteger(v) || v < 0 || v > a) {
      setError("Answers and “very disappointed” must be whole numbers, with very disappointed no more than answers.");
      return;
    }
    setError(null);
    const ok = await dispatch({ type: "pmf.log", survey: { id: newId("pmf"), on: todayISO(), answers: a, veryDisappointed: v, segment: segment.trim() || undefined } });
    if (ok) {
      toast(a < PMF_SURVEY.minAnswers.value ? `Saved. With ${a} answers it's a hint, not a score; ${PMF_SURVEY.minAnswers.value}+ reads.` : "Saved.");
      onSaved?.();
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2.5">
      <p className="text-[12.5px] leading-[18px] text-fg-3">
        Ask people who used it at least twice in the last two weeks: &ldquo;How would you feel if you could no longer use it?&rdquo; Very, somewhat or not disappointed.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="pmf-a" className="mb-1 text-[11.5px]">
            Answers
          </Label>
          <Input id="pmf-a" inputMode="numeric" value={answers} onChange={(e) => setAnswers(e.target.value)} className="font-mono text-[16px] sm:text-[13px]" />
        </div>
        <div>
          <Label htmlFor="pmf-v" className="mb-1 text-[11.5px]">
            Very disappointed
          </Label>
          <Input id="pmf-v" inputMode="numeric" value={very} onChange={(e) => setVery(e.target.value)} className="font-mono text-[16px] sm:text-[13px]" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor="pmf-s" className="mb-1 text-[11.5px]">
            Segment (optional)
          </Label>
          <Input id="pmf-s" value={segment} onChange={(e) => setSegment(e.target.value)} maxLength={60} placeholder="weekly runners" className="text-[16px] sm:text-[13px]" />
        </div>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <Button type="submit" size="sm">
        Save the survey
      </Button>
    </form>
  );
}
