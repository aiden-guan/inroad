"use client";

import { Command } from "cmdk";
import { ArrowLeftRight, ArrowRight, Building2, CalendarHeart, Compass, FileUp, Handshake, Keyboard, Map as MapIcon, MessageCircle, Moon, NotebookPen, Phone, Plug, Search, Settings, Sparkles, Sunrise, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAsk } from "@/components/providers/ask-provider";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Favicon } from "@/components/ui/favicon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/client/cn";
import { readRecent } from "@/lib/client/recent";

/**
 * ⌘K. Opens instantly, no animation on navigation or filtering (it's used constantly).
 * The first row is always Ask ("Ask: …" once there's a query), so a question is one Enter away.
 */
export function CommandPalette() {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const setOpen = useCallback((next: boolean | ((o: boolean) => boolean)) => {
    setOpenState((o) => {
      const value = typeof next === "function" ? next(o) : next;
      if (!value) setQuery("");
      return value;
    });
    // Read on open (an event, not a render): what the founder opened lately comes first.
    setRecent(readRecent());
  }, []);
  const router = useRouter();
  const { ws } = useWorkspace();
  const { start } = useRuns();
  const { openAsk } = useAsk();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("inroad:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("inroad:palette", onOpen);
    };
  }, [setOpen]);

  const companies = useMemo(
    () =>
      Object.values(ws?.accounts ?? {})
        .filter((a) => a.status !== "disqualified")
        .sort((a, b) => b.fitScore - a.fitScore)
        .slice(0, 200),
    [ws],
  );

  const recentCompanies = recent.map((d) => ws?.accounts[d]).filter((a): a is NonNullable<typeof a> => !!a && a.status !== "disqualified").slice(0, 5);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // ignore
    }
  };
  const looksLikeDomain = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(query.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""));

  // A Radix dialog under the hood, so the palette takes focus even over an open sheet (whose focus
  // trap would otherwise swallow every keystroke). Opens instantly: it's used constantly.
  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command menu"
      loop
      overlayClassName="fixed inset-0 z-[90] bg-overlay/50"
      contentClassName="fixed left-1/2 top-[14vh] z-[91] w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-xl bg-surface-raised shadow-xl ring-1 ring-border outline-none"
    >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 text-fg-3" />
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Ask anything, or jump to a company, page or action…"
            className="h-12 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3"
          />
          <Kbd>esc</Kbd>
        </div>
        <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-3">Press Enter to ask.</Command.Empty>
          {!query.trim() && (
            <Item value="ask a question open conversation" icon={<MessageCircle className="size-4 text-accent" />} onSelect={() => run(() => openAsk())} hint="Ask">
              Ask a question…
            </Item>
          )}
          {query.trim() && (
            <Item value={`ask ${query}`} icon={<MessageCircle className="size-4 text-accent" />} onSelect={() => run(() => openAsk({ prefill: query.trim() }))} hint="Ask">
              <span className="text-fg-3">Ask:</span> {query}
            </Item>
          )}
          {query.trim() && looksLikeDomain && (
            <Item
              value={`research ${query}`}
              icon={<Sparkles className="size-4" />}
              onSelect={() =>
                run(() => {
                  const domain = query.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
                  router.push(`/companies?add=${encodeURIComponent(domain)}`);
                })
              }
            >
              Research {query.trim()}
            </Item>
          )}
          {!query.trim() && recentCompanies.length > 0 && (
            <Command.Group heading="Recent">
              {recentCompanies.map((a) => (
                <Item
                  key={`recent-${a.domain}`}
                  value={`recent ${a.name} ${a.domain}`}
                  icon={<Favicon domain={a.domain} name={a.name} size={16} />}
                  onSelect={() => run(() => router.push(`/companies?c=${encodeURIComponent(a.domain)}`))}
                  hint={<ArrowRight className="size-3.5" />}
                >
                  {a.name} <span className="font-mono text-[12px] text-fg-3">{a.domain}</span>
                </Item>
              ))}
            </Command.Group>
          )}
          <Command.Group heading="Go to">
            <Item value="today" icon={<Sunrise className="size-4" />} onSelect={() => run(() => router.push("/today"))} hint="G T">
              Today
            </Item>
            <Item value="companies" icon={<Building2 className="size-4" />} onSelect={() => run(() => router.push("/companies"))} hint="G C">
              Companies
            </Item>
            <Item value="intros warm introductions connectors" icon={<Handshake className="size-4" />} onSelect={() => run(() => router.push("/intros"))} hint="G N">
              Intros
            </Item>
            <Item value="events dinners" icon={<CalendarHeart className="size-4" />} onSelect={() => run(() => router.push("/events"))} hint="G E">
              Events
            </Item>
            <Item value="playbook icp positioning" icon={<NotebookPen className="size-4" />} onSelect={() => run(() => router.push("/playbook"))} hint="G P">
              Playbook
            </Item>
            <Item value="integrations connect tools" icon={<Plug className="size-4" />} onSelect={() => run(() => router.push("/integrations"))} hint="G I">
              Integrations
            </Item>
            <Item value="settings usage api key" icon={<Settings className="size-4" />} onSelect={() => run(() => router.push("/settings"))} hint="G S">
              Settings
            </Item>
          </Command.Group>
          <Command.Group heading="Do">
            <Item value="find new companies discover accounts" icon={<Compass className="size-4" />} onSelect={() => run(() => void start("discovery", {}))}>
              Find new companies to talk to
            </Item>
            <Item value="import linkedin connections warm network csv" icon={<FileUp className="size-4" />} onSelect={() => run(() => router.push("/integrations?import=linkedin"))}>
              Import LinkedIn connections
            </Item>
            <Item value="import github stargazers repo developers warm" icon={<FileUp className="size-4" />} onSelect={() => run(() => router.push("/integrations?import=github"))}>
              Import GitHub stargazers
            </Item>
            <Item value="make an intro introduce two people give" icon={<ArrowLeftRight className="size-4" />} onSelect={() => run(() => router.push("/intros?new=give"))}>
              Make an intro
            </Item>
            <Item value="add a connector investor advisor who introduces me" icon={<UserPlus className="size-4" />} onSelect={() => run(() => router.push("/intros?new=connector"))}>
              Add someone who introduces you
            </Item>
            <Item value="log a call debrief notes" icon={<Phone className="size-4" />} onSelect={() => run(() => router.push("/companies?view=talking&log=1"))}>
              Log a call
            </Item>
            <Item value="plan a dinner roundtable event" icon={<CalendarHeart className="size-4" />} onSelect={() => run(() => router.push("/events?new=1"))}>
              Plan a dinner or roundtable
            </Item>
            <Item value="map where are my leads nearby location" icon={<MapIcon className="size-4" />} onSelect={() => run(() => router.push("/companies?view=map"))}>
              Map of your leads
            </Item>
            <Item value="toggle theme dark light" icon={<Moon className="size-4" />} onSelect={() => run(toggleTheme)}>
              Toggle dark mode
            </Item>
            <Item value="keyboard shortcuts help keys" icon={<Keyboard className="size-4" />} onSelect={() => run(() => window.dispatchEvent(new Event("inroad:shortcuts")))} hint="?">
              Keyboard shortcuts
            </Item>
          </Command.Group>
          {companies.length > 0 && (
            <Command.Group heading="Companies">
              {companies.map((a) => (
                <Item
                  key={a.domain}
                  value={`${a.name} ${a.domain}`}
                  icon={<Favicon domain={a.domain} name={a.name} size={16} />}
                  onSelect={() => run(() => router.push(`/companies?c=${encodeURIComponent(a.domain)}`))}
                  hint={<ArrowRight className="size-3.5" />}
                >
                  {a.name} <span className="font-mono text-[12px] text-fg-3">{a.domain}</span>
                </Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
    </Command.Dialog>
  );
}

function Item({ children, icon, onSelect, value, hint }: { children: ReactNode; icon?: ReactNode; onSelect: () => void; value: string; hint?: ReactNode }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-[13.5px] text-fg",
        "data-[selected=true]:bg-bg-subtle",
      )}
    >
      <span className="flex size-4 items-center justify-center text-fg-3">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="font-mono text-[11px] text-fg-3">{hint}</span>}
    </Command.Item>
  );
}
