"use client";

import { Menu as MenuIcon, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { AskDialog } from "@/components/ask/ask-dialog";
import { ConnectorPoller } from "@/components/integrations/connector-poller";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/menu";
import { Orb } from "@/components/ui/orb";
import { OrbMorph, useWide } from "@/components/ui/orb-morph";
import { PageContainer } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/client/cn";
import { ease } from "@/lib/motion";
import { AgentPanel, useAgentStatus, useNavCounts } from "./agent-status";
import { CommandPalette } from "./command-palette";
import { SampleBanner } from "./sample-banner";
import { ShortcutsDialog } from "./shortcuts";
import { CompanyMenu, useMarket } from "./market-switch";
import { SECONDARY, goKeys, navFor } from "./nav";
import { AgentLine, NorthStarLine, Sidebar } from "./sidebar";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** Linear-style "G then T" navigation. Instant, never animated. Only to pages the company's market shows. */
function useGoKeys() {
  const router = useRouter();
  const market = useMarket();
  useEffect(() => {
    const go = goKeys(market);
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        armed = Date.now();
        return;
      }
      if (armed && Date.now() - armed < 1200 && go[k]) {
        e.preventDefault();
        router.push(go[k]);
      }
      armed = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, market]);
}

/** Reads the pathname, so it renders under Suspense (dynamic routes can't resolve it while prerendering). */
function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const counts = useNavCounts();
  const market = useMarket();
  // Any navigation closes the menu (G then T, the palette), not only a tap on one of its links.
  const [openedOn] = useState(pathname);
  useEffect(() => {
    if (pathname !== openedOn) onNavigate();
  }, [pathname, openedOn, onNavigate]);
  return (
    <nav id="mobile-nav" aria-label="Pages" className="grid grid-cols-2 gap-1 p-2">
      {/* The company menu, like the sidebar's: who you sell to lives in it, not on top of the pages. */}
      <CompanyMenu className="col-span-2 h-11 px-3" onNavigate={onNavigate} />
      {[...navFor(market), ...SECONDARY].map((n) => {
        const active = pathname.startsWith(n.href);
        const count = counts[n.href];
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2 rounded-sm px-3 py-2 text-[14px]", active ? "bg-surface font-medium ring-1 ring-border" : "text-fg-2")}
          >
            <span className="flex-1">{n.label}</span>
            {count !== undefined && (
              <span className="min-w-5 rounded-full bg-accent px-1.5 text-center font-mono text-[12px] font-medium leading-[18px] text-accent-fg">{count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The phone header: the menu, the wordmark with the agent's one live line under it, and the orb (its
 * state and ticks, as in the sidebar), which opens the palette. Tapping the line shows the runs.
 */
function MobileHeader({ navOpen, onToggleNav, menuRef }: { navOpen: boolean; onToggleNav: () => void; menuRef: React.RefObject<HTMLButtonElement | null> }) {
  const status = useAgentStatus();
  const wide = useWide();
  const [runsOpen, setRunsOpen] = useState(false);
  return (
    <header className="sticky top-0 z-50 flex h-12 items-center gap-2 border-b border-border bg-bg/90 px-4 backdrop-blur md:hidden">
      <button
        ref={menuRef}
        aria-label="Menu"
        aria-expanded={navOpen}
        aria-controls="mobile-nav"
        onClick={onToggleNav}
        className="relative -ml-1.5 size-8 shrink-0 rounded-sm text-fg-2 transition-colors active:bg-bg-subtle"
      >
        <AnimatePresence initial={false}>
          <motion.span
            key={navOpen ? "x" : "menu"}
            initial={{ opacity: 0, rotate: navOpen ? -45 : 45, scale: 0.9 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18, ease: ease.out }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {navOpen ? <X className="size-5" /> : <MenuIcon className="size-5" />}
          </motion.span>
        </AnimatePresence>
      </button>
      <Popover
        align="start"
        open={runsOpen}
        onOpenChange={setRunsOpen}
        className="w-[min(18rem,calc(100vw-32px))] p-2"
        trigger={
          <button className="flex min-w-0 flex-1 flex-col items-start rounded-sm py-0.5 text-left" aria-label={`Head of GTM: ${status.line}`}>
            <span className="font-serif text-[18px] font-medium leading-[20px] tracking-[-0.02em] text-fg">{BRAND.product}</span>
            <AgentLine status={status} className="max-w-full text-[12px] leading-4" />
          </button>
        }
      >
        <AgentPanel status={status} onNavigate={() => setRunsOpen(false)} />
      </Popover>
      {/* The sidebar's "Ask or jump to…" for touch: the palette, with Ask as its first row. */}
      <button aria-label="Ask or jump to" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event("inroad:palette"))} className="-mr-1.5 shrink-0 rounded-full p-1.5">
        <OrbMorph on={!wide} layout="phone">
          <Orb state={status.state} size={20} tick={status.ticks} />
        </OrbMorph>
      </button>
    </header>
  );
}

/**
 * The phone menu drops over the page with a scrim: a tap outside or Esc closes it (focus goes back to
 * the menu button), and so does navigating.
 */
function useMobileNav() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      menuRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return { open, setOpen, menuRef };
}

/** Past this, a first load that hasn't answered says so, with a retry. */
const SLOW_MS = 8000;

function useSlowLoad(): boolean {
  const { ws, error } = useWorkspace();
  const waiting = !ws && !error;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  return waiting && slow;
}

/**
 * Pages render their own skeletons while the workspace loads. If it can't load at all, every page says the same
 * thing here, with a retry, instead of a skeleton that never resolves.
 */
function WorkspaceGate({ children }: { children: ReactNode }) {
  const { ws, error, refresh } = useWorkspace();
  if (ws || !error) return children;
  return (
    <PageContainer>
      <PageState
        kind="error"
        title="Couldn't open your workspace"
        body="Everything is still on this computer. If Inroad just started, give it a moment and try again."
        detail={error}
        onRetry={refresh}
      />
    </PageContainer>
  );
}

/**
 * A slim line over the page when loading is slow or a refresh failed. What was loaded stays on screen; nothing is
 * lost, and Try again reads it anew.
 */
function WorkspaceNotice() {
  const { ws, error, refresh } = useWorkspace();
  const slow = useSlowLoad();
  const [busy, setBusy] = useState(false);
  const stale = !!ws && !!error;
  if (!slow && !stale) return null;
  return (
    <div role="status" className="flex min-h-10 items-center gap-2.5 border-b border-border bg-bg-subtle px-4 py-1 text-[13px] md:px-6">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", stale ? "bg-warning" : "bg-fg-3")} />
      <p className="min-w-0 flex-1 truncate text-fg-2">
        {stale ? "Couldn't refresh your workspace. Showing what was loaded before." : "Still opening your workspace. This is taking longer than usual."}
      </p>
      <Button
        size="xs"
        variant="ghost"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await refresh();
          setBusy(false);
        }}
        className="-mr-2 shrink-0 text-fg"
      >
        Try again
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { ws, loading } = useWorkspace();
  const router = useRouter();
  const nav = useMobileNav();
  useGoKeys();

  // First run: until the founder has been through onboarding, everything routes to /welcome.
  useEffect(() => {
    if (!loading && ws && ws.onboarding.status !== "hired") router.replace("/welcome");
  }, [loading, ws, router]);

  return (
    <div className="flex min-h-dvh">
      <a href="#main-content" className="fixed left-4 top-3 z-[90] -translate-y-24 rounded-lg bg-primary px-4 py-2 text-primary-fg focus:translate-y-0">Skip to content</a>
      <Suspense fallback={<div aria-hidden className="sticky top-0 hidden h-dvh w-[240px] shrink-0 border-r border-border bg-bg-subtle md:block" />}>
        <Sidebar />
      </Suspense>
      <div className="min-w-0 flex-1">
        <MobileHeader navOpen={nav.open} onToggleNav={() => nav.setOpen((o) => !o)} menuRef={nav.menuRef} />
        <AnimatePresence>
          {nav.open && (
            <motion.div
              key="scrim"
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, ease: ease.out }}
              onClick={() => nav.setOpen(false)}
              className="fixed inset-0 top-12 z-40 bg-overlay/40 md:hidden"
            />
          )}
          {nav.open && (
            <motion.div
              key="nav"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12, ease: ease.inQuad } }}
              transition={{ duration: 0.2, ease: ease.out }}
              className="fixed inset-x-0 top-12 z-40 border-b border-border bg-bg shadow-md md:hidden"
            >
              <Suspense fallback={null}>
                <MobileNav onNavigate={() => nav.setOpen(false)} />
              </Suspense>
              <div className="border-t border-border px-2 py-1.5">
                <NorthStarLine onNavigate={() => nav.setOpen(false)} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <SampleBanner />
        <WorkspaceNotice />
        <main id="main-content" tabIndex={-1} className="workspace-main min-h-dvh min-w-0 outline-none">
          <WorkspaceGate>{children}</WorkspaceGate>
        </main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
      <AskDialog />
      <ConnectorPoller />
    </div>
  );
}
