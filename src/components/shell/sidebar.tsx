"use client";

import { AnimatePresence, motion } from "motion/react";
import { Building2, CalendarHeart, Command, Handshake, Moon, NotebookPen, Plug, Settings, Sun, Sunrise } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { useActiveRuns, useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge } from "@/components/ui/badge";
import { Favicon } from "@/components/ui/favicon";
import { Kbd } from "@/components/ui/kbd";
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
  { href: "/companies", label: "Companies", icon: Building2, key: "C" },
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
        <button className="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-bg-subtle">
          <Orb state={state} size={22} tick={ticks} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
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
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-border bg-bg-subtle md:flex">
      <div className="flex h-12 items-center gap-2 px-4">
        <span className="font-serif text-[21px] font-medium tracking-[-0.02em] text-fg [font-variation-settings:'opsz'_36]">{BRAND.product}</span>
        {ws?.company && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[12px] text-fg-3">
            <Favicon domain={ws.company.domain} size={14} />
            <span className="truncate">{ws.company.name}</span>
          </span>
        )}
      </div>

      <div className="px-2 pb-2">
        <AgentBlock />
      </div>

      <nav className="flex flex-col gap-0.5 px-2">
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

      <div className="mt-auto flex flex-col gap-0.5 px-2 pb-2">
        <button
          onClick={() => window.dispatchEvent(new Event("inroad:palette"))}
          aria-haspopup="dialog"
          className="mb-1 flex h-8 items-center gap-2 rounded-sm px-2 text-[13px] text-fg-2 ring-1 ring-border transition-colors hover:bg-surface hover:text-fg"
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
      className={cn(
        "relative flex h-8 items-center gap-2.5 rounded-sm px-2 text-[13px] transition-colors duration-150",
        active ? "font-medium text-fg" : "text-fg-2 hover:bg-surface/60 hover:text-fg",
      )}
      title={shortcut}
    >
      {active && <motion.span layoutId="nav-active" transition={spring.snappy} className="absolute inset-0 rounded-sm bg-surface shadow-xs ring-1 ring-border" />}
      <Icon className={cn("relative size-4", active ? "text-fg" : "text-fg-3")} />
      <span className="relative flex-1">{label}</span>
      {count !== undefined && (
        <span className="relative min-w-5 rounded-full bg-accent px-1.5 text-center font-mono text-[10.5px] font-medium leading-[18px] text-accent-fg">{count}</span>
      )}
    </Link>
  );
}

export { NAV, SECONDARY };
