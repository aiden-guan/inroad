"use client";

import { Building2, ChevronsUpDown, UsersRound, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";
import { toast } from "sonner";
import { useActiveRuns, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Select } from "@/components/ui/field";
import { Popover } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import { CONSUMER_MODEL_LABELS, consumerModelOf, playbookMarket } from "@/lib/consumer/market";
import type { ConsumerModel, Market } from "@/lib/domain/types";
import { ease, spring } from "@/lib/motion";
import { landingAfterSwitch, shellMarket } from "./nav";

/**
 * Who the company sells to, switched from the company row at the top of the sidebar (and the phone menu, and ⌘K).
 * Switching is instant and keeps everything: the shell shows that market's pages, Today and every draft follow it,
 * and each market's own goal comes back when you return to it. Only the playbook waits to be asked, since
 * rewriting it is a model run.
 */

export const MODES: Record<Market, { label: string; line: string; icon: LucideIcon; gives: string }> = {
  b2b: { label: "Businesses", line: "Sells to businesses", icon: Building2, gives: "Accounts, deals, plays and warm intros, with revenue as the number." },
  consumer: { label: "Consumers", line: "Sells to consumers", icon: UsersRound, gives: "Weekly numbers, creators and communities, with retention first." },
};

export function useMarket(): Market {
  const { ws } = useWorkspace();
  return shellMarket(ws);
}

/** Switches the market. A page the new market doesn't use gives way to its counterpart, or Today. */
export function useSwitchMarket() {
  const { ws, dispatch } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    async (to: Market, consumerModel?: ConsumerModel): Promise<boolean> => {
      if (!ws?.company) return false;
      const ok = await dispatch({ type: "company.setMarket", market: to, consumerModel });
      const landing = ok ? landingAfterSwitch(pathname, to) : null;
      if (landing) router.push(landing);
      return ok;
    },
    [ws, dispatch, pathname, router],
  );
}

