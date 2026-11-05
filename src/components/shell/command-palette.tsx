"use client";

import { Command } from "cmdk";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Briefcase,
  CalendarHeart,
  ClipboardList,
  Compass,
  FileText,
  FileUp,
  Handshake,
  Inbox,
  Keyboard,
  Map as MapIcon,
  Megaphone,
  MessageCircle,
  Moon,
  NotebookPen,
  PenLine,
  Phone,
  Reply,
  Search,
  Sparkles,
  Target,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAsk } from "@/components/providers/ask-provider";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { newAccount } from "@/components/companies/sheet/new-account";
import { unlessSheetOpen } from "@/components/companies/sheet/open-sheet";
import { RELATIONSHIP_LABEL } from "@/components/intros/connectors";
import { ASSET_KINDS, creatableKinds } from "@/components/playbook/model";
import { Favicon } from "@/components/ui/favicon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/client/cn";
import { readRecent } from "@/lib/client/recent";
import { newDeal } from "@/lib/deals/rules";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import { OPEN_STAGES, STAGE_LABELS } from "@/lib/domain/types";
import { MODES, useMarket, useSwitchMarket } from "./market-switch";
import { SECONDARY, navFor } from "./nav";
import { connectorChoices, connectorTargets, dealCandidates, proposalDeals, repliesToCheck, reviewThisWeek, upcomingMeetings, writeTargets } from "./palette-data";
import { isQuestion, matchScore, mergeRanked, rankBy, scoreBy, type Rankable } from "./palette-rank";
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

/** At most this many rows answer a query: the best of every company, person, command and page, never the first 200. */
const RESULTS = 50;

/**
 * A row on the palette's first page. `id` is its cmdk value (unique); `name`, `aliases` and `keywords` are what a
 * query matches (palette-rank). To add a command, add a row to `commands` below.
 */
interface Row extends Rankable {
  id: string;
  label: ReactNode;
  icon: ReactNode;
  onSelect: () => void;
  hint?: ReactNode;
  keys?: string;
  more?: boolean;
}

/** A company or a person a query can find: data only, so the whole workspace can be searched on every keystroke. */
interface Found extends Rankable {
  id: string;
  domain: string;
  person?: string;
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // ignore
  }
}

/** The company whose sheet is open (`/companies?c=<domain>`): its actions come first. Read when the palette opens. */
function sheetDomain(): string | null {
  if (window.location.pathname !== "/companies") return null;
  return new URLSearchParams(window.location.search).get("c");
}

/**
 * ⌘K. Opens instantly, no animation on navigation or filtering (it's used constantly).
 * With nothing typed: "Ask a question…" (or, over a company sheet, that company's actions), then what to do, where
 * to go and the companies. With a query, one ranked list (palette-rank): exact and prefix names of companies and
 * people first, then word starts, then loose matches, and "Ask: …" last, or first when the query is a question.
 * The SPEC's commands (Write to, Paste a reply, Check replies, Prep for, Ask a connector, Draft an asset or a
 * pilot proposal, Run the weekly review, Add a deal) each land in the flow that already does the work.
 */
