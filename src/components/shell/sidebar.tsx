"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Command, Moon, Sun, Target } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge } from "@/components/ui/badge";
import { useKeyboardDriven } from "@/components/ui/fx";
import { Kbd } from "@/components/ui/kbd";
import { Popover } from "@/components/ui/menu";
import { Num } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { OrbMorph, useWide } from "@/components/ui/orb-morph";
import { cn } from "@/lib/client/cn";
import { usd } from "@/lib/client/format";
import { monthKey, todayISO } from "@/lib/domain/ids";
import { ease, spring } from "@/lib/motion";
import { northStar } from "@/lib/revenue/north-star";
import { UpdateNotice } from "@/components/updates/update-notice";
import { AgentPanel, useAgentStatus, useNavCounts, type AgentStatus } from "./agent-status";
import { CompanyMenu, useMarket } from "./market-switch";
import { SECONDARY, navFor } from "./nav";

function readTheme(): "light" | "dark" {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribeTheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", cb);
  return () => {
    obs.disconnect();
    mq.removeEventListener("change", cb);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => null);
  /** Flips the theme; given the point it was asked from, the new theme spreads out from there as a circle. */
  const toggle = (from?: { x: number; y: number }) => {
    const apply = () => {
      const next = readTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch {
        // private mode
      }
    };
    const root = document.documentElement;
    if (!from || !document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
    root.style.setProperty("--vt-x", `${from.x}px`);
    root.style.setProperty("--vt-y", `${from.y}px`);
    root.style.setProperty("--vt-r", `${Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y))}px`);
    root.dataset.vt = "theme";
    void document.startViewTransition(apply).finished.finally(() => delete root.dataset.vt);
  };
  return { theme, toggle };
}

/** The agent's one live line: the run in progress (shimmering), or what's waiting. Crossfades when it changes. */
export function AgentLine({ status, className }: { status: AgentStatus; className?: string }) {
  const { line, active } = status;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={line}
        initial={{ opacity: 0, filter: "blur(2px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, filter: "blur(2px)" }}
        transition={{ duration: 0.15 }}
        className={cn("block truncate", active.length ? "shimmer-text" : status.ready ? "text-fg-2" : "text-fg-3", className)}
      >
        {line}
        {active.length > 1 && ` +${active.length - 1}`}
      </motion.span>
    </AnimatePresence>
  );
}

/** The agent in one line: its orb, what it's doing or what's waiting, and the runs behind it on a click. */
function AgentBlock() {
  const status = useAgentStatus();
  const wide = useWide();
  return (
    <Popover
      align="start"
      className="w-72 p-2"
      trigger={
        <button
          aria-label={`Head of GTM: ${status.line.trim() || "starting"}`}
          className="group flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-150 hover:bg-surface/70 data-[state=open]:bg-surface/70"
        >
          <span className="flex size-[18px] shrink-0 items-center justify-center">
            <OrbMorph on={wide} layout="desktop">
              <Orb state={status.state} size={16} tick={status.ticks} />
            </OrbMorph>
          </span>
          <AgentLine status={status} className="min-w-0 flex-1 text-[13px]" />
          <AiBadge className="shrink-0" />
        </button>
      }
    >
      <p className="flex items-center gap-1.5 px-1.5 pb-2 pt-0.5 text-[13px] font-medium text-fg">
        Head of GTM <AiBadge />
      </p>
      <AgentPanel status={status} />
    </Popover>
  );
}

/** "Ask or jump to…": ⌘K, always in view at the top of the sidebar. */
function PaletteButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("inroad:palette"))}
      aria-haspopup="dialog"
      className="flex h-8 w-full items-center gap-2 rounded-md bg-surface px-2.5 text-[13px] text-fg-3 shadow-xs ring-1 ring-inset ring-border transition-[color,box-shadow] duration-150 hover:text-fg-2 hover:ring-border-strong"
    >
      <Command className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left">Ask or jump to…</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