/** Businesses or consumers, as two radios that look like one control. */
export function MarketToggle({ value, onChange, className }: { value: Market; onChange: (market: Market) => void; className?: string }) {
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <fieldset className={cn("grid grid-cols-2 gap-1 rounded-lg bg-bg-subtle p-1 ring-1 ring-inset ring-border", className)}>
      <legend className="sr-only">Who you sell to</legend>
      {(["b2b", "consumer"] as const).map((m) => {
        const { icon: Icon, label } = MODES[m];
        const on = value === m;
        return (
          <label key={m} className="relative cursor-pointer">
            <input type="radio" name={id} value={m} checked={on} onChange={() => onChange(m)} className="peer sr-only" />
            {on && (
              <motion.span
                layoutId={`${id}-pill`}
                transition={reduce ? { duration: 0 } : spring.snappy}
                className="absolute inset-0 rounded-md bg-surface shadow-xs ring-1 ring-inset ring-border-strong/60"
              />
            )}
            <span
              className={cn(
                "relative flex h-10 items-center justify-center gap-1.5 rounded-md text-[13px] md:h-8 md:text-[12.5px] font-medium transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)]",
                on ? "text-fg" : "text-fg-3 hover:text-fg-2",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** The company row at the top of the sidebar: who you are, who you sell to, and the switch behind it. */
export function CompanySwitcher() {
  const { ws } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (!ws?.company) return null;
  const market = shellMarket(ws);
  return (
    <div className="mx-4 mb-5 shrink-0 border-b border-border pb-3">
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="start"
        className="w-[320px] p-3"
        trigger={
          <button
            title="Who you sell to"
            className="group -mx-1.5 flex w-[calc(100%+12px)] min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-colors duration-150 hover:bg-surface/70 data-[state=open]:bg-surface/70"
          >
            <Favicon domain={ws.company.domain} size={20} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[12px] font-medium leading-4 text-fg-2 transition-colors group-hover:text-fg">{ws.company.name}</span>
                {ws.sample && (
                  <Badge tone="warning" className="h-4 px-1 text-[10px]">
                    Sample
                  </Badge>
                )}
              </span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={market}
                  initial={{ opacity: 0, y: 3, filter: "blur(2px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -3, filter: "blur(2px)", transition: { duration: 0.1 } }}
                  transition={{ duration: 0.18, ease: ease.out }}
                  className="block truncate text-[11px] leading-4 text-fg-3"
                >
                  {MODES[market].line}
                </motion.span>
              </AnimatePresence>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-fg-4 transition-colors duration-150 group-hover:text-fg-3" aria-hidden />
          </button>
        }
      >
        <MarketPanel onNavigate={() => setOpen(false)} />
      </Popover>
    </div>
  );
}

/** Rewrites the playbook for the market chosen now (a foundation refresh). Everything the founder approved stays. */
export function useRewritePlaybook() {
  const { ws } = useWorkspace();
  const { start } = useRuns();
  const rewriting = useActiveRuns().some((r) => r.workflow === "foundation");
  const [asking, setAsking] = useState(false);
  const rewrite = async () => {
    if (!ws?.company) return;
    const market = shellMarket(ws);
    setAsking(true);
    const run = await start("foundation", { url: ws.company.domain || undefined, note: ws.company.founderNote, mode: "refresh", market, consumerModel: market === "consumer" ? consumerModelOf(ws) : undefined });
    setAsking(false);
    if (run) toast("Rewriting your playbook. Everything you approved stays.");
  };
  return { rewrite, busy: asking || rewriting, rewriting };
}

/** The market the playbook on file was written for, when it isn't the one chosen now. */
function useMismatch(): Market | null {
  const { ws } = useWorkspace();
  const written = ws ? playbookMarket(ws) : null;
  return ws && written && written !== shellMarket(ws) ? written : null;
}

/**
 * On the Playbook, when it was written for the other market: Today and new drafts follow the switch at once, the
 * playbook when it's rewritten. The sample's playbook is part of the demo, so it explains instead of offering a run.
 */
export function PlaybookMismatch({ className }: { className?: string }) {
  const { ws } = useWorkspace();
  const written = useMismatch();
  const { rewrite, busy, rewriting } = useRewritePlaybook();
  if (!ws || !written) return null;
  const now = MODES[shellMarket(ws)].label.toLowerCase();
  return (
    <div role="note" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-lg bg-bg-subtle px-4 py-3 ring-1 ring-inset ring-border", className)}>
      <p className="min-w-0 flex-1 basis-64 text-pretty text-[13px] leading-5 text-fg-2">
        {ws.sample
          ? `The sample's playbook was written for selling to ${MODES[written].label.toLowerCase()}, so parts of it won't fit ${now}. With your own company, it's written for the market you pick.`
          : `Written for selling to ${MODES[written].label.toLowerCase()}. Today and new drafts already follow your switch to ${now}; rewrite the playbook to match. Everything you approved stays.`}
      </p>
      {!ws.sample && (
        <Button size="sm" variant="agent" loading={busy} onClick={() => void rewrite()}>
          {rewriting ? "Rewriting your playbook" : `Rewrite it for ${now}`}
        </Button>
      )}
    </div>
  );
}

function MarketPanel({ onNavigate }: { onNavigate: () => void }) {
  const { ws } = useWorkspace();
  const switchTo = useSwitchMarket();
  const written = useMismatch();
  const { rewrite, busy, rewriting } = useRewritePlaybook();
  const modelId = useId();
  if (!ws?.company) return null;
  const market = shellMarket(ws);
  const model = consumerModelOf(ws);

  return (
    <div>
      <p className="mb-2 px-0.5 text-[11.5px] font-medium text-fg-3">Who you sell to</p>
      <MarketToggle value={market} onChange={(m) => void switchTo(m)} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={market}
          initial={{ opacity: 0, filter: "blur(2px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: 0.1 } }}
          transition={{ duration: 0.18, ease: ease.out }}
          className="mt-2 px-0.5 text-pretty text-[12.5px] leading-[18px] text-fg-2"
        >
          {MODES[market].gives}
        </motion.p>
      </AnimatePresence>

      {market === "consumer" && (
        <div className="mt-3">
          <label htmlFor={modelId} className="mb-1.5 block px-0.5 text-[11.5px] font-medium text-fg-3">
            Kind of consumer company
          </label>
          <Select id={modelId} value={model} onChange={(e) => void switchTo("consumer", e.target.value as ConsumerModel)} className="h-8 w-full text-[12.5px]">
            {(Object.keys(CONSUMER_MODEL_LABELS) as ConsumerModel[]).map((k) => (
              <option key={k} value={k}>
                {CONSUMER_MODEL_LABELS[k].label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* The sample's playbook is part of the demo: rewriting it would spend tokens on made-up data. */}
      {written && !ws.sample && (
        <div className="mt-3 rounded-md bg-bg-subtle px-3 py-2.5 ring-1 ring-inset ring-border">
          <p className="text-pretty text-[12.5px] leading-[18px] text-fg-2">
            Your playbook was written for {MODES[written].label.toLowerCase()}. Today and new drafts follow the switch already.
          </p>
          <Button size="xs" variant="agent" loading={busy} onClick={() => void rewrite()} className="mt-2">
            {rewriting ? "Rewriting your playbook" : `Rewrite it for ${MODES[market].label.toLowerCase()}`}
          </Button>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border px-0.5 pt-2.5 text-[11.5px] text-fg-3">
        <span>Nothing is deleted. Switch back any time.</span>
        <Link href="/settings#market" onClick={onNavigate} className="shrink-0 rounded-xs underline-offset-4 transition-colors hover:text-fg hover:underline">
          Settings
        </Link>
      </div>
    </div>
  );
}
