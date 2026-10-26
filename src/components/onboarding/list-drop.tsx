"use client";

import { Check, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { DropZone } from "@/components/import/drop-zone";
import { postJson } from "@/components/import/api";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { droppedLine, planDrop } from "@/lib/network/drop";
import type { ImportResponse } from "@/lib/network/types";
import { ease } from "@/lib/motion";

/**
 * "Got a list?" while the site is read (SPEC §3.2 step 1): Connections.csv, a waitlist or a user export, in
 * one drop. Discovery looks for people the founder knows at every company it finds; the network screen runs
 * once the bet exists (Today starts it). Names stay on this computer.
 */
export function ListDrop() {
  const { refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onFile(name: string, text: string) {
    const plan = planDrop(text);
    if (plan.kind === "empty") {
      setError(`${name} has no rows I can read.`);
      return;
    }
    if (plan.kind === "unmapped") {
      setError(`I couldn't find a website or work-email column in ${name}. You can pick the columns in the importer after this.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res =
        plan.kind === "linkedin"
          ? await postJson<ImportResponse>("/api/import/linkedin", { fileName: name, text, screen: false })
          : await postJson<ImportResponse>("/api/import", { fileName: name, text, preset: plan.preset, mapping: plan.mapping });
      setDone(droppedLine(res.batch));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {done ? (
        <motion.p
          key="done"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: ease.out }}
          className="flex gap-2 text-pretty text-[13px] leading-5 text-fg-2"
          role="status"
        >
          <Check className="mt-0.5 size-3.5 shrink-0 text-fg-3" aria-hidden />
          {done}
        </motion.p>
      ) : (
        <motion.div key="drop" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
          <DropZone
            compact
            title="Got a list? Drop it here"
            hint="Your LinkedIn Connections.csv, a waitlist or a user export. I'll start with people who already know you."
            icon={<Users className="size-4" aria-hidden />}
            onFile={(n, t) => void onFile(n, t)}
            busy={busy}
            error={error}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
