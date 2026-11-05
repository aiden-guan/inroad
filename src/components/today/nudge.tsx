"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { copyText, gmailFromUrl } from "@/components/compose/handoff";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import type { Action } from "@/lib/domain/actions";
import { addBusinessDays, newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Activity, ID, Person, Workspace } from "@/lib/domain/types";
import { emailOf, first } from "@/lib/moves/util";
import { signOff } from "@/lib/quality/gates";
import { readIntent } from "@/lib/replies/intent";
import { REMIND_BUSINESS_DAYS } from "@/lib/replies/remind";
import { replyBody } from "@/lib/replies/sender";
import { RemindControl } from "./remind-toggle";

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * A short note written in code (a bump, a nudge, a check-back), editable, handed off the way every draft is: open the
 * thread in Gmail or copy it, send it from there, then Mark as sent here (A while the card is focused). The logged
 * send gets "Remind me if no reply" like any other, and the toast can change it or take the send back.
 */
export function NudgeComposer({
  ws,
  person,
  domain,
  dealId,
  initial,
  summary,
  label,
  focused,
  moveId,
  channel,
  onSent,
}: {
  ws: Workspace;
  person: Person;
  domain: string;
  dealId?: ID;
  initial: string;
  /** What the timeline says about the send: "Followed up with Leo Marchetti". */
  summary: string;
  label: string;
  focused: boolean;
  /** The card this send finishes, reopened by Undo. */
  moveId?: ID;
  channel?: Activity["channel"];
  onSent: () => void;
}) {
  const { dispatch } = useWorkspace();
  const id = useId();
  const [text, setText] = useState(initial);
  const so = signOff(ws);
  const outgoing = `${text.trim()}${so ? `\n\n${so}` : ""}`;
  const email = emailOf(person);
  const viaLinkedIn = channel === "linkedin";
  const name = first(person.name) || "them";

  const sent = async () => {
    if (!text.trim()) return;
    const activityId = newId("act");
    const ok = await dispatch({
      type: "activity.log",
      activity: {
        id: activityId,
        at: nowISO(),
        kind: viaLinkedIn ? "linkedin_dm" : "touch_sent",
        personId: person.id,
        accountDomain: domain,
        dealId,
        channel: viaLinkedIn ? "linkedin" : "email",
        summary,
        body: text.trim(),
        source: "founder",
        remindOn: addBusinessDays(todayISO(), REMIND_BUSINESS_DAYS),
      },
    });
    if (!ok) return;
    onSent();
    toast(`Marked as sent to ${name}.`, {
      duration: 10_000,
      description: <RemindControl activityId={activityId} />,
      action: { label: "Undo", onClick: () => void dispatch([{ type: "activity.remove", id: activityId }, ...(moveId ? [{ type: "move.reopen" as const, id: moveId }] : [])]) },
    });
  };

  // A marks it as sent, like approving a draft: the card's own way to finish (Today stands down for it).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || e.key.toLowerCase() !== "a") return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      void sent();
    };
  });
  useEffect(() => {
    if (!focused) return;
    const listener = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [focused]);

  return (
    <div className="space-y-2.5">
      <div className="draft-rule rounded-r-md py-2 pl-3.5 pr-2">
        <Label htmlFor={`${id}-note`} className="sr-only">
          {label}
        </Label>
        <Textarea id={`${id}-note`} value={text} onChange={(e) => setText(e.target.value)} className="min-h-20 text-[15px] leading-6 ring-border" />
        {so && <p className="mt-1.5 text-[15px] leading-6 text-fg-2">{so}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {email && !viaLinkedIn && (
          <Button
            size="sm"
            variant="secondary"
            icon={<ArrowUpRight className="size-3.5" />}
            onClick={async () => {
              await copyText(outgoing);
              window.open(gmailFromUrl(ws, email), "_blank", "noopener,noreferrer");
              toast("Copied. Paste it as a reply in your thread with them, then press Mark as sent.");
            }}
          >
            Open thread in Gmail
          </Button>
        )}
        <CopyButton text={outgoing} className="h-7" />
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} kbd={focused ? "A" : undefined} onClick={() => void sent()} disabled={!text.trim()}>
          Mark as sent
        </Button>
      </div>
    </div>
  );
}

/**
 * "They replied": Inroad can't read the inbox, so a reminder may come due on a thread that did get an answer. Paste
 * it here: it's logged as their words (cleaned of the quoted thread), the sends it answers are marked replied, and the
 * reply moves into the replies lane. An auto-reply is logged as one, so it holds the thread instead of ending it.
 */
export function TheyReplied({ person, domain, dealId, touchIds, onLogged }: { person: Person; domain: string; dealId?: ID; touchIds: ID[]; onLogged: () => void }) {
  const { dispatch } = useWorkspace();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const name = first(person.name) || "them";
  const save = async () => {
    const body = replyBody(text).trim();
    if (!body) return;
    const at = nowISO();
    const auto = readIntent(body)?.intent === "ooo";
    const actions: Action[] = [
      {
        type: "activity.log",
        activity: { id: newId("act"), at, kind: "reply_received", personId: person.id, accountDomain: domain, dealId, channel: "email", summary: `Reply from ${person.name}`, body: body.slice(0, 8000), source: "founder", ...(auto ? { sentiment: "ooo" as const } : {}) },
      },
      ...(touchIds.length ? [{ type: "activity.markOutcome" as const, ids: touchIds, outcome: "replied" as const, at }] : []),
    ];
    if (await dispatch(actions)) {
      onLogged();
      toast(`Logged ${name}'s reply. It's in your replies now.`);
    }
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
        {name} replied
      </button>
    );
  }
  return (
    <div className="w-full space-y-2 pt-1 animate-[fade-in_150ms_var(--ease-out)]">
      <Label htmlFor={`${id}-reply`} className="sr-only">
        Paste {name}&apos;s reply
      </Label>
      <Textarea
        id={`${id}-reply`}
        autoFocus
        value={text}
        placeholder={`Paste ${name}'s reply. It stays on this machine.`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="min-h-20 text-[14px] leading-[22px]"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" kbd="⌘↵" disabled={!text.trim()} onClick={() => void save()}>
          Log the reply
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The quiet text links under a card's main action. */
export function ModeLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-fg-2 underline-offset-4 hover:text-fg hover:underline">
      {children}
    </button>
  );
}
