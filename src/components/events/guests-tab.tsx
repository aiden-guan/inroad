"use client";

import { motion } from "motion/react";
import { ChevronDown, ExternalLink, TriangleAlert, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Favicon } from "@/components/ui/favicon";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Menu, MenuItem, Popover } from "@/components/ui/menu";
import { EmptyState, Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { newId, todayISO, weekOf } from "@/lib/domain/ids";
import { STAGE_LABELS, type GtmEvent, type Guest, type Person, type Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { coldFirstTouches } from "@/lib/quality/cap";
import {
  GUEST_STATUSES,
  GUEST_STATUS_LABEL,
  emailFor,
  eventDay,
  guestLabel,
  guestVars,
  mergeTokens,
  peerFor,
  roleLabel,
  guestFromPerson,
} from "./plan-math";
import { DraftBlock, Sources, useGuestActions } from "./ui";

const SECTION_ORDER: Guest["status"][] = ["attended", "no_show", "confirmed", "accepted", "invited", "candidate", "waitlist", "declined"];
const ROLE_ORDER: Record<Guest["role"], number> = { anchor: 0, customer_host: 1, connector: 2, prospect: 3 };

type CopyKind = "invite" | "host" | "reminder" | "dayof" | "decline";

function GuestMark({ g }: { g: Guest }) {
  return g.accountDomain ? (
    <Favicon domain={g.accountDomain} size={22} />
  ) : (
    <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-[5px] bg-surface text-fg-3 ring-1 ring-border">
      <Users className="size-3" />
    </span>
  );
}

function StatusMenu({ g, onSet }: { g: Guest; onSet: (s: Guest["status"]) => void }) {
  return (
    <Menu
      trigger={
        <button
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-[12px] font-medium ring-1 transition-colors",
            g.status === "candidate" ? "text-fg-2 ring-border hover:bg-bg-subtle" : "bg-bg-subtle text-fg ring-border hover:bg-surface",
          )}
          aria-label={`Status: ${GUEST_STATUS_LABEL[g.status]}`}
        >
          {GUEST_STATUS_LABEL[g.status]}
          <ChevronDown className="size-3 text-fg-3" />
        </button>
      }
    >
      {GUEST_STATUSES.map((s) => (
        <MenuItem key={s} onSelect={() => onSet(s)} hint={s === g.status ? "Current" : undefined}>
          {GUEST_STATUS_LABEL[s]}
        </MenuItem>
      ))}
    </Menu>
  );
}