/**
 * The sidebar fits a 1440×800 window with nothing below the fold, and ⌘K never scrolls away:
 *   pinned top  136px  12 + company menu 36 + 8 + ⌘K 32 + 4 + agent 36 + 8
 *   pages       341px  10 business rows × 32 + 9 × 1 + 12 (consumer: 6 rows, 209px)
 *   pinned foot 151px  1 + 8 + north star 36 + 2 + Integrations 32 + 2 + Settings 32 + 2 + theme & spend 28 + 8
 *   = 628px. Only the pages scroll, and only in a window shorter than that; an update notice adds ~118px while shown.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { ws } = useWorkspace();
  const { theme, toggle } = useTheme();
  const spend = ws?.usage[monthKey()]?.costUsd ?? 0;
  const counts = useNavCounts();
  const market = useMarket();
  const reduce = useReducedMotion();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col border-r border-border bg-bg-subtle md:flex">
      <div className="flex shrink-0 flex-col gap-1 px-2 pb-2 pt-3">
        <CompanyMenu />
        <div className="pt-1">
          <PaletteButton />
        </div>
        <AgentBlock />
      </div>

      <nav aria-label="Workspace" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5 [scrollbar-width:thin]">
        <div className="relative flex flex-col gap-px">
          {/* Switching markets swaps pages in and out: leaving rows fade where they were, the rest glide into place. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {navFor(market).map((item) => (
              <motion.div
                key={item.href}
                layout={reduce ? false : "position"}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14, ease: ease.inQuad } }}
                transition={{ duration: 0.22, ease: ease.out, layout: spring.layout }}
              >
                <NavLink href={item.href} label={item.label} icon={item.icon} shortcut={`G then ${item.key}`} active={pathname.startsWith(item.href)} count={counts[item.href]} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </nav>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-border px-2 pb-2 pt-2">
        <UpdateNotice />
        <NorthStarLine />
        {SECONDARY.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} shortcut={`G then ${item.key}`} active={pathname.startsWith(item.href)} />
        ))}
        <div className="flex h-7 items-center justify-between gap-2 pl-2.5 pr-0.5">
          <Link href="/settings#usage" className="min-w-0 truncate rounded-xs text-[12px] text-fg-3 transition-colors hover:text-fg-2" title="AI spend this month, on your own key">
            AI spend <span className="font-mono tnum">{usd(spend)}</span>
          </Link>
          <button
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              toggle(e.detail ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined);
            }}
            aria-label="Toggle theme"
            title={theme === "dark" ? "Light theme" : "Dark theme"}
            className="relative grid size-7 shrink-0 place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface hover:text-fg [&>*]:[grid-area:1/1]"
          >
            <AnimatePresence initial={false}>
              <motion.span
                key={theme ?? "none"}
                initial={{ opacity: 0, rotate: -90, scale: 0.5, filter: "blur(2px)" }}
                animate={{ opacity: 1, rotate: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, rotate: 90, scale: 0.5, filter: "blur(2px)" }}
                transition={spring.snappy}
                className="flex"
              >
                {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * The one number in view on every page: committed against the revenue target once one is set ("$66K of $150K
 * committed"), else the goal from the plan ("2 of 5 paid pilots"). It opens Revenue, or Growth for a consumer
 * company. The words come from lib/revenue/north-star, which Today uses too.
 */
export function NorthStarLine({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { ws } = useWorkspace();
  // Read the clock only once the workspace is here: never while prerendering the shell.
  const star = useMemo(() => (ws ? northStar(ws, todayISO()) : null), [ws]);
  if (!star) return <div aria-hidden className={cn("h-9", className)} />;
  return (
    <Link
      href={star.href}
      onClick={onNavigate}
      title={star.description}
      aria-label={star.description}
      className={cn("group flex h-9 flex-col justify-center gap-1 rounded-md px-2.5 transition-colors duration-150 hover:bg-surface/60", className)}
    >
      <span className="flex min-w-0 items-center gap-2 text-[12.5px] leading-[18px]">
        <Target className="size-3.5 shrink-0 text-fg-3 transition-colors group-hover:text-fg-2" aria-hidden />
        <span className="min-w-0 truncate tnum text-fg-2 transition-colors group-hover:text-fg">{star.text}</span>
      </span>
      <span aria-hidden className="ml-[22px] block h-[2px] overflow-hidden rounded-full bg-border">
        <span className="block h-full origin-left rounded-full bg-fg-3 transition-transform duration-500 ease-out" style={{ transform: `scaleX(${star.progress})` }} />
      </span>
    </Link>
  );
}

/** The goal line under its earlier name (the phone menu used it). */
export const GoalLine = NorthStarLine;

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  count,
  shortcut,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  count?: number;
  shortcut?: string;
}) {
  // "G then T" is used all day: from the keyboard the selection snaps; from a click it glides.
  const keyboard = useKeyboardDriven();
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors duration-150",
        active ? "font-medium text-fg" : "text-fg-2 hover:bg-surface/60 hover:text-fg",
      )}
      title={shortcut}
    >
      {active && (
        <motion.span
          layoutId="nav-selection"
          transition={keyboard ? { duration: 0 } : spring.glide}
          className="absolute inset-0 rounded-md bg-surface shadow-xs ring-1 ring-inset ring-border"
        />
      )}
      <Icon className={cn("relative size-4 shrink-0 transition-colors duration-150", active ? "text-fg" : "text-fg-3")} />
      <span className="relative min-w-0 flex-1 truncate">{label}</span>
      <AnimatePresence initial={false}>
        {count !== undefined && (
          <motion.span
            key="count"
            initial={{ opacity: 0, scale: 0.5, x: -4, y: 4 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
            transition={spring.pop}
            className="relative min-w-5 rounded-md bg-accent-subtle px-1.5 text-center font-mono text-[12px] font-medium leading-[18px] text-accent-text"
          >
            <Num value={count} />
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}
