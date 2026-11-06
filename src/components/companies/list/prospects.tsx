"use client";

import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  ArrowUpDown,
  Banknote,
  Briefcase,
  CalendarClock,
  Check,
  Columns3,
  EyeOff,
  FileText,
  Layers,
  MessageCircleQuestion,
  PenLine,
  Plus,
  Rocket,
  Sparkles,
  Star,
  TriangleAlert,
  UserPlus,
  UserRoundCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuCheckItem, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/misc";
import { SourceChip } from "@/components/ui/source";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { plural } from "@/lib/client/format";
import { LIMITS, type ColumnCell, type ColumnJob, type ResearchColumn, type SavedView, type ViewFilters, type ViewState } from "@/lib/columns/types";
import { answerKey, answerOptions, cellLabel, cellState, compareCells, estimateRest, shortQuestion, sortChoices } from "@/lib/columns/values";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Action } from "@/lib/domain/actions";
import type { Account as AccountT, ICPCriterion, Signal, SignalType, Workspace } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { BulkBar } from "./columns/bulk-bar";
import { ResearchCell, type CellRun } from "./columns/cell";
import { ColumnComposer, type ComposerRow } from "./columns/composer";
import { downloadCsv, exportCsv } from "./columns/csv";
import { ColumnHeader } from "./columns/header";
import {
  BUILTIN_SORTS,
  BUILTIN_SORT_LABEL,
  DEFAULT_SORT,
  cleanState,
  defaultState,
  filterCount,
  isBuiltinSort,
  nudge,
  sameState,
  suggestName,
  viewState,
  type BuiltinSort,
} from "./columns/table-state";
import { useColumns, useColumnsPolling } from "./columns/use-columns";
import { ViewTabs } from "./columns/view-tabs";
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

interface Row {
  a: AccountT;
  status: ProspectStatus;
  top?: Signal;
}

const BUILTIN_CMP: Record<BuiltinSort, (x: Row, y: Row) => number> = {
  priority: (x, y) =>
    (isScored(x.a) ? TIER_RANK[x.a.tier] : 3) - (isScored(y.a) ? TIER_RANK[y.a.tier] : 3) || priority(y.a) - priority(x.a) || x.a.name.localeCompare(y.a.name),
  fit: (x, y) => y.a.fitScore - x.a.fitScore || priority(y.a) - priority(x.a),
  signal: (x, y) => (y.top?.date ?? "").localeCompare(x.top?.date ?? "") || priority(y.a) - priority(x.a),
  added: (x, y) => y.a.addedAt.localeCompare(x.a.addedAt),
};

/*
 * Columns, desktop: lead (select · company) · tier · fit · why now · [warm · roles at lg] · status · research
 * columns · "+". The template lives in CSS variables so research columns can be added at runtime. With research
 * columns the table may grow wider than the page: it scrolls sideways and the company stays pinned on the left.
 */
const RESEARCH_W = 136;
/** "Why now" is the reason to act: with research columns it keeps room for the headline and its source, and the table scrolls sideways instead. */
const WHY_MIN = 300;
const GRID = "md:[grid-template-columns:var(--cols-md)] lg:[grid-template-columns:var(--cols-lg)]";

function gridVars(n: number): CSSProperties {
  const tail = `${n ? ` repeat(${n}, ${RESEARCH_W}px)` : ""} 32px`;
  const md = n ? `minmax(184px,1fr) 20px 30px minmax(${WHY_MIN}px,2fr) 84px${tail}` : `minmax(0,1.15fr) 20px 30px minmax(0,2.6fr) 84px${tail}`;
  const lg = n ? `minmax(200px,1fr) 20px 30px minmax(${WHY_MIN}px,2fr) 40px 40px 84px${tail}` : `minmax(0,1.1fr) 20px 30px minmax(0,2.7fr) 40px 40px 84px${tail}`;
  // Sum of the minimum tracks, the gaps (12px) and the row's side padding (24px).
  const minMd = 184 + 20 + 30 + WHY_MIN + 84 + n * RESEARCH_W + 32 + (5 + n) * 12 + 24;
  const minLg = 200 + 20 + 30 + WHY_MIN + 40 + 40 + 84 + n * RESEARCH_W + 32 + (7 + n) * 12 + 24;
  return { "--cols-md": md, "--cols-lg": lg, "--minw-md": `${minMd}px`, "--minw-lg": `${minLg}px` } as CSSProperties;
}

