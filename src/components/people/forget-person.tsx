"use client";

import { useState } from "react";
import { toast } from "sonner";
import { HoldButton } from "@/components/companies/sheet/shared";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { cn } from "@/lib/client/cn";
import { firstName } from "@/lib/client/format";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Person } from "@/lib/domain/types";
import { emailsOf } from "@/lib/people/forget";

/**
 * "Delete their details": what the cold-email footer promises when someone asks. Hold to confirm,
 * and no undo, because it really deletes: the person, their drafts and contact paths, and the
 * sources that name them. Only their email stays, on the suppression list, so nothing writes to them again.
 */
export function ForgetPerson({ person, onDone, onCancel, className }: { person: Person; onDone?: () => void; onCancel?: () => void; className?: string }) {
  const { dispatch } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const first = firstName(person.name) || "them";
  const kept = emailsOf(person);

  const forget = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await dispatch({ type: "person.forget", id: person.id, at: nowISO(), suppressionId: newId("sup") });
    setBusy(false);
    if (!ok) return;
    toast(kept.length ? `Deleted ${person.name}'s details. Only their email stays, so I never write to them again.` : `Deleted ${person.name}'s details.`);
    onDone?.();
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      <p className="max-w-[62ch] text-[12.5px] leading-[19px] text-fg-2">
        Deletes {first}, their contact details, every draft to them and the sources that name them.{" "}
        {kept.length ? `Only ${kept.length === 1 ? "their email stays" : "their emails stay"}, on your suppression list, so I never write to them again.` : "There's no email on file, so nothing is kept."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <HoldButton onConfirm={() => void forget()} disabled={busy}>
          Hold to delete {first}&apos;s details
        </HoldButton>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-7 rounded-sm px-2 text-[12.5px] text-fg-3 transition-colors hover:text-fg">
            Keep
          </button>
        )}
      </div>
    </div>
  );
}
