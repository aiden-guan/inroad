"use client";

import { ExternalLink } from "lucide-react";
import { useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { CopyButton } from "@/components/ui/misc";
import { WorkLog } from "@/components/ui/work-log";
import { cn } from "@/lib/client/cn";
import type { Action } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { awaitingOutcome, gmailSearchLinks, searchDays, type AwaitingPerson } from "@/lib/moves/replies";
import { ago } from "@/lib/moves/util";

export interface CheckRepliesHandle {
  /** Returns true when the key was handled here (the page's own shortcuts then stand down). */
  handleKey: (e: KeyboardEvent) => boolean;
}

type Mark = "replied" | "no_reply" | "bounced" | "not_sent";

const MARK_LABEL: Record<Mark, string> = {
  replied: "Reply logged",
  no_reply: "No reply",
  bounced: "Bounced · address marked",
  not_sent: "Not sent · back in drafts",
};

/**
 * "Check replies": one Gmail search for everyone touched in 14 days, then one key per person.
 * R replied (paste it) · N no reply · B bounced · U didn't send. Rows stay visible once marked so
 * the founder can see what they did and draft a reply straight away.
 */
export function CheckReplies({
  ws,
  now,
  active,
  onFinished,
  onChanged,
  ref,
}: {
  ws: Workspace;
  now: number;
  active: boolean;
  onFinished: () => void;
  /** Something changed that other moves depend on (a reply logged, a step back in drafts). */
  onChanged: () => void;
  ref?: Ref<CheckRepliesHandle>;
}) {
  const { dispatch } = useWorkspace();
  const { start, runs } = useRuns();
  const pending = useMemo(() => awaitingOutcome(ws, new Date(now)), [ws, now]);
  // Snapshot at open so marked rows don't jump out from under the cursor.
  const [snapshot] = useState<AwaitingPerson[]>(() => pending);
  const rows = useMemo(() => {
    const ids = new Set(snapshot.map((p) => p.personId));
    return [...snapshot, ...pending.filter((p) => !ids.has(p.personId))];
  }, [snapshot, pending]);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [cursor, setCursor] = useState(0);
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [draftRuns, setDraftRuns] = useState<Record<string, string>>({});
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const emails = rows.filter((r) => r.email).map((r) => r.email!);
  // Threads still waiting on a time reach back past 14 days.
  const days = searchDays(rows, todayISO(new Date(now)));
  const links = gmailSearchLinks(emails, ws.founder.gmailAuthUser, days);
  const missingEmail = rows.length - emails.length;
  const allMarked = rows.length > 0 && rows.every((r) => marks[r.personId]);

  const at = () => nowISO();
  const mark = async (row: AwaitingPerson, m: Exclude<Mark, "replied">) => {
    const ids = row.touches.map((t) => t.id);
    const actions: Action[] = [];
    if (m === "no_reply") actions.push({ type: "activity.markOutcome", ids, outcome: "no_reply", at: at() });
    if (m === "bounced") {
      actions.push({ type: "activity.markOutcome", ids, outcome: "bounced", at: at() });
      actions.push({ type: "activity.log", activity: { id: newId("act"), at: at(), kind: "bounce", personId: row.personId, accountDomain: row.domain, channel: "email", summary: `Email to ${row.name} bounced`, source: "founder" } });
      const p = row.person;
      if (p && row.email) {
        const email = row.email.toLowerCase();
        const known = p.contactPaths.some((c) => c.value.toLowerCase() === email);
        const paths = known
          ? p.contactPaths.map((c) => (c.value.toLowerCase() === email ? { ...c, bounced: true, verified: false } : c))
          : [...p.contactPaths, { kind: "published_email" as const, value: row.email, verified: false, founderConfirmed: false, bounced: true }];
        actions.push({ type: "person.upsert", person: { ...p, contactPaths: paths } });
      }
    }
    if (m === "not_sent") {
      for (const t of row.touches) {
        if (t.draftRef && ws.outreach[t.draftRef.packageId]) actions.push({ type: "outreach.unapproveStep", packageId: t.draftRef.packageId, step: t.draftRef.step, activityId: t.id });
        else actions.push({ type: "activity.markOutcome", ids: [t.id], outcome: "not_sent", at: at() });
      }
    }
    setMarks((all) => ({ ...all, [row.personId]: m }));
    const ok = await dispatch(actions);
    if (!ok) setMarks((all) => ({ ...Object.fromEntries(Object.entries(all).filter(([k]) => k !== row.personId)) }));
    else onChanged();
  };

  const saveReply = async (row: AwaitingPerson) => {
    const text = (replyText[row.personId] ?? "").trim();
    if (!text) return;
    const ok = await dispatch([
      {
        type: "activity.log",
        activity: {
          id: newId("act"),
          at: at(),
          kind: "reply_received",
          personId: row.personId,
          accountDomain: row.domain,
          dealId: ws.accounts[row.domain]?.dealId,
          channel: "email",
          summary: `Reply from ${row.name}`,
          body: text.slice(0, 8000),
          source: "founder",
        },
      },
      { type: "activity.markOutcome", ids: row.touches.map((t) => t.id), outcome: "replied", at: at() },
    ]);
    if (ok) {
      setMarks((all) => ({ ...all, [row.personId]: "replied" }));
      setPasteFor(null);
      onChanged();
    }
  };

  const draftReply = async (row: AwaitingPerson) => {
    const r = await start("compose", { domain: row.domain, personId: row.personId, mode: "reply", replyText: replyText[row.personId] ?? "" }, { notify: false });
    if (r) setDraftRuns((all) => ({ ...all, [row.personId]: r.id }));
  };

  const undo = async (row: AwaitingPerson) => {
    const ok = await dispatch({ type: "activity.markOutcome", ids: row.touches.map((t) => t.id), outcome: null, at: at() });
    if (ok) setMarks((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== row.personId)));
  };

  const moveCursor = (to: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, to));
    setCursor(next);
    rowRefs.current.get(rows[next]?.personId ?? "")?.scrollIntoView({ block: "nearest" });
  };

  useImperativeHandle(ref, () => ({
    handleKey: (e: KeyboardEvent) => {
      if (!active || !rows.length) return false;
      const row = rows[cursor];
      const k = e.key.toLowerCase();
      if (pasteFor) return false; // the textarea owns the keyboard
      if (k === "j" || e.key === "ArrowDown") return moveCursor(cursor + 1), true;
      if (k === "k" || e.key === "ArrowUp") return moveCursor(cursor - 1), true;
      if (!row || marks[row.personId]) return k === "r" || k === "n" || k === "b" || k === "u";
      if (k === "r") return setPasteFor(row.personId), true;
      if (k === "n") return void mark(row, "no_reply"), moveCursor(cursor + 1), true;
      if (k === "b") return void mark(row, "bounced"), moveCursor(cursor + 1), true;
      if (k === "u") return void mark(row, "not_sent"), moveCursor(cursor + 1), true;
      return false;
    },
  }));

  if (!rows.length) {
    return <p className="text-[13px] text-fg-2">Nothing left to check. Every touch from the last 14 days has an outcome.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[13px] leading-5 text-fg-2">
          Open one search that shows replies from everyone you wrote to in the last {days} days, then mark each person here. Approving a draft counted it as sent; this is where that gets corrected.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {links.map((l, i) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.97]"
            >
              {links.length > 1 ? `Open search ${i + 1} of ${links.length}` : "Open Gmail search"}
              <ExternalLink className="size-3.5 opacity-70" />
            </a>
          ))}
          {links.length > 0 && <CopyButton text={links.map((l) => l.query).join("\n")} label="Copy query" />}
        </div>
        {missingEmail > 0 && (
          <p className="text-[12px] text-fg-3">
            {missingEmail === rows.length ? "None of these people have an email on file" : `${missingEmail} ${missingEmail === 1 ? "person has" : "people have"} no email on file`}; check LinkedIn for those.
          </p>
        )}
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-md ring-1 ring-border">
        {rows.map((row, i) => {
          const m = marks[row.personId];
          const isCursor = active && i === cursor;
          const runId = draftRuns[row.personId];
          const run = runId ? runs[runId] : undefined;
          return (
            <li
              key={row.personId}
              ref={(el) => {
                if (el) rowRefs.current.set(row.personId, el);
                else rowRefs.current.delete(row.personId);
              }}
              onClick={() => setCursor(i)}
              className={cn("px-3 py-2.5", isCursor && "bg-accent-subtle/60", m && "bg-bg-subtle/60")}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-[13.5px] font-medium", m ? "text-fg-2" : "text-fg")}>
                    {row.name} <span className="font-normal text-fg-3">· {row.company}</span>
                  </p>
                  <p className="truncate font-mono text-[11.5px] text-fg-3">
                    {row.lastLabel} {ago(row.lastAt, new Date(now))}
                    {row.awaitingTime && <span className="font-sans text-fg-2"> · said yes, no time yet</span>}
                    {row.email ? ` · ${row.email}` : " · no email"}
                  </p>
                </div>
                {m ? (
                  <div className="flex items-center gap-2 text-[12.5px] text-fg-2">
                    <span>{MARK_LABEL[m]}</span>
                    {m === "no_reply" && (
                      <button onClick={() => void undo(row)} className="text-fg-3 underline-offset-4 hover:text-fg hover:underline">
                        Undo
                      </button>
                    )}
                    {m === "replied" && !run && (
                      <Button size="sm" variant="agent" onClick={() => void draftReply(row)}>
                        Draft a reply
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    <RowButton k="R" label="Replied" onClick={() => setPasteFor(row.personId)} />
                    <RowButton k="N" label="No reply" onClick={() => void mark(row, "no_reply")} />
                    <RowButton k="B" label="Bounced" onClick={() => void mark(row, "bounced")} />
                    <RowButton k="U" label="Didn't send" onClick={() => void mark(row, "not_sent")} />
                  </div>
                )}
              </div>

              {pasteFor === row.personId && !m && (
                <div className="mt-2.5 space-y-2">
                  <Textarea
                    autoFocus
                    aria-label={`Paste ${row.name}'s reply`}
                    placeholder={`Paste ${row.name.split(" ")[0]}'s reply`}
                    value={replyText[row.personId] ?? ""}
                    onChange={(e) => setReplyText((all) => ({ ...all, [row.personId]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void saveReply(row);
                      }
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setPasteFor(null);
                      }
                    }}
                    className="min-h-24 text-[14px] leading-[22px]"
                  />
                  <div className="flex items-center gap-2">
                    {(replyText[row.personId] ?? "").trim() ? (
                      <Button size="sm" variant="primary" onClick={() => void saveReply(row)} kbd="⌘↵">
                        Log reply
                      </Button>
                    ) : (
                      <span className="text-[12px] text-fg-3">Paste the reply to log it. It stays on this machine.</span>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setPasteFor(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {run && <WorkLog run={run} className="mt-2.5" />}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        {allMarked ? (
          <Button
            variant="primary"
            onClick={() => {
              const replied = Object.values(marks).filter((m) => m === "replied").length;
              toast(replied ? `Checked. ${replied} ${replied === 1 ? "reply" : "replies"} logged.` : "Checked. No replies today.");
              onFinished();
            }}
          >
            Done checking
          </Button>
        ) : (
          <span className="text-[12.5px] text-fg-3">
            {rows.filter((r) => marks[r.personId]).length} of {rows.length} marked
          </span>
        )}
      </div>
    </div>
  );
}

function RowButton({ k, label, onClick }: { k: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-[12px] text-fg-2 transition-[background-color,color,transform] duration-150 hover:bg-surface hover:text-fg active:scale-[0.97]"
    >
      <Kbd className="hidden h-4 min-w-4 text-[10px] md:inline-flex">{k}</Kbd>
      <span>{label}</span>
    </button>
  );
}
