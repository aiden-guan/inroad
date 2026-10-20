"use client";

import { Mic } from "lucide-react";
import Link from "next/link";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Favicon } from "@/components/ui/favicon";
import { Label, Textarea } from "@/components/ui/field";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { addDays, todayISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type GtmEvent, type Guest, type Workspace } from "@/lib/domain/types";
import { attribution, emailFor, eventDay, formatEventDate, guestLabel, guestVars, mergeTokens, touchesUsed } from "./plan-math";
import { AgentNote, DraftBlock, Stat, SummaryReceipt, useEventRuns, useGuestActions } from "./ui";

const FIT_LABEL = { pursue: "Pursue", nurture: "Nurture", none: "No fit" } as const;
const MAX_TOUCHES = 5;

function Attribution({ ev, ws }: { ev: GtmEvent; ws: Workspace }) {
  const a = attribution(ev, ws);
  const rate = a.rate90 === null ? null : Math.round(a.rate90 * 100);
  const behind = rate !== null && a.daysSince >= 30 && rate < 35;
  return (
    <section>
      <SectionLabel>Did the room turn into pipeline?</SectionLabel>
      <Card className="p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <Stat label="Companies in the room" value={a.attendees} />
          <Stat label="Meetings · 30 days" value={a.meetingAccounts30} hint="Accounts with a meeting" />
          <Stat label="Meetings · 90 days" value={a.meetingAccounts90} />
          <Stat
            label="Attendee → meeting"
            value={<span className={cn(behind && "text-warning")}>{rate === null ? "—" : `${rate}%`}</span>}
            hint="Target: 35% or more"
          />
        </dl>
        {(a.sourced.length > 0 || a.influenced.length > 0) && (
          <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            {[
              { label: "Sourced (new within 90 days)", deals: a.sourced },
              { label: "Influenced (already open, moved)", deals: a.influenced },
            ].map((group) => (
              <div key={group.label}>
                <p className="text-[12px] text-fg-3">{group.label}</p>
                {group.deals.length ? (
                  <ul className="mt-1.5 space-y-1">
                    {group.deals.map((d) => (
                      <li key={d.id}>
                        <Link href={`/companies?c=${encodeURIComponent(d.accountDomain)}`} className="flex items-center gap-2 text-[13px] text-fg hover:underline">
                          <Favicon domain={d.accountDomain} size={14} />
                          <span className="truncate">{ws.accounts[d.accountDomain]?.name ?? d.name}</span>
                          <Badge>{STAGE_LABELS[d.stage]}</Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-fg-3">None yet.</p>
                )}
              </div>
            ))}
          </div>
        )}
        {a.attendees === 0 && <p className="mt-4 border-t border-border pt-3 text-[12.5px] text-fg-3">Mark who came and this tracks meetings and deals from their companies for 90 days.</p>}
      </Card>
    </section>
  );
}

function GuestAfter({ ev, g, ws }: { ev: GtmEvent; g: Guest; ws: Workspace }) {
  const actions = useGuestActions(ev)!;
  const company = ws.accounts[g.accountDomain]?.name ?? (g.accountDomain || "");
  const to = emailFor(g.personId ? ws.people[g.personId] : undefined);
  const used = touchesUsed(g, ev);
  const cadence = ev.plan?.followUp.cadence ?? [];
  const nextStep = used < MAX_TOUCHES ? cadence[used] : undefined;
  const day = eventDay(ev);
  const sentNote = (g.touches ?? []).some((t) => t.what === "Next-morning note");
  const d = g.debrief;

  return (
    <Card className="@container p-4">
      <div className="flex items-start gap-3">
        {g.accountDomain ? <Favicon domain={g.accountDomain} size={22} /> : <span className="size-[22px]" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-fg">{guestLabel(g)}</p>
          <p className="truncate text-[12.5px] text-fg-3">{[g.name ? g.title : null, company].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {d && <Badge tone={d.fit === "pursue" ? "neutral" : "outline"}>{FIT_LABEL[d.fit]}</Badge>}
          <span className={cn("font-mono text-[11.5px] tnum", used >= MAX_TOUCHES ? "text-warning" : "text-fg-3")} title="Human touches in the 90 days after the event">
            {used}/{MAX_TOUCHES}
          </span>
        </span>
      </div>

      <div className="mt-3">
        <Label htmlFor={`vn-${g.id}`} hint="Paraphrase is fine">
          <span className="inline-flex items-center gap-1.5">
            <Mic className="size-3" /> Voice note
          </span>
        </Label>
        <Textarea
          id={`vn-${g.id}`}
          key={`vn-${g.voiceNote ?? ""}`}
          defaultValue={g.voiceNote ?? ""}
          placeholder="Their biggest challenge, what they wish existed, peers they named, timing."
          className="min-h-16"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (g.voiceNote ?? "")) void actions.save({ ...g, voiceNote: v || undefined });
          }}
        />
      </div>

      {d && (
        <>
          <dl className="mt-4 grid gap-x-4 gap-y-1.5 text-[12.5px] leading-[18px] @xl:grid-cols-2">
            {[
              ["Challenge", d.challenge],
              ["Wishes", d.wishes],
              ["Peers named", d.peersNamed?.join(", ")],
              ["Next step", d.nextStep],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-20 shrink-0 text-fg-3">{k}</dt>
                  <dd className="min-w-0 text-fg-2">{v}</dd>
                </div>
              ))}
          </dl>
          <DraftBlock
            className="mt-4"
            label="Next-morning note"
            subject={`Thank you for ${ev.kind === "dinner" ? "last night" : "yesterday"}`}
            body={d.nextMorningNote}
            to={to}
            maxWords={90}
            actions={
              <Button size="sm" variant="primary" disabled={sentNote || used >= MAX_TOUCHES} onClick={() => void actions.logTouch(g, "Next-morning note", d.nextMorningNote)}>
                {sentNote ? "Sent" : "Mark sent"}
              </Button>
            }
          />
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[12.5px]">
        {nextStep ? (
          <>
            <span className="min-w-0 flex-1 text-fg-2">
              <span className="text-fg-3">Next touch · </span>
              {nextStep.touch}
              {day && <span className="font-mono text-[11.5px] text-fg-3"> · {shortDate(addDays(day, nextStep.day))}</span>}
            </span>
            {(!d || sentNote || nextStep.day > 1) && (
              <Button size="xs" variant="secondary" onClick={() => void actions.logTouch(g, nextStep.day <= 1 && !sentNote ? "Next-morning note" : nextStep.touch)}>
                Log touch
              </Button>
            )}
          </>
        ) : (
          <span className="flex-1 text-fg-3">Five touches used. Let them come to you, or move them to nurture.</span>
        )}
        {g.accountDomain && d?.fit === "pursue" && (
          <Link href={`/companies?c=${encodeURIComponent(g.accountDomain)}`} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
            Open {company}
          </Link>
        )}
      </div>
    </Card>
  );
}

export function AfterTab({ ev }: { ev: GtmEvent }) {
  const { ws } = useWorkspace();
  const { start } = useRuns();
  const runs = useEventRuns(ev.id);
  const actions = useGuestActions(ev);
  if (!ws || !ev.plan || !actions) return null;

  const today = todayISO();
  const day = eventDay(ev);
  const upcoming = Boolean(day && day > today);
  const guests = Object.values(ev.guests);
  const attended = guests.filter((g) => g.status === "attended").sort((a, b) => b.score - a.score);
  const noShows = guests.filter((g) => g.status === "no_show");
  const toMark = guests.filter((g) => g.status === "accepted" || g.status === "confirmed");
  const withNotes = attended.filter((g) => g.voiceNote?.trim());
  const pending = withNotes.filter((g) => !g.debrief);
  const groupEmail = ev.after?.groupEmail ?? { subject: `Thank you for ${ev.kind === "dinner" ? "last night" : "yesterday"}`, body: ev.plan.followUp.groupEmail };
  const bcc = attended.map((g) => emailFor(g.personId ? ws.people[g.personId] : undefined)).filter((x): x is string => Boolean(x));

  return (
    <div className="space-y-10">
      {upcoming && (
        <AgentNote className="max-w-[64ch]">
          This fills in after {formatEventDate(ev)}. Before you leave the room, record a 30-second voice note per guest: their biggest challenge, what they wish existed, peers they named, and timing.
          Paste them here the next morning and I&apos;ll draft each note.
        </AgentNote>
      )}

      <Attribution ev={ev} ws={ws} />

      {toMark.length > 0 && (
        <section>
          <SectionLabel>Who came? · {toMark.length} to mark</SectionLabel>
          <ul className="space-y-0.5">
            {toMark.map((g) => (
              <li key={g.id} className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface/70">
                {g.accountDomain ? <Favicon domain={g.accountDomain} size={20} /> : <span className="size-5" />}
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">
                  {guestLabel(g)} <span className="text-fg-3">· {ws.accounts[g.accountDomain]?.name ?? g.title}</span>
                </span>
                <Button size="xs" variant="secondary" onClick={() => void actions.setStatus(g, "attended")}>
                  Came
                </Button>
                <Button size="xs" variant="ghost" onClick={() => void actions.setStatus(g, "no_show")}>
                  No-show
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionLabel
          right={
            withNotes.length > 0 ? (
              <Button
                variant="agent"
                size="sm"
                loading={runs.debriefing}
                onClick={() => void start("dinner_plan", { mode: "debrief", eventId: ev.id, guestIds: (pending.length ? pending : withNotes).map((g) => g.id) })}
              >
                {pending.length ? `Write next-morning notes (${pending.length})` : "Rewrite the notes"}
              </Button>
            ) : undefined
          }
        >
          <span className="inline-flex items-center gap-1.5">
            Voice notes and next-morning notes {withNotes.length > 0 && <AiBadge />}
          </span>
        </SectionLabel>
        {runs.debriefRun && (runs.debriefing || runs.debriefRun.error) && <WorkLog run={runs.debriefRun} className="mb-4 max-w-[720px]" />}
        {!runs.debriefRun && runs.debriefSummary && !runs.debriefing && (
          <div className="mb-3">
            <SummaryReceipt summary={runs.debriefSummary} />
          </div>
        )}
        {attended.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {attended.map((g) => (
              <GuestAfter key={g.id} ev={ev} g={g} ws={ws} />
            ))}
          </div>
        ) : (
          <p className="max-w-[60ch] text-[13px] text-fg-2">
            {upcoming ? "Guests who come will appear here." : "Mark who came above, then paste a voice note for each. I'll turn them into next-morning notes that reference what each person said."}
          </p>
        )}
      </section>

      {noShows.length > 0 && (
        <section>
          <SectionLabel>No-shows · {noShows.length}</SectionLabel>
          <p className="mb-3 text-[12.5px] text-fg-3">No fees, no guilt. Offer first pick of the next date.</p>
          <div className="grid gap-3 xl:grid-cols-2">
            {noShows.map((g) => (
              <DraftBlock
                key={g.id}
                label={guestLabel(g)}
                subject="Sorry we missed you"
                body={mergeTokens(ev.plan!.followUp.noShow, guestVars(ev, g, ws))}
                to={emailFor(g.personId ? ws.people[g.personId] : undefined)}
                maxWords={50}
              />
            ))}
          </div>
        </section>
      )}

      {(attended.length > 0 || ev.after) && (
        <section className="max-w-[720px]">
          <SectionLabel>Group email · within 48 hours</SectionLabel>
          {ev.after?.themes.length ? (
            <ul className="mb-3 space-y-1">
              {ev.after.themes.map((t) => (
                <li key={t} className="flex gap-2 font-serif text-[15px] leading-[22px] text-fg-2">
                  <span className="mt-[9px] size-1 shrink-0 rounded-full bg-fg-4" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          <DraftBlock label={ev.after ? "Draft · Chatham House, no attribution" : "Template · write the notes first to fill the themes"} subject={groupEmail.subject} body={groupEmail.body} bcc={bcc} maxWords={180} />
          <p className="mt-2 text-[12px] text-fg-3">Opens with everyone in BCC. Make each promised intro in its own email.</p>
        </section>
      )}
    </div>
  );
}
