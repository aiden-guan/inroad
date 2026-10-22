"use client";

import { Check, Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { addKnown } from "@/components/companies/list/add-customers";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { accountFor, parseKnownUsers } from "@/lib/customers/known-users";
import type { Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";

const names = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The users the founder named while I read ("Who are your last 3 users?") aren't prospects: one click
 * makes them customers, so the Customers tab has them, a referral ask comes next on Today, and anyone
 * there who changes jobs is flagged as someone who knows the product.
 */
export function KnownUsers({ ws }: { ws: Workspace }) {
  const { refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const users = parseKnownUsers(ws.onboarding.answers?.last3);
  const open = users.filter((u) => accountFor(ws, u)?.status !== "customer");
  if (!users.length || (!open.length && !done)) return null;

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await addKnown(ws, open);
      setDone(r.line);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-lg bg-bg-subtle px-3.5 py-3 ring-1 ring-border" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.p key="done" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: ease.out }} className="flex gap-2 text-pretty text-[13px] leading-5 text-fg-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            <span>{done} I&apos;ll ask them who else has this problem.</span>
          </motion.p>
        ) : (
          <motion.div key="ask" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            <p className="flex gap-2 text-pretty text-[13px] leading-5 text-fg-2">
              <Star className="mt-0.5 size-3.5 shrink-0 text-fg-3" aria-hidden />
              <span>
                You named {names(open.map((u) => u.name))}. They&apos;re customers, not prospects: I&apos;ll ask them who else has this problem, and flag anyone there who changes jobs.
              </span>
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-5.5">
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void add()}>
                Add {open.length === 1 ? "them" : `all ${open.length}`} as customers
              </Button>
              {error && <span className="text-[12.5px] text-danger">{error}</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
