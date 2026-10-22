"use client";

import { Command } from "cmdk";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Briefcase,
  Building2,
  CalendarHeart,
  ClipboardList,
  Compass,
  FileText,
  FileUp,
  Handshake,
  Inbox,
  Keyboard,
  Map as MapIcon,
  MessageCircle,
  Moon,
  NotebookPen,
  PenLine,
  Phone,
  Plug,
  Reply,
  Search,
  Settings,
  Sparkles,
  Sunrise,
  UserPlus,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAsk } from "@/components/providers/ask-provider";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { newAccount } from "@/components/companies/sheet/new-account";
import { unlessSheetOpen } from "@/components/companies/sheet/open-sheet";
import { RELATIONSHIP_LABEL } from "@/components/intros/connectors";
import { ASSET_KINDS, CREATABLE_KINDS } from "@/components/playbook/model";
import { Favicon } from "@/components/ui/favicon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/client/cn";
import { readRecent } from "@/lib/client/recent";
import { newDeal } from "@/lib/deals/rules";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import { STAGE_LABELS } from "@/lib/domain/types";
import { connectorChoices, connectorTargets, dealCandidates, proposalDeals, repliesToCheck, upcomingMeetings, writeTargets } from "./palette-data";
import { PasteReply } from "./paste-reply";

/** A ⌘K command that needs a choice first opens a page of the palette; Esc or ⌫ on an empty query goes back. */
type Page = { kind: "reply" } | { kind: "write" } | { kind: "prep" } | { kind: "connector"; id?: string } | { kind: "asset" } | { kind: "proposal" } | { kind: "deal" };

const PAGE: Record<Page["kind"], { title: string; placeholder: string }> = {
  reply: { title: "Paste a reply", placeholder: "" },
  write: { title: "Write to…", placeholder: "Who are you writing to?" },
  prep: { title: "Prep for…", placeholder: "Which meeting?" },
  connector: { title: "Ask a connector for intros", placeholder: "Who should you ask?" },
  asset: { title: "Draft an asset", placeholder: "What should I draft?" },
  proposal: { title: "Draft a pilot proposal", placeholder: "For which deal?" },
  deal: { title: "Add a deal", placeholder: "Which company? Or type its website" },
};

const STATUS: Record<string, string> = { ready: "Ready", in_flight: "Ask in flight", resting: "Asked recently", give_first: "Give first" };

