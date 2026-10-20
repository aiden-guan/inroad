"use client";

import { Check } from "lucide-react";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import type { Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";

const enter = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, transition: { duration: 0.12 } }, transition: { duration: 0.28, ease: ease.out } };

/**
 * "Two quick ones while I read." Skippable. Answers land in the workspace immediately; the running bet picks them
 * up on its next step, and discovery seeds from any domains named here.
 */
export function InlineQuestions({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const o = ws.onboarding;
  const [last3, setLast3] = useState(o.answers?.last3 ?? "");
  const [before, setBefore] = useState(o.answers?.before ?? "");

  if (o.questionsDone) {
    const answered = !!(o.answers?.last3 || o.answers?.before);
    if (!answered) return null;
    return (
      <motion.p {...enter} className="flex items-center gap-2 text-[13px] text-fg-2">
        <Check className="size-3.5 text-fg-3" aria-hidden />
        Got your answers. They go into the bet.
      </motion.p>
    );
  }

  const send = (e?: FormEvent, skip = false) => {
    e?.preventDefault();
    void dispatch({
      type: "onboarding.update",
      patch: {
        answers: skip ? o.answers : { ...o.answers, last3: last3.trim() || undefined, before: before.trim() || undefined },
        questionsDone: true,
      },
    });
  };

  return (
    <motion.form {...enter} onSubmit={send} className="rounded-lg bg-surface p-4 shadow-xs ring-1 ring-border sm:p-5" aria-labelledby="two-quick-ones">
      <h2 id="two-quick-ones" className="text-[13.5px] font-medium text-fg">
        Two quick ones while I read. <span className="font-normal text-fg-3">Skip if you like.</span>
      </h2>
      <div className="mt-4 space-y-4">
        <div>
          <Label htmlFor="onb-last3">Who are your last 3 users or design partners? Names or websites.</Label>
          <Input
            id="onb-last3"
            value={last3}
            onChange={(e) => setLast3(e.target.value)}
            placeholder="acme.com, northwind.io, Dana at Globex"
            maxLength={400}
            className="h-9 text-[16px] sm:text-[13.5px]"
          />
        </div>
        <div>
          <Label htmlFor="onb-before">What were they doing before you?</Label>
          <Input
            id="onb-before"
            value={before}
            onChange={(e) => setBefore(e.target.value)}
            placeholder="Spreadsheets and a script the CTO wrote"
            maxLength={400}
            className="h-9 text-[16px] sm:text-[13.5px]"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" kbd="↵" disabled={!last3.trim() && !before.trim()}>
          Send
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => send(undefined, true)}>
          Skip
        </Button>
      </div>
    </motion.form>
  );
}

/** Thin or JavaScript-only site: one sentence from the founder beats anything I'd guess. */
export function WhoBuysPrompt({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const o = ws.onboarding;
  const [who, setWho] = useState("");
  const n = o.pagesRead ?? 0;
  const pages = `${n} page${n === 1 ? "" : "s"}`;
  if (o.answers?.who) {
    return (
      <motion.p {...enter} className="flex items-center gap-2 text-[13px] text-fg-2">
        <Check className="size-3.5 text-fg-3" aria-hidden />
        Thanks. I&rsquo;ll build from your sentence.
      </motion.p>
    );
  }
  return (
    <motion.form
      {...enter}
      onSubmit={(e) => {
        e.preventDefault();
        if (who.trim()) void dispatch({ type: "onboarding.update", patch: { answers: { ...o.answers, who: who.trim() } } });
      }}
      className="rounded-lg bg-surface p-4 shadow-xs ring-1 ring-border sm:p-5"
    >
      <Label htmlFor="onb-who" className="mb-3 block text-pretty text-[13.5px] font-normal leading-5 text-fg">
        {o.site === "spa"
          ? `Your site is mostly JavaScript, so I could only read ${pages}. One sentence on who buys from you will make this much better.`
          : `I could only read ${pages} on your site. One sentence on who buys from you will make this much better.`}
      </Label>
      <div className="flex gap-2">
        <Input
          id="onb-who"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="Heads of platform at Series B fintechs who reconcile payments by hand"
          maxLength={300}
          className="h-9 min-w-0 flex-1 text-[16px] sm:text-[13.5px]"
        />
        <Button type="submit" variant="primary" size="md" className="h-9" disabled={!who.trim()}>
          Send
        </Button>
      </div>
    </motion.form>
  );
}