export function CommandPalette() {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  // The highlighted item. Cleared on a page change so the new page's first item takes it: left alone,
  // it names an item that's gone (the one clicked), and Enter would pick nothing.
  const [selected, setSelected] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [context, setContext] = useState<string | null>(null);
  const setOpen = useCallback((next: boolean | ((o: boolean) => boolean)) => {
    setOpenState((o) => {
      const value = typeof next === "function" ? next(o) : next;
      if (!value) {
        setQuery("");
        setPage(null);
        setSelected("");
      }
      return value;
    });
    // Read on open (an event, not a render): what the founder opened lately comes first, and the sheet that's open.
    setRecent(readRecent());
    setContext(sheetDomain());
  }, []);
  const router = useRouter();
  const { ws, dispatch } = useWorkspace();
  const { start } = useRuns();
  const { openAsk } = useAsk();
  const market = useMarket();
  const switchMarket = useSwitchMarket();
  const b2b = market === "b2b";
  const other = b2b ? "consumer" : "b2b";
  const OtherIcon = MODES[other].icon;

  // A page picked with the mouse leaves focus on the dialog, not the input: put it back, so typing filters the page.
  const go = useCallback((next: Page | null) => {
    setPage(next);
    setQuery("");
    setSelected("");
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[cmdk-dialog] [cmdk-input]")?.focus());
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

  // Every company that isn't disqualified, best fit first, while the palette is open. A query searches all of
  // them; with nothing typed the list shows the top 200.
  const companies = useMemo(
    () =>
      open
        ? Object.values(ws?.accounts ?? {})
            .filter((a) => a.status !== "disqualified")
            .sort((a, b) => b.fitScore - a.fitScore)
        : [],
    [ws, open],
  );

  const recentCompanies = recent.map((d) => ws?.accounts[d]).filter((a): a is NonNullable<typeof a> => !!a && a.status !== "disqualified").slice(0, 5);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
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
      if (window.location.pathname === "/today") window.dispatchEvent(new CustomEvent("inroad:today-open", { detail: "check_replies" }));
      else router.push("/today?open=check_replies");
    });
  // Reviews land on Today, under the moves. One written this week opens; it isn't paid for twice.
  const review = (kind: "monday" | "friday" | "growth") =>
    run(() => {
      if (ws && reviewThisWeek(ws, kind, new Date())) toast(`This week's ${{ monday: "pipeline", friday: "learning", growth: "growth" }[kind]} review is on Today.`);
      else void start("review", { kind });
      if (window.location.pathname !== "/today") router.push("/today");
    });
  // Everything stays where it is; the toast undoes it in one click.
  const switchTo = () =>
    run(async () => {
      if (!(await switchMarket(other))) return;
      toast(`Now selling to ${MODES[other].label.toLowerCase()}.`, { description: "The pages, Today and every draft follow. Nothing is deleted.", action: { label: "Undo", onClick: () => void switchMarket(market) } });
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
  const prepFor = (meetingId: string, domain: string | undefined, briefed: boolean) =>
    run(() => {
      if (!domain) return;
      // No brief yet: start it now; the sheet shows it being written.
      if (!briefed) void start("prep", { meetingId }, { notify: unlessSheetOpen(domain) });
      router.push(sheet(domain, `&intent=prep&ref=${encodeURIComponent(meetingId)}`));
    });

  // Only once a page is open (never while prerendering the shell, which mustn't read the clock).
  const pageItems = (() => {
    if (!ws || !page) return null;
    switch (page.kind) {
      case "write": {
        const targets = rankBy(q, writeTargets(ws), ({ person, account }) => ({ name: person.name, keywords: `${person.title} ${account?.name ?? ""} ${person.accountDomain}`, kind: "entity" }));
        return (
          <Command.Group heading="People">
            {targets.map(({ person, account }) => (
              <Item
                key={person.id}
                value={person.id}
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
        const meetings = rankBy(q, upcomingMeetings(ws, new Date()), ({ meeting, company }) => ({ name: meeting.title, keywords: `${company} ${meeting.attendees.map((a) => a.name).join(" ")}`, kind: "entity" }));
        return (
          <Command.Group heading="Next two weeks">
            {meetings.map(({ meeting, domain, company }) => (
              <Item
                key={meeting.id}
                value={meeting.id}
                icon={domain ? <Favicon domain={domain} name={company} size={16} /> : <CalendarHeart className="size-4" />}
                hint={meeting.brief ? "Brief ready" : "Writes the brief"}
                onSelect={() => prepFor(meeting.id, domain, !!meeting.brief)}
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
          const targets = rankBy(q, connectorTargets(ws, connector), ({ account }) => ({ name: account.name, aliases: [account.domain], kind: "entity" }));
          return (
            <Command.Group heading={`Who ${connector.name.split(" ")[0]} could introduce you to`}>
              {targets.map(({ account, reach }) => (
                <Item
                  key={account.domain}
                  value={account.domain}
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
        const choices = rankBy(q, connectorChoices(ws, todayISO()), ({ connector: c }) => ({ name: c.name, keywords: `${c.company ?? ""} ${(c.reach ?? []).join(" ")}`, kind: "entity" }));
        const addConnector: Rankable = { name: "Add someone who introduces you", keywords: "connector investor advisor", kind: "command" };
        return (
          <Command.Group heading="People who introduce you">
            {choices.map(({ connector: c, ledger }) => (
              <Item key={c.id} value={c.id} icon={<Handshake className="size-4" />} hint={STATUS[ledger.status]} onSelect={() => go({ kind: "connector", id: c.id })}>
                {c.name}{" "}
                <span className="text-fg-3">
                  · {RELATIONSHIP_LABEL[c.relationship]}
                  {c.company ? `, ${c.company}` : ""}
                </span>
              </Item>
            ))}
            {(!q || matchScore(q, addConnector) > 0) && (
              <Item value="add-connector" icon={<UserPlus className="size-4" />} onSelect={() => run(() => router.push("/intros?new=connector"))}>
                Add someone who introduces you
              </Item>
            )}
          </Command.Group>
        );
      }
      case "asset": {
        const kinds = rankBy(q, creatableKinds(ws).filter((k) => k !== "pilot_proposal"), (k) => ({ name: ASSET_KINDS[k].label, keywords: ASSET_KINDS[k].description, kind: "command" }));
        return (
          <Command.Group heading="Draft">
            {kinds.map((k) => (
              <Item key={k} value={k} icon={<FileText className="size-4" />} onSelect={() => run(() => router.push(`/playbook?new=${k}`))}>
                {ASSET_KINDS[k].label} <span className="text-fg-3">· {ASSET_KINDS[k].description}</span>
              </Item>
            ))}
          </Command.Group>
        );
      }
      case "proposal": {
        const deals = rankBy(q, proposalDeals(ws), (d) => ({ name: ws.accounts[d.accountDomain]?.name ?? d.name, aliases: [d.name, d.accountDomain], keywords: STAGE_LABELS[d.stage], kind: "entity" }));
        return (
          <Command.Group heading="Live deals">
            {deals.map((d) => (
              <Item
                key={d.id}
                value={d.id}
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
        const candidates = rankBy(q, dealCandidates(ws), (a) => ({ name: a.name, aliases: [a.domain], kind: "entity" }));
        const typed = looksLikeDomain ? cleanDomain(q) : null;
        return (
          <>
            {typed && !ws.accounts[typed] && (
              <Item value={`add:${typed}`} icon={<Briefcase className="size-4" />} onSelect={() => startDeal(typed)}>
                Add {typed} and start a deal
              </Item>
            )}
            <Command.Group heading="Companies">
              {candidates.map((a) => (
                <Item key={a.domain} value={a.domain} icon={<Favicon domain={a.domain} name={a.name} size={16} />} onSelect={() => startDeal(a.domain)}>
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

  const empty =
    page?.kind === "prep"
      ? "No meetings in the next two weeks. Add one on a deal and I'll prep it."
      : page?.kind === "proposal"
        ? "No live deals yet. A pilot proposal is built from a deal's qualification card."
        : page?.kind === "write"
          ? "No one by that name. Research their company first, then write."
          : "Nothing matches.";

  /* ───────────── The first page, as rows ───────────── */

  // The workspace while the palette shows its first page, else null: nothing below is built while it's closed
  // (or while prerendering the shell, which mustn't read the clock).
  const root = open && !page ? ws : null;

  /** What to do with the company whose sheet is open, first. */
  const contextRows: Row[] = [];
  const contextAccount = root && context ? root.accounts[context] : undefined;
  if (root && contextAccount) {
    const a = contextAccount;
    const deal = a.dealId ? root.deals[a.dealId] : undefined;
    const live = !!deal && OPEN_STAGES.includes(deal.stage);
    const people = writeTargets(root).filter((t) => t.person.accountDomain === a.domain).slice(0, 2);
    const meeting = upcomingMeetings(root, new Date()).find((m) => m.domain === a.domain);
    const ctx = (row: Omit<Row, "kind" | "boost">): Row => ({ ...row, kind: "command", boost: 3 });
    contextRows.push(ctx({ id: "ctx:ask", name: `Ask about ${a.name}`, keywords: "ask question", icon: <MessageCircle className="size-4 text-accent" />, hint: "Ask", label: <>Ask about {a.name}…</>, onSelect: () => run(() => openAsk({ context: { kind: "account", id: a.domain } })) }));
    for (const { person } of people) {
      contextRows.push(
        ctx({
          id: `ctx:write:${person.id}`,
          name: `Write to ${person.name}`,
          keywords: `email message ${person.title}`,
          icon: <PenLine className="size-4" />,
          label: (
            <>
              Write to {person.name} {person.title && <span className="text-fg-3">· {person.title}</span>}
            </>
          ),
          onSelect: () => run(() => router.push(sheet(a.domain, `&intent=write&ref=${encodeURIComponent(person.id)}`))),
        }),
      );
    }
    if (meeting) {
      contextRows.push(
        ctx({
          id: "ctx:prep",
          name: `Prep for ${meeting.meeting.title}`,
          keywords: "prep meeting call brief",
          icon: <ClipboardList className="size-4" />,
          hint: meeting.meeting.brief ? "Brief ready" : "Writes the brief",
          label: <>Prep for {meeting.meeting.title}</>,
          onSelect: () => prepFor(meeting.meeting.id, a.domain, !!meeting.meeting.brief),
        }),
      );
    }
    contextRows.push(ctx({ id: "ctx:log", name: `Log a call with ${a.name}`, keywords: "debrief notes transcript", icon: <Phone className="size-4" />, label: <>Log a call with {a.name}</>, onSelect: () => run(() => router.push(sheet(a.domain, "&intent=log"))) }));
    contextRows.push(
      live
        ? ctx({ id: "ctx:proposal", name: `Draft a pilot proposal for ${a.name}`, keywords: "order form deal", icon: <NotebookPen className="size-4" />, label: <>Draft a pilot proposal for {a.name}</>, onSelect: () => run(() => router.push(`/playbook?new=pilot_proposal&deal=${encodeURIComponent(deal.id)}`)) })
        : ctx({ id: "ctx:deal", name: `Start a deal with ${a.name}`, keywords: "add deal pipeline conversation", icon: <Briefcase className="size-4" />, label: <>Start a deal with {a.name}</>, onSelect: () => startDeal(a.domain) }),
    );
    contextRows.push(
      ctx({
        id: "ctx:research",
        name: a.dossier ? `Research ${a.name} again` : `Research ${a.name}`,
        keywords: "dossier refresh",
        icon: <Sparkles className="size-4" />,
        label: a.dossier ? <>Research {a.name} again</> : <>Research {a.name}</>,
        onSelect: () => run(() => void start("dossier", { domain: a.domain, force: !!a.dossier }, { notify: unlessSheetOpen(a.domain) })),
      }),
    );
    contextRows.push(
      ctx({
        id: "ctx:similar",
        name: `Find companies like ${a.name}`,
        keywords: "discover lookalike similar",
        icon: <Compass className="size-4" />,
        label: <>Find companies like {a.name}</>,
        onSelect: () => run(() => void start("discovery", { count: 10, brief: `Companies like ${a.domain}`, seedDomains: [a.domain], source: "manual" })),
      }),
    );
  }

  const cmd = (row: Omit<Row, "kind">): Row => ({ ...row, kind: "command" });
  const commands: Row[] = !root
    ? []
    : [
        cmd({ id: "do:write", name: "Write to…", keywords: "someone email message person outreach", icon: <PenLine className="size-4" />, label: "Write to…", onSelect: () => go({ kind: "write" }), more: true }),
        cmd({ id: "do:reply", name: "Paste a reply", keywords: "they replied answer email", icon: <Reply className="size-4" />, label: "Paste a reply", onSelect: () => go({ kind: "reply" }), more: true }),
        cmd({ id: "do:check-replies", name: "Check replies", keywords: "who replied gmail search", icon: <Inbox className="size-4" />, label: "Check replies", onSelect: checkReplies }),
        cmd({ id: "do:prep", name: "Prep for a meeting…", keywords: "call brief", icon: <ClipboardList className="size-4" />, label: "Prep for a meeting…", onSelect: () => go({ kind: "prep" }), more: true }),
        ...(b2b
          ? [
              cmd({ id: "do:log-call", name: "Log a call", keywords: "debrief notes transcript", icon: <Phone className="size-4" />, label: "Log a call", onSelect: () => run(() => router.push("/companies?view=talking&log=1")) }),
              cmd({ id: "do:revenue-target", name: "Set the revenue target", keywords: "quota number quarter forecast", icon: <Target className="size-4" />, label: "Set the revenue target", onSelect: () => run(() => router.push("/revenue?target=1")) }),
              cmd({ id: "do:gtm-update", name: "Write the weekly GTM update", keywords: "board investor ceo report forecast", icon: <FileText className="size-4" />, label: "Write the weekly GTM update", onSelect: () => run(() => router.push("/revenue#update-label")) }),
            ]
          : [
              cmd({ id: "do:log-numbers", name: "Log last week's numbers", keywords: "weekly growth signups retention active users", icon: <FileUp className="size-4" />, label: "Log last week's numbers", onSelect: () => run(() => router.push("/growth?log=1")) }),
              cmd({ id: "do:growth-review", name: "Run the weekly growth review", keywords: "monday numbers experiment", icon: <ClipboardList className="size-4" />, label: "Run the weekly growth review", onSelect: () => review("growth") }),
            ]),
        cmd({ id: "do:research", name: b2b ? "Search the web and research companies" : "Search the web", keywords: "research sources", icon: <Search className="size-4" />, label: b2b ? "Search the web and research companies" : "Search the web", onSelect: () => run(() => router.push("/research")) }),
        ...(b2b ? [cmd({ id: "do:discover", name: "Find new companies to talk to", keywords: "discover accounts prospects", icon: <Compass className="size-4" />, label: "Find new companies to talk to", onSelect: () => run(() => void start("discovery", {})) })] : []),
        cmd({
          id: "do:partners",
          name: b2b ? "Find newsletters, podcasts and communities" : "Find creators and communities",
          keywords: b2b ? "partners linkedin creators sponsors" : "influencers where users gather",
          icon: <Megaphone className="size-4" />,
          label: b2b ? "Find newsletters, podcasts and communities" : "Find creators and communities",
          onSelect: () => run(() => void start("partners", { mode: "find", count: 8, source: "founder" })),
        }),
        ...(b2b ? [cmd({ id: "do:connector", name: "Ask a connector for intros", keywords: "warm introduction investor advisor", icon: <Handshake className="size-4" />, label: "Ask a connector for intros", onSelect: () => go({ kind: "connector" }), more: true })] : []),
        cmd({
          id: "do:asset",
          name: b2b ? "Draft an asset…" : "Draft a document…",
          keywords: `asset document ${creatableKinds(root).map((k) => ASSET_KINDS[k].label).join(" ")}`,
          icon: <FileText className="size-4" />,
          label: b2b ? "Draft an asset…" : "Draft a document…",
          onSelect: () => go({ kind: "asset" }),
          more: true,
        }),
        ...(b2b
          ? [
              cmd({ id: "do:proposal", name: "Draft a pilot proposal…", keywords: "order form deal", icon: <NotebookPen className="size-4" />, label: "Draft a pilot proposal…", onSelect: () => go({ kind: "proposal" }), more: true }),
              cmd({ id: "do:deal", name: "Add a deal…", keywords: "start a deal pipeline conversation", icon: <Briefcase className="size-4" />, label: "Add a deal…", onSelect: () => go({ kind: "deal" }), more: true }),
              cmd({ id: "do:monday-review", name: "Run the weekly pipeline review", keywords: "monday", icon: <ClipboardList className="size-4" />, label: "Run the weekly pipeline review", onSelect: () => review("monday") }),
              cmd({ id: "do:friday-review", name: "Run the weekly learning review", keywords: "friday what worked", icon: <ClipboardList className="size-4" />, label: "Run the weekly learning review", onSelect: () => review("friday") }),
              cmd({ id: "do:event", name: "Plan a roundtable or dinner", keywords: "event", icon: <CalendarHeart className="size-4" />, label: "Plan a roundtable or dinner", onSelect: () => run(() => router.push("/events?new=1")) }),
              cmd({ id: "do:import-list", name: "Import a list", keywords: "csv companies crm export conference", icon: <FileUp className="size-4" />, label: "Import a list", onSelect: () => run(() => router.push("/integrations?import=csv")) }),
              cmd({ id: "do:import-linkedin", name: "Import LinkedIn connections", keywords: "warm network csv", icon: <FileUp className="size-4" />, label: "Import LinkedIn connections", onSelect: () => run(() => router.push("/integrations?import=linkedin")) }),
              cmd({ id: "do:import-github", name: "Import GitHub stargazers", keywords: "repo developers warm", icon: <FileUp className="size-4" />, label: "Import GitHub stargazers", onSelect: () => run(() => router.push("/integrations?import=github")) }),
              cmd({ id: "do:give-intro", name: "Make an intro", keywords: "introduce two people give", icon: <ArrowLeftRight className="size-4" />, label: "Make an intro", onSelect: () => run(() => router.push("/intros?new=give")) }),
              cmd({ id: "do:add-connector", name: "Add someone who introduces you", keywords: "connector investor advisor", icon: <UserPlus className="size-4" />, label: "Add someone who introduces you", onSelect: () => run(() => router.push("/intros?new=connector")) }),
              cmd({ id: "do:map", name: "Map of your leads", keywords: "where are my leads nearby location", icon: <MapIcon className="size-4" />, label: "Map of your leads", onSelect: () => run(() => router.push("/companies?view=map")) }),
            ]
          : []),
        ...(root.company
          ? [
              cmd({
                id: "do:switch-market",
                name: `Switch to selling to ${MODES[other].label.toLowerCase()}`,
                keywords: `${b2b ? "consumer b2c" : "b2b business"} mode market who you sell to`,
                icon: <OtherIcon className="size-4" />,
                label: `Switch to selling to ${MODES[other].label.toLowerCase()}`,
                onSelect: switchTo,
              }),
            ]
          : []),
        cmd({ id: "do:theme", name: "Toggle dark mode", keywords: "theme light", icon: <Moon className="size-4" />, label: "Toggle dark mode", onSelect: () => run(toggleTheme) }),
        cmd({ id: "do:shortcuts", name: "Keyboard shortcuts", keywords: "help keys", icon: <Keyboard className="size-4" />, label: "Keyboard shortcuts", keys: "?", onSelect: () => run(() => window.dispatchEvent(new Event("inroad:shortcuts"))) }),
      ];

  const pages: Row[] = !root
    ? []
    : [...navFor(market), ...SECONDARY].map((p) => ({ id: `go:${p.href}`, name: p.label, keywords: p.keywords, kind: "page", icon: <p.icon className="size-4" />, label: p.label, keys: `G ${p.key}`, onSelect: () => run(() => router.push(p.href)) }));

  const companyRow = (a: (typeof companies)[number], extra?: Partial<Row>): Row => {
    const deal = a.dealId ? ws?.deals[a.dealId] : undefined;
    const live = !!deal && OPEN_STAGES.includes(deal.stage);
    return {
      id: `company:${a.domain}`,
      name: a.name,
      aliases: deal && deal.name !== a.name ? [a.domain, deal.name] : [a.domain],
      kind: "entity",
      icon: <Favicon domain={a.domain} name={a.name} size={16} />,
      label: (
        <>
          {a.name} <span className="font-mono text-[12px] text-fg-3">{a.domain}</span>
        </>
      ),
      hint: live ? STAGE_LABELS[deal.stage] : <ArrowRight className="size-3.5" />,
      onSelect: () => run(() => router.push(sheet(a.domain))),
      ...extra,
    };
  };

  const personRow = (personId: string): Row | null => {
    const p = ws?.people[personId];
    if (!p) return null;
    const account = ws?.accounts[p.accountDomain];
    return {
      id: `person:${p.id}`,
      name: p.name,
      kind: "entity",
      icon: <Favicon domain={p.accountDomain} name={account?.name} size={16} />,
      label: (
        <>
          {p.name}{" "}
          <span className="text-fg-3">
            · {p.title ? `${p.title}, ` : ""}
            {account?.name ?? p.accountDomain}
          </span>
        </>
      ),
      onSelect: () => run(() => router.push(sheet(p.accountDomain))),
    };
  };

  // What a query searches besides commands and pages: every company and every person (not the first 200 by fit),
  // as plain data, rebuilt only when the workspace changes. Recently opened companies win ties.
  const found = useMemo((): Found[] => {
    if (!root || !b2b) return [];
    const recentSet = new Set(recent);
    const out: Found[] = companies.map((a) => {
      const deal = a.dealId ? root.deals[a.dealId] : undefined;
      return { id: `company:${a.domain}`, domain: a.domain, name: a.name, aliases: deal && deal.name !== a.name ? [a.domain, deal.name] : [a.domain], kind: "entity", boost: recentSet.has(a.domain) ? 1 : 0 };
    });
    for (const p of Object.values(root.people)) {
      const account = root.accounts[p.accountDomain];
      if (account?.status === "disqualified") continue;
      out.push({ id: `person:${p.id}`, domain: p.accountDomain, person: p.id, name: p.name, keywords: `${p.title} ${account?.name ?? ""} ${p.accountDomain} ${p.email ?? ""}`, kind: "entity" });
    }
    return out;
  }, [root, b2b, companies, recent]);
  const foundRanked = useMemo(() => (root && q ? scoreBy(q, found, (f) => f, RESULTS) : []), [root, q, found]);

  const domainRows: Row[] =
    root && q && looksLikeDomain && b2b
      ? [
          cmd({ id: "do:research-domain", name: `Research ${cleanDomain(q)}`, icon: <Sparkles className="size-4" />, label: `Research ${cleanDomain(q)}`, onSelect: () => run(() => router.push(`/companies?add=${encodeURIComponent(cleanDomain(q))}`)) }),
          cmd({
            id: "do:similar-domain",
            name: `Find companies like ${cleanDomain(q)}`,
            icon: <Compass className="size-4" />,
            label: `Find companies like ${cleanDomain(q)}`,
            onSelect: () =>
              run(() => {
                const domain = cleanDomain(q);
                void start("discovery", { count: 10, brief: `Companies like ${domain}`, seedDomains: [domain], source: "manual" });
                // Plain /companies reopens the last-used view; new finds land in Prospects.
                router.push("/companies?view=prospects");
              }),
          }),
        ]
      : [];
  // One list, best first: the open company's actions win ties, then what the query names, then commands and pages.
  const searched: Row[] = !root || !q
    ? []
    : mergeRanked(scoreBy(q, [...contextRows.filter((r) => r.id !== "ctx:ask"), ...domainRows, ...commands, ...pages], (r) => r), foundRanked, RESULTS)
        .map((r) => ("label" in r ? r : r.person ? personRow(r.person) : root.accounts[r.domain] ? companyRow(root.accounts[r.domain]) : null))
        .filter((r): r is Row => !!r);

  const askFirst = isQuestion(q);
  const askRow = q ? (
    <Item value="ask" icon={<MessageCircle className="size-4 text-accent" />} onSelect={() => run(() => openAsk({ prefill: q }))} hint="Ask">
      <span className="text-fg-3">Ask:</span> {query}
    </Item>
  ) : null;
  const rows = (list: Row[]) =>
    list.map((r) => (
      <Item key={r.id} value={r.id} icon={r.icon} onSelect={r.onSelect} hint={r.hint} keys={r.keys} more={r.more}>
        {r.label}
      </Item>
    ));

  // A Radix dialog under the hood, so the palette takes focus even over an open sheet (whose focus
  // trap would otherwise swallow every keystroke). Opens instantly: it's used constantly. cmdk doesn't filter
  // or sort: the rows arrive ranked (palette-rank), in the order they should read.
  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command menu"
      value={selected}
      onValueChange={setSelected}
      shouldFilter={false}
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
            <span className="max-w-40 truncate">
              {page.kind === "connector" && page.id ? (ws?.connectors.find((c) => c.id === page.id)?.name ?? PAGE.connector.title) : page.kind === "asset" && !b2b ? "Draft a document" : PAGE[page.kind].title}
            </span>
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
            placeholder={page ? PAGE[page.kind].placeholder : contextAccount ? `Ask about ${contextAccount.name}, or jump anywhere…` : "Ask anything, or jump to a company, page or action…"}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-3"
          />
        )}
        <Kbd className="hidden md:pointer-fine:inline-flex">esc</Kbd>
      </div>
      {page?.kind === "reply" ? (
        <PasteReply onDone={() => setOpen(false)} />
      ) : (
        <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3">
          <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-3">{empty}</Command.Empty>
          {page ? (
            pageItems
          ) : q ? (
            <>
              {askFirst && askRow}
              {rows(searched)}
              {!askFirst && askRow}
            </>
          ) : (
            <>
              {contextAccount ? (
                <Command.Group heading={`Actions for ${contextAccount.name}`}>{rows(contextRows)}</Command.Group>
              ) : (
                <Item value="ask-open" icon={<MessageCircle className="size-4 text-accent" />} onSelect={() => run(() => openAsk())} hint="Ask">
                  Ask a question…
                </Item>
              )}
              {b2b && recentCompanies.length > 0 && <Command.Group heading="Recent">{rows(recentCompanies.map((a) => companyRow(a, { id: `recent:${a.domain}` })))}</Command.Group>}
              <Command.Group heading="Do">{rows(commands)}</Command.Group>
              <Command.Group heading="Go to">{rows(pages)}</Command.Group>
              {b2b && companies.length > 0 && <Command.Group heading="Companies">{rows(companies.slice(0, 200).map((a) => companyRow(a)))}</Command.Group>}
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
      {hint && <span className="shrink-0 text-[12px] text-fg-3">{hint}</span>}
      {keys && <span className="hidden font-mono text-[12px] text-fg-3 md:pointer-fine:inline">{keys}</span>}
      {more && <ArrowRight className="size-3.5 shrink-0 text-fg-4" aria-hidden />}
    </Command.Item>
  );
}
