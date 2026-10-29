"use client";

import { ArrowRightLeft, CalendarClock, CornerDownLeft, Flag, Handshake, MailX, MessageSquare, Phone, Plus, Send, StickyNote, Users } from "lucide-react";
import { useMemo, useState, type ComponentType } from "react";
import { ComposeButton } from "@/components/compose/composer";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, Select } from "@/components/ui/field";
import { EmptyState, Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { relativeTime } from "@/lib/client/format";
import { newId, nowISO } from "@/lib/domain/ids";
import { STAGE_LABELS, type Account, type Activity, type ActivityKind, type Deal, type Person } from "@/lib/domain/types";
import { useNow } from "./shared";

interface Item {
  id: string;
  at: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  who?: string;
  body?: string;
  badge?: string;
  tone?: "danger" | "warning";
}

const ICON: Partial<Record<ActivityKind, ComponentType<{ className?: string }>>> = {
  touch_sent: Send,
  reply_received: CornerDownLeft,
  bounce: MailX,
  unsubscribe: MailX,
  meeting_held: Phone,
  intro_requested: Handshake,
  intro_made: Handshake,
  linkedin_connect: Users,
  linkedin_dm: MessageSquare,
  stage_changed: Flag,
  note: StickyNote,
  pushed: ArrowRightLeft,
};

const SENTIMENT: { value: NonNullable<Activity["sentiment"]>; label: string }[] = [
  { value: "positive", label: "Interested" },
  { value: "neutral", label: "Neutral" },
  { value: "negative", label: "Not now" },
  { value: "referral", label: "Referral" },
  { value: "ooo", label: "Out of office" },
];

/** Everything that happened with this company, newest first. Touches live here, not on the board. */
export function Timeline({ account, deal }: { account: Account; deal?: Deal }) {
  const { ws } = useWorkspace();
  const now = useNow();
  const [logging, setLogging] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const items = useMemo<Item[]>(() => {
    if (!ws) return [];
    const people = new Set(account.peopleIds);
    const out: Item[] = ws.activities
      .filter((a) => a.accountDomain === account.domain || (deal && a.dealId === deal.id) || (a.personId && people.has(a.personId)))
      .map((a) => ({
        id: a.id,
        at: a.at,
        icon: ICON[a.kind] ?? StickyNote,
        title: a.summary,
        who: a.personId ? ws.people[a.personId]?.name : undefined,
        body: a.body,
        badge: a.sentiment ? SENTIMENT.find((s) => s.value === a.sentiment)?.label : undefined,
        tone: a.kind === "bounce" || a.kind === "unsubscribe" ? "danger" : undefined,
      }));
    if (deal) {
      deal.stageHistory.forEach((h, i) =>
        out.push({ id: `stage-${i}`, at: h.at, icon: Flag, title: i === 0 ? `Deal started at ${STAGE_LABELS[h.stage]}` : `Moved to ${STAGE_LABELS[h.stage]}` }),
      );
      for (const id of deal.meetingIds) {
        const m = ws.meetings[id];
        // The debrief's "Call debriefed" activity stands in for a debriefed meeting; match this meeting only.
        const recorded =
          !!m?.debrief &&
          ws.activities.some((a) => a.kind === "meeting_held" && (a.meetingId ? a.meetingId === m.id : a.dealId === deal.id && a.summary === `Call debriefed: ${m.title}`));
        if (m && !recorded) {
          out.push({ id: `mtg-${m.id}`, at: m.startsAt, icon: CalendarClock, title: m.title, badge: new Date(m.startsAt).getTime() > now ? "Upcoming" : m.debrief ? undefined : "No debrief" });
        }
      }
    }
    out.push({ id: "added", at: account.addedAt, icon: Plus, title: `Added${account.sourceDetail ? ` from ${account.sourceDetail}` : ` · ${account.source.replace(/_/g, " ")}`}` });
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [ws, account, deal, now]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-fg-3">{items.length} events</p>
        <Button size="sm" variant={logging ? "ghost" : "secondary"} icon={<CornerDownLeft className="size-3.5" />} onClick={() => setLogging((l) => !l)} aria-expanded={logging}>
          Log a reply
        </Button>
      </div>
      {logging && <LogReply account={account} deal={deal} onDone={() => setLogging(false)} />}
      {items.length <= 1 && !logging ? (
        <EmptyState title="Nothing here yet" body="Touches, replies, meetings and stage changes land here as they happen." />
      ) : (
        <ol className="relative space-y-0.5 before:absolute before:bottom-2 before:left-[17px] before:top-2 before:w-px before:bg-border">
          {items.map((it) => {
            const Icon = it.icon;
            const expanded = open === it.id;
            return (
              <li key={it.id} className="relative">
                <button
                  onClick={() => it.body && setOpen(expanded ? null : it.id)}
                  aria-expanded={it.body ? expanded : undefined}
                  className={cn("flex w-full items-start gap-3 rounded-md px-1 py-1.5 text-left", it.body && "hover:bg-bg-subtle")}
                >
                  <span className="relative z-[1] flex size-[26px] shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-border">
                    <Icon className={cn("size-3.5", it.tone === "danger" ? "text-danger" : "text-fg-2")} />
                  </span>
                  <span className="min-w-0 flex-1 pt-[3px]">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
                      <span className="text-fg">{it.title}</span>
                      {it.who && !it.title.includes(it.who) && <span className="text-fg-3">{it.who}</span>}
                      {it.badge && <Badge tone={it.badge === "No debrief" ? "warning" : "outline"}>{it.badge}</Badge>}
                    </span>
                    {it.body && <span className={cn("mt-0.5 whitespace-pre-wrap text-[12.5px] leading-[18px] text-fg-2", expanded ? "block" : "line-clamp-2")}>{it.body}</span>}
                  </span>
                  <span className="shrink-0 pt-[4px] font-mono text-[11.5px] text-fg-3">{relativeTime(it.at, now)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function LogReply({ account, deal, onDone }: { account: Account; deal?: Deal; onDone: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const people = account.peopleIds.map((id) => ws?.people[id]).filter((p): p is Person => !!p);
  const touched = new Set((ws?.activities ?? []).filter((a) => a.kind === "touch_sent" && a.accountDomain === account.domain).map((a) => a.personId));
  const sorted = [...people].sort((a, b) => Number(touched.has(b.id)) - Number(touched.has(a.id)));
  const [personId, setPersonId] = useState(sorted[0]?.id ?? "__new");
  const [newName, setNewName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [text, setText] = useState("");
  const [sentiment, setSentiment] = useState<NonNullable<Activity["sentiment"]>>("positive");
  const [received, setReceived] = useState("");
  const [logged, setLogged] = useState<string | null>(null);

  const save = async () => {
    if (text.trim().length < 2) return;
    let pid = personId;
    const actions = [];
    if (pid === "__new") {
      if (!newName.trim()) return;
      const person: Person = {
        id: newId("per"),
        accountDomain: account.domain,
        name: newName.trim(),
        title: newTitle.trim(),
        evidenceIds: [],
        confidence: "medium",
        mayHaveLeft: false,
        contactPaths: [],
        jurisdiction: "unknown",
        doNotContact: false,
        source: "manual",
      };
      pid = person.id;
      actions.push({ type: "person.upsert" as const, person });
    }
    const name = pid === personId ? people.find((p) => p.id === pid)?.name : newName.trim();
    actions.push({
      type: "activity.log" as const,
      activity: {
        id: newId("act"),
        at: received ? new Date(received).toISOString() : nowISO(),
        kind: "reply_received" as const,
        personId: pid,
        accountDomain: account.domain,
        dealId: deal?.id,
        channel: "email" as const,
        summary: `Reply from ${name ?? "them"}`,
        body: text.trim().slice(0, 8000),
        sentiment,
        source: "founder" as const,
      },
    });
    const ok = await dispatch(actions);
    if (ok) setLogged(pid);
  };

  if (logged) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface p-3 ring-1 ring-border animate-[fade-in_150ms_var(--ease-out)]">
        <p className="mr-auto text-[13px] text-fg">Logged. Their open follow-ups are cancelled.</p>
        <ComposeButton domain={account.domain} personId={logged} mode="reply" label="Draft a reply" />
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-surface p-3 ring-1 ring-border animate-[fade-in_150ms_var(--ease-out)]">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="reply-from">From</Label>
          <Select
            id="reply-from"
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="h-8 w-full rounded-sm bg-surface px-2 text-[13px] ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.title ? ` · ${p.title}` : ""}
              </option>
            ))}
            <option value="__new">Someone else…</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="reply-at" hint="optional">
            Received
          </Label>
          <Input id="reply-at" type="datetime-local" value={received} onChange={(e) => setReceived(e.target.value)} />
        </div>
      </div>
      {personId === "__new" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" aria-label="Name" />
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" aria-label="Title" />
        </div>
      )}
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste their reply" aria-label="Their reply" className="mt-3 min-h-24" />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto max-w-full overflow-x-auto scrollbar-none">
          <Segmented layoutId="reply-sentiment" value={sentiment} onChange={setSentiment} options={SENTIMENT.map((s) => ({ value: s.value, label: s.label }))} />
        </div>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={text.trim().length < 2 || (personId === "__new" && !newName.trim())}>
          Log reply
        </Button>
      </div>
    </div>
  );
}