function GuestDetail({ ev, g, ws }: { ev: GtmEvent; g: Guest; ws: Workspace }) {
  const actions = useGuestActions(ev)!;
  const plan = ev.plan!;
  const person = g.personId ? ws.people[g.personId] : undefined;
  const to = emailFor(person);
  const vars = guestVars(ev, g, ws);
  const peer = peerFor(ev, g, ws);
  const acc = ws.accounts[g.accountDomain];
  const deal = g.dealId ? ws.deals[g.dealId] : undefined;
  const hasHostCopy = Boolean(plan.coHost) || g.role === "customer_host";
  const [kind, setKind] = useState<CopyKind>(g.status === "candidate" || g.status === "waitlist" ? "invite" : g.status === "declined" ? "decline" : "reminder");
  const day = eventDay(ev);

  const copy: Record<CopyKind, { subject?: string; body: string; maxWords?: number; text?: boolean }> = {
    invite: { subject: mergeTokens(plan.copy.inviteFounder.subject, vars), body: mergeTokens(plan.copy.inviteFounder.body, vars), maxWords: 120 },
    host: { subject: mergeTokens(plan.copy.inviteCustomerHost.subject, vars), body: mergeTokens(plan.copy.inviteCustomerHost.body, vars), maxWords: 80 },
    reminder: { subject: `See you ${vars.date ?? "soon"}`, body: mergeTokens(plan.copy.reminder48h, vars), maxWords: 60 },
    dayof: { body: mergeTokens(plan.copy.dayOfText, vars), maxWords: 30, text: true },
    decline: { subject: `Re: ${mergeTokens(plan.copy.inviteFounder.subject, vars)}`, body: mergeTokens(plan.copy.declineReply ?? "Thanks for letting me know. Is there a colleague who should be there instead?", vars), maxWords: 40 },
  };
  const c = copy[kind];
  const save = (patch: Partial<Guest>) => {
    const next = { ...g, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(g)) void actions.save(next);
  };

  const next =
    kind === "invite" && (g.status === "candidate" || g.status === "waitlist") ? (
      <Button size="sm" variant="primary" onClick={() => void actions.setStatus(g, "invited")}>
        Mark invited
      </Button>
    ) : kind === "reminder" && !g.remindedOn && (g.status === "accepted" || g.status === "confirmed") ? (
      <Button size="sm" variant="primary" onClick={() => save({ remindedOn: todayISO() })}>
        Mark reminded
      </Button>
    ) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: ease.out }}
      className="grid gap-6 border-t border-border px-3 pb-4 pt-4 @2xl:grid-cols-[minmax(0,1fr)_240px] @2xl:px-4"
    >
      <div className="min-w-0 space-y-4">
        <div>
          <Label htmlFor={`pl-${g.id}`} hint="≤25 words, about them, not you">
            Personal line
          </Label>
          <Textarea
            id={`pl-${g.id}`}
            key={`pl-${g.personalLine}`}
            defaultValue={g.personalLine}
            placeholder={g.personalLine ? undefined : "Why this person, in one sentence. Their challenge, not your product."}
            className="min-h-14 text-[14px] leading-[21px]"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== g.personalLine) save({ personalLine: v, edited: true });
            }}
          />
        </div>
        <div>
          <Label htmlFor={`w-${g.id}`} hint="Used in the 48-hour reminder">
            What they want from the room
          </Label>
          <Input id={`w-${g.id}`} key={`w-${g.wants ?? ""}`} defaultValue={g.wants ?? ""} placeholder="Compare notes on…" onBlur={(e) => {
              const v = e.target.value.trim() || undefined;
              if (v !== g.wants) save({ wants: v, edited: true });
            }}
          />
        </div>
        <div>
          <div className="mb-2 overflow-x-auto scrollbar-none">
            <Segmented<CopyKind>
              className="w-max"
              layoutId={`copy-${g.id}`}
              value={kind}
              onChange={setKind}
              options={[
                { value: "invite", label: "Invite" },
                ...(hasHostCopy ? [{ value: "host" as const, label: "Co-host's note" }] : []),
                { value: "reminder", label: "48h reminder" },
                { value: "dayof", label: "Day of" },
                { value: "decline", label: "On decline" },
              ]}
            />
          </div>
          <DraftBlock
            key={kind}
            label={kind === "host" ? "For your co-host to send" : kind === "dayof" ? "Text message" : "Draft"}
            subject={c.subject}
            body={c.body}
            to={kind === "host" || c.text ? undefined : to}
            maxWords={c.maxWords}
            channel={c.text ? "text" : "email"}
            actions={next}
          />
          {!to && kind !== "dayof" && kind !== "host" && (
            <p className="mt-2 text-[12px] text-fg-3">
              No email on file.{" "}
              {person?.linkedinUrl ? (
                <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                  Send it on LinkedIn
                </a>
              ) : g.accountDomain ? (
                <Link href={`/companies?c=${encodeURIComponent(g.accountDomain)}`} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                  Find a contact path
                </Link>
              ) : (
                "Copy it and send it yourself."
              )}
            </p>
          )}
        </div>
      </div>

      <aside className="min-w-0 space-y-4 text-[12.5px]">
        <div>
          <p className="font-medium text-fg-3">Why them</p>
          {g.scoreParts ? (
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11.5px] tnum">
              <dt className="text-fg-3">Fit</dt>
              <dd className="text-fg">{g.scoreParts.fit.toFixed(2)}</dd>
              <dt className="text-fg-3">Seniority</dt>
              <dd className="text-fg">{g.scoreParts.seniority.toFixed(2)}</dd>
              <dt className="text-fg-3">Why now</dt>
              <dd className="text-fg">{g.scoreParts.whyNow}/4</dd>
              <dt className="text-fg-3">Warm path</dt>
              <dd className="text-fg">{g.scoreParts.warmPath ? "yes" : "no"}</dd>
              <dt className="text-fg-3">{ev.kind === "dinner" ? "Same city" : "Virtual"}</dt>
              <dd className="text-fg">{ev.kind === "dinner" ? (g.scoreParts.sameCity ? "yes" : "no") : "yes"}</dd>
            </dl>
          ) : (
            <p className="mt-1 text-fg-2">Added by you.</p>
          )}
        </div>
        {g.warmPath && !deal && <p className="text-fg-2">{g.warmPath}</p>}
        {deal && (
          <p className="text-fg-2">
            Deal · <span className="text-fg">{STAGE_LABELS[deal.stage]}</span>
            {deal.nextStep && <span className="text-fg-3"> · next: {deal.nextStep.what}</span>}
          </p>
        )}
        {(g.evidenceIds?.length ?? 0) > 0 && <Sources ids={g.evidenceIds} />}
        {peer && (
          <p className="text-fg-2">
            Seat beside <span className="text-fg">{guestLabel(peer)}</span>
            {g.seatNextTo?.why && <span className="text-fg-3"> · {g.seatNextTo.why}</span>}
          </p>
        )}
        {g.competitorConflict && (
          <p className="flex gap-1.5 text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {g.competitorConflict}
          </p>
        )}
        {day && g.invitedOn && <p className="font-mono text-[11.5px] text-fg-3">Invited {g.invitedOn}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
          {acc && (
            <Link href={`/companies?c=${encodeURIComponent(acc.domain)}`} className="inline-flex items-center gap-1 text-fg-2 underline-offset-4 hover:text-fg hover:underline">
              Open {acc.name}
            </Link>
          )}
          {person?.linkedinUrl && (
            <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg-2 hover:text-fg">
              LinkedIn <ExternalLink className="size-3" />
            </a>
          )}
          <button
            className="text-fg-3 transition-colors hover:text-danger"
            onClick={() => {
              void actions.remove(g);
              toast(`Removed ${guestLabel(g)}`, { action: { label: "Undo", onClick: () => void actions.restore(g) } });
            }}
          >
            Remove
          </button>
        </div>
      </aside>
    </motion.div>
  );
}

