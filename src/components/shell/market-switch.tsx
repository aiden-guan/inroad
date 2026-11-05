"use client";

import { Building2, ChevronsUpDown, Keyboard, Settings, UsersRound, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useRuns, useRunsSelector, type RunState } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Popover } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/client/cn";
import { CONSUMER_MODEL_LABELS, consumerModelOf, playbookMarket } from "@/lib/consumer/market";
import type { ConsumerModel, Market } from "@/lib/domain/types";
import { ease, spring } from "@/lib/motion";
import { landingAfterSwitch, shellMarket } from "./nav";

/**
 * Who the company sells to, switched from the company menu at the top of the sidebar (and the phone menu, ⌘K and
 * Settings). Switching is instant and keeps everything: the shell shows that market's pages, Today and every draft
 * follow it, and each market's own goal comes back when you return to it. Only the playbook waits to be asked,
 * since rewriting it is a model run.
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
                "relative flex h-10 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] md:h-8 md:text-[12.5px]",
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

/**
 * The company menu at the top of the sidebar (and of the phone menu): the workspace, named the founder's company.
 * It holds who you sell to (the switch that swaps the pages), and the way to Settings and the shortcuts.
 */
export function CompanyMenu({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { ws } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (!ws?.company) {
    return (
      <div aria-hidden className={cn("flex h-9 items-center gap-2.5 px-2", className)}>
        <span className="skeleton size-[18px] rounded-[5px]" />
        <span className="skeleton h-3 w-24 rounded-sm" />
      </div>
    );
  }
  const close = () => {
    setOpen(false);
    onNavigate?.();
  };
  const { name, domain } = ws.company;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="w-[300px] p-0"
      trigger={
        <button
          title="Your company, who you sell to, and settings"
          className={cn(
            "group flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-150 hover:bg-surface/70 data-[state=open]:bg-surface/70",
            className,
          )}
        >
          <Favicon domain={domain} name={name} size={18} />
          <span className="min-w-0 truncate text-[13px] font-medium text-fg">{name}</span>
          {ws.sample && <Badge tone="warning">Sample</Badge>}
          <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-fg-3 transition-colors duration-150 group-hover:text-fg-2" aria-hidden />
        </button>
      }
    >
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        <Favicon domain={domain} name={name} size={24} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium leading-5 text-fg">{name}</p>
          {domain && <p className="truncate font-mono text-[12px] leading-4 text-fg-3">{domain}</p>}
        </div>
      </div>
      <div className="p-3">
        <MarketPanel />
      </div>
      <div className="border-t border-border p-1.5">
        <MenuRow href="/settings#company" icon={Building2} onSelect={close}>
          Company and market
        </MenuRow>
        <MenuRow href="/settings" icon={Settings} keys="G S" onSelect={close}>
          Settings
        </MenuRow>
        <MenuRow
          icon={Keyboard}
          keys="?"
          onSelect={() => {
            close();
            window.dispatchEvent(new Event("inroad:shortcuts"));
          }}
        >
          Keyboard shortcuts
        </MenuRow>
      </div>
    </Popover>
  );
}

/** The sidebar's company row under its earlier name. */
export const CompanySwitcher = CompanyMenu;

function MenuRow({ href, icon: Icon, keys, onSelect, children }: { href?: string; icon: LucideIcon; keys?: string; onSelect: () => void; children: ReactNode }) {
  const body = (
    <>
      <Icon className="size-4 shrink-0 text-fg-3" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {keys && <span className="hidden font-mono text-[12px] text-fg-3 md:pointer-fine:inline">{keys}</span>}
    </>
  );
  const row = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-fg-2 transition-colors duration-100 hover:bg-bg-subtle hover:text-fg";
  return href ? (
    <Link href={href} onClick={onSelect} className={row}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onSelect} className={row}>
      {body}
    </button>
  );
}

const rewritingNow = (runs: Record<string, RunState>) => Object.values(runs).some((r) => r.workflow === "foundation" && (r.status === "running" || r.status === "queued"));

/** Rewrites the playbook for the market chosen now (a foundation refresh). Everything the founder approved stays. */
export function useRewritePlaybook() {
  const { ws } = useWorkspace();
  const { start } = useRuns();
  const rewriting = useRunsSelector(rewritingNow);
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

function MarketPanel() {
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
      <p className="mb-2 px-0.5 text-[12px] font-medium text-fg-3">Who you sell to</p>
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
          {MODES[market].gives} <span className="text-fg-3">Nothing is deleted; switch back any time.</span>
        </motion.p>
      </AnimatePresence>

      {market === "consumer" && (
        <div className="mt-3">
          <label htmlFor={modelId} className="mb-1.5 block px-0.5 text-[12px] font-medium text-fg-3">
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
    </div>
  );
}
