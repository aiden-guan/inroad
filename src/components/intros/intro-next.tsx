"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { gmailComposeUrl } from "@/components/compose/handoff";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { CopyButton, Segmented } from "@/components/ui/misc";
import type { Action } from "@/lib/domain/actions";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Intro, IntroStage, Workspace } from "@/lib/domain/types";
import { targetFirstName, targetLabel, type IntroAction, type IntroNext } from "@/lib/intros/rules";
import { messageFor } from "@/lib/intros/templates";
import { first } from "@/lib/moves/util";

/** What each founder move is, in one sentence. */
function lead(action: IntroAction, intro: Intro, side?: 0 | 1): string {
  const c = first(intro.connectorName) || "your connector";
  const t = targetLabel(intro);
  if (intro.kind === "give") {
    const s = side !== undefined && intro.sides ? intro.sides[side] : undefined;
    const o = side !== undefined && intro.sides ? intro.sides[side === 0 ? 1 : 0] : undefined;
    if (action === "send_intro") return "Both said yes. Send one short email to both of them, then step back.";
    if (action === "check_how") return "Two weeks on, a light check-in keeps you in both their minds.";
    if (action === "let_go") return `${first(s?.name)} didn't answer. Close it; ${first(o?.name)} never learns they were asked.`;
    if (s && !s.askedOn) return `Ask ${first(s.name)} first. Nothing about them reaches ${first(o?.name)} until they say yes.`;
    return `One short nudge with an easy out. If ${first(s?.name)} stays quiet, let it go.`;
  }
  switch (action) {
    case "nudge":
      return `One short nudge with an easy out. If ${c} stays quiet after this, I'll suggest letting it go and trying another way in.`;
    case "check_in":
      return `${c} is checking with ${t}. One light check-in, never more.`;
    case "let_go":
      return "Quiet after your nudge. Close it here; the note is optional, and I'll stop suggesting this path for 90 days.";
    case "reply":
      return `Reply all within a day: it's the first thing ${t} sees of you. Thank ${c}, move them to BCC, offer times.`;
    case "book":
      return `One follow-up. If ${t} still doesn't pick a time, leave it there.`;
    case "close_loop":
      return `Tell ${c} what happened, good or not. Connectors who hear back introduce again.`;
    case "thank":
      return `${c} checked for you. Say thanks either way.`;
    default:
      return "";
  }
}

const DONE_LABEL: Record<IntroAction, string> = {
  nudge: "I sent the nudge",
  check_in: "I checked in",
  let_go: "Close it",
  reply: "I replied",
  book: "I followed up",
  close_loop: "I told them",
  thank: "I thanked them",
  send_intro: "I sent the intro",
  check_how: "I checked in",
};

/** The actions that record a finished move. Ids and timestamps are made here so both sides agree. */
function doneActions(intro: Intro, next: IntroNext, outcome: Intro["outcome"]): Action[] {
  const at = nowISO();
  const id = intro.id;
  switch (next.action) {
    case "nudge":
      if (intro.kind === "give" && next.side !== undefined) {
        return [{ type: "intro.mark", id, field: intro.sides?.[next.side].askedOn ? "nudgedOn" : "askedOn", side: next.side, at }];
      }
      return [{ type: "intro.mark", id, field: "nudgedOn", at }];
    case "check_in":
    case "book":
      return [{ type: "intro.mark", id, field: "nudgedOn", at }];
    case "reply":
      return [{ type: "intro.mark", id, field: "repliedOn", at }];
    case "close_loop":
      return [{ type: "intro.mark", id, field: "thankedOn", at }, ...(intro.stage !== "done" ? [{ type: "intro.advance" as const, id, stage: "done" as const, outcome, at }] : [])];
    case "thank":
      return [{ type: "intro.mark", id, field: "thankedOn", at }];
    case "let_go":
      return [{ type: "intro.advance", id, stage: "no_answer", at }];
    case "send_intro":
      return [{ type: "intro.advance", id, stage: "introduced", at, activityId: newId("act") }];
    case "check_how":
      return [{ type: "intro.mark", id, field: "thankedOn", at }, { type: "intro.advance", id, stage: "done", at }];
    default:
      return [];
  }
}

/**
 * The founder's next move on an intro: what it is, the note (written in code, editable), where to
 * send it, and one button that records it. Nothing is sent from here.
 */
