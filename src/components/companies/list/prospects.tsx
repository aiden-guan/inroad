"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  ArrowUpDown,
  Banknote,
  Briefcase,
  CalendarClock,
  Check,
  EyeOff,
  FileText,
  Layers,
  MessageCircleQuestion,
  PenLine,
  Rocket,
  Star,
  TriangleAlert,
  UserPlus,
  UserRoundCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/misc";
import { SourceChip } from "@/components/ui/source";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { plural } from "@/lib/client/format";
import { nowISO, todayISO } from "@/lib/domain/ids";
import type { Action } from "@/lib/domain/actions";
import type { Account as AccountT, ICPCriterion, Signal, SignalType, Workspace } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { DismissPopover } from "./dismiss-panel";
import { FilterMenu } from "./filter-menu";
import {
  DISMISS_REASONS,
  ageLabel,
  PROSPECT_STATUS_LABEL,
  SIGNAL_LABEL,
  TIER_HINT,
  inOverlay,
  isScored,
  isTyping,
  priority,
  prospectStatus,
  signalDecay,
  sourceText,
  topSignal,
  touchIndex,
  type DismissReason,
  type ProspectStatus,
} from "./lib";

type SortKey = "priority" | "fit" | "signal" | "added";
const SORT_LABEL: Record<SortKey, string> = { priority: "Priority", fit: "Fit", signal: "Newest signal", added: "Recently added" };

const SIGNAL_ICON: Record<SignalType, LucideIcon> = {
  first_hire: UserPlus,
  hiring: Briefcase,
  funding: Banknote,
  launch: Rocket,
  new_leader: UserRoundCheck,
  champion_job_change: ArrowRightLeft,
  jd_names_pain: FileText,
  stack_change: Layers,
  compliance_deadline: CalendarClock,
  persona_post: PenLine,
  community_request: MessageCircleQuestion,
  public_pain: TriangleAlert,
  filing: FileText,
  sensitive: EyeOff,
  life_event: UserRoundCheck,
  seasonal: CalendarClock,
  trend: Rocket,
  competitor_gap: TriangleAlert,
};

const TIER_RANK: Record<AccountT["tier"], number> = { A: 0, B: 1, C: 2 };

// Desktop columns: select · company · tier · fit · why now · warm · roles · status.
const GRID = "md:grid-cols-[16px_minmax(0,1.3fr)_20px_30px_minmax(0,2.3fr)_84px] lg:grid-cols-[16px_minmax(0,1.3fr)_20px_30px_minmax(0,2.3fr)_40px_40px_84px]";

const rowId = (domain: string) => `prospect-${domain.replace(/[^a-z0-9]/gi, "-")}`;

interface Row {
  a: AccountT;
  status: ProspectStatus;
  top?: Signal;
}

type Measurable = { getBoundingClientRect: () => DOMRect };

/** A trait at least two dismissed accounts share: a tag, else an ICP criterion they fail. Never a city. */
function sharedTrait(accounts: AccountT[], criteria: ICPCriterion[]): string | null {
  const tags = new Map<string, { label: string; n: number }>();
  for (const a of accounts) {
    for (const t of new Set((a.tags ?? []).map((x) => x.trim()).filter(Boolean))) {
      const cur = tags.get(t.toLowerCase());
      if (cur) cur.n++;
      else tags.set(t.toLowerCase(), { label: t, n: 1 });
    }
  }
  const tag = [...tags.values()].sort((x, y) => y.n - x.n)[0];
  if (tag && tag.n >= 2) return `${tag.label.charAt(0).toUpperCase()}${tag.label.slice(1)} companies`.slice(0, 120);
  const fails = new Map<string, number>();
  for (const a of accounts) for (const c of a.criteria) if (c.met === "false") fails.set(c.criterionId, (fails.get(c.criterionId) ?? 0) + 1);
  const failed = [...fails.entries()]
    .filter(([, n]) => n >= 2)
    .sort((x, y) => y[1] - x[1])
    .map(([id]) => criteria.find((c) => c.id === id))
    .find(Boolean);
  return failed ? `Fails: ${failed.text}`.slice(0, 120) : null;
}