const cleanDomain = (q: string) => q.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
const isDomain = (q: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(cleanDomain(q));

/**
 * ⌘K. Opens instantly, no animation on navigation or filtering (it's used constantly).
 * The first row is always Ask ("Ask: …" once there's a query), so a question is one Enter away.
 * The SPEC's commands (Write to, Paste a reply, Check replies, Prep for, Ask a connector, Draft an asset or a
 * pilot proposal, Run the weekly review, Add a deal) each land in the flow that already does the work.
 */
export function CommandPalette() {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const setOpen = useCallback((next: boolean | ((o: boolean) => boolean)) => {
    setOpenState((o) => {
      const value = typeof next === "function" ? next(o) : next;
      if (!value) {
        setQuery("");
        setPage(null);
      }
      return value;
    });
    // Read on open (an event, not a render): what the founder opened lately comes first.
    setRecent(readRecent());
  }, []);
  const router = useRouter();
  const pathname = usePathname();
  const { ws, dispatch } = useWorkspace();
  const { start } = useRuns();
  const { openAsk } = useAsk();

  const go = useCallback((next: Page | null) => {
    setPage(next);
    setQuery("");
  }, []);

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

  // Esc on a page goes back to the list instead of closing. Caught before the dialog's own Esc handler.
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !pageRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      const p = pageRef.current;
      go(p.kind === "connector" && p.id ? { kind: "connector" } : null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, go]);

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
  const q = query.trim();
  const looksLikeDomain = isDomain(q);
  const sheet = (domain: string, extra = "") => `/companies?c=${encodeURIComponent(domain)}${extra}`;

  const checkReplies = () =>
    run(() => {
      const n = ws ? repliesToCheck(ws, new Date()) : 0;
      if (!n) {
        toast("Nothing to check. Every email from the last 14 days has an outcome.");
        return;
      }
      if (pathname === "/today") window.dispatchEvent(new CustomEvent("inroad:today-open", { detail: "check_replies" }));
      else router.push("/today?open=check_replies");
    });
  const review = (kind: "monday" | "friday") =>
    run(() => {
      void start("review", { kind });
      if (pathname !== "/today") router.push("/today");
    });
  const startDeal = (domain: string) =>
    run(async () => {
      if (!ws) return;
      const existing = ws.accounts[domain];
      const account = existing ?? newAccount(domain);
      const open = existing?.dealId ? ws.deals[existing.dealId] : undefined;
      if (!open || ["won", "lost"].includes(open.stage)) {
        const ok = await dispatch([...(existing ? [] : [{ type: "account.add" as const, account }]), { type: "deal.create", deal: newDeal(account, newId("deal"), nowISO()) }]);
        if (!ok) return;
        toast(`Deal started with ${account.name}. Add its next step.`);
      }
      router.push(sheet(domain));
    });

  // Only once a page is open (never while prerendering the shell, which mustn't read the clock).
  const pageItems = (() => {
    if (!ws || !page) return null;
    switch (page.kind) {
      case "write": {
        const targets = writeTargets(ws);
        return (
          <Command.Group heading="People">
            {targets.map(({ person, account }) => (
              <Item
                key={person.id}
                value={`${person.name} ${person.title} ${account?.name ?? ""} ${person.accountDomain}`}
                icon={<Favicon domain={person.accountDomain} name={account?.name} size={16} />}
                onSelect={() => run(() => router.push(sheet(person.accountDomain, `&intent=write&ref=${encodeURIComponent(person.id)}`)))}
              >
                {person.name}{" "}
                <span className="text-fg-3">
                  · {person.title ? `${person.title}, ` : ""}
                  {account?.name ?? person.accountDomain}
                </span>
              </Item>
            ))}
          </Command.Group>
        );
      }
      case "prep": {
        const meetings = upcomingMeetings(ws, new Date());
        return (
          <Command.Group heading="Next two weeks">
            {meetings.map(({ meeting, domain, company }) => (
              <Item
                key={meeting.id}
                value={`${meeting.title} ${company} ${meeting.attendees.map((a) => a.name).join(" ")}`}
                icon={domain ? <Favicon domain={domain} name={company} size={16} /> : <CalendarHeart className="size-4" />}
                hint={meeting.brief ? "Brief ready" : "Writes the brief"}
                onSelect={() =>
                  run(() => {
                    if (!domain) return;
                    // No brief yet: start it now; the sheet shows it being written.
                    if (!meeting.brief) void start("prep", { meetingId: meeting.id }, { notify: unlessSheetOpen(domain) });
                    router.push(sheet(domain, `&intent=prep&ref=${encodeURIComponent(meeting.id)}`));
                  })
                }
              >
                {meeting.title}{" "}
                <span className="text-fg-3">
                  · {new Date(meeting.startsAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}
                </span>
              </Item>
            ))}
          </Command.Group>
        );
      }
      case "connector": {
        const connector = page.id ? ws.connectors.find((c) => c.id === page.id) : undefined;
        if (connector) {
          return (
            <Command.Group heading={`Who ${connector.name.split(" ")[0]} could introduce you to`}>
              {connectorTargets(ws, connector).map(({ account, reach }) => (
                <Item
                  key={account.domain}
                  value={`${account.name} ${account.domain}`}
                  icon={<Favicon domain={account.domain} name={account.name} size={16} />}
                  hint={reach === "exact" ? "In their reach" : reach === "topic" ? "Their world" : undefined}
                  onSelect={() => run(() => router.push(sheet(account.domain, `&intent=intro&ref=${encodeURIComponent(connector.id)}`)))}
                >
                  {account.name} <span className="font-mono text-[12px] text-fg-3">{account.domain}</span>
                </Item>
              ))}
            </Command.Group>
          );
        }
        const choices = connectorChoices(ws, todayISO());
        return (
          <Command.Group heading="People who introduce you">
            {choices.map(({ connector: c, ledger }) => (
              <Item key={c.id} value={`${c.name} ${c.company ?? ""} ${(c.reach ?? []).join(" ")}`} icon={<Handshake className="size-4" />} hint={STATUS[ledger.status]} onSelect={() => go({ kind: "connector", id: c.id })}>
                {c.name}{" "}
                <span className="text-fg-3">
                  · {RELATIONSHIP_LABEL[c.relationship]}
                  {c.company ? `, ${c.company}` : ""}
                </span>
              </Item>
            ))}
            <Item value="add someone who introduces me connector investor advisor" icon={<UserPlus className="size-4" />} onSelect={() => run(() => router.push("/intros?new=connector"))}>
              Add someone who introduces you
            </Item>
          </Command.Group>
        );
      }
      case "asset":
        return (
          <Command.Group heading="Draft">
            {CREATABLE_KINDS.filter((k) => k !== "pilot_proposal").map((k) => (
              <Item key={k} value={`${ASSET_KINDS[k].label} ${ASSET_KINDS[k].description}`} icon={<FileText className="size-4" />} onSelect={() => run(() => router.push(`/playbook?new=${k}`))}>
                {ASSET_KINDS[k].label} <span className="text-fg-3">· {ASSET_KINDS[k].description}</span>
              </Item>
            ))}
          </Command.Group>
        );
      case "proposal": {
        const deals = proposalDeals(ws);
        return (
          <Command.Group heading="Live deals">
            {deals.map((d) => (
              <Item
                key={d.id}
                value={`${d.name} ${d.accountDomain} ${d.stage}`}
                icon={<Favicon domain={d.accountDomain} name={ws.accounts[d.accountDomain]?.name ?? d.name} size={16} />}
                hint={STAGE_LABELS[d.stage]}
                onSelect={() => run(() => router.push(`/playbook?new=pilot_proposal&deal=${encodeURIComponent(d.id)}`))}
              >
                {ws.accounts[d.accountDomain]?.name ?? d.name}
              </Item>
            ))}
          </Command.Group>
        );
      }
      case "deal": {
        const candidates = dealCandidates(ws);
        const typed = looksLikeDomain ? cleanDomain(q) : null;
        return (
          <>
            {typed && !ws.accounts[typed] && (
              <Item value={`add ${q}`} icon={<Briefcase className="size-4" />} onSelect={() => startDeal(typed)}>
                Add {typed} and start a deal
              </Item>
            )}
            <Command.Group heading="Companies">
              {candidates.map((a) => (
                <Item key={a.domain} value={`${a.name} ${a.domain}`} icon={<Favicon domain={a.domain} name={a.name} size={16} />} onSelect={() => startDeal(a.domain)}>
                  {a.name} <span className="font-mono text-[12px] text-fg-3">{a.domain}</span>
                </Item>
              ))}
            </Command.Group>
          </>
        );
      }
      default:
        return null;
    }
  })();

  const empty = page
    ? page.kind === "prep"
      ? "No meetings in the next two weeks. Add one on a deal and I'll prep it."
      : page.kind === "proposal"
        ? "No live deals yet. A pilot proposal is built from a deal's qualification card."
        : page.kind === "write"
          ? "No one by that name. Research their company first, then write."
          : "Nothing matches."
    : "Press Enter to ask.";

  // A Radix dialog under the hood, so the palette takes focus even over an open sheet (whose focus
  // trap would otherwise swallow every keystroke). Opens instantly: it's used constantly.
  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command menu"
      loop
      onKeyDown={(e) => {
        if (e.key === "Backspace" && !query && page && page.kind !== "reply") {
          e.preventDefault();
          go(page.kind === "connector" && page.id ? { kind: "connector" } : null);
        }
      }}
      overlayClassName="fixed inset-0 z-[90] bg-overlay/50"
      contentClassName="fixed left-1/2 top-[14vh] z-[91] w-[calc(100vw-32px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-xl bg-surface-raised shadow-xl ring-1 ring-border outline-none"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        {page ? (
          <button
            type="button"
            onClick={() => go(page.kind === "connector" && page.id ? { kind: "connector" } : null)}
            aria-label="Back"
            className="-ml-1.5 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-[12.5px] text-fg-2 transition-colors hover:bg-bg-subtle hover:text-fg"
          >
            <ArrowLeft className="size-3.5" />
            <span className="max-w-40 truncate">{page.kind === "connector" && page.id ? (ws?.connectors.find((c) => c.id === page.id)?.name ?? PAGE.connector.title) : PAGE[page.kind].title}</span>
          </button>
        ) : (
          <Search className="size-4 text-fg-3" />
        )}
        {page?.kind === "reply" ? (
          <p className="h-12 min-w-0 flex-1 truncate py-3.5 text-[13px] text-fg-3">Matched to who sent it, on this computer</p>
        ) : (
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={page ? PAGE[page.kind].placeholder : "Ask anything, or jump to a company, page or action…"}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3"
          />
        )}
        <Kbd className="hidden md:pointer-fine:inline-flex">esc</Kbd>
      </div>
      {page?.kind === "reply" ? (
        <PasteReply onDone={() => setOpen(false)} />
      ) : (
        <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-3">{empty}</Command.Empty>
          {page ? (
            pageItems
          ) : (
            <>
              {!q && (
                <Item value="ask a question open conversation" icon={<MessageCircle className="size-4 text-accent" />} onSelect={() => run(() => openAsk())} hint="Ask">
                  Ask a question…
                </Item>
              )}
              {q && (
                <Item value={`ask ${query}`} icon={<MessageCircle className="size-4 text-accent" />} onSelect={() => run(() => openAsk({ prefill: q }))} hint="Ask">
                  <span className="text-fg-3">Ask:</span> {query}
                </Item>
              )}
              {q && looksLikeDomain && (
                <Item value={`research ${query}`} icon={<Sparkles className="size-4" />} onSelect={() => run(() => router.push(`/companies?add=${encodeURIComponent(cleanDomain(q))}`))}>
                  Research {cleanDomain(q)}
                </Item>
              )}
              {q && looksLikeDomain && (
                <Item
                  value={`find companies like ${query}`}
                  icon={<Compass className="size-4" />}
                  onSelect={() =>
                    run(() => {
                      const domain = cleanDomain(q);
                      void start("discovery", { count: 10, brief: `Companies like ${domain}`, seedDomains: [domain], source: "manual" });
                      router.push("/companies");
                    })
                  }
                >
                  Find companies like {cleanDomain(q)}
                </Item>
              )}
              {!q && recentCompanies.length > 0 && (
                <Command.Group heading="Recent">
                  {recentCompanies.map((a) => (
                    <Item
                      key={`recent-${a.domain}`}
                      value={`recent ${a.name} ${a.domain}`}
                      icon={<Favicon domain={a.domain} name={a.name} size={16} />}
                      onSelect={() => run(() => router.push(sheet(a.domain)))}
                      hint={<ArrowRight className="size-3.5" />}
                    >
                      {a.name} <span className="font-mono text-[12px] text-fg-3">{a.domain}</span>
                    </Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Do">
                <Item value="write to someone email message person outreach" icon={<PenLine className="size-4" />} onSelect={() => go({ kind: "write" })} more>
                  Write to…
                </Item>
                <Item value="paste a reply they replied answer email" icon={<Reply className="size-4" />} onSelect={() => go({ kind: "reply" })} more>
                  Paste a reply
                </Item>
                <Item value="check replies who replied gmail search" icon={<Inbox className="size-4" />} onSelect={checkReplies}>
                  Check replies
                </Item>
                <Item value="prep for a meeting call brief" icon={<ClipboardList className="size-4" />} onSelect={() => go({ kind: "prep" })} more>
                  Prep for a meeting…
                </Item>
                <Item value="log a call debrief notes transcript" icon={<Phone className="size-4" />} onSelect={() => run(() => router.push("/companies?view=talking&log=1"))}>
                  Log a call
                </Item>
                <Item value="find new companies discover accounts prospects" icon={<Compass className="size-4" />} onSelect={() => run(() => void start("discovery", {}))}>
                  Find new companies to talk to
                </Item>
                <Item value="ask a connector for intros warm introduction investor advisor" icon={<Handshake className="size-4" />} onSelect={() => go({ kind: "connector" })} more>
                  Ask a connector for intros
                </Item>
                <Item value="draft an asset one-pager demo script security case study insight design partner terms document" icon={<FileText className="size-4" />} onSelect={() => go({ kind: "asset" })} more>
                  Draft an asset…
                </Item>
                <Item value="draft a pilot proposal order form deal" icon={<NotebookPen className="size-4" />} onSelect={() => go({ kind: "proposal" })} more>
                  Draft a pilot proposal…
                </Item>
                <Item value="add a deal start a deal pipeline conversation" icon={<Briefcase className="size-4" />} onSelect={() => go({ kind: "deal" })} more>
                  Add a deal…
                </Item>
                <Item value="run weekly review monday pipeline review" icon={<ClipboardList className="size-4" />} onSelect={() => review("monday")}>
                  Run the weekly pipeline review
                </Item>
                <Item value="run weekly review friday learning review what worked" icon={<ClipboardList className="size-4" />} onSelect={() => review("friday")}>
                  Run the weekly learning review
                </Item>
                <Item value="plan a roundtable dinner event" icon={<CalendarHeart className="size-4" />} onSelect={() => run(() => router.push("/events?new=1"))}>
                  Plan a roundtable or dinner
                </Item>
                <Item value="import a list csv companies crm export conference" icon={<FileUp className="size-4" />} onSelect={() => run(() => router.push("/integrations?import=csv"))}>
                  Import a list
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
                <Item value="map where are my leads nearby location" icon={<MapIcon className="size-4" />} onSelect={() => run(() => router.push("/companies?view=map"))}>
                  Map of your leads
                </Item>
                <Item value="toggle theme dark light" icon={<Moon className="size-4" />} onSelect={() => run(toggleTheme)}>
                  Toggle dark mode
                </Item>
                <Item value="keyboard shortcuts help keys" icon={<Keyboard className="size-4" />} onSelect={() => run(() => window.dispatchEvent(new Event("inroad:shortcuts")))} keys="?">
                  Keyboard shortcuts
                </Item>
              </Command.Group>
              <Command.Group heading="Go to">
                <Item value="today" icon={<Sunrise className="size-4" />} onSelect={() => run(() => router.push("/today"))} keys="G T">
                  Today
                </Item>
                <Item value="companies" icon={<Building2 className="size-4" />} onSelect={() => run(() => router.push("/companies"))} keys="G C">
                  Companies
                </Item>
                <Item value="intros warm introductions connectors" icon={<Handshake className="size-4" />} onSelect={() => run(() => router.push("/intros"))} keys="G N">
                  Intros
                </Item>
                <Item value="events dinners" icon={<CalendarHeart className="size-4" />} onSelect={() => run(() => router.push("/events"))} keys="G E">
                  Events
                </Item>
                <Item value="playbook icp positioning" icon={<NotebookPen className="size-4" />} onSelect={() => run(() => router.push("/playbook"))} keys="G P">
                  Playbook
                </Item>
                <Item value="integrations connect tools" icon={<Plug className="size-4" />} onSelect={() => run(() => router.push("/integrations"))} keys="G I">
                  Integrations
                </Item>
                <Item value="settings usage api key" icon={<Settings className="size-4" />} onSelect={() => run(() => router.push("/settings"))} keys="G S">
                  Settings
                </Item>
              </Command.Group>
              {companies.length > 0 && (
                <Command.Group heading="Companies">
                  {companies.map((a) => (
                    <Item
                      key={a.domain}
                      value={`${a.name} ${a.domain}`}
                      icon={<Favicon domain={a.domain} name={a.name} size={16} />}
                      onSelect={() => run(() => router.push(sheet(a.domain)))}
                      hint={<ArrowRight className="size-3.5" />}
                    >
                      {a.name} <span className="font-mono text-[12px] text-fg-3">{a.domain}</span>
                    </Item>
                  ))}
                </Command.Group>
              )}
            </>
          )}
        </Command.List>
      )}
    </Command.Dialog>
  );
}

/** One row. `keys` are keyboard hints (hidden on touch); `more` marks a command that opens a page of choices. */
function Item({ children, icon, onSelect, value, hint, keys, more }: { children: ReactNode; icon?: ReactNode; onSelect: () => void; value: string; hint?: ReactNode; keys?: string; more?: boolean }) {
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
      {hint && <span className="shrink-0 text-[11.5px] text-fg-3">{hint}</span>}
      {keys && <span className="hidden font-mono text-[11px] text-fg-3 md:pointer-fine:inline">{keys}</span>}
      {more && <ArrowRight className="size-3.5 shrink-0 text-fg-4" aria-hidden />}
    </Command.Item>
  );
}
