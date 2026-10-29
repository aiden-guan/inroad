"use client";

import { AnimatePresence, motion } from "motion/react";
import { Building2, CalendarHeart, Command, Handshake, Megaphone, Moon, NotebookPen, PenTool, Plug, Search, Settings, Sun, Sunrise, Target, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge, Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { Favicon } from "@/components/ui/favicon";
import { Kbd } from "@/components/ui/kbd";
import { Popover } from "@/components/ui/menu";
import { Num } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import { OrbMorph, useWide } from "@/components/ui/orb-morph";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/client/cn";
import { usd } from "@/lib/client/format";
import { monthKey } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { goalLine } from "@/lib/moves/nav-counts";
import { UpdateNotice } from "@/components/updates/update-notice";
import { AgentPanel, useAgentStatus, useNavCounts, type AgentStatus } from "./agent-status";
import { SampleBanner } from "./sample-banner";

const NAV = [
  { href: "/today", label: "Today", icon: Sunrise, key: "T" },
  { href: "/revenue", label: "Revenue", icon: Target, key: "V" },
  { href: "/partners", label: "Creators", icon: Megaphone, key: "R" },
  { href: "/companies", label: "Companies", icon: Building2, key: "C" },
  { href: "/plays", label: "Plays", icon: Zap, key: "Y" },
  { href: "/research", label: "Research", icon: Search, key: "F" },
  { href: "/intros", label: "Intros", icon: Handshake, key: "N" },
  { href: "/events", label: "Events", icon: CalendarHeart, key: "E" },
  { href: "/playbook", label: "Playbook", icon: NotebookPen, key: "P" },
  { href: "/studio", label: "Studio", icon: PenTool, key: "M" },
] as const;

/** Creators and communities show for consumer companies (or once anyone is on the list). */
export function navFor(ws: Workspace | null | undefined) {
  const consumer = ws?.company?.market === "consumer" || Object.keys(ws?.partners ?? {}).length > 0;
  return NAV.filter((n) => n.href !== "/partners" || consumer);
}

const SECONDARY = [
  { href: "/integrations", label: "Integrations", icon: Plug, key: "I" },
  { href: "/settings", label: "Settings", icon: Settings, key: "S" },
] as const;

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
  const toggle = () => {
    const next = readTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // private mode
    }
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

  return (
    <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-border bg-bg-subtle [scrollbar-width:thin] md:flex">
      <div className="flex h-[76px] shrink-0 items-center gap-2.5 px-5">
        <BrandMark className="size-8 text-fg" />
        <span className="font-serif text-[27px] font-medium tracking-[-0.04em] text-fg [font-variation-settings:'opsz'_48]">{BRAND.product}</span>
      </div>

      {ws?.company && (
        <div className="mx-4 mb-5 flex min-w-0 shrink-0 items-center gap-2 border-b border-border px-1 pb-4">
          <Favicon domain={ws.company.domain} size={20} />
          <span className="truncate text-[12px] font-medium text-fg-2">{ws.company.name}</span>
          {ws.sample ? (
            <Badge tone="warning" className="ml-auto h-4 px-1 text-[10px]">
              Sample
            </Badge>
          ) : (
            <span className="ml-auto font-mono text-[9px] uppercase tracking-[.08em] text-fg-3">Workspace</span>
          )}
        </div>
      )}

      <SampleBanner variant="sidebar" />

      <div className="shrink-0 px-3 pb-6">
        <AgentBlock />
      </div>

      <nav aria-label="Workspace" className="flex shrink-0 flex-col gap-1 px-3">
        {navFor(ws).map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            shortcut={`G then ${item.key}`}
            active={pathname.startsWith(item.href)}
            count={counts[item.href]}
          />
        ))}
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
          <button onClick={toggle} aria-label="Toggle theme" className="rounded-xs p-1 text-fg-3 transition-colors hover:bg-surface hover:text-fg">
            {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * "Paid pilots 1 of 5 · Customers 0 of 20": the near-term goal and the long arc, in view on every page.
 * The numbers tick (NumberFlow) when a deal is won. Opens the plan they come from.
 */
export function GoalLine({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { ws } = useWorkspace();
  if (!ws) return null;
  const { pilots, customers } = goalLine(ws);
  return (
    <Link
      href="/playbook#plan"
      onClick={onNavigate}
      title="Your goal, from the plan"
      aria-label={`Paid pilots: ${pilots[0]} of ${pilots[1]}. Customers: ${customers[0]} of ${customers[1]}.`}
      className={cn("mb-2 block border-t border-border px-2 pb-1 pt-2.5 text-[12px] leading-[18px] transition-colors hover:text-fg", className)}
    >
      <GoalRow label="Paid pilots" value={pilots} />
      <GoalRow label="Customers" value={customers} />
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
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors duration-150",
        active ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-inset ring-border" : "text-fg-2 hover:bg-surface/60 hover:text-fg",
      )}
      title={shortcut}
    >
      <Icon className={cn("relative size-4", active ? "text-fg" : "text-fg-3")} />
      <span className="relative flex-1">{label}</span>
      {count !== undefined && (
        <span className="relative min-w-5 rounded-md bg-accent-subtle px-1.5 text-center font-mono text-[10.5px] font-medium leading-5 text-accent-text">{count}</span>
      )}
    </Link>
  );
}

export { NAV, SECONDARY };
