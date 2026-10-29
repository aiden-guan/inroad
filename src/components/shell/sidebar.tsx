"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Command, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { useKeyboardDriven } from "@/components/ui/fx";
import { Kbd } from "@/components/ui/kbd";
import { Popover } from "@/components/ui/menu";
import { Num } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { OrbMorph, useWide } from "@/components/ui/orb-morph";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/client/cn";
import { usd } from "@/lib/client/format";
import { isConsumer } from "@/lib/consumer/market";
import { monthKey, todayISO } from "@/lib/domain/ids";
import { ease, spring } from "@/lib/motion";
import { goalLine } from "@/lib/moves/nav-counts";
import { UpdateNotice } from "@/components/updates/update-notice";
import { AgentPanel, useAgentStatus, useNavCounts, type AgentStatus } from "./agent-status";
import { CompanySwitcher, useMarket } from "./market-switch";
import { SECONDARY, navFor } from "./nav";
import { SampleBanner } from "./sample-banner";

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
        className={cn("block truncate", active.length ? "shimmer-text" : "text-fg-3", className)}
      >
        {line}
        {active.length > 1 && ` +${active.length - 1}`}
      </motion.span>
    </AnimatePresence>
  );
}

function AgentBlock() {
  const status = useAgentStatus();
  const wide = useWide();
  return (
    <Popover
      align="start"
      className="w-72 p-2"
      trigger={
        <button className="group flex w-full items-center gap-3 rounded-xl bg-surface/70 px-3 py-3 text-left ring-1 ring-inset ring-border transition-[background-color,box-shadow] duration-150 hover:bg-surface-raised hover:shadow-sm">
          <OrbMorph on={wide} layout="desktop">
            <Orb state={status.state} size={22} tick={status.ticks} />
          </OrbMorph>
          <span className="min-w-0 flex-1">
            <span className="mb-0.5 flex items-center gap-1.5 text-[12px] font-medium text-fg">
              Head of GTM <AiBadge />
            </span>
            <AgentLine status={status} className="text-[12px]" />
          </span>
        </button>
      }
    >
      <AgentPanel status={status} />
    </Popover>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { ws } = useWorkspace();
  const { theme, toggle } = useTheme();
  const spend = ws?.usage[monthKey()]?.costUsd ?? 0;
  const counts = useNavCounts();
  const market = useMarket();
  const reduce = useReducedMotion();

  return (
    <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-border bg-bg-subtle [scrollbar-width:thin] md:flex">
      <div className="flex h-[76px] shrink-0 items-center gap-2.5 px-5">
        {/* The layout persists across navigation, so this draws once per page load. */}
        <BrandMark draw="once" className="size-8 text-fg" />
        <span className="font-serif text-[27px] font-medium tracking-[-0.04em] text-fg [font-variation-settings:'opsz'_48]">{BRAND.product}</span>
      </div>

      <CompanySwitcher />

      <SampleBanner variant="sidebar" />

      <div className="shrink-0 px-3 pb-6">
        <AgentBlock />
      </div>

      <nav aria-label="Workspace" className="relative flex shrink-0 flex-col gap-1 px-3">
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
              <NavLink
                href={item.href}
                label={item.label}
                icon={item.icon}
                shortcut={`G then ${item.key}`}
                active={pathname.startsWith(item.href)}
                count={counts[item.href]}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </nav>

      <div className="mt-auto flex shrink-0 flex-col gap-1 px-3 pb-4 pt-6">
        <UpdateNotice />
        <GoalLine />
        <button
          onClick={() => window.dispatchEvent(new Event("inroad:palette"))}
          aria-haspopup="dialog"
          className="mb-4 flex h-10 items-center gap-2 rounded-lg bg-surface/50 px-3 text-[12px] text-fg-2 ring-1 ring-inset ring-border transition-colors hover:bg-surface hover:text-fg"
        >
          <Command className="size-3.5" />
          <span className="flex-1 text-left">Ask or jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
        {SECONDARY.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} shortcut={`G then ${item.key}`} active={pathname.startsWith(item.href)} />
        ))}
        <div className="mt-1 flex items-center justify-between px-2 pt-1">
          <Link href="/settings#usage" className="font-mono text-[11px] tnum text-fg-3 hover:text-fg-2" title="AI spend this month">
            {usd(spend)} this month
          </Link>
          <button
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              toggle(e.detail ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined);
            }}
            aria-label="Toggle theme"
            className="relative grid size-[22px] place-items-center rounded-xs text-fg-3 transition-colors hover:bg-surface hover:text-fg [&>*]:[grid-area:1/1]"
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
 * The goal and the number under it, in view on every page: "Paid pilots 1 of 5 · Customers 0 of 20" for a business,
 * "Weekly active users 40 of 100 · Signups a week 18 of 25" for a consumer company. The numbers tick (NumberFlow)
 * when they move. Opens where they come from: the plan, or Growth.
 */
export function GoalLine({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { ws } = useWorkspace();
  if (!ws) return null;
  const rows = goalLine(ws, todayISO());
  const consumer = isConsumer(ws);
  return (
    <Link
      href={consumer ? "/growth" : "/playbook#plan"}
      onClick={onNavigate}
      title={consumer ? "Your goal and last week's numbers" : "Your goal, from the plan"}
      aria-label={rows.map((r) => `${r.label}: ${r.value[0]} of ${r.value[1]}.`).join(" ")}
      className={cn("mb-2 block border-t border-border px-2 pb-1 pt-2.5 text-[12px] leading-[18px] transition-colors hover:text-fg", className)}
    >
      {rows.map((r) => (
        <GoalRow key={r.label} label={r.label} value={r.value} />
      ))}
    </Link>
  );
}

function GoalRow({ label, value: [n, of] }: { label: string; value: [number, number] }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className="text-fg-3">{label}</span>
      <span className="text-fg-3">
        <Num value={n} className="font-medium text-fg" /> of <Num value={of} className="text-fg-2" />
      </span>
    </span>
  );
}

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
        "relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors duration-150",
        active ? "font-medium text-fg" : "text-fg-2 hover:bg-surface/60 hover:text-fg",
      )}
      title={shortcut}
    >
      {active && (
        <motion.span
          layoutId="nav-selection"
          transition={keyboard ? { duration: 0 } : spring.glide}
          className="absolute inset-0 rounded-lg bg-surface shadow-xs ring-1 ring-inset ring-border"
        />
      )}
      <Icon className={cn("relative size-4 transition-colors duration-150", active ? "text-fg" : "text-fg-3")} />
      <span className="relative flex-1">{label}</span>
      <AnimatePresence initial={false}>
        {count !== undefined && (
          <motion.span
            key="count"
            initial={{ opacity: 0, scale: 0.5, x: -4, y: 4 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
            transition={spring.pop}
            className="relative min-w-5 rounded-md bg-accent-subtle px-1.5 text-center font-mono text-[10.5px] font-medium leading-5 text-accent-text"
          >
            <Num value={count} />
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}