export function IntroNextPanel({ intro, next, today, onDone }: { intro: Intro; next: IntroNext; today: string; onDone?: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const [outcome, setOutcome] = useState<NonNullable<Intro["outcome"]>>(intro.outcome ?? "useful");
  const [busy, setBusy] = useState(false);
  if (!ws || !next.action) return null;
  const action = next.action;
  const shown = action === "close_loop" ? { ...intro, outcome } : intro;
  const msg = messageFor(action, shown, ws, today, next.side);

  return (
    <div className="space-y-3">
      <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">{lead(action, intro, next.side)}</p>
      {action === "close_loop" && (
        <Segmented
          layoutId={`outcome-${intro.id}`}
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: "useful", label: "Useful" },
            { value: "pilot", label: "Moving ahead" },
            { value: "not_a_fit", label: "Not a fit" },
          ]}
        />
      )}
      {msg.body && (
        // Keyed by the generated text, so changing the outcome rewrites a note the founder hasn't touched.
        <MessageBox key={`${action}-${next.side ?? ""}-${msg.body}`} ws={ws} msg={msg} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={<Check className="size-3.5" />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const ok = await dispatch(doneActions(intro, next, outcome));
            setBusy(false);
            if (ok) {
              if (action === "let_go") toast("Closed. I won't suggest that path again for 90 days.");
              onDone?.();
            }
          }}
        >
          {next.side !== undefined && intro.kind === "give" && action === "nudge" && !intro.sides?.[next.side].askedOn ? `I asked ${first(intro.sides?.[next.side].name)}` : DONE_LABEL[action]}
        </Button>
        <StageControls intro={intro} compact />
      </div>
    </div>
  );
}

function MessageBox({ ws, msg }: { ws: Workspace; msg: ReturnType<typeof messageFor> }) {
  const [text, setText] = useState(msg.body);
  const url = gmailComposeUrl(ws, { to: msg.to ?? null, subject: msg.subject ?? null, body: text });
  return (
    <div className="rounded-md bg-surface ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[12px] text-fg-3">
        <span>{msg.where}</span>
        {msg.to && <span className="truncate font-mono text-[11.5px]">{msg.to}</span>}
        {msg.subject && <span className="truncate">“{msg.subject}”</span>}
        {msg.optional && <span className="ml-auto">Optional</span>}
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" className="min-h-28 rounded-none bg-transparent px-3 py-2.5 text-[13.5px] leading-[21px] ring-0 hover:ring-0" />
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-1.5">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12px] font-medium text-fg-2 ring-1 ring-border transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-[0.97]"
          >
            Open in Gmail <ArrowUpRight className="size-3.5" />
          </a>
        )}
        <CopyButton text={text} />
      </div>
    </div>
  );
}

/** "What happened?": one click per real-world event, so the intro's state always matches reality. */
export function StageControls({ intro, compact }: { intro: Intro; compact?: boolean }) {
  const { dispatch } = useWorkspace();
  const c = first(intro.connectorName) || "They";
  const t = targetFirstName(intro) ?? "They";
  const go = (stage: IntroStage, extra: Partial<Extract<Action, { type: "intro.advance" }>> = {}) =>
    void dispatch({ type: "intro.advance", id: intro.id, stage, at: nowISO(), activityId: stage === "introduced" ? newId("act") : undefined, ...extra });
  const consent = (side: 0 | 1, value: "yes" | "no") => void dispatch({ type: "intro.consent", id: intro.id, side, consent: value, at: nowISO() });

  const options: { label: string; run: () => void; tone?: "quiet" }[] = [];
  if (intro.kind === "give") {
    if (intro.stage === "asked") {
      intro.sides?.forEach((s, i) => {
        if (s.consent !== "pending" || !s.askedOn) return;
        options.push({ label: `${first(s.name)} said yes`, run: () => consent(i as 0 | 1, "yes") });
        options.push({ label: `${first(s.name)} passed`, run: () => consent(i as 0 | 1, "no"), tone: "quiet" });
      });
    }
  } else {
    switch (intro.stage) {
      case "asked":
        options.push({ label: `${c} is checking with ${t}`, run: () => go("forwarded") });
        options.push({ label: "Intro made", run: () => go("introduced") });
        options.push({ label: `${c} passed`, run: () => go("declined", { declinedBy: "connector" }), tone: "quiet" });
        break;
      case "forwarded":
        options.push({ label: "Intro made", run: () => go("introduced") });
        options.push({ label: `${t} passed`, run: () => go("declined", { declinedBy: "target" }), tone: "quiet" });
        break;
      case "introduced":
        options.push({ label: "Meeting booked", run: () => go("meeting") });
        options.push({ label: `${t} went quiet`, run: () => go("no_answer"), tone: "quiet" });
        break;
      case "meeting":
        options.push({ label: "It didn't happen", run: () => go("no_answer"), tone: "quiet" });
        break;
      case "declined":
      case "no_answer":
        options.push({ label: "They came back", run: () => go("forwarded"), tone: "quiet" });
        break;
    }
  }
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {!compact && <span className="mr-1 text-[12px] text-fg-3">What happened?</span>}
      {compact && <span className="mx-1 h-4 w-px bg-border" aria-hidden />}
      {options.map((o) => (
        <Button key={o.label} size="xs" variant="ghost" onClick={o.run} className={o.tone === "quiet" ? "text-fg-3" : undefined}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
