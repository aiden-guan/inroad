"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { ease } from "@/lib/motion";

/**
 * Leaving the sample: one click, no typed confirmation, since nothing real is lost (the sample is made
 * up and never backed up). If loading it replaced the founder's own workspace, that comes back (from the
 * backup taken then; Backups is out of reach from the first screen); otherwise the first screen, to set
 * up their company.
 */
export function useLeaveSample() {
  const { refresh } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/workspace/sample", { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { error?: string; restored?: boolean; workspace?: { onboarding?: { status?: string } } } | null;
      if (!res.ok) throw new Error(body?.error ?? "That didn't work. Try again.");
      await refresh();
      if (body?.restored) {
        router.push(body.workspace?.onboarding?.status === "hired" ? "/today" : "/welcome");
        toast("Sample cleared. Your own workspace is back, as it was before the sample.");
        return;
      }
      router.push("/welcome");
      toast("Sample cleared. Let's start with your website.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return { leave, busy };
}

/**
 * Says the sample is made up wherever the founder is, with the way out next to it: a slim strip across the top of
 * the page column, on every page and at every size. (It used to be a card in the sidebar, where it pushed the
 * pages and ⌘K below the fold.) The company menu keeps a "Sample" badge while the strip scrolls away.
 */
export function SampleBanner() {
  const { ws } = useWorkspace();
  const { leave, busy } = useLeaveSample();
  const name = ws?.company?.name ?? "This company";
  return (
    <AnimatePresence initial={false}>
      {ws?.sample && (
        <motion.div
          key="sample"
          role="note"
          aria-label="Sample workspace"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.22, ease: ease.out }}
          className="shrink-0 overflow-hidden"
        >
          <div className="flex min-h-10 items-center gap-2.5 border-b border-border bg-warning-subtle px-4 py-1 text-[13px] md:px-6">
            <FlaskConical className="size-3.5 shrink-0 text-warning" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-fg-2" title={`${name} and everyone here are made up`}>
              <span className="font-medium text-fg">
                Sample<span className="hidden sm:inline"> workspace</span>
              </span>
              <span aria-hidden> · </span>
              <span className="hidden sm:inline">{name} and everyone here are made up.</span>
              <span className="sm:hidden">made up</span>
            </p>
            <Button size="xs" variant="ghost" loading={busy} onClick={() => void leave()} className="-mr-2 shrink-0 text-fg hover:bg-surface/70">
              Start with my company <ArrowRight className="size-3" aria-hidden />
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