/** The pinned company cell needs an opaque background equal to the row's: surface at 40% over the page. */
const PIN_BG = "md:bg-[color:color-mix(in_oklab,var(--surface)_40%,var(--bg))] md:group-hover:bg-bg-subtle";
const PIN = "md:sticky md:left-0 md:z-[2] md:-ml-3 md:pl-3 md:group-data-[scrolled]/table:shadow-[1px_0_0_var(--border)]";

const rowId = (domain: string) => `prospect-${domain.replace(/[^a-z0-9]/gi, "-")}`;

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

/** ?viewId= lives in the URL; the native history API updates useSearchParams without a round trip. */
function setViewParam(id: string | null) {
  const next = new URLSearchParams(window.location.search);
  if (id) next.set("viewId", id);
  else next.delete("viewId");
  const qs = next.toString();
  window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
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
  const { start, stop, runs } = useRuns();
  const router = useRouter();
  const params = useSearchParams();
  const { data: colData, apply, refresh: refreshColumns } = useColumns();

  const [cursor, setCursor] = useState<string | null>(null);
  const [kbd, setKbd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dismissing, setDismissing] = useState<string[] | null>(null);
  const [settled, setSettled] = useState(false);
  const [composer, setComposer] = useState<{ scope: "visible" | "selected"; editing: ResearchColumn | null } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [work, setWork] = useState<{ key: string; state: ViewState } | null>(null);
  const anchor = useRef<Measurable>({ getBoundingClientRect: () => new DOMRect() });
  const composerAnchor = useRef<Measurable>({ getBoundingClientRect: () => new DOMRect() });
  const lastClicked = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const tableActive = useRef(false);

  /* ─────────── Research columns and saved views ─────────── */

  const columnRuns = Object.values(runs).filter((r) => r.workflow === "research_column" && (r.status === "running" || r.status === "queued"));
  const jobs: ColumnJob[] = useMemo(() => colData?.jobs ?? [], [colData]);
  useColumnsPolling(columnRuns.length > 0 || jobs.length > 0);

  const columnsAll = useMemo(() => colData?.columns ?? [], [colData]);
  const colById = useMemo(() => new Map(columnsAll.map((c) => [c.id, c])), [columnsAll]);
  const cells = useMemo(() => colData?.cells ?? {}, [colData]);
  const views = useMemo(() => colData?.views ?? [], [colData]);
  const viewId = params.get("viewId");
  const active = views.find((v) => v.id === viewId) ?? null;
  const key = active?.id ?? "all";
  const base = useMemo(() => (active ? cleanState(viewState(active), columnsAll) : defaultState(colData)), [active, columnsAll, colData]);
  const working = useMemo(() => (work && work.key === key ? cleanState(work.state, columnsAll) : base), [work, key, columnsAll, base]);
  // The default view's columns are its own layout (hide and move save at once); a saved view's are part of it.
  const state: ViewState = useMemo(() => (active ? working : { ...working, columns: base.columns }), [active, working, base]);
  const dirty = active ? !sameState(state, base) : filterCount(state.filters) > 0 || state.sort.key !== DEFAULT_SORT.key || state.sort.dir !== DEFAULT_SORT.dir;
  const update = (fn: (s: ViewState) => ViewState) => setWork({ key, state: fn(state) });
  const f = state.filters;

  // Loading the sample, a reset or a restore replaces the workspace and its columns together.
  useEffect(() => {
    void refreshColumns();
  }, [ws.createdAt, refreshColumns]);

  // A link to a view that was deleted lands on the default view.
  useEffect(() => {
    if (viewId && colData && !colData.views.some((v) => v.id === viewId)) setViewParam(null);
  }, [viewId, colData]);

  const shownCols = useMemo(() => state.columns.map((id) => colById.get(id)).filter((c): c is ResearchColumn => !!c), [state.columns, colById]);

  /* ─────────── Rows ─────────── */

  const touched = useMemo(() => touchIndex(ws.activities), [ws.activities]);
  const all = useMemo<Row[]>(
    () =>
      Object.values(ws.accounts)
        .filter((a) => a.status === "new" || a.status === "tracked" || a.status === "disqualified")
        .map((a) => ({ a, status: prospectStatus(a, touched), top: topSignal(a, today) })),
    [ws.accounts, touched, today],
  );

  const sourceKey = (a: AccountT) => (a.source === "integration" ? `integration:${a.sourceDetail ?? ""}` : a.source === "csv_import" ? "csv_import" : a.source);
  const statusSet = useMemo(() => new Set(f.statuses), [f.statuses]);
  const visibleStatus = (s: ProspectStatus) => (statusSet.size ? statusSet.has(s) : s !== "dismissed");

  const rows = useMemo(() => {
    const tiers = new Set(f.tiers);
    const signals = new Set(f.signals);
    const sources = new Set(f.sources);
    const answers = Object.entries(f.answers).filter(([id, keys]) => keys.length && colById.has(id));
    const out = all.filter(
      (r) =>
        visibleStatus(r.status) &&
        (!tiers.size || (isScored(r.a) && tiers.has(r.a.tier))) &&
        (!signals.size || r.a.signals.some((s) => signals.has(s.type) && (s.type === "sensitive" || signalDecay(s, today) > 0))) &&
        (!sources.size || sources.has(sourceKey(r.a))) &&
        answers.every(([id, keys]) => keys.includes(answerKey(colById.get(id)!, cells[id]?.[r.a.domain]))),
    );
    const sortKey = state.sort.key;
    const col = sortKey.startsWith("col:") ? colById.get(sortKey.slice(4)) : undefined;
    const cmp = isBuiltinSort(sortKey)
      ? BUILTIN_CMP[sortKey]
      : col
        ? (x: Row, y: Row) => compareCells(col, cells[col.id]?.[x.a.domain], cells[col.id]?.[y.a.domain], state.sort.dir) || BUILTIN_CMP.priority(x, y)
        : BUILTIN_CMP.priority;
    return out.sort(cmp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, f, state.sort, colById, cells, today, statusSet]);

  // Filter options with counts (over the non-dismissed set unless dismissed is being shown).
  const pool = useMemo(() => all.filter((r) => visibleStatus(r.status)), [all, statusSet]); // eslint-disable-line react-hooks/exhaustive-deps
  const poolDomains = useMemo(() => pool.map((r) => r.a.domain), [pool]);
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
  /** Filter chips for research columns: yes/no and pick-one columns shown here with an answer, and any column already filtered. */
  const answerFilters = useMemo(
    () =>
      columnsAll
        .filter((c) => (f.answers[c.id]?.length ?? 0) > 0 || (state.columns.includes(c.id) && (c.type === "yes_no" || c.type === "pick_one") && poolDomains.some((d) => cellState(cells[c.id]?.[d]) === "answered")))
        .map((c) => ({ c, options: answerOptions(c, cells[c.id], poolDomains) })),
    [columnsAll, f.answers, state.columns, poolDomains, cells],
  );

  const filtered = filterCount(f) > 0;
  const setFilters = (patch: Partial<ViewFilters>) => update((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  const setAnswerFilter = (id: string, keys: string[]) => update((s) => ({ ...s, filters: { ...s.filters, answers: { ...s.filters.answers, [id]: keys } } }));
  const clearFilters = () => update((s) => ({ ...s, filters: { tiers: [], signals: [], statuses: [], sources: [], answers: {} } }));

  const idx = cursor ? rows.findIndex((r) => r.a.domain === cursor) : -1;

  /* ─────────── Account actions ─────────── */

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
    const fdn = ws.foundation;
    if (!fdn || !["not_icp", "too_small", "too_big"].includes(reason)) return;
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
          : sharedTrait(same, fdn.icp.criteria);
    if (!text) {
      if (same.length - just.length >= 3) return; // asked when the third one landed
      toast(`That's ${same.length} dismissed as “${label}” this week.`, {
        description: "If they share something, name it under Not a fit and I'll stop suggesting companies like these.",
        duration: 10_000,
        action: { label: "Name what they share", onClick: () => router.push("/playbook#anti-icp") },
      });
      return;
    }
    const antiIcp = fdn.icp.antiIcp;
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
    tableActive.current = true;
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

  /* ─────────── Research column actions ─────────── */

  const runFor = (columnId: string) => jobs.filter((j) => j.columnId === columnId);
  const queued = useMemo(() => {
    const out = new Map<string, { active: Set<string>; waiting: Set<string> }>();
    for (const j of jobs) {
      const cur = out.get(j.columnId) ?? { active: new Set<string>(), waiting: new Set<string>() };
      for (const d of j.active) cur.active.add(d);
      for (const d of j.domains) cur.waiting.add(d);
      out.set(j.columnId, cur);
    }
    return out;
  }, [jobs]);
  const cellRun = (columnId: string, domain: string, cell: ColumnCell | undefined): CellRun => {
    const q = queued.get(columnId);
    if (!q) return null;
    if (q.active.has(domain)) return "running";
    return q.waiting.has(domain) && (!cell || cell.error) ? "queued" : null;
  };

  const ask = (column: ResearchColumn, domains: string[], force: boolean) => {
    const list = [...new Set(domains)].slice(0, LIMITS.domains);
    if (!list.length) return;
    void start("research_column", { columnId: column.id, domains: list, force }, { notify: list.length > 1 });
    if (domains.length > list.length) toast(`Asking the first ${list.length} of ${domains.length}`, { description: "One run asks up to 500 companies. Ask again for the rest when it's done." });
  };

  const openComposer = (el: Element | null, scope: "visible" | "selected", editing: ResearchColumn | null = null) => {
    // A hidden anchor (the header's + on a phone) measures as nothing: open from the top of the page instead.
    const measured = el?.getBoundingClientRect();
    const rect = measured && (measured.width || measured.height) ? measured : new DOMRect(window.innerWidth / 2, 120, 0, 0);
    composerAnchor.current = { getBoundingClientRect: () => rect };
    setComposer({ scope, editing });
  };

  const createColumn = async (column: ResearchColumn) => {
    // Made inside a saved view, the column joins that view (saved with it, whatever else is unsaved).
    const ops: Parameters<typeof apply>[0] = [{ type: "column.add", column }];
    if (active) ops.push({ type: "view.save", view: { ...active, columns: [...active.columns, column.id], updatedAt: nowISO() } });
    const ok = await apply(ops);
    if (ok && active && work?.key === active.id) setWork({ key: active.id, state: { ...work.state, columns: [...work.state.columns, column.id] } });
    return ok;
  };

  const updateColumn = async (column: ResearchColumn, patch: Pick<ResearchColumn, "question" | "type" | "options" | "instructions">) => {
    for (const j of runFor(column.id)) void stop(j.runId);
    return apply([{ type: "column.update", id: column.id, patch, at: nowISO() }]);
  };

  const deleteColumn = (column: ResearchColumn) => {
    if (!colData) return;
    for (const j of runFor(column.id)) void stop(j.runId);
    const snapshot = {
      column,
      index: colData.columns.findIndex((c) => c.id === column.id),
      cells: colData.cells[column.id] ?? {},
      hidden: colData.hidden.includes(column.id),
      views: colData.views.filter((v) => v.columns.includes(column.id)).map((v) => ({ id: v.id, index: v.columns.indexOf(column.id) })),
    };
    const answers = Object.values(snapshot.cells).filter((c) => !c.error).length;
    void apply([{ type: "column.delete", id: column.id }]);
    toast(`Deleted “${shortQuestion(column.question, 40)}”`, {
      description: answers ? `With its ${plural(answers, "answer")}.` : undefined,
      action: { label: "Undo", onClick: () => void apply([{ type: "column.restore", ...snapshot }]) },
    });
  };

  const setColumnShown = (id: string, show: boolean) => {
    if (active) update((s) => ({ ...s, columns: show ? [...s.columns.filter((x) => x !== id), id] : s.columns.filter((x) => x !== id) }));
    else void apply([{ type: "column.hide", id, hidden: !show }]);
  };

  const moveColumn = (id: string, by: -1 | 1) => {
    if (active) return update((s) => ({ ...s, columns: nudge(s.columns, id, by) }));
    const i = state.columns.indexOf(id);
    const neighbor = state.columns[i + by];
    if (i === -1 || !neighbor) return;
    void apply([{ type: "column.move", id, to: columnsAll.findIndex((c) => c.id === neighbor) }]);
  };

  /* ─────────── View actions ─────────── */

  const selectView = (id: string | null) => {
    setWork(null);
    setSaveOpen(false);
    setViewParam(id);
  };

  const saveView = () => {
    if (!active) return setSaveOpen(true);
    void apply([{ type: "view.save", view: { ...active, filters: state.filters, sort: state.sort, columns: state.columns, updatedAt: nowISO() } }]).then((ok) => ok && setWork(null));
    toast(`Saved “${active.name}”`);
  };

  const saveAsView = (name: string) => {
    const view: SavedView = { id: newId("view"), name, filters: state.filters, sort: state.sort, columns: state.columns, createdAt: nowISO() };
    void apply([{ type: "view.save", view }]).then((ok) => {
      if (!ok) return;
      setWork(null);
      setViewParam(view.id);
    });
  };

  const deleteView = (view: SavedView) => {
    const index = views.findIndex((v) => v.id === view.id);
    if (active?.id === view.id) selectView(null);
    void apply([{ type: "view.delete", id: view.id }]);
    toast(`Deleted the view “${view.name}”`, { action: { label: "Undo", onClick: () => void apply([{ type: "view.restore", view, index }]).then((ok) => ok && setViewParam(view.id)) } });
  };

  /* ─────────── Bulk ─────────── */

  const selectedRows = [...rows.filter((r) => selected.has(r.a.domain)), ...all.filter((r) => selected.has(r.a.domain) && !rows.includes(r))];
  const trackedSel = selectedRows.filter((r) => r.status !== "dismissed" && isTracked(r.a)).map((r) => r.a.domain);
  const untrackedSel = selectedRows.filter((r) => !(r.status !== "dismissed" && isTracked(r.a))).map((r) => r.a.domain);
  const missingSel = Object.fromEntries(columnsAll.map((c) => [c.id, selectedRows.filter((r) => { const s = cellState(cells[c.id]?.[r.a.domain]); return s === "empty" || s === "failed"; }).length]));

  const exportSelected = () => {
    const out = selectedRows.map((r) => ({
      name: r.a.name,
      domain: r.a.domain,
      tier: isScored(r.a) ? r.a.tier : "",
      fit: isScored(r.a) ? r.a.fitScore : null,
      status: PROSPECT_STATUS_LABEL[r.status],
      whyNow: r.top?.headline ?? "",
      whyNowDate: r.top?.date ?? "",
      whyNowUrl: r.top?.url ?? "",
      warm: r.a.warmPathCount,
      openRoles: r.a.enrichment ? r.a.enrichment.openRoles : null,
    }));
    downloadCsv(exportCsv(out, shownCols, cells), `inroad-companies-${today}.csv`);
    toast(`Exported ${plural(out.length, "company", "companies")}`, { description: shownCols.length ? `With ${plural(shownCols.length, "research column")}, their confidence and sources.` : undefined });
  };

  /* ─────────── Keyboard: J/K move · Enter open · T track · X dismiss · ⌘A select · Esc clear · ⌘S save view ─────────── */

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      tableActive.current = !!tableRef.current?.contains(e.target as Node);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  useEffect(() => {
    if (sheetOpen || dismissing || composer) return;
    let lastG = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || inOverlay(e.target)) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        if (k === "a" && rows.length && (tableActive.current || kbd || selected.size > 0)) {
          e.preventDefault();
          setSelected(new Set(rows.map((r) => r.a.domain)));
        } else if (k === "s" && dirty) {
          e.preventDefault();
          saveView();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && selected.size) {
        e.preventDefault();
        setSelected(new Set());
        return;
      }
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
        tableActive.current = true;
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
  const n = shownCols.length;
  const sortLabel = isBuiltinSort(state.sort.key)
    ? BUILTIN_SORT_LABEL[state.sort.key]
    : (() => {
        const c = colById.get(state.sort.key.slice(4));
        return c ? shortQuestion(c.question, 22) : BUILTIN_SORT_LABEL.priority;
      })();
  const composerRows: ComposerRow[] = (composer?.scope === "selected" ? selectedRows : rows).map((r) => ({ domain: r.a.domain, name: r.a.name }));
  const visibleDomains = rows.map((r) => r.a.domain);
  const statusLabel = (v: string) => PROSPECT_STATUS_LABEL[v as ProspectStatus] ?? v;
  const signalLabel = (v: string) => SIGNAL_LABEL[v as SignalType] ?? v;

  return (
    <div className="pb-24">
      <ViewTabs
        views={views}
        activeId={active?.id ?? null}
        dirty={dirty}
        suggest={suggestName(state, columnsAll, { status: statusLabel, signal: signalLabel })}
        saveOpen={saveOpen}
        onSaveOpenChange={setSaveOpen}
        onSelect={selectView}
        onSave={saveView}
        onSaveAs={saveAsView}
        onDiscard={() => setWork(null)}
        onRename={(id, name) => {
          const v = views.find((x) => x.id === id);
          if (v) void apply([{ type: "view.save", view: { ...v, name, updatedAt: nowISO() } }]);
        }}
        onDelete={(id) => {
          const v = views.find((x) => x.id === id);
          if (v) deleteView(v);
        }}
      />

      {/* Toolbar */}
      <div className="-mx-1 flex flex-wrap items-center gap-2 px-1 py-1">
        <FilterMenu label="Tier" options={tierOptions} value={new Set(f.tiers as AccountT["tier"][])} onChange={(next) => setFilters({ tiers: [...next] })} />
        <FilterMenu label="Signal" options={signalOptions} value={new Set(f.signals as SignalType[])} onChange={(next) => setFilters({ signals: [...next] })} />
        <FilterMenu label="Status" options={statusOptions} value={new Set(f.statuses as ProspectStatus[])} onChange={(next) => setFilters({ statuses: [...next] })} />
        <FilterMenu label="Source" options={sourceOptions} value={new Set(f.sources)} onChange={(next) => setFilters({ sources: [...next] })} />
        {answerFilters.map(({ c, options }) => (
          <FilterMenu key={c.id} label={shortQuestion(c.question, 26)} options={options} value={new Set(f.answers[c.id] ?? [])} onChange={(next) => setAnswerFilter(c.id, [...next])} />
        ))}
        {filtered && (
          <button onClick={clearFilters} className="h-7 shrink-0 rounded-sm px-2 text-[12.5px] text-fg-3 transition-colors hover:text-fg">
            Clear
          </button>
        )}
        <span className="flex-1" />
        <span className="shrink-0 font-mono text-[12px] tnum text-fg-3">{rows.length}</span>
        {columnsAll.length > 0 && (
          <Menu
            trigger={
              <button className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-bg-subtle hover:text-fg">
                <Columns3 className="size-3.5" />
                <span className="hidden sm:inline">Columns</span>
                <span className="font-mono text-[12px] tnum text-fg-3">
                  {n}/{columnsAll.length}
                </span>
              </button>
            }
          >
            <MenuLabel>Research columns {active ? "in this view" : "shown"}</MenuLabel>
            {columnsAll.map((c) => (
              <MenuCheckItem key={c.id} checked={state.columns.includes(c.id)} onCheckedChange={(on) => setColumnShown(c.id, on)}>
                <span className="block max-w-64 truncate">{shortQuestion(c.question, 48)}</span>
              </MenuCheckItem>
            ))}
            <MenuSeparator />
            <MenuItem icon={<Plus className="size-3.5" />} onSelect={() => openComposer(document.getElementById("add-column"), "visible")}>
              New column…
            </MenuItem>
          </Menu>
        )}
        <Menu
          trigger={
            <button className="inline-flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-sm px-2 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-bg-subtle hover:text-fg">
              <ArrowUpDown className="size-3.5 shrink-0" />
              <span className="truncate">{sortLabel}</span>
            </button>
          }
        >
          <MenuLabel>Sort by</MenuLabel>
          {BUILTIN_SORTS.map((k) => (
            <MenuItem key={k} onSelect={() => update((s) => ({ ...s, sort: { key: k, dir: "desc" } }))} icon={state.sort.key === k ? <Check className="size-3.5" /> : <span />}>
              {BUILTIN_SORT_LABEL[k]}
            </MenuItem>
          ))}
          {shownCols.length > 0 && <MenuSeparator />}
          {shownCols.map((c) => {
            const first = sortChoices(c.type)[0];
            return (
              <MenuItem key={c.id} onSelect={() => update((s) => ({ ...s, sort: { key: `col:${c.id}`, dir: first.dir } }))} icon={state.sort.key === `col:${c.id}` ? <Check className="size-3.5" /> : <span />} hint={first.label}>
                <span className="block max-w-48 truncate">{shortQuestion(c.question, 32)}</span>
              </MenuItem>
            );
          })}
        </Menu>
        <Button
          size="sm"
          variant="ghost"
          icon={<Sparkles className="size-3.5 text-accent-text" />}
          onClick={(e) => openComposer(e.currentTarget, "visible")}
          className={cn("h-7 px-2 text-[12.5px]", columnsAll.length > 0 && "md:hidden")}
        >
          Ask every company
        </Button>
      </div>

      {/* Table: header and rows scroll sideways together; the company stays pinned. */}
      <div ref={tableRef} className="mt-4">
        <div
          data-scrolled={scrolled || undefined}
          onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
          className="group/table overflow-x-auto overscroll-x-contain rounded-xl"
        >
          <div style={gridVars(n)} className={cn(n > 0 && "md:min-w-[var(--minw-md)] lg:min-w-[var(--minw-lg)]")}>
            {/* Column labels */}
            <div className={cn("hidden h-10 items-center gap-3 border-b border-border px-3 text-[12px] font-medium text-fg-3 md:grid", GRID)}>
              <div className={cn("flex min-w-0 items-center gap-3 md:bg-bg-subtle", PIN)}>
                <button
                  role="checkbox"
                  aria-checked={allSelected}
                  aria-label="Select all"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.a.domain)))}
                  className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-[4px] ring-1 ring-border-strong transition-colors", allSelected && "bg-primary ring-primary")}
                >
                  {allSelected && <Check className="size-2.5 text-primary-fg" strokeWidth={3} />}
                </button>
                <span>Company</span>
              </div>
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
              {shownCols.map((c, i) => {
                const missing = visibleDomains.filter((d) => {
                  const s = cellState(cells[c.id]?.[d]);
                  return (s === "empty" || s === "failed") && !queued.get(c.id)?.waiting.has(d);
                });
                const measured = Object.values(cells[c.id] ?? {});
                const per = measured.length ? estimateRest(measured, 1) : null;
                const priced = per && !per.unpriced;
                return (
                  <div key={c.id} id={`colhead-${c.id}`} className="flex min-w-0 items-center">
                    <ColumnHeader
                      column={c}
                      sort={state.sort}
                      onSort={(dir) => update((s) => ({ ...s, sort: { key: `col:${c.id}`, dir } }))}
                      options={answerOptions(c, cells[c.id], poolDomains)}
                      filter={f.answers[c.id] ?? []}
                      onFilter={(keys) => setAnswerFilter(c.id, keys)}
                      jobs={runFor(c.id)}
                      onStop={() => runFor(c.id).forEach((j) => void stop(j.runId))}
                      empty={missing.length}
                      visible={visibleDomains.length}
                      fillUsd={priced ? per.restUsd * missing.length : null}
                      againUsd={priced ? per.restUsd * visibleDomains.length : null}
                      onFill={() => ask(c, missing, false)}
                      onAskAll={() => ask(c, visibleDomains, true)}
                      onEdit={() => openComposer(document.getElementById(`colhead-${c.id}`), "visible", c)}
                      onMove={(by) => moveColumn(c.id, by)}
                      canMove={{ left: i > 0, right: i < shownCols.length - 1 }}
                      onHide={() => setColumnShown(c.id, false)}
                      onDelete={() => deleteColumn(c)}
                    />
                  </div>
                );
              })}
              <Tooltip content="Ask every company a question">
                <button
                  id="add-column"
                  aria-label="Add a research column"
                  onClick={(e) => openComposer(e.currentTarget, "visible")}
                  className="flex size-7 items-center justify-center rounded-sm text-fg-3 transition-colors hover:bg-bg hover:text-fg focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <Plus className="size-4" />
                </button>
              </Tooltip>
            </div>

            {rows.length === 0 ? (
              <EmptyState title="Nothing matches these filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
            ) : (
              <ul onMouseMove={() => kbd && setKbd(false)} aria-label="Prospects" className="divide-y divide-border rounded-b-xl bg-surface/40">
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
                    columns={shownCols}
                    cells={cells}
                    cellRun={cellRun}
                    onAsk={(c, force) => ask(c, [r.a.domain], force)}
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
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <p className="mt-4 hidden flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3 md:pointer-fine:flex">
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
          <span className="flex items-center gap-1">
            <Kbd>⌘A</Kbd> select all
          </span>
          <span className="flex items-center gap-1">
            <Kbd>⇧</Kbd> click for a range
          </span>
        </p>
      )}

      <BulkBar
        count={selected.size}
        tracked={trackedSel.length}
        untracked={untrackedSel.length}
        columns={columnsAll}
        missing={missingSel}
        onTrack={() => {
          track(untrackedSel, true);
          setSelected(new Set());
        }}
        onUntrack={() => {
          track(trackedSel, false);
          setSelected(new Set());
        }}
        onDismiss={(el) => openDismiss([...selected], el)}
        onAsk={(c, onlyMissing) => {
          const domains = selectedRows.map((r) => r.a.domain).filter((d) => !onlyMissing || ["empty", "failed"].includes(cellState(cells[c.id]?.[d])));
          if (!state.columns.includes(c.id)) setColumnShown(c.id, true);
          ask(c, domains, !onlyMissing);
        }}
        onNewColumn={(el) => openComposer(el, "selected")}
        onExport={exportSelected}
        onClear={() => setSelected(new Set())}
      />

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

      <ColumnComposer
        open={!!composer}
        onOpenChange={(o) => !o && setComposer(null)}
        anchor={composerAnchor}
        rows={composerRows}
        scope={composer?.scope ?? "visible"}
        data={colData}
        editing={composer?.editing}
        onCreate={createColumn}
        onUpdate={updateColumn}
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
  columns,
  cells,
  cellRun,
  onAsk,
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
  columns: ResearchColumn[];
  cells: Record<string, Record<string, ColumnCell>>;
  cellRun: (columnId: string, domain: string, cell: ColumnCell | undefined) => CellRun;
  onAsk: (column: ResearchColumn, force: boolean) => void;
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
  // On a phone the research columns become one line under the company: the first two answers.
  const answered = columns
    .map((c) => ({ c, cell: cells[c.id]?.[a.domain] }))
    .filter((x) => cellState(x.cell) === "answered")
    .slice(0, 2);

  const why = top ? (
    <span className="flex min-w-0 items-center gap-1.5">
      {Icon && <Icon className="size-3.5 shrink-0 text-fg-3" aria-label={SIGNAL_LABEL[top.type]} />}
      <span className="min-w-0 flex-1 truncate text-fg-2" title={top.headline}>
        {top.headline}
      </span>
      <SourceChip
        url={ev?.url ?? top.url}
        publishedAt={ev?.publishedAt ?? top.date}
        quote={ev?.quote}
        claim={ev?.claim}
        confidence={ev?.confidence}
        className="relative z-[1] max-w-[7.5rem] shrink-0"
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
      onClick={(e) => {
        // The whole row opens the sheet, except its own controls and anything in a popover opened from it.
        if ((e.target as HTMLElement).closest("button,a,input,[role=checkbox],[data-cell],[data-radix-popper-content-wrapper]")) return;
        onOpen();
      }}
      className={cn(
        "group relative flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[13px] md:grid md:min-h-14 md:py-2.5",
        GRID,
        "transition-colors duration-100 hover:bg-bg-subtle",
        focused && "bg-bg-subtle shadow-[inset_2px_0_0_var(--fg-3)]",
        selected && "bg-bg-subtle",
        dismissed && "opacity-60",
      )}
    >
      {/* Select · company. Pinned on the left when the table scrolls sideways. */}
      <div className={cn("flex min-w-0 flex-1 items-center gap-3 md:flex-none", PIN, focused || selected ? "md:bg-bg-subtle" : PIN_BG)}>
        <button
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${a.name}`}
          onClick={onSelect}
          className={cn(
            "relative z-[1] hidden size-3.5 shrink-0 items-center justify-center rounded-[4px] ring-1 ring-border-strong transition-[opacity,background-color] duration-100 md:flex",
            selected ? "bg-primary opacity-100 ring-primary" : selecting ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          {selected && <Check className="size-2.5 text-primary-fg" strokeWidth={3} />}
        </button>
        <Tooltip content={`${a.domain} · found via ${sourceText(a)}${a.sourceDetail && a.source !== "integration" && a.source !== "csv_import" ? ` · ${a.sourceDetail}` : ""}`}>
          <span className="relative z-[1] flex shrink-0">
            <Favicon domain={a.domain} name={a.name} size={20} />
          </span>
        </Tooltip>
        <div className="min-w-0 flex-1">
          {/* The company identity stays readable beside its research columns. */}
          <button onClick={onOpen} className="block min-w-0 max-w-full truncate text-left font-medium text-fg outline-none focus-visible:underline">
            {a.name}
          </button>
          <span className="mt-0.5 hidden truncate text-[12px] leading-4 text-fg-3 md:block">{a.domain}</span>
          {/* Phone: why-now under the name, with the age instead of the full source chip */}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] md:hidden">
            {top ? (
              <>
                {Icon && <Icon className="size-3.5 shrink-0 text-fg-3" />}
                <span className="min-w-0 truncate text-fg-2">{top.headline}</span>
                <span className="shrink-0 font-mono text-[12px] text-fg-3">{ageLabel(top.date, today)}</span>
              </>
            ) : (
              why
            )}
          </div>
          {answered.length > 0 && (
            <p className="mt-0.5 flex min-w-0 gap-2.5 text-[12px] text-fg-3 md:hidden">
              {answered.map(({ c, cell }) => (
                <span key={c.id} className="min-w-0 truncate">
                  {shortQuestion(c.question, 22)}: <span className="text-fg-2">{cellLabel(cell)}</span>
                </span>
              ))}
            </p>
          )}
        </div>
      </div>

      {/* Tier */}
      <Tooltip content={scored ? TIER_HINT[a.tier] : "Not scored against your ICP yet"}>
        <span
          className={cn(
            "relative z-[1] hidden size-5 cursor-default items-center justify-center rounded-xs font-mono text-[12px] ring-1 ring-inset md:inline-flex",
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
        <span className="relative z-[1] hidden cursor-default text-right font-mono text-[12px] tnum text-fg-2 md:block">{scored ? a.fitScore : "–"}</span>
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

      {/* Research columns */}
      {columns.map((c) => {
        const cell = cells[c.id]?.[a.domain];
        return (
          <div key={c.id} className="hidden min-w-0 md:flex">
            <ResearchCell column={c} cell={cell} run={cellRun(c.id, a.domain, cell)} company={a.name} onAsk={(force) => onAsk(c, force)} />
          </div>
        );
      })}
    </motion.li>
  );
}
