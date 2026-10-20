"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Orb } from "@/components/ui/orb";
import { nowISO } from "@/lib/domain/ids";

/**
 * Asked once, just before the first draft ever: a few real emails let the drafts sound like the
 * founder instead of like software. Skippable; nothing else waits on it.
 */
export function VoicePrompt({ onContinue }: { onContinue: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const [text, setText] = useState("");
  const [added, setAdded] = useState(ws?.voice?.samples.length ?? 0);
  const [saving, setSaving] = useState(false);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const add = async () => {
    if (words < 15) return false;
    setSaving(true);
    const ok = await dispatch({ type: "voice.addSample", text: text.trim(), kind: "email", at: nowISO() });
    setSaving(false);
    if (ok) {
      setAdded((n) => n + 1);
      setText("");
    }
    return ok;
  };

  return (
    <div className="rounded-lg bg-surface p-4 ring-1 ring-border animate-[rise-in_200ms_var(--ease-out)]">
      <div className="flex items-start gap-2.5">
        <Orb state="needs" size={16} className="mt-1" />
        <div className="min-w-0">
          <p className="font-serif text-[17px] leading-[26px] text-fg">
            Teach me how you write: paste 2–3 emails you&apos;ve sent. <AiBadge className="ml-1 align-[2px]" />
          </p>
          <p className="mt-0.5 text-[13px] leading-5 text-fg-2">I&apos;ll match your greeting, length and tone. Ones that got replies work best. Saved on this computer. When I draft, I send Claude a couple of them as examples, so trim signatures and phone numbers.</p>
        </div>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="An email you wrote"
        placeholder="Paste one email you wrote, then Add. Leave out the signature."
        className="mt-3 min-h-28 text-[13.5px] leading-[21px]"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void add()} disabled={words < 15} loading={saving && words >= 15}>
          Add
        </Button>
        {added > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-fg-3">
            <Check className="size-3.5 text-success" /> {added} added
          </span>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onContinue}>
          Skip for now
        </Button>
        <Button
          variant="agent"
          size="sm"
          disabled={saving}
          onClick={async () => {
            if (words >= 15 && !(await add())) return;
            onContinue();
          }}
        >
          Write the draft
        </Button>
      </div>
    </div>
  );
}