function GuestRow({ ev, g, ws, open, onToggle }: { ev: GtmEvent; g: Guest; ws: Workspace; open: boolean; onToggle: () => void }) {
  const actions = useGuestActions(ev)!;
  const company = ws.accounts[g.accountDomain]?.name ?? (g.accountDomain || (g.role === "connector" ? "Connector" : ""));
  const deal = g.dealId ? ws.deals[g.dealId] : undefined;
  return (
    <li className={cn("@container rounded-md transition-[background-color,box-shadow] duration-150", open ? "bg-surface shadow-sm ring-1 ring-border" : "hover:bg-surface/70")}>
      <div className="flex min-h-12 items-center gap-2 px-2 py-1.5 md:gap-3">
        <button data-row aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 rounded-sm py-1 text-left">
          <GuestMark g={g} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className={cn("truncate text-[13.5px] font-medium", g.name ? "text-fg" : "text-fg-2 italic")}>{g.name ?? `${g.title} (no name yet)`}</span>
              {g.mustAttend && <span className="hidden size-1.5 shrink-0 rounded-full bg-fg sm:inline-block" title="Must-attend" aria-label="Must-attend" />}
              {g.competitorConflict && <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-label="Competitor conflict" />}
            </span>
            <span className="block truncate text-[12.5px] text-fg-3">{[g.name ? g.title : null, company].filter(Boolean).join(" · ")}</span>
          </span>
        </button>
        <span className="hidden items-center gap-1.5 lg:flex">
          {g.role !== "prospect" && <Badge tone="outline">{roleLabel(g.role, ev.kind)}</Badge>}
          {deal && <Badge>{STAGE_LABELS[deal.stage]}</Badge>}
          {g.warmPath && g.role === "prospect" && !deal && <Badge tone="outline">Warm</Badge>}
        </span>
        <span className="hidden w-7 text-right font-mono text-[11.5px] tnum text-fg-3 sm:block" title="Score">
          {g.role === "connector" ? "" : g.score}
        </span>
        <StatusMenu g={g} onSet={(s) => void actions.setStatus(g, s)} />
      </div>
      {open && <GuestDetail ev={ev} g={g} ws={ws} />}
    </li>
  );
}

