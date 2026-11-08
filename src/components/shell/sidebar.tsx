"use client";

import { AnimatePresence, motion } from "motion/react";
import { Building2, CalendarHeart, Command, Handshake, Moon, NotebookPen, Plug, Search, Settings, Sun, Sunrise, Target, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { useActiveRuns, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { Favicon } from "@/components/ui/favicon";
import { useKeyboardDriven } from "@/components/ui/fx";
import { Kbd } from "@/components/ui/kbd";
import { Num } from "@/components/ui/misc";
import { Popover } from "@/components/ui/menu";
import { Orb } from "@/components/ui/orb";
import { Receipt } from "@/components/ui/work-log";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/client/cn";
import { usd } from "@/lib/client/format";
import { monthKey, todayISO } from "@/lib/domain/ids";
import { yourMoves } from "@/lib/intros/rules";
import { spring } from "@/lib/motion";

const NAV = [
  { href: "/today", label: "Today", icon: Sunrise, key: "T" },
  { href: "/revenue", label: "Revenue", icon: Target, key: "R" },
  { href: "/visibility", label: "Search & AI", icon: Search, key: "V" },
  { href: "/companies", label: "Companies", icon: Building2, key: "C" },
  { href: "/plays", label: "Plays", icon: Zap, key: "Y" },
  { href: "/intros", label: "Intros", icon: Handshake, key: "N" },
  { href: "/events", label: "Events", icon: CalendarHeart, key: "E" },
  { href: "/playbook", label: "Playbook", icon: NotebookPen, key: "P" },
] as const;

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

function AgentBlock() {
  const { ws } = useWorkspace();
  const { runs } = useRuns();
  const active = useActiveRuns();
  const openMoves = useMemo(
    () => Object.values(ws?.moves ?? {}).filter((m) => m.status === "open" && m.dueOn <= todayISO()).length,
    [ws],
  );
  const recent = useMemo(
    () =>
      Object.values(runs)
        .filter((r) => r.status !== "running" && r.status !== "queued")
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 5),
    [runs],
  );
  const state = active.length ? "working" : openMoves ? "needs" : "idle";
  const ticks = active.reduce((n, r) => n + r.steps.length, 0);
  const line = active.length
    ? active[0].title
    : openMoves
      ? `${openMoves} move${openMoves === 1 ? "" : "s"} ready for you`
      : "All caught up";

  return (
    <Popover
      align="start"
      className="w-72 p-2"
      trigger={
        <button className="group flex w-full items-center gap-3 rounded-xl bg-surface/70 px-3 py-3 text-left ring-1 ring-inset ring-border transition-[background-color,box-shadow] duration-150 hover:bg-surface-raised hover:shadow-sm">
          <Orb state={state} size={22} tick={ticks} />
          <span className="min-w-0 flex-1">
            <span className="mb-0.5 flex items-center gap-1.5 text-[12px] font-medium text-fg">
              Head of GTM <AiBadge />
            </span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={line}
                initial={{ opacity: 0, filter: "blur(2px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(2px)" }}
                transition={{ duration: 0.15 }}
                className={cn("block truncate text-[12px]", active.length ? "shimmer-text" : "text-fg-3")}
              >
                {line}
                {active.length > 1 && ` +${active.length - 1}`}
              </motion.span>
            </AnimatePresence>
          </span>
        </button>
      }
    >
      <div className="space-y-2">
        {active.length > 0 && (
          <div>
            <p className="px-1.5 pb-1 text-[11px] font-medium text-fg-3">In progress · {active.length}</p>
            {active.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-[13px]">
                <Orb state="working" size={14} />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="truncate font-mono text-[11px] text-fg-3">{r.steps.at(-1)?.text.slice(0, 18)}</span>
              </div>
            ))}
          </div>
        )}
        <div>
          <p className="px-1.5 pb-1 text-[11px] font-medium text-fg-3">Recent</p>
          {recent.length === 0 && <p className="px-1.5 py-1 text-[12px] text-fg-3">Nothing yet this session.</p>}
          {recent.map((r) => (
            <div key={r.id} className="rounded-sm px-1.5 py-1">
              <p className="truncate text-[13px] text-fg">{r.title}</p>
              <Receipt run={r} />
            </div>
          ))}
        </div>
      </div>
    </Popover>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { ws } = useWorkspace();
  const { theme, toggle } = useTheme();
  const spend = ws?.usage[monthKey()]?.costUsd ?? 0;
  const counts: Record<string, number | undefined> = {
    "/today": Object.values(ws?.moves ?? {}).filter((m) => m.status === "open" && m.dueOn <= todayISO()).length || undefined,
    "/intros": (ws ? yourMoves(ws, todayISO()).length : 0) || undefined,
  };

  return (
    <aside className="workspace-sidebar sticky top-0 hidden h-dvh w-[224px] shrink-0 flex-col bg-bg-subtle lg:flex">
      <div className="flex h-[76px] shrink-0 items-center gap-2.5 px-5">
        {/* The layout persists across navigation, so this draws once per page load. */}
        <BrandMark draw="once" className="size-7 text-accent-text" />
        <span className="font-serif text-[27px] font-medium tracking-[-0.04em] text-fg [font-variation-settings:'opsz'_48]">{BRAND.product}</span>
      </div>

      {ws?.company && (
        <div className="mx-4 mb-5 flex min-w-0 items-center gap-2 border-b border-border px-1 pb-4">
          <Favicon domain={ws.company.domain} size={20} />
          <span className="truncate text-[12px] font-medium text-fg-2">{ws.company.name}</span>
          <span className="ml-auto text-[11px] text-fg-3">Workspace</span>
        </div>
      )}

      <div className="px-3 pb-6">
        <AgentBlock />
      </div>

      <nav aria-label="Workspace" className="flex flex-col gap-1 px-3">
        {NAV.map((item) => (
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

      <div className="mt-auto flex flex-col gap-1 px-3 pb-4 pt-6">
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
          className="absolute inset-0 rounded-lg bg-surface ring-1 ring-inset ring-border"
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

export { NAV, SECONDARY };
