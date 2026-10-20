"use client";

import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Card, SectionLabel } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/misc";
import { SourceChip } from "@/components/ui/source";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { addDays } from "@/lib/domain/ids";
import { STAGE_LABELS, type GtmEvent, type Stage, type Workspace } from "@/lib/domain/types";
import { briefingBook, briefingMarkdown, eventDay, firstNameOf, guestLabel, roleLabel, seatingPlan, type SeatSlot } from "./plan-math";

function initials(label: string) {
  const parts = label.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "·";
}

/** A round table, seats placed by angle. Hosts are ink; guests are paper. */
function RoundTable({ seats, index, count }: { seats: SeatSlot[]; index: number; count: number }) {
  const n = seats.length;
  return (
    <figure className="w-full">
      <div className="relative mx-auto aspect-square w-full max-w-[360px]">
        <div className="absolute inset-[24%] flex flex-col items-center justify-center rounded-full bg-bg-subtle ring-1 ring-border">
          <span className="text-[12px] text-fg-3">{count > 1 ? `Table ${index + 1}` : "Round table"}</span>
          <span className="font-mono text-[12px] tnum text-fg-2">{n} seats</span>
        </div>
        {seats.map((s, i) => {
          const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
          const x = 50 + 40 * Math.cos(angle);
          const y = 50 + 40 * Math.sin(angle);
          const host = s.kind !== "guest";
          return (
            <Tooltip
              key={`${s.label}-${i}`}
              content={
                <span className="block">
                  <span className="block font-medium">{s.label}</span>
                  <span className="block opacity-80">{s.sub}</span>
                  {s.why && <span className="mt-1 block opacity-80">{s.why}</span>}
                </span>
              }
            >
              <button
                type="button"
                className="absolute flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 rounded-md p-1 text-center"
                style={{ left: `${x}%`, top: `${y}%` }}
                aria-label={`Seat ${i + 1}: ${s.label}, ${s.sub}`}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-[11px] font-semibold ring-1",
                    host ? "bg-primary text-primary-fg ring-primary" : "bg-surface text-fg ring-border-strong",
                  )}
                >
                  {initials(s.label)}
                </span>
                <span className="w-full truncate text-[11px] leading-[14px] text-fg-2">{s.label.split(" ")[0]}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </figure>
  );
}

function Seating({ ev, ws }: { ev: GtmEvent; ws: Workspace }) {
  const plan = ev.plan!;
  const { tables, preview } = seatingPlan(ev, ws);
  const pairs = tables.flat().filter((s) => s.why && s.kind === "guest");
  const hostless = tables.findIndex((t) => !t.some((s) => s.kind !== "guest" || s.why?.startsWith("Customer host")));
  return (
    <section>
      <SectionLabel right={preview ? <Badge tone="outline">Preview from the must-attend list</Badge> : undefined}>Seating</SectionLabel>
      <Card className="p-4">
        <div className={cn("grid gap-6", tables.length > 1 && "sm:grid-cols-2")}>
          {tables.map((t, i) => (
            <RoundTable key={i} seats={t} index={i} count={tables.length} />
          ))}
        </div>
        {hostless >= 0 && (
          <p className="mt-4 text-[12.5px] leading-[18px] text-warning">
            Table {hostless + 1} has no host. Ask {plan.coHost ? "your co-host" : "a customer or your co-host"} to anchor it, or trim the list to 10.
          </p>
        )}
        {pairs.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-border pt-3 text-[12.5px] leading-[18px] text-fg-2">
            {pairs
              .filter((_, i) => i % 2 === 0)
              .slice(0, 6)
              .map((s) => (
                <li key={s.guestId}>
                  <span className="text-fg">{s.label}</span> · {s.why}
                </li>
              ))}
          </ul>
        )}
        <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
          {plan.seatingRules.map((r) => (
            <li key={r} className="flex gap-2 text-[13px] leading-5 text-fg-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-fg-4" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function Facilitation({ ev }: { ev: GtmEvent }) {
  const plan = ev.plan!;
  return (
    <section>
      <SectionLabel>Facilitation</SectionLabel>
      <Card className="p-4">
        <ul className="space-y-1.5">
          {plan.seatingRules.map((r) => (
            <li key={r} className="flex gap-2 text-[13px] leading-5 text-fg-2">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-fg-4" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

export function RoomTab({ ev }: { ev: GtmEvent }) {
  const { ws } = useWorkspace();
  if (!ws || !ev.plan) return null;
  const plan = ev.plan;
  const theme = plan.themes[ev.chosenThemeIdx ?? 0];
  const day = eventDay(ev);
  const book = briefingBook(ev, ws);
  const promptsText = theme ? [theme.question, "", ...theme.prompts.map((p, i) => `${i + 1}. ${p}`), "", "In reserve:", ...theme.reservePrompts.map((p) => `- ${p}`)].join("\n") : "";

  return (
    <div className="space-y-10">
      <div className="grid gap-8 xl:grid-cols-2">
        <section>
          <SectionLabel>Run of show</SectionLabel>
          <Card className="p-1.5">
            <ol>
              {plan.runOfShow.map((s, i) => (
                <li key={i} className="flex gap-4 rounded-md px-3 py-2.5 odd:bg-bg-subtle/60">
                  <span className="w-11 shrink-0 pt-px font-mono text-[12px] tnum text-fg-3">{s.time}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-fg">{s.segment}</span>
                    {s.notes && <span className="mt-0.5 block text-[12.5px] leading-[18px] text-fg-2">{s.notes}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          {plan.anchorBrief && (
            <div className="mt-4 rounded-md bg-bg-subtle px-4 py-3">
              <p className="text-[12px] font-medium text-fg-3">{ev.kind === "roundtable" ? "The framer's 5 minutes" : "The anchor's 5–10 minutes"}</p>
              <p className="mt-1 text-[13.5px] leading-5 text-fg-2">{plan.anchorBrief}</p>
            </div>
          )}
        </section>

        <section>
          <SectionLabel right={promptsText ? <CopyButton text={promptsText} label="Copy prompts" /> : undefined}>Prompts</SectionLabel>
          {theme ? (
            <Card className="p-4">
              <p className="font-serif text-[17px] leading-[25px] text-fg">{theme.question}</p>
              {theme.prompts.length > 0 ? (
                <ol className="mt-4 space-y-2.5">
                  {theme.prompts.map((p, i) => (
                    <li key={i} className="flex gap-3 text-[14px] leading-[21px] text-fg">
                      <span className="w-4 shrink-0 font-mono text-[12px] leading-[21px] text-fg-3">{i + 1}</span>
                      {p}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-[13px] text-fg-3">No prompts yet. Re-plan to write them.</p>
              )}
              {theme.reservePrompts.length > 0 && (
                <>
                  <p className="mt-5 text-[12px] font-medium text-fg-3">In reserve, when the room goes quiet</p>
                  <ul className="mt-2 space-y-2">
                    {theme.reservePrompts.map((p, i) => (
                      <li key={i} className="flex gap-3 text-[13.5px] leading-5 text-fg-2">
                        <span className="w-4 shrink-0 text-fg-4">–</span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-5 border-t border-border pt-3 text-[12px] leading-[17px] text-fg-3">
                Open with the norms: off the record, no recording, no pitch. Close with one observation that ties it together.
              </p>
            </Card>
          ) : (
            <p className="text-[13px] text-fg-3">Pick a question on the Plan tab.</p>
          )}
        </section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">{ev.kind === "dinner" ? <Seating ev={ev} ws={ws} /> : <Facilitation ev={ev} />}</div>

      <section>
        <SectionLabel right={book.length ? <CopyButton text={briefingMarkdown(ev, ws)} label="Copy briefing book" /> : undefined}>
          Briefing book{day ? ` · ready by ${shortDate(addDays(day, -2))}` : ""}
        </SectionLabel>
        {book.length === 0 ? (
          <p className="text-[13px] text-fg-3">The briefing book fills in as guests accept.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {book.map((b) => (
              <li key={b.guest.id}>
                <Card className="h-full p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-fg">{guestLabel(b.guest)}</p>
                      <p className="truncate text-[12.5px] text-fg-3">
                        {b.guest.name ? `${b.guest.title} · ` : ""}
                        {b.company}
                      </p>
                    </div>
                    <span className="flex shrink-0 gap-1">
                      {b.guest.role !== "prospect" && <Badge tone="outline">{roleLabel(b.guest.role, ev.kind)}</Badge>}
                      {b.stage && <Badge>{STAGE_LABELS[b.stage as Stage]}</Badge>}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-1.5 text-[12.5px] leading-[18px]">
                    {[
                      ["Challenge", b.challenge],
                      ["Wants", b.wants],
                      ["Intro", b.intro],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="w-16 shrink-0 text-fg-3">{k}</dt>
                          <dd className="min-w-0 text-fg-2">{v}</dd>
                        </div>
                      ))}
                    {b.signal && (
                      <div className="flex gap-2">
                        <dt className="w-16 shrink-0 text-fg-3">Recent</dt>
                        <dd className="min-w-0 text-fg-2">
                          {b.signal.headline} <SourceChip url={b.signal.url} publishedAt={b.signal.date} claim={b.signal.headline} />
                        </dd>
                      </div>
                    )}
                    {!b.challenge && !b.wants && !b.signal && <p className="text-fg-3">Little on file. Ask {firstNameOf(b.guest.name) ?? "them"} what they want from the room when you confirm.</p>}
                  </dl>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