function AddGuest({ ev, ws }: { ev: GtmEvent; ws: Workspace }) {
  const actions = useGuestActions(ev)!;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const taken = useMemo(() => new Set(Object.values(ev.guests).map((g) => g.personId).filter(Boolean)), [ev]);
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(ws.people)
      .filter((p) => !p.doNotContact && !taken.has(p.id))
      .filter((p) => !needle || `${p.name} ${p.title} ${ws.accounts[p.accountDomain]?.name ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => (ws.accounts[b.accountDomain]?.fitScore ?? 0) - (ws.accounts[a.accountDomain]?.fitScore ?? 0))
      .slice(0, 8);
  }, [q, ws, taken]);

  const add = (p: Person) => {
    void actions.save(guestFromPerson(ws, ev, p, newId("gst")));
    setOpen(false);
    setQ("");
    toast(`Added ${p.name}. Write their personal line before you invite them.`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[min(320px,calc(100vw-32px))] p-2"
      trigger={
        <Button size="sm" variant="secondary" icon={<UserPlus className="size-3.5" />}>
          Add a guest
        </Button>
      }
    >
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people you've researched" aria-label="Search people" />
      <ul className="mt-1.5 max-h-72 overflow-y-auto">
        {matches.map((p) => (
          <li key={p.id}>
            <button onClick={() => add(p)} className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-bg-subtle focus-visible:bg-bg-subtle">
              <Favicon domain={p.accountDomain} size={18} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-fg">{p.name}</span>
                <span className="block truncate text-[11.5px] text-fg-3">
                  {p.title} · {ws.accounts[p.accountDomain]?.name ?? p.accountDomain}
                </span>
              </span>
            </button>
          </li>
        ))}
        {!matches.length && <li className="px-2 py-3 text-[12.5px] text-fg-3">{q ? "No one matches." : "No one left to add."} People come from the companies you research.</li>}
      </ul>
    </Popover>
  );
}

export function GuestsTab({ ev }: { ev: GtmEvent }) {
  const { ws } = useWorkspace();
  const [filter, setFilter] = useState<"all" | Guest["status"]>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  if (!ws) return null;

  const guests = Object.values(ev.guests);
  const counts = Object.fromEntries(GUEST_STATUSES.map((s) => [s, guests.filter((g) => g.status === s).length])) as Record<Guest["status"], number>;
  const sort = (a: Guest, b: Guest) => Number(Boolean(b.mustAttend)) - Number(Boolean(a.mustAttend)) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.score - a.score;
  const sections = SECTION_ORDER.filter((s) => filter === "all" || filter === s)
    .map((s) => ({ status: s, guests: guests.filter((g) => g.status === s).sort(sort) }))
    .filter((s) => s.guests.length);
  const must = guests.filter((g) => g.mustAttend);
  const mustDeclined = must.filter((g) => g.status === "declined").length;
  // The cap counter Today and the send gate use: cold email invites with no warm path count, like first touches.
  const cold = coldFirstTouches(ws, { from: weekOf() });
  const cap = ws.caps.firstTouchesPerWeek;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key.toLowerCase();
    if (k !== "j" && k !== "k") return;
    const target = e.target as HTMLElement;
    if (!target.matches("[data-row]")) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ?? [])];
    const i = rows.indexOf(target as HTMLButtonElement);
    const next = rows[k === "j" ? i + 1 : i - 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  const filters: { value: "all" | Guest["status"]; label: string; count?: number }[] = [
    { value: "all", label: "All", count: guests.length },
    ...SECTION_ORDER.filter((s) => counts[s]).map((s) => ({ value: s, label: GUEST_STATUS_LABEL[s], count: counts[s] })),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[60ch]">
          <p className="font-serif text-[17px] italic leading-[25px] text-fg-2">Would you be happy if this person were the only one who showed up? If not, cut them.</p>
          <p className="mt-1.5 text-[12.5px] text-fg-3">
            {must.length > 0 && (
              <>
                <span className="mr-1 inline-block size-1.5 rounded-full bg-fg align-middle" aria-hidden /> {must.length} must-attend
                {mustDeclined > 0 && <span className={cn(mustDeclined >= 5 && "text-danger")}> · {mustDeclined} declined{mustDeclined >= 5 ? ": move the date" : ""}</span>}
                <span aria-hidden> · </span>
              </>
            )}
            <span className={cn("font-mono tnum", cold >= cap && "text-warning")}>
              {cold} of {cap} cold first touches this week
            </span>
          </p>
        </div>
        <AddGuest ev={ev} ws={ws} />
      </div>

      {guests.length === 0 ? (
        <EmptyState
          title="No guests yet"
          body="Re-plan once you've researched a few companies or imported your LinkedIn connections. Warm paths fill rooms."
          action={
            <Link href="/integrations?import=linkedin" className="text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline">
              Import LinkedIn connections
            </Link>
          }
        />
      ) : (
        <>
          <div className="-mx-6 mt-5 overflow-x-auto px-6 scrollbar-none md:mx-0 md:px-0">
            <Segmented className="w-max" layoutId={`guest-filter-${ev.id}`} value={filter} onChange={setFilter} options={filters} />
          </div>
          <div ref={listRef} onKeyDown={onKeyDown} className="mt-5 space-y-6">
            {sections.map((s) => (
              <section key={s.status}>
                <SectionLabel>
                  {GUEST_STATUS_LABEL[s.status]} · {s.guests.length}
                </SectionLabel>
                <ul className="space-y-0.5">
                  {s.guests.map((g) => (
                    <GuestRow key={g.id} ev={ev} g={g} ws={ws} open={openId === g.id} onToggle={() => setOpenId(openId === g.id ? null : g.id)} />
                  ))}
                </ul>
              </section>
            ))}
            {!sections.length && <p className="text-[13px] text-fg-3">No guests with this status.</p>}
          </div>
          <p className="mt-6 hidden text-[11.5px] text-fg-3 md:block">
            <kbd className="font-mono">J</kbd>/<kbd className="font-mono">K</kbd> to move, <kbd className="font-mono">Enter</kbd> to open a guest.
          </p>
        </>
      )}
    </div>
  );
}
