"use client";

import { Menu as MenuIcon } from "lucide-react";
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
import { NAV, SECONDARY, Sidebar } from "./sidebar";

const GO: Record<string, string> = { t: "/today", c: "/companies", n: "/intros", e: "/events", p: "/playbook", m: "/studio", i: "/integrations", s: "/settings" };

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
  return (
    <nav className="sticky top-12 z-40 grid grid-cols-2 gap-1 border-b border-border bg-bg p-2 md:hidden">
      {[...NAV, ...SECONDARY].map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={onNavigate}
          className={cn("rounded-sm px-3 py-2 text-[14px]", pathname.startsWith(n.href) ? "bg-surface font-medium ring-1 ring-border" : "text-fg-2")}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { ws, loading } = useWorkspace();
  const router = useRouter();
  const [mobileNav, setMobileNav] = useState(false);
  useGoKeys();

  // First run: until the founder has been through onboarding, everything routes to /welcome.
  useEffect(() => {
    if (!loading && ws && ws.onboarding.status !== "hired") router.replace("/welcome");
  }, [loading, ws, router]);

  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={<div aria-hidden className="sticky top-0 hidden h-dvh w-[232px] shrink-0 border-r border-border bg-bg-subtle md:block" />}>
        <Sidebar />
      </Suspense>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur md:hidden">
          <button aria-label="Menu" onClick={() => setMobileNav((o) => !o)} className="-ml-1 rounded-sm p-1.5 text-fg-2">
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
        <main className="min-w-0">{children}</main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
      <AskDialog />
      <ConnectorPoller />
    </div>
  );
}
