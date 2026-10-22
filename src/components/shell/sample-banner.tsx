"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/cn";
import { ease } from "@/lib/motion";

/**
 * Leaving the sample: one click, no typed confirmation, since nothing real is lost (the sample is made
 * up and never backed up). Clears it and goes to the first screen to set up the founder's own company.
 */
export function useLeaveSample() {
  const { refresh } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/workspace/reset", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't work. Try again.");
      await refresh();
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
 * Says the sample is made up wherever the founder is, with the way out next to it. A card at the top
 * of the sidebar on desktop, a slim bar under the header on a phone.
 */
export function SampleBanner({ variant }: { variant: "sidebar" | "bar" }) {
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
          className={cn("overflow-hidden", variant === "bar" && "md:hidden")}
        >
          {variant === "sidebar" ? (
            <div className="mx-2 mb-2 rounded-md bg-warning-subtle px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-warning">
                <FlaskConical className="size-3.5" aria-hidden /> Sample workspace
              </p>
              <p className="mt-0.5 text-[12px] leading-[17px] text-fg-2 text-pretty">{name} and everyone here are made up.</p>
              <Button size="xs" variant="ghost" loading={busy} onClick={() => void leave()} className="-ml-2 mt-1 text-fg hover:bg-surface/70">
                Start with my company <ArrowRight className="size-3" aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-b border-border bg-warning-subtle px-4 py-2 text-[12.5px]">
              <FlaskConical className="size-3.5 shrink-0 text-warning" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-fg-2" title={`${name} and everyone here are made up`}>
                <span className="font-medium text-fg">Sample</span> <span aria-hidden>·</span> made up
              </p>
              <Button size="xs" variant="ghost" loading={busy} onClick={() => void leave()} className="-mr-2 shrink-0 text-fg hover:bg-surface/70">
                Start with my company <ArrowRight className="size-3" aria-hidden />
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
