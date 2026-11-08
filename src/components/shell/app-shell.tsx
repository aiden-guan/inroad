"use client";

import { ChevronRight, Menu as MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { AskDialog } from "@/components/ask/ask-dialog";
import { ConnectorPoller } from "@/components/integrations/connector-poller";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Orb } from "@/components/ui/orb";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/client/cn";
import { CommandPalette } from "./command-palette";
import { ShortcutsDialog } from "./shortcuts";
import { NAV, SECONDARY, Sidebar, useTheme } from "./sidebar";

function WorkspaceBar() {
  const pathname = usePathname();
  const { ws } = useWorkspace();
  const current = [...NAV, ...SECONDARY].find((item) => pathname.startsWith(item.href));
  return (
    <div className="workspace-bar hidden h-12 items-center justify-between gap-4 px-6 lg:flex">
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-fg-3">
        <span className="truncate">{ws?.company?.name ?? "Your workspace"}</span>
        <ChevronRight aria-hidden className="size-3 shrink-0 text-fg-4" />
        <span className="shrink-0 font-medium text-fg-2">{current?.label ?? "Workspace"}</span>
      </div>
      <button onClick={() => window.dispatchEvent(new Event("inroad:palette"))} aria-haspopup="dialog" className="flex items-center gap-2 rounded-md px-2 py-1 text-[12px] text-fg-3 transition-colors hover:bg-surface hover:text-fg">
        <Orb size={13} /> Ask Inroad <span className="ml-2 font-mono text-[11px] text-fg-4">⌘K</span>
      </button>
    </div>
  );
}

const GO: Record<string, string> = { t: "/today", r: "/revenue", c: "/companies", y: "/plays", n: "/intros", e: "/events", p: "/playbook", i: "/integrations", s: "/settings" };

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** Linear-style "G then T" navigation. Instant, never animated. */
function useGoKeys() {
  const router = useRouter();
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        armed = Date.now();
        return;
      }
      if (armed && Date.now() - armed < 1200 && GO[k]) {
        e.preventDefault();
        router.push(GO[k]);
      }
      armed = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}

/** Reads the pathname, so it renders under Suspense (dynamic routes can't resolve it while prerendering). */
function MobileNav({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  return (
    <nav id="mobile-navigation" aria-label="Workspace" className="fixed inset-x-0 top-12 z-40 grid grid-cols-2 gap-1 rounded-b-xl border-b border-border bg-surface p-3 shadow-lg [animation:rise-in_160ms_var(--ease-out)] lg:hidden">
      {[...NAV, ...SECONDARY].map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={onNavigate}
          aria-current={pathname.startsWith(n.href) ? "page" : undefined}
          className={cn("flex min-h-11 items-center rounded-md px-3 py-2 text-[14px]", pathname.startsWith(n.href) ? "bg-bg-subtle font-medium" : "text-fg-2")}
        >
          {n.label}
        </Link>
      ))}
      <button onClick={() => toggle()} className="col-span-2 mt-2 min-h-11 border-t border-border px-3 pt-2 text-left text-[13px] text-fg-2">Switch to {theme === "dark" ? "light" : "dark"} theme</button>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { ws, loading } = useWorkspace();
  const router = useRouter();
  const [mobileNav, setMobileNav] = useState(false);
  useGoKeys();

  useEffect(() => {
    if (!mobileNav) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNav(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileNav]);

  // First run: until the founder has been through onboarding, everything routes to /welcome.
  useEffect(() => {
    if (!loading && ws && ws.onboarding.status !== "hired") router.replace("/welcome");
  }, [loading, ws, router]);

  return (
    <div className="workspace-frame flex min-h-dvh bg-bg-subtle">
      <a href="#main-content" className="fixed left-4 top-3 z-[90] -translate-y-24 rounded-lg bg-primary px-4 py-2 text-primary-fg focus:translate-y-0">Skip to content</a>
      <Suspense fallback={<div aria-hidden className="sticky top-0 hidden h-dvh w-[224px] shrink-0 bg-bg-subtle lg:block" />}>
        <Sidebar />
      </Suspense>
      <div className="min-w-0 flex-1 lg:pb-2 lg:pr-2">
        <Suspense fallback={<div className="hidden h-12 lg:block" />}><WorkspaceBar /></Suspense>
        <header className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-border bg-bg-subtle px-4 lg:hidden">
          <button aria-label="Menu" aria-controls="mobile-navigation" aria-expanded={mobileNav} onClick={() => setMobileNav((o) => !o)} className="-ml-1 flex size-10 items-center justify-center rounded-md text-fg-2">
            <MenuIcon className="size-5" />
          </button>
          <span className="font-serif text-[19px] font-medium tracking-[-0.02em]">{BRAND.product}</span>
          {/* The sidebar's "Ask or jump to…" for touch: the palette, with Ask as its first row. */}
          <button aria-label="Ask or jump to" aria-haspopup="dialog" onClick={() => window.dispatchEvent(new Event("inroad:palette"))} className="-mr-1 ml-auto rounded-full p-1.5">
            <Orb size={18} />
          </button>
        </header>
        {mobileNav && (
          <Suspense fallback={null}>
            <MobileNav onNavigate={() => setMobileNav(false)} />
          </Suspense>
        )}
        <main id="main-content" tabIndex={-1} className="workspace-main min-w-0 outline-none">{children}</main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
      <AskDialog />
      <ConnectorPoller />
    </div>
  );
}
