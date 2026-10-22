"use client";

import { ArrowUpRight, Check, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { gmailComposeUrl } from "@/components/compose/handoff";
import { useAsk } from "@/components/providers/ask-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { referralAsk } from "@/lib/customers/known-users";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";

/**
 * "Who else has this problem?" for one customer: the note, written in code in the founder's voice, to
 * edit, open in Gmail or copy, then one click to record that it went. Recording it closes the Today card.
 * The AI draft stays one click away for a longer, forwardable version. `inline` drops the frame and the
 * header, for the Today card that already carries the title.
 */
export function ReferralAsk({ ws, domain, onClose, inline = false }: { ws: Workspace; domain: string; onClose: () => void; inline?: boolean }) {
  const { dispatch } = useWorkspace();
  const { openAsk } = useAsk();
  const ask = referralAsk(ws, domain);
  const [text, setText] = useState(ask.body);
  const [busy, setBusy] = useState(false);
  const acc = ws.accounts[domain];
  if (!acc) return null;
  const person = ask.personName ? Object.values(ws.people).find((p) => p.accountDomain === domain && p.name === ask.personName) : undefined;
  const who = ask.personName?.split(" ")[0] ?? acc.name;
  const url = gmailComposeUrl(ws, { to: ask.to, subject: ask.subject, body: text });

  async function asked() {
    setBusy(true);
    const ok = await dispatch({
      type: "activity.log",
      activity: { id: newId("act"), at: nowISO(), kind: "intro_requested", accountDomain: domain, ...(person ? { personId: person.id } : {}), channel: "email", summary: `Asked ${ask.personName ?? acc.name} who else has the problem`, body: text, source: "founder" },
    });
    setBusy(false);
    if (ok) {
      toast(`Noted. When ${who} names someone, add them from ${acc.name}'s sheet.`);
      onClose();
    }
  }

  const note = (
    <div className="rounded-md bg-surface ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[12px] text-fg-3">
        <span>Email</span>
        {ask.to && <span className="truncate font-mono text-[11.5px]">{ask.to}</span>}
        <span className="truncate">“{ask.subject}”</span>
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Referral note" className="min-h-32 rounded-none bg-transparent px-3 py-2.5 text-[13.5px] leading-[21px] ring-0 hover:ring-0" />
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

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" size="sm" icon={<Check className="size-3.5" />} loading={busy} onClick={() => void asked()}>
        I asked {who}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          openAsk({
            context: { kind: "account", id: domain },
            prefill: `Draft a short referral ask for ${acc.name}: who else they know with the same problem, and a forwardable two-line blurb.`,
          })
        }
      >
        Write a longer one with AI
      </Button>
    </div>
  );

  if (inline) {
    return (
      <div className="space-y-3" aria-label={`Referral ask for ${acc.name}`}>
        {note}
        {actions}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: ease.out }}
      className="mb-4 rounded-lg bg-surface p-3.5 shadow-xs ring-1 ring-border"
      aria-label={`Referral ask for ${acc.name}`}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-fg">Ask {ask.personName ? `${who} at ${acc.name}` : acc.name} who else has this problem</p>
          <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">One or two named peers beat a general &ldquo;let me know if you hear of anyone&rdquo;. Edit it to sound like you.</p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      {note}
      <div className="mt-3">{actions}</div>
    </motion.div>
  );
}
