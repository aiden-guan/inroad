"use client";

import * as RP from "@radix-ui/react-popover";
import { Circle, Columns3, Ellipsis, Rows3 } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { money, plural, shortDate } from "@/lib/client/format";
import { nowISO } from "@/lib/domain/ids";
import { LOSS_REASONS, type Criterion } from "@/lib/deals/rules";
import { OPEN_STAGES, STAGE_LABELS, type Deal, type LossReason, type Stage, type Workspace } from "@/lib/domain/types";
import { championOf, daysInStage, dealValue, exitCriteria, isForward, lastActivityDays, nextStepState, stageEnteredAt } from "./lib";

export type ClosedView = "won" | "lost" | "nurture";

type Pending = { id: string; to: Stage; missing: Criterion[] } | { id: string; to: "lost"; missing: [] };
type Measurable = { getBoundingClientRect: () => DOMRect };

export function Talking({
  ws,
  today,
  layout,
  closed,
  onLayout,
  onClosed,
  onOpen,
  onProspects,
}: {
  ws: Workspace;
  today: string;
  layout: "board" | "table";
  closed: ClosedView | null;
  onLayout: (l: "board" | "table") => void;
  onClosed: (c: ClosedView | null) => void;
  onOpen: (domain: string) => void;
  onProspects: () => void;
}) {
  const { dispatch } = useWorkspace();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const anchor = useRef<Measurable>({ getBoundingClientRect: () => new DOMRect() });

  const deals = useMemo(() => Object.values(ws.deals), [ws.deals]);
  const open = useMemo(
    () =>
      deals
        .filter((d) => OPEN_STAGES.includes(d.stage))
        .sort((a, b) => {
          // Risk first inside a column: overdue, then missing next step, then by next-step date.
          const rank = (d: Deal) => ({ overdue: 0, missing: 1, ok: 2 })[nextStepState(d, today)];
          return rank(a) - rank(b) || (a.nextStep?.date ?? "9999").localeCompare(b.nextStep?.date ?? "9999");
        }),
    [deals, today],
  );
  const counts = { won: deals.filter((d) => d.stage === "won").length, lost: deals.filter((d) => d.stage === "lost").length, nurture: deals.filter((d) => d.stage === "nurture").length };

  const qualified = open.filter((d) => d.stage !== "talking");
  const quoted = qualified.filter((d) => (d.priceQuotes ?? []).length > 0 || d.amountUsd);
  const qualifiedUsd = quoted.reduce((n, d) => n + (dealValue(d) ?? 0), 0);
  const missing = open.filter((d) => nextStepState(d, today) === "missing").length;
  const overdue = open.filter((d) => nextStepState(d, today) === "overdue").length;

  const nameOf = (d: Deal) => ws.accounts[d.accountDomain]?.name || d.name || d.accountDomain;

  const commit = (id: string, to: Stage, extra: { lossReason?: LossReason } = {}) => {
    const d = ws.deals[id];
    if (!d || d.stage === to) return;
    const from = d.stage;
    void dispatch({ type: "deal.setStage", id, stage: to, at: nowISO(), ...extra });
    toast(`Moved ${nameOf(d)} to ${STAGE_LABELS[to]}`, {
      action: { label: "Undo", onClick: () => void dispatch({ type: "deal.setStage", id, stage: from, at: nowISO() }) },
    });
  };

  /** Founder action: check the stage's usual exit criteria first, then move (or ask why, for lost). */
  const requestMove = (id: string, to: Stage, anchorEl: Element | null) => {
    const d = ws.deals[id];
    if (!d || d.stage === to) return;
    const rect = anchorEl?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, 160, 0, 0);
    anchor.current = { getBoundingClientRect: () => rect };
    if (to === "lost") {
      setPending({ id, to: "lost", missing: [] });
      return;
    }
    const gaps = isForward(d.stage, to) ? exitCriteria(d, to, today) : [];
    if (gaps.length) setPending({ id, to, missing: gaps });
    else commit(id, to);
  };

  const onDrop = (stage: Stage) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/x-inroad-deal") || dragging;
    setOver(null);
    setDragging(null);
    if (id) requestMove(id, stage, e.currentTarget.querySelector("header") ?? e.currentTarget);
  };

  const moveMenu = (d: Deal, className?: string) => (
    <MoveMenu
      deal={d}
      className={className}
      onMove={(to, el) => (to === "nurture" ? commit(d.id, "nurture") : requestMove(d.id, to, el))}
    />
  );

  /* ─────────── Header: metrics · closed filter · layout ─────────── */

  const header = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-2">
        <span>
          {quoted.length ? (
            <>
              <span className="font-mono tnum text-fg">{money(qualifiedUsd)}</span> qualified
            </>
          ) : (
            <>
              <span className="font-mono tnum text-fg">{qualified.length}</span> qualified
            </>
          )}
        </span>
        <Tooltip content="Every deal needs a dated next step the buyer agreed to.">
          <span className={cn("cursor-default", missing ? "text-danger" : "text-fg-3")}>
            <span className="font-mono tnum">{missing}</span> without a dated next step
          </span>
        </Tooltip>
        {overdue > 0 && (
          <span className="text-danger">
            <span className="font-mono tnum">{overdue}</span> overdue
          </span>
        )}
      </p>
      <span className="flex-1" />
      <div className="flex items-center gap-0.5 text-[12.5px]" role="tablist" aria-label="Show">
        {([null, "won", "lost", "nurture"] as const).map((c) => (
          <button
            key={c ?? "open"}
            role="tab"
            aria-selected={closed === c}
            onClick={() => onClosed(c)}
            className={cn(
              "h-7 rounded-sm px-2 font-medium transition-colors duration-150",
              closed === c ? "bg-bg-subtle text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {c ? STAGE_LABELS[c] : "Open"}
            {c && <span className="ml-1 font-mono text-[11px] tnum text-fg-3">{counts[c]}</span>}
          </button>
        ))}
      </div>
      {!closed && (
        <div className="flex items-center rounded-sm ring-1 ring-border">
          <Tooltip content="Board">
            <button
              aria-label="Board"
              aria-pressed={layout === "board"}
              onClick={() => onLayout("board")}
              className={cn("flex size-7 items-center justify-center rounded-l-sm transition-colors", layout === "board" ? "bg-bg-subtle text-fg" : "text-fg-3 hover:text-fg")}
            >
              <Columns3 className="size-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Table">
            <button
              aria-label="Table"
              aria-pressed={layout === "table"}
              onClick={() => onLayout("table")}
              className={cn("flex size-7 items-center justify-center rounded-r-sm transition-colors", layout === "table" ? "bg-bg-subtle text-fg" : "text-fg-3 hover:text-fg")}
            >
              <Rows3 className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );

  /* ─────────── Bodies ─────────── */

  let body: ReactNode;
  if (closed) {
    const rows = deals.filter((d) => d.stage === closed).sort((a, b) => stageEnteredAt(b).localeCompare(stageEnteredAt(a)));
    body = rows.length ? (
      <DealTable
        rows={rows}
        ws={ws}
        today={today}
        onOpen={onOpen}
        columns={[
          { label: closed === "nurture" ? "Since" : "Closed", cell: (d) => <span className="font-mono text-[12px] text-fg-3">{shortDate(stageEnteredAt(d))}</span> },
          closed === "lost"
            ? { label: "Reason", cell: (d) => <span className="truncate text-fg-2">{LOSS_REASONS.find((r) => r.value === d.lossReason)?.label ?? "No reason logged"}</span> }
            : closed === "nurture"
              ? { label: "Check back", cell: (d) => <span className="font-mono text-[12px] text-fg-2">{d.nurtureUntil ? shortDate(d.nurtureUntil) : "—"}</span> }
              : { label: "Value", cell: (d) => <span className="font-mono text-[12px] text-fg-2">{dealValue(d) ? money(dealValue(d)) : "—"}</span> },
        ]}
        menu={(d) => moveMenu(d)}
      />
    ) : (
      <EmptyState title={closed === "won" ? "No wins yet." : closed === "lost" ? "Nothing lost yet." : "Nothing in nurture."} body={closed === "lost" ? "Disqualifying early is a good outcome. Log the reason when you do." : undefined} />
    );
  } else if (!open.length) {
    body = (
      <EmptyState
        title="No conversations yet."
        body="A deal starts at the first real conversation. Track a prospect and reach out, or log a call from a company's sheet."
        action={<Button onClick={onProspects}>Go to prospects</Button>}
      />
    );
  } else if (layout === "table") {
    body = (
      <DealTable
        rows={open}
        ws={ws}
        today={today}
        onOpen={onOpen}
        columns={[
          { label: "Stage", cell: (d) => <span className="text-fg-2">{STAGE_LABELS[d.stage]}</span> },
          { label: "In stage", cell: (d) => <span className="font-mono text-[12px] tnum text-fg-3">{daysInStage(d, today)}d</span> },
        ]}
        menu={(d) => moveMenu(d)}
      />
    );
  } else {
    body = (
      <div className="-mx-6 snap-x snap-mandatory scroll-px-6 overflow-x-auto px-6 pb-2 md:-mx-10 md:snap-none md:px-10 scrollbar-none">
        <div className="grid min-w-[880px] grid-cols-4 gap-3">
          {OPEN_STAGES.map((stage) => {
            const cards = open.filter((d) => d.stage === stage);
            const value = cards.reduce((n, d) => n + (dealValue(d) ?? 0), 0);
            return (
              <section
                key={stage}
                id={`col-${stage}`}
                aria-label={`${STAGE_LABELS[stage]} · ${plural(cards.length, "deal")}`}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (over !== stage) setOver(stage);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === stage ? null : o));
                }}
                onDrop={onDrop(stage)}
                className={cn(
                  "flex min-h-[360px] snap-start flex-col rounded-lg bg-sunken/70 p-1.5 ring-1 ring-inset ring-transparent transition-[background-color,box-shadow] duration-150",
                  over === stage && dragging && ws.deals[dragging]?.stage !== stage && "bg-bg-subtle ring-border-strong",
                )}
              >
                <header className="flex h-8 items-center justify-between px-2">
                  <span className="text-[12px] font-medium text-fg-2">{STAGE_LABELS[stage]}</span>
                  <span className="font-mono text-[11px] tnum text-fg-3">
                    {cards.length}
                    {value > 0 && ` · ${money(value)}`}
                  </span>
                </header>
                <div className="flex flex-col gap-1.5">
                  {cards.map((d) => (
                    <DealCard
                      key={d.id}
                      deal={d}
                      ws={ws}
                      today={today}
                      name={nameOf(d)}
                      dragging={dragging === d.id}
                      onOpen={() => onOpen(d.accountDomain)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/x-inroad-deal", d.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(d.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      menu={moveMenu(d, "relative z-[1] transition-opacity duration-100 focus-visible:opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100")}
                    />
                  ))}
                  {!cards.length && <p className="px-2 py-8 text-center text-[12px] text-fg-4">{dragging ? "Drop here" : "Nothing here"}</p>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  const pendingDeal = pending ? ws.deals[pending.id] : undefined;

  return (
    <div className="space-y-4 pb-16">
      {header}
      {body}
      <RP.Root open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <RP.Anchor virtualRef={anchor} />
        <RP.Portal>
          <RP.Content
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            className="z-[70] w-72 origin-[var(--radix-popover-content-transform-origin)] rounded-lg bg-surface-raised p-3 shadow-lg ring-1 ring-border outline-none data-[state=closed]:animate-[pop-out_100ms_var(--ease-in-quad)] data-[state=open]:animate-[pop-in_160ms_var(--ease-out)]"
          >
            {pending && pendingDeal && pending.to === "lost" ? (
              <div>
                <p className="text-[13px] font-medium text-fg">Why did {nameOf(pendingDeal)} close lost?</p>
                <p className="mt-0.5 text-[12px] text-fg-3">The reason feeds your Friday review.</p>
                <div className="-mx-1 mt-2">
                  {LOSS_REASONS.map((r, i) => (
                    <button
                      key={r.value}
                      autoFocus={i === 0}
                      onClick={() => {
                        commit(pending.id, "lost", { lossReason: r.value });
                        setPending(null);
                      }}
                      className="flex h-8 w-full items-center rounded-sm px-2 text-left text-[13px] text-fg outline-none transition-colors duration-100 hover:bg-bg-subtle focus-visible:bg-bg-subtle"
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : pending && pendingDeal ? (
              <div>
                <p className="text-[13px] font-medium text-fg">
                  Move {nameOf(pendingDeal)} to {STAGE_LABELS[pending.to]}?
                </p>
                <p className="mt-0.5 text-[12px] text-fg-3">Usually true before {STAGE_LABELS[pending.to]}, still missing:</p>
                <ul className="mt-2.5 space-y-1.5">
                  {pending.missing.slice(0, 6).map((c) => (
                    <li key={c.key} className="flex items-start gap-2 text-[12.5px] leading-[17px] text-fg-2">
                      <Circle className="mt-[3px] size-2.5 shrink-0 text-warning" strokeWidth={2.5} />
                      {c.label}
                    </li>
                  ))}
                </ul>
                <div className="mt-3.5 flex items-center justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    autoFocus
                    onClick={() => {
                      commit(pending.id, pending.to);
                      setPending(null);
                    }}
                  >
                    Move anyway
                  </Button>
                </div>
              </div>
            ) : null}
          </RP.Content>
        </RP.Portal>
      </RP.Root>
    </div>
  );
}

/* ─────────────────────────── Card ─────────────────────────── */

function NextStep({ deal, today, compact }: { deal: Deal; today: string; compact?: boolean }) {
  const state = nextStepState(deal, today);
  if (state === "missing") {
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-warning">
        <span className="size-1.5 shrink-0 rounded-full bg-current" />
        No dated next step
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 text-[12px]", state === "overdue" ? "text-danger" : "text-fg-2")}>
      {state === "overdue" && <span className="size-1.5 shrink-0 rounded-full bg-current" />}
      <span className={cn("min-w-0", compact ? "truncate" : "line-clamp-2")}>{deal.nextStep!.what}</span>
      <span className={cn("shrink-0 font-mono text-[11px]", state === "overdue" ? "text-danger" : "text-fg-3")}>
        {state === "overdue" ? "was " : ""}
        {shortDate(deal.nextStep!.date)}
      </span>
    </span>
  );
}

function ChampionDot({ deal, ws }: { deal: Deal; ws: Workspace }) {
  const c = championOf(deal, ws);
  const label = c.status === "none" ? "No champion yet" : `Champion: ${c.name ?? "named"} (${c.status === "tested" ? "tested" : c.status === "coach" ? "coach" : "untested"})`;
  return (
    <Tooltip content={label}>
      <span className="relative z-[1] flex size-3 cursor-default items-center justify-center" aria-label={label}>
        <span
          className={cn(
            "size-2 rounded-full",
            c.status === "tested" ? "bg-fg" : c.status === "none" ? "ring-1 ring-inset ring-border-strong" : "ring-[1.5px] ring-inset ring-fg-2",
          )}
        />
      </span>
    </Tooltip>
  );
}

function DealCard({
  deal,
  ws,
  today,
  name,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  menu,
}: {
  deal: Deal;
  ws: Workspace;
  today: string;
  name: string;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  menu: ReactNode;
}) {
  const days = daysInStage(deal, today);
  const value = dealValue(deal);
  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative cursor-grab rounded-md bg-surface p-2.5 shadow-xs ring-1 ring-border transition-[box-shadow,opacity] duration-150 hover:ring-border-strong active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-center gap-2">
        <Favicon domain={deal.accountDomain} name={name} size={16} />
        <button onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-fg outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline">
          {name}
        </button>
        {menu}
      </div>
      <div className="mt-1.5">
        <NextStep deal={deal} today={today} />
      </div>
      <div className="mt-2 flex items-center gap-2.5 text-[11.5px] text-fg-3">
        <ChampionDot deal={deal} ws={ws} />
        <span>{plural(deal.contacts.length, "contact")}</span>
        <Tooltip content={`In ${STAGE_LABELS[deal.stage]} since ${shortDate(stageEnteredAt(deal))}`}>
          <span className="relative z-[1] cursor-default font-mono tnum">{days}d</span>
        </Tooltip>
        {value ? <span className="ml-auto font-mono tnum text-fg-2">{money(value)}</span> : null}
      </div>
    </article>
  );
}

function MoveMenu({ deal, onMove, className }: { deal: Deal; onMove: (to: Stage, el: Element | null) => void; className?: string }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const targets: Stage[] = (["talking", "qualified", "pilot", "proposal"] as Stage[]).filter((s) => s !== deal.stage);
  return (
    <Menu
      trigger={
        <button ref={trigger} aria-label="Move deal" className={cn("flex size-6 items-center justify-center rounded-xs text-fg-3 hover:bg-bg-subtle hover:text-fg", className)}>
          <Ellipsis className="size-3.5" />
        </button>
      }
    >
      <MenuLabel>Move to</MenuLabel>
      {targets.map((s) => (
        <MenuItem key={s} onSelect={() => onMove(s, trigger.current)}>
          {STAGE_LABELS[s]}
        </MenuItem>
      ))}
      <MenuSeparator />
      {deal.stage !== "won" && <MenuItem onSelect={() => onMove("won", trigger.current)}>Won</MenuItem>}
      {deal.stage !== "lost" && <MenuItem onSelect={() => onMove("lost", trigger.current)}>Lost…</MenuItem>}
      {deal.stage !== "nurture" && (
        <MenuItem onSelect={() => onMove("nurture", trigger.current)} hint="60 days">
          Nurture
        </MenuItem>
      )}
    </Menu>
  );
}

/* ─────────────────────────── Table ─────────────────────────── */

function DealTable({
  rows,
  ws,
  today,
  onOpen,
  columns,
  menu,
}: {
  rows: Deal[];
  ws: Workspace;
  today: string;
  onOpen: (domain: string) => void;
  columns: { label: string; cell: (d: Deal) => ReactNode }[];
  menu: (d: Deal) => ReactNode;
}) {
  const grid = "md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_88px_76px_64px_28px] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_88px_76px_64px_84px_28px]";
  return (
    <div>
      <div className={cn("hidden h-8 items-center gap-3 border-b border-border px-3 text-[11px] font-medium text-fg-3 md:grid", grid)}>
        <span>Company</span>
        <span>Next step</span>
        {columns.map((c) => (
          <span key={c.label}>{c.label}</span>
        ))}
        <span>Contacts</span>
        <span className="hidden lg:block">Last touch</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((d) => {
          const name = ws.accounts[d.accountDomain]?.name || d.name || d.accountDomain;
          const last = lastActivityDays(d, today);
          return (
            <li key={d.id} className={cn("group relative flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px] transition-colors duration-100 hover:bg-bg-subtle/70 md:grid md:h-11 md:py-0", grid)}>
              <div className="flex min-w-0 flex-1 items-center gap-2.5 md:flex-none">
                <Favicon domain={d.accountDomain} name={name} size={18} />
                <button
                  onClick={() => onOpen(d.accountDomain)}
                  className="min-w-0 truncate text-left font-medium text-fg outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
                >
                  {name}
                </button>
                <ChampionDot deal={d} ws={ws} />
              </div>
              <div className="order-last w-full min-w-0 md:order-none md:w-auto">
                <NextStep deal={d} today={today} compact />
              </div>
              {columns.map((c) => (
                <div key={c.label} className="hidden min-w-0 md:block">
                  {c.cell(d)}
                </div>
              ))}
              <span className="hidden font-mono text-[12px] tnum text-fg-3 md:block">{d.contacts.length}</span>
              <span className="hidden font-mono text-[12px] tnum text-fg-3 lg:block">{last === null ? "—" : last === 0 ? "today" : `${last}d ago`}</span>
              <div className="relative z-[1] flex justify-end transition-opacity duration-100 md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100 md:has-[[data-state=open]]:opacity-100">{menu(d)}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