export function Prospects({
  ws,
  today,
  sheetOpen,
  onOpen,
  emptyAction,
}: {
  ws: Workspace;
  today: string;
  sheetOpen: boolean;
  onOpen: (domain: string) => void;
  emptyAction: React.ReactNode;
}) {
  const { dispatch } = useWorkspace();
  const { start, runs } = useRuns();
  const router = useRouter();

  const [tiers, setTiers] = useState<Set<AccountT["tier"]>>(new Set());
  const [signalTypes, setSignalTypes] = useState<Set<SignalType>>(new Set());
  const [statuses, setStatuses] = useState<Set<ProspectStatus>>(new Set());
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>("priority");
  const [cursor, setCursor] = useState<string | null>(null);
  const [kbd, setKbd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissing, setDismissing] = useState<string[] | null>(null);
  const [settled, setSettled] = useState(false);
  const anchor = useRef<Measurable>({ getBoundingClientRect: () => new DOMRect() });
  const lastClicked = useRef<string | null>(null);

  const touched = useMemo(() => touchIndex(ws.activities), [ws.activities]);
  const all = useMemo<Row[]>(
    () =>
      Object.values(ws.accounts)
        .filter((a) => a.status === "new" || a.status === "tracked" || a.status === "disqualified")
        .map((a) => ({ a, status: prospectStatus(a, touched), top: topSignal(a, today) })),
    [ws.accounts, touched, today],
  );

  const sourceKey = (a: AccountT) => (a.source === "integration" ? `integration:${a.sourceDetail ?? ""}` : a.source === "csv_import" ? "csv_import" : a.source);
  const visibleStatus = (s: ProspectStatus) => (statuses.size ? statuses.has(s) : s !== "dismissed");

  const rows = useMemo(() => {
    const out = all.filter(
      (r) =>
        visibleStatus(r.status) &&
        (!tiers.size || (isScored(r.a) && tiers.has(r.a.tier))) &&
        (!signalTypes.size || r.a.signals.some((s) => signalTypes.has(s.type) && (s.type === "sensitive" || signalDecay(s, today) > 0))) &&
        (!sources.size || sources.has(sourceKey(r.a))),
    );
    const cmp: Record<SortKey, (x: Row, y: Row) => number> = {
      priority: (x, y) =>
        (isScored(x.a) ? TIER_RANK[x.a.tier] : 3) - (isScored(y.a) ? TIER_RANK[y.a.tier] : 3) || priority(y.a) - priority(x.a) || x.a.name.localeCompare(y.a.name),
      fit: (x, y) => y.a.fitScore - x.a.fitScore || priority(y.a) - priority(x.a),
      signal: (x, y) => (y.top?.date ?? "").localeCompare(x.top?.date ?? "") || priority(y.a) - priority(x.a),
      added: (x, y) => y.a.addedAt.localeCompare(x.a.addedAt),
    };
    return out.sort(cmp[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, tiers, signalTypes, statuses, sources, sort, today]);

  // Filter options with counts (over the non-dismissed set unless dismissed is being shown).
  const pool = useMemo(() => all.filter((r) => visibleStatus(r.status)), [all, statuses]); // eslint-disable-line react-hooks/exhaustive-deps
  const tierOptions = (["A", "B", "C"] as const).map((t) => ({ value: t, label: `Tier ${t}`, count: pool.filter((r) => isScored(r.a) && r.a.tier === t).length }));
  const signalOptions = useMemo(() => {
    const counts = new Map<SignalType, number>();
    for (const r of pool) for (const t of new Set(r.a.signals.filter((s) => s.type === "sensitive" || signalDecay(s, today) > 0).map((s) => s.type))) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, label: SIGNAL_LABEL[value], count }));
  }, [pool, today]);
  const statusOptions = (["new", "tracked", "contacted", "replied", "dismissed"] as const).map((s) => ({ value: s, label: PROSPECT_STATUS_LABEL[s], count: all.filter((r) => r.status === s).length }));
  const sourceOptions = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const r of pool) {
      const k = sourceKey(r.a);
      const cur = m.get(k);
      if (cur) cur.count++;
      else m.set(k, { label: r.a.source === "csv_import" ? "CSV import" : sourceText(r.a), count: 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count).map(([value, v]) => ({ value, label: v.label, count: v.count }));
  }, [pool]);

  const filtered = tiers.size + signalTypes.size + statuses.size + sources.size > 0;
  const clearFilters = () => {
    setTiers(new Set());
    setSignalTypes(new Set());
    setStatuses(new Set());
    setSources(new Set());
  };

  const idx = cursor ? rows.findIndex((r) => r.a.domain === cursor) : -1;

  /* ─────────── Actions ─────────── */

  const isTracked = (a: AccountT) => a.status === "tracked" || a.watch;

  const track = (domains: string[], watch: boolean) => {
    const accounts = domains.map((d) => ws.accounts[d]).filter(Boolean);
    if (!accounts.length) return;
    const actions: Action[] = [];
    for (const a of accounts) {
      if (a.status === "disqualified") actions.push({ type: "account.restore", domain: a.domain });
      actions.push({ type: "account.track", domain: a.domain, watch });
    }
    void dispatch(actions);
    if (!watch) {
      toast(accounts.length === 1 ? `Stopped tracking ${accounts[0].name}` : `Stopped tracking ${accounts.length} companies`);
      return;
    }
    // Tracking starts a dossier (a few cents each), unless a fresh one exists or one is already being
    // written. At most 10 a day across every Track, not 10 per click.
    const researching = new Set(Object.values(runs).filter((r) => r.workflow === "dossier" && (r.status === "running" || r.status === "queued")).map((r) => r.ref?.id));
    const due = accounts.filter((a) => (!a.dossier || a.dossier.staleAfter < today) && !researching.has(a.domain));
    const startedToday = new Set<string>();
    for (const r of [...ws.runs, ...Object.values(runs)]) if (r.workflow === "dossier" && todayISO(new Date(r.startedAt)) === today) startedToday.add(r.id);
    const batch = due.slice(0, Math.max(0, 10 - startedToday.size));
    for (const a of batch) void start("dossier", { domain: a.domain }, { notify: accounts.length === 1 });
    const name = accounts.length === 1 ? accounts[0].name : plural(accounts.length, "company", "companies");
    const waiting = due.length - batch.length;
    if (!due.length) toast(`Tracking ${name}`);
    else if (!waiting) toast(`Tracking ${name} · researching ${accounts.length === 1 ? "now" : `all ${batch.length}`}`);
    else {
      const rest = !batch.length ? (waiting === 1 ? "it" : "any of them") : waiting === 1 ? "the other one" : `any of the other ${waiting}`;
      toast(batch.length ? `Tracking ${name} · researching ${batch.length} now` : `Tracking ${name}`, {
        description: `I start up to 10 research runs a day to keep costs down. Open ${rest} to research it now (a few cents).`,
      });
    }
  };

  const dismiss = (domains: string[], reason: DismissReason, note?: string) => {
    const accounts = domains.map((d) => ws.accounts[d]).filter(Boolean);
    if (!accounts.length) return;
    const at = nowISO();
    // Keep the keyboard cursor on the next row.
    if (cursor && domains.includes(cursor)) {
      const after = rows.slice(idx + 1).find((r) => !domains.includes(r.a.domain)) ?? rows.slice(0, idx).reverse().find((r) => !domains.includes(r.a.domain));
      setCursor(after?.a.domain ?? null);
    }
    void dispatch(accounts.map((a) => ({ type: "account.disqualify", domain: a.domain, reason, note, at })));
    setSelected((s) => {
      const next = new Set(s);
      for (const d of domains) next.delete(d);
      return next;
    });
    const label = DISMISS_REASONS.find((r) => r.value === reason)?.label ?? reason;
    // Disqualifying clears `watch`; Undo puts tracked ones back to tracked (without starting research again).
    const wasTracked = accounts.filter((a) => a.status === "tracked" || a.watch);
    toast(`Dismissed ${accounts.length === 1 ? accounts[0].name : plural(accounts.length, "company", "companies")} · ${label}`, {
      action: {
        label: "Undo",
        onClick: () =>
          void dispatch([
            ...accounts.map((a): Action => ({ type: "account.restore", domain: a.domain })),
            ...wasTracked.map((a): Action => ({ type: "account.track", domain: a.domain, watch: true })),
          ]),
      },
    });
    proposeAntiIcp(reason, accounts);
  };

  // Three dismissals for the same reason in a week → offer an anti-ICP line (the founder decides).
  const proposeAntiIcp = (reason: DismissReason, just: AccountT[]) => {
    const f = ws.foundation;
    if (!f || !["not_icp", "too_small", "too_big"].includes(reason)) return;
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const same = [
      ...just,
      ...Object.values(ws.accounts).filter((a) => a.disqualified?.reason === reason && a.disqualified.at >= weekAgo && !just.some((j) => j.domain === a.domain)),
    ];
    if (same.length < 3) return;
    const label = DISMISS_REASONS.find((r) => r.value === reason)!.label.toLowerCase();
    const names = same.slice(0, 3).map((a) => a.name);
    // Screening tests attributes, so "not ICP" needs a trait they share; names alone give it nothing to test.
    const text =
      reason === "too_small"
        ? `Too small to buy yet (like ${names.join(", ")})`
        : reason === "too_big"
          ? `Too big for founder-led sales (like ${names.join(", ")})`
          : sharedTrait(same, f.icp.criteria);
    if (!text) {
      if (same.length - just.length >= 3) return; // asked when the third one landed
      toast(`That's ${same.length} dismissed as “${label}” this week.`, {
        description: "If they share something, name it under Not a fit and I'll stop suggesting companies like these.",
        duration: 10_000,
        action: { label: "Name what they share", onClick: () => router.push("/playbook#anti-icp") },
      });
      return;
    }
    const antiIcp = f.icp.antiIcp;
    const dupe = antiIcp.some((x) =>
      reason === "not_icp" ? x.text.toLowerCase() === text.toLowerCase() : x.reason.startsWith("You dismissed") && x.text.toLowerCase().startsWith(text.toLowerCase().slice(0, 12)),
    );
    if (dupe) return;
    const why = `You dismissed ${same.length} as ${label} in a week${reason === "not_icp" ? ` (${names.join(", ")})` : ""}`.slice(0, 160);
    toast(`That's ${same.length} dismissed as “${label}” this week.`, {
      description: reason === "not_icp" ? `They share this: “${text}”. Add it to your anti-ICP so I stop suggesting companies like these?` : "Add it to your anti-ICP so I stop suggesting companies like these?",
      duration: 10_000,
      action: {
        label: "Add to anti-ICP",
        onClick: () => void dispatch({ type: "foundation.set", path: ["icp", "antiIcp"], value: [...antiIcp, { text, reason: why }] }),
      },
    });
  };

  const openDismiss = (domains: string[], el: Element | null) => {
    const rect = el?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
    anchor.current = { getBoundingClientRect: () => rect };
    setDismissing(domains);
  };

  const toggleSelect = (domain: string, e: MouseEvent) => {
    e.stopPropagation();
    setSelected((s) => {
      const next = new Set(s);
      const on = !next.has(domain);
      // Shift-click selects the range since the last click.
      if (e.shiftKey && lastClicked.current) {
        const a = rows.findIndex((r) => r.a.domain === lastClicked.current);
        const b = rows.findIndex((r) => r.a.domain === domain);
        if (a !== -1 && b !== -1) {
          for (const r of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (on) next.add(r.a.domain);
            else next.delete(r.a.domain);
          }
        }
      } else if (on) next.add(domain);
      else next.delete(domain);
      return next;
    });
    lastClicked.current = domain;
  };

  /* ─────────── Keyboard: J/K move · Enter open · T track · X dismiss ─────────── */

  useEffect(() => {
    if (sheetOpen || dismissing) return;
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || inOverlay(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        lastG = e.timeStamp;
        return;
      }
      if (lastG && e.timeStamp - lastG < 1200) {
        lastG = 0; // "G then T" belongs to navigation
        return;
      }
      if (!rows.length) return;
      if (k === "j" || e.key === "ArrowDown" || k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const d = k === "j" || e.key === "ArrowDown" ? 1 : -1;
        const from = idx < 0 ? (d > 0 ? -1 : rows.length) : idx;
        const next = rows[Math.max(0, Math.min(rows.length - 1, from + d))];
        setCursor(next.a.domain);
        setKbd(true);
        // Drop stale focus so Enter, T and X act on the highlighted row, not the last-clicked control.
        const ae = document.activeElement as HTMLElement | null;
        if (ae && ae !== document.body) ae.blur();
        document.getElementById(rowId(next.a.domain))?.scrollIntoView({ block: "nearest" });
        return;
      }
      // A focused control keeps its own Enter (and the row shortcuts stay off while Tab is in use).
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && t.closest?.("a,button,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=menuitem]")) return;
      if (!kbd || idx < 0) return;
      const row = rows[idx];
      if (e.key === "Enter") {
        e.preventDefault();
        onOpen(row.a.domain);
      } else if (k === "t") {
        e.preventDefault();
        track([row.a.domain], !(isTracked(row.a) && row.a.status !== "disqualified"));
      } else if (k === "x" && row.status !== "dismissed") {
        e.preventDefault();
        const el = document.getElementById(rowId(row.a.domain));
        openDismiss([row.a.domain], el?.querySelector("[data-status]") ?? el);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ─────────── Render ─────────── */

  if (!all.length) {
    return <EmptyState title="No companies yet." body="I'll start with the YC directory and your competitors' customer pages, then check each one for a dated reason to talk now." action={emptyAction} />;
  }

  const dismissTitle =
    dismissing && dismissing.length === 1 ? `Why dismiss ${ws.accounts[dismissing[0]]?.name ?? dismissing[0]}?` : `Why dismiss ${dismissing?.length ?? 0} companies?`;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.a.domain));

  return (
    <div className="pb-24">
      {/* Toolbar */}
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1 scrollbar-none">
        <FilterMenu label="Tier" options={tierOptions} value={tiers} onChange={setTiers} />
        <FilterMenu label="Signal" options={signalOptions} value={signalTypes} onChange={setSignalTypes} />
        <FilterMenu label="Status" options={statusOptions} value={statuses} onChange={setStatuses} />
        <FilterMenu label="Source" options={sourceOptions} value={sources} onChange={setSources} />
        {filtered && (
          <button onClick={clearFilters} className="h-7 shrink-0 rounded-sm px-2 text-[12.5px] text-fg-3 transition-colors hover:text-fg">
            Clear
          </button>
        )}
        <span className="flex-1" />
        <span className="shrink-0 font-mono text-[11.5px] tnum text-fg-3">{rows.length}</span>
        <Menu
          trigger={
            <button className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-bg-subtle hover:text-fg">
              <ArrowUpDown className="size-3.5" />
              {SORT_LABEL[sort]}
            </button>
          }
        >
          <MenuLabel>Sort by</MenuLabel>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <MenuItem key={k} onSelect={() => setSort(k)} icon={sort === k ? <Check className="size-3.5" /> : <span />}>
              {SORT_LABEL[k]}
            </MenuItem>
          ))}
        </Menu>
      </div>

      {/* Column labels */}
      <div className={cn("mt-2 hidden h-8 items-center gap-3 border-b border-border px-3 text-[11px] font-medium text-fg-3 md:grid", GRID)}>
        <button
          role="checkbox"
          aria-checked={allSelected}
          aria-label="Select all"
          onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.a.domain)))}
          className={cn("flex size-3.5 items-center justify-center rounded-[4px] ring-1 ring-border-strong transition-colors", allSelected && "bg-primary ring-primary")}
        >
          {allSelected && <Check className="size-2.5 text-primary-fg" strokeWidth={3} />}
        </button>
        <span>Company</span>
        <Tooltip content="A: strong fit and a fresh reason now. B: strong fit, no fresh reason yet. C: partial fit, strong signal.">
          <span className="cursor-default">Tier</span>
        </Tooltip>
        <Tooltip content="How well they match your ICP criteria, 0–100. Unknown counts as half.">
          <span className="cursor-default">Fit</span>
        </Tooltip>
        <span>Why now</span>
        <Tooltip content="People you know there, from your network import">
          <span className="hidden cursor-default lg:block">Warm</span>
        </Tooltip>
        <Tooltip content="Open roles on their job board">
          <span className="hidden cursor-default lg:block">Roles</span>
        </Tooltip>
        <span>Status</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing matches these filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
      ) : (
        <ul onMouseMove={() => kbd && setKbd(false)} aria-label="Prospects" className="divide-y divide-border">
          {rows.map((r, i) => (
            <ProspectRow
              key={r.a.domain}
              row={r}
              index={i}
              animate={!settled && i < 8}
              onEntered={i === Math.min(rows.length, 8) - 1 ? () => setSettled(true) : undefined}
              focused={kbd && i === idx}
              selected={selected.has(r.a.domain)}
              selecting={selected.size > 0}
              ws={ws}
              today={today}
              onOpen={() => {
                setCursor(r.a.domain);
                onOpen(r.a.domain);
              }}
              onSelect={(e) => toggleSelect(r.a.domain, e)}
              onTrack={() => track([r.a.domain], !(isTracked(r.a) && r.status !== "dismissed"))}
              onDismiss={(el) => openDismiss([r.a.domain], el)}
              onRestore={() => void dispatch({ type: "account.restore", domain: r.a.domain })}
            />
          ))}
        </ul>
      )}

      {rows.length > 0 && (
        <p className="mt-4 hidden items-center gap-3 text-[11.5px] text-fg-3 md:flex">
          <span className="flex items-center gap-1">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>T</Kbd> track
          </span>
          <span className="flex items-center gap-1">
            <Kbd>X</Kbd> dismiss
          </span>
        </p>
      )}

      {/* Bulk bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
            className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4"
          >
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-lg bg-surface-raised p-1.5 pl-3 shadow-lg ring-1 ring-border">
              <span className="mr-1 font-mono text-[12px] tnum text-fg-2">{selected.size} selected</span>
              <Button size="sm" variant="primary" icon={<Star className="size-3.5" />} onClick={() => (track([...selected], true), setSelected(new Set()))}>
                Track {selected.size}
              </Button>
              <Button size="sm" variant="ghost" onClick={(e) => openDismiss([...selected], e.currentTarget)}>
                Dismiss…
              </Button>
              <IconButton label="Clear selection" onClick={() => setSelected(new Set())}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DismissPopover
        open={!!dismissing}
        onOpenChange={(o) => !o && setDismissing(null)}
        anchor={anchor}
        title={dismissTitle}
        onChoose={(reason, note) => {
          if (dismissing) dismiss(dismissing, reason, note);
          setDismissing(null);
        }}
      />
    </div>
  );
}

/* ─────────────────────────── Row ─────────────────────────── */

function ProspectRow({
  row,
  index,
  animate,
  focused,
  selected,
  selecting,
  ws,
  today,
  onOpen,
  onSelect,
  onTrack,
  onDismiss,
  onRestore,
  onEntered,
}: {
  row: Row;
  index: number;
  animate: boolean;
  onEntered?: () => void;
  focused: boolean;
  selected: boolean;
  selecting: boolean;
  ws: Workspace;
  today: string;
  onOpen: () => void;
  onSelect: (e: MouseEvent) => void;
  onTrack: () => void;
  onDismiss: (el: Element) => void;
  onRestore: () => void;
}) {
  const { a, status, top } = row;
  const ev = top?.evidenceId ? ws.evidence[top.evidenceId] : undefined;
  const scored = isScored(a);
  const dismissed = status === "dismissed";
  const tracked = status !== "dismissed" && (a.status === "tracked" || a.watch);
  const Icon = top ? SIGNAL_ICON[top.type] : null;
  const criteria = ws.foundation?.icp.criteria ?? [];
  const teams = a.enrichment?.rolesByTeam.slice(0, 3).map((t) => `${t.team} ${t.count}`).join(" · ");

  const why = top ? (
    <span className="flex min-w-0 items-center gap-1.5">
      {Icon && <Icon className="size-3.5 shrink-0 text-fg-3" aria-label={SIGNAL_LABEL[top.type]} />}
      <span className="min-w-0 truncate text-fg-2" title={top.headline}>
        {top.headline}
      </span>
      <SourceChip
        url={ev?.url ?? top.url}
        publishedAt={ev?.publishedAt ?? top.date}
        quote={ev?.quote}
        claim={ev?.claim}
        confidence={ev?.confidence}
        className="relative z-[1] shrink-0"
      />
    </span>
  ) : (
    <span className="truncate text-fg-4">
      {scored && a.tier === "B" ? "Good fit. No dated reason yet" : "No dated signal yet"}
      <span className="text-fg-4/80"> · {sourceText(a)}</span>
    </span>
  );

  return (
    <motion.li
      id={rowId(a.domain)}
      variants={listItem}
      custom={index}
      initial={animate ? "hidden" : false}
      animate="show"
      onAnimationComplete={onEntered}
      aria-selected={focused || undefined}
      className={cn(
        "group relative flex items-center gap-3 px-3 py-2.5 text-[13px] md:grid md:h-11 md:py-0",
        GRID,
        "transition-colors duration-100 hover:bg-bg-subtle",
        focused && "bg-bg-subtle shadow-[inset_2px_0_0_var(--fg-3)]",
        selected && "bg-bg-subtle",
        dismissed && "opacity-60",
      )}
    >
      {/* Select */}
      <button
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${a.name}`}
        onClick={onSelect}
        className={cn(
          "relative z-[1] hidden size-3.5 items-center justify-center rounded-[4px] ring-1 ring-border-strong transition-[opacity,background-color] duration-100 md:flex",
          selected ? "bg-primary opacity-100 ring-primary" : selecting ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
        )}
      >
        {selected && <Check className="size-2.5 text-primary-fg" strokeWidth={3} />}
      </button>

      {/* Company (the whole row opens the sheet) */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5 md:flex-none">
        <Tooltip content={`Found via ${sourceText(a)}${a.sourceDetail && a.source !== "integration" && a.source !== "csv_import" ? ` · ${a.sourceDetail}` : ""}`}>
          <span className="relative z-[1] flex shrink-0">
            <Favicon domain={a.domain} name={a.name} size={20} />
          </span>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <button
              onClick={onOpen}
              className="min-w-0 max-w-full shrink-0 truncate text-left font-medium text-fg outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
            >
              {a.name}
            </button>
            {/* The name wins the space; the domain truncates first and hides when there's no room. */}
            <span className="hidden min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-3 xl:inline">{a.domain}</span>
          </div>
          {/* Phone: why-now under the name, with the age instead of the full source chip */}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] md:hidden">
            {top ? (
              <>
                {Icon && <Icon className="size-3.5 shrink-0 text-fg-3" />}
                <span className="min-w-0 truncate text-fg-2">{top.headline}</span>
                <span className="shrink-0 font-mono text-[11px] text-fg-3">{ageLabel(top.date, today)}</span>
              </>
            ) : (
              why
            )}
          </div>
        </div>
      </div>

      {/* Tier */}
      <Tooltip content={scored ? TIER_HINT[a.tier] : "Not scored against your ICP yet"}>
        <span
          className={cn(
            "relative z-[1] hidden size-5 cursor-default items-center justify-center rounded-xs font-mono text-[11px] ring-1 ring-inset md:inline-flex",
            !scored ? "text-fg-4 ring-border" : a.tier === "A" ? "text-fg ring-border-strong" : a.tier === "B" ? "text-fg-2 ring-border" : "text-fg-3 ring-border",
          )}
        >
          {scored ? a.tier : "–"}
        </span>
      </Tooltip>

      {/* Fit */}
      <Tooltip
        content={
          scored && a.criteria.length ? (
            <span className="block space-y-0.5">
              {a.criteria.slice(0, 6).map((c) => {
                const text = criteria.find((x) => x.id === c.criterionId)?.text ?? (c.criterionId.startsWith("prov") ? "Matches who you sell to" : c.criterionId);
                return (
                  <span key={c.criterionId} className="flex gap-1.5">
                    <span className="w-3 shrink-0 font-mono">{c.met === "true" ? "✓" : c.met === "false" ? "✕" : "?"}</span>
                    <span className="line-clamp-2">
                      {text}
                      {c.note ? <span className="opacity-70"> · {c.note}</span> : null}
                    </span>
                  </span>
                );
              })}
            </span>
          ) : scored ? (
            `Fit ${a.fitScore}`
          ) : (
            "Not scored yet. Find companies scores what you add."
          )
        }
      >
        <span className="relative z-[1] hidden cursor-default font-mono text-[12px] tnum text-fg-2 md:block">{scored ? a.fitScore : "–"}</span>
      </Tooltip>

      {/* Why now */}
      <div className="hidden min-w-0 md:flex">{why}</div>

      {/* Warm paths */}
      <Tooltip content={a.warmPathCount ? `${plural(a.warmPathCount, "person", "people")} you know here` : "Nobody you know here yet"}>
        <span className={cn("relative z-[1] hidden cursor-default items-center gap-1 font-mono text-[12px] tnum lg:flex", a.warmPathCount ? "text-fg-2" : "text-fg-4")}>
          <Users className="size-3.5" />
          {a.warmPathCount || "–"}
        </span>
      </Tooltip>

      {/* Open roles */}
      <Tooltip content={a.enrichment ? (a.enrichment.openRoles ? teams : "No public job board found") : "Not checked yet"}>
        <span className={cn("relative z-[1] hidden cursor-default items-center gap-1 font-mono text-[12px] tnum lg:flex", a.enrichment?.openRoles ? "text-fg-2" : "text-fg-4")}>
          <Briefcase className="size-3.5" />
          {a.enrichment ? a.enrichment.openRoles : "–"}
        </span>
      </Tooltip>

      {/* Status + hover actions */}
      <div data-status className="relative flex shrink-0 items-center justify-end md:justify-start">
        <span className={cn("flex items-center gap-1 text-[12px] transition-opacity duration-100 md:group-hover:opacity-0 md:group-focus-within:opacity-0", status === "new" || dismissed ? "text-fg-3" : "text-fg-2")}>
          {tracked && <Star className="size-3 fill-current" />}
          {PROSPECT_STATUS_LABEL[status]}
        </span>
        <span className="absolute inset-y-0 right-0 z-[1] hidden items-center gap-0.5 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100 md:flex md:left-0 md:right-auto">
          {dismissed ? (
            <Button size="xs" variant="ghost" onClick={onRestore}>
              Restore
            </Button>
          ) : (
            <>
              <IconButton label={tracked ? "Stop tracking (T)" : "Track (T)"} onClick={onTrack} className="size-6">
                <Star className={cn("size-3.5", tracked && "fill-current text-fg")} />
              </IconButton>
              <IconButton label="Dismiss (X)" onClick={(e) => onDismiss(e.currentTarget)} className="size-6">
                <X className="size-3.5" />
              </IconButton>
            </>
          )}
        </span>
      </div>
    </motion.li>
  );
}

