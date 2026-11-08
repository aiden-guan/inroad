"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, MessageCircle, MessagesSquare, PenLine, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAsk } from "@/components/providers/ask-provider";
import { RunInline } from "@/components/today/parts";
import { AiBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { CopyButton, Segmented } from "@/components/ui/misc";
import { Kbd } from "@/components/ui/kbd";
import { KIND_LABELS, KIND_PLURAL, QuoteRow, TrendBars, TrendLabel } from "@/components/voice/parts";
import { cn } from "@/lib/client/cn";
import { money, shortDate, usd } from "@/lib/client/format";
import { nowISO } from "@/lib/domain/ids";
import { STAGE_LABELS } from "@/lib/domain/types";
import { ease } from "@/lib/motion";
import { plural } from "@/lib/moves/util";
import { heardIn } from "@/lib/voice";
import { winLine } from "@/lib/voice/stats";
import { askAboutTheme, messagingChanges, studioMaterial, type MessagingChange } from "@/lib/voice/use";
import type { ThemeKind, VoiceTheme } from "@/lib/voice/types";
import { BuyerAlternatives } from "./buyers-alternatives";
import { BattlecardBlock } from "./buyers-battlecard";
import { QuoteBank } from "./buyers-quotes";
import { usePlaybook } from "./context";
import { voiceMarkdown } from "./model";
import { RovingList, focusRow, setParams, themeDomId, useArrival } from "./buyers-shared";
import { FieldLabel, Section, Sub, undoable } from "./ui";

/**
 * Buyer voice: what buyers actually say, grouped with receipts. Every count, trend, stage and win split is code's,
 * recounted from debriefs and replies on each change; the one model pass only names and merges the groups, and is
 * offered again only when new debriefs arrive. From a theme the founder can add their words to messaging (a tracked
 * playbook change they accept), write a post from the quotes, or ask about it. Consumer mode reads the founder's
 * notes from user conversations instead, and shows only what those can support.
 */

type Filter = "all" | ThemeKind;
const FILTERS: Filter[] = ["all", "objection", "pain", "outcome", "process"];

export function BuyersSection() {
  const { ws, voice, today } = usePlaybook();
  const consumer = ws.company?.market === "consumer";
  const s = voice.summary;
  const who = consumer ? "users" : "buyers";
  // The same page the Playbook export carries: for a weekly update, a channel or a new hire.
  const summaryText = useMemo(() => voiceMarkdown(ws, today, consumer, voice).join("\n").trim(), [ws, today, consumer, voice]);
  const kicker = s.quotes ? (
    <p className="text-[13px] leading-5 text-fg-3">
      From {consumer ? plural(s.talks, "user conversation") : `${plural(s.calls, "call")}${s.replies ? ` and ${plural(s.replies, "reply", "replies")}` : ""}`}
      {!consumer && ` with ${plural(s.companies, "company", "companies")}`}
      {s.firstDate && s.lastDate && ` · ${shortDate(s.firstDate)} to ${shortDate(s.lastDate)}`}
      {" · "}
      {consumer ? `${plural(s.paraphrase, "note")}, all paraphrase` : `${s.verbatim} in their words, ${s.paraphrase} paraphrased`}
      {s.calls + s.talks < 15 && <span className="text-fg-3"> · anecdotes until about 15 conversations</span>}
    </p>
  ) : undefined;

  return (
    <Section id="buyers" title={consumer ? "User voice" : "Buyer voice"} kicker={kicker} right={summaryText ? <CopyButton text={`${summaryText}\n`} label="Copy summary" /> : undefined}>
      {s.quotes === 0 ? (
        <Empty consumer={consumer} />
      ) : (
        <>
          <Overview />
          <Themes who={who} consumer={consumer} />
          {!consumer && <BuyerAlternatives />}
          <QuoteBank consumer={consumer} />
        </>
      )}
    </Section>
  );
}

function Empty({ consumer }: { consumer: boolean }) {
  return (
    <Sub id="buyer-themes" title={consumer ? "What users say" : "What buyers say"}>
      <div className="rounded-lg bg-surface p-5 ring-1 ring-border">
        <p className="font-serif text-[18px] leading-[27px] text-fg">Nothing to group yet.</p>
        <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-[21px] text-fg-2">
          {consumer
            ? "Log a user conversation from Today with a few lines of notes, and what users tell you is grouped here, labeled as your notes."
            : "Paste a call transcript under a deal with Log a call. I'll pull out what buyers said, word for word, and group it here: objections, pains, what they want, who signs, and the tools they compare you with. Replies they send count too."}
        </p>
        <Link
          href={consumer ? "/today" : "/companies?view=talking"}
          className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn transition-colors hover:bg-primary-hover"
        >
          {consumer ? "Open Today" : "Open your deals"}
        </Link>
      </div>
    </Sub>
  );
}

/* ───────────────────────────── Overview ───────────────────────────── */

function Overview() {
  const { voice } = usePlaybook();
  const params = useSearchParams();
  const open = (h: (typeof voice.headlines)[number]) => {
    if (h.theme) {
      setParams(params, { theme: h.theme, kind: null });
      focusRow(themeDomId(h.theme));
    } else if (h.alternative) {
      setParams(params, { alt: h.alternative });
      focusRow(themeDomId(h.alternative));
    }
  };
  return (
    <div className="space-y-4">
      {voice.headlines.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-border">
          {voice.headlines.map((h) => (
            <li key={h.text}>
              <button type="button" onClick={() => open(h)} className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-subtle/60 focus-visible:bg-bg-subtle/60 focus-visible:outline-none">
                <span aria-hidden className={cn("mt-[9px] size-1.5 shrink-0 rounded-full", h.tone === "attention" ? "bg-accent" : "bg-fg-4")} />
                <span className="min-w-0 flex-1 font-serif text-[16px] leading-[24px] text-fg [overflow-wrap:anywhere]">{h.text}</span>
                <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Naming />
    </div>
  );
}

/** The cached naming pass: when it ran and what it cost, or the offer to run it (only names; every number stays code's). */
function Naming() {
  const { voice } = usePlaybook();
  const n = voice.naming;
  if (n.status === "fresh") {
    return (
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-fg-3">
        <AiBadge />
        Theme names written by AI from {plural(voice.summary.calls + voice.summary.talks, "conversation")} on {shortDate(n.at)}
        {n.costUsd !== undefined && ` for ${usd(n.costUsd)}`}. Every number is counted in code.
      </p>
    );
  }
  const stale = n.status === "stale";
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-bg-subtle/50 px-4 py-3 ring-1 ring-inset ring-border sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[13px] leading-5 text-fg-2">
        {stale
          ? n.newCalls
            ? `${plural(n.newCalls, "new call")} since themes were named. Names cover what was there then; counts already include the new ones.`
            : "Debriefs changed since themes were named. Counts are current; names may lag."
          : "Themes carry code labels. One cheap pass can name them in your buyers' words and merge duplicates. It never changes a number."}
      </p>
      <RunInline workflow="buyer_voice" args={{ mode: "name" }} runRef={{ kind: "playbook", id: "buyers" }} label={stale ? "Rename themes" : "Name themes"} variant="secondary" icon={<Sparkles className="size-3.5" />} hint="About 10 seconds · about $0.01" />
    </div>
  );
}

/* ───────────────────────────── Themes ───────────────────────────── */

function Themes({ who, consumer }: { who: string; consumer: boolean }) {
  const { voice } = usePlaybook();
  const params = useSearchParams();
  const kindParam = params.get("kind") as Filter | null;
  const filter: Filter = kindParam && FILTERS.includes(kindParam) ? kindParam : "all";
  const openKey = params.get("theme");
  const [onceOpen, setOnceOpen] = useState(false);
  useArrival(openKey);

  const shown = voice.themes.filter((t) => filter === "all" || t.kind === filter);
  const recurring = shown.filter((t) => heardIn(t) >= 2);
  const once = shown.filter((t) => heardIn(t) < 2);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, voice.themes.filter((t) => f === "all" || t.kind === f).length])) as Record<Filter, number>;
  const toggle = (key: string) => setParams(params, { theme: openKey === key ? null : key });

  return (
    <Sub
      id="buyer-themes"
      title={consumer ? "What users say" : "What buyers say"}
      right={
        <span className="hidden items-center gap-1 text-[12px] text-fg-3 md:inline-flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> to move · <Kbd>↵</Kbd> to open
        </span>
      }
      hint={
        consumer
          ? "Grouped in code from your notes on user conversations. Notes are paraphrase, so nothing here is quoted as their words."
          : `Grouped in code from what ${who} said on calls and in replies. Counts are conversations; a win rate waits until enough deals are decided.`
      }
    >
      {voice.themes.length > 3 && (
        <Segmented
          value={filter}
          onChange={(f) => setParams(params, { kind: f === "all" ? null : f })}
          options={FILTERS.filter((f) => f === "all" || counts[f] > 0).map((f) => ({ value: f, label: f === "all" ? "All" : KIND_PLURAL[f], count: counts[f] }))}
          className="mb-3"
          layoutId="buyer-filter"
        />
      )}
      <RovingList>
        {recurring.map((t) => (
          <ThemeRow key={t.key} t={t} open={openKey === t.key} onToggle={() => toggle(t.key)} consumer={consumer} />
        ))}
      </RovingList>
      {recurring.length === 0 && <p className="text-[13px] text-fg-3">Nothing here came up in more than one conversation yet.</p>}
      {once.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={onceOpen || once.some((t) => t.key === openKey)}
            onClick={() => setOnceOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-xs text-[12.5px] text-fg-3 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <ChevronRight className={cn("size-3.5 transition-transform duration-150", (onceOpen || once.some((t) => t.key === openKey)) && "rotate-90")} />
            Heard once ({once.length})
          </button>
          {(onceOpen || once.some((t) => t.key === openKey)) && (
            <RovingList className="mt-2">
              {once.map((t) => (
                <ThemeRow key={t.key} t={t} open={openKey === t.key} onToggle={() => toggle(t.key)} consumer={consumer} />
              ))}
            </RovingList>
          )}
        </div>
      )}
    </Sub>
  );
}

function StatusChip({ t }: { t: VoiceTheme }) {
  if (t.kind === "objection") {
    if (!t.response) return <Badge tone="warning">No answer yet</Badge>;
    return t.response.approved ? <Badge tone="success">Answer approved</Badge> : <Badge tone="outline">Draft answer</Badge>;
  }
  if (t.kind === "pain" || t.kind === "outcome") return t.inPlaybook ? <Badge tone="neutral">In your playbook</Badge> : <Badge tone="agent">Not in your playbook</Badge>;
  return null;
}

function stageLine(t: VoiceTheme): string | null {
  if (!t.stages.length) return null;
  return t.stages.map((s) => `${STAGE_LABELS[s.stage]} ${s.n}`).join(" · ");
}

function ThemeRow({ t, open, onToggle, consumer }: { t: VoiceTheme; open: boolean; onToggle: () => void; consumer: boolean }) {
  const preview = t.snippets.find((s) => s.verbatim) ?? t.snippets[0];
  const n = heardIn(t);
  const stages = stageLine(t);
  return (
    <li id={themeDomId(t.key)} className={cn("scroll-mt-28 rounded-lg bg-surface ring-1 ring-border transition-shadow duration-150", open && "shadow-sm ring-border-strong")}>
      <button type="button" data-row aria-expanded={open} onClick={onToggle} className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
        <ChevronRight aria-hidden className={cn("mt-1 size-3.5 shrink-0 text-fg-4 transition-transform duration-150", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14.5px] font-medium leading-[21px] text-fg [overflow-wrap:anywhere]">{t.label}</span>
            <TrendLabel trend={t.trend} />
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-fg-3">
            <span>{KIND_LABELS[t.kind]}</span>
            <span className="font-mono tnum text-fg-2">
              {consumer ? plural(n, "conversation") : `${plural(t.calls, "call")}${t.replies ? ` + ${plural(t.replies, "reply", "replies")}` : ""} · ${plural(t.deals, "deal")}`}
            </span>
            <TrendBars trend={t.trend} />
            {!consumer && stages && <span className="hidden sm:inline">{stages}</span>}
          </span>
          {!open && preview && (
            <span className={cn("mt-1.5 line-clamp-2 text-[13.5px] leading-[20px] [overflow-wrap:anywhere]", preview.verbatim ? "font-serif italic text-fg-2" : "text-fg-3")}>
              {preview.verbatim ? `“${preview.text}”` : preview.text}
            </span>
          )}
        </span>
        <span className="hidden shrink-0 sm:block">
          <StatusChip t={t} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease: ease.out }} className="overflow-hidden">
            <ThemeDetail t={t} consumer={consumer} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

const QUOTES_SHOWN = 4;

function ThemeDetail({ t, consumer }: { t: VoiceTheme; consumer: boolean }) {
  const { voice } = usePlaybook();
  const [all, setAll] = useState(false);
  const quotes = all ? t.snippets : t.snippets.slice(0, QUOTES_SHOWN);
  const tr = t.trend;
  const total = voice.conversations.length;
  return (
    <div className="border-t border-border px-4 pb-4 pt-3 sm:pl-10">
      <div className="sm:hidden">
        <StatusChip t={t} />
      </div>
      {t.gist && (
        <p className="mt-1 flex items-start gap-2 font-serif text-[15.5px] leading-[23px] text-fg-2 sm:mt-0">
          <AiBadge className="mt-[3px]" />
          <span>{t.gist}</span>
        </p>
      )}
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <div>
          <dt>
            <FieldLabel>How often</FieldLabel>
          </dt>
          <dd className="text-[13px] leading-5 text-fg">
            <span className="font-mono tnum">{heardIn(t)}</span> of {plural(total, "conversation")}
            <span className="block text-[12px] text-fg-3">
              Last 30 days: <span className="font-mono tnum">{tr.recent}</span> of {tr.recentTotal} · before: <span className="font-mono tnum">{tr.before}</span> of {tr.beforeTotal}
            </span>
          </dd>
        </div>
        {!consumer && (
          <div>
            <dt>
              <FieldLabel>When it comes up</FieldLabel>
            </dt>
            <dd className="text-[13px] leading-5 text-fg">{stageLine(t) ?? "No deal on file"}</dd>
          </div>
        )}
        {!consumer && (
          <div>
            <dt>
              <FieldLabel>Deals where it came up</FieldLabel>
            </dt>
            <dd className="text-[13px] leading-5 text-fg">{winLine(t.win)}</dd>
          </div>
        )}
      </dl>
      {!consumer && t.open.length > 0 && (
        <div className="mt-3">
          <FieldLabel>Open deals where it came up</FieldLabel>
          <ul className="flex flex-wrap gap-1.5">
            {t.open.map((d) => (
              <li key={d.dealId}>
                <Link
                  href={`/companies?c=${encodeURIComponent(d.domain)}`}
                  className="inline-flex h-7 max-w-[16rem] items-center gap-1.5 rounded-sm bg-bg-subtle px-2 text-[12.5px] text-fg-2 ring-1 ring-border transition-colors hover:bg-surface hover:text-fg"
                >
                  <Favicon domain={d.domain} name={d.name} size={14} />
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 font-mono text-[12px] text-fg-3">
                    {STAGE_LABELS[d.stage]}
                    {d.amountUsd ? ` · ${money(d.amountUsd)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {t.phrases.length > 0 && (
        <p className="mt-3 text-[12.5px] leading-5 text-fg-3">
          Their words: {t.phrases.map((p, i) => (
            <span key={p}>
              {i > 0 && ", "}
              <span className="font-serif text-[13.5px] italic text-fg-2">“{p}”</span>
            </span>
          ))}
        </p>
      )}
      <ul className="mt-2 divide-y divide-border">
        {quotes.map((s) => (
          <QuoteRow key={s.id} s={s} />
        ))}
      </ul>
      {t.snippets.length > QUOTES_SHOWN && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 rounded-xs text-[12.5px] text-fg-3 underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
          {all ? "Show fewer" : `Show all ${t.snippets.length}`}
        </button>
      )}
      <ThemeActions t={t} consumer={consumer} />
    </div>
  );
}

function ThemeActions({ t, consumer }: { t: VoiceTheme; consumer: boolean }) {
  const { ws, voice, dispatch } = usePlaybook();
  const { openAsk } = useAsk();
  const router = useRouter();
  const [messaging, setMessaging] = useState(false);
  const changes = useMemo(() => messagingChanges(ws, t), [ws, t]);
  const canMessage = t.kind === "pain" || t.kind === "outcome";

  const post = async () => {
    const material = studioMaterial(ws, voice, t, nowISO());
    if (material.length && !(await dispatch(material.map((m) => ({ type: "studio.material.upsert" as const, material: m }))))) return;
    const quotes = material.filter((m) => m.kind === "quote").length;
    toast(material.length ? `Added ${quotes ? `${plural(quotes, "quote")} and ` : ""}the count to your Studio material. Quotes are marked don't-name.` : "Its quotes are already in your Studio material.");
    router.push("/studio?view=create");
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {canMessage && !consumer && (
          <Button size="sm" variant={messaging ? "secondary" : "primary"} aria-expanded={messaging} onClick={() => setMessaging((m) => !m)}>
            Add to messaging
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<PenLine className="size-3.5" />} onClick={() => void post()}>
          Write a post about this
        </Button>
        <Button size="sm" variant="ghost" icon={<MessageCircle className="size-3.5" />} onClick={() => openAsk({ context: { kind: "playbook", id: t.kind === "objection" ? "competitors" : "messaging" }, prefill: askAboutTheme(voice, t) })}>
          Ask about this
        </Button>
        {canMessage && <span className="text-[12px] text-fg-3">{t.inPlaybook ? `Your playbook says it under ${t.inPlaybook}.` : "Your playbook doesn't say this yet."}</span>}
      </div>
      {messaging && <MessagingPanel changes={changes} />}
      {t.kind === "objection" && !consumer && (
        <div className="mt-2">
          {t.response && (
            <p className="text-[13px] leading-5 text-fg-2">
              <span className="text-fg-3">{t.response.approved ? "Your approved answer: " : "Draft answer on file: "}</span>
              {t.response.text || "No response written yet."}
            </p>
          )}
          <BattlecardBlock subjectKey={t.key} label="Draft an answer" hasAnswer={!!t.response?.approved} />
        </div>
      )}
    </div>
  );
}

/** Each change is a tracked playbook revision: before and after, applied only on Accept, restorable from the Journal. */
function MessagingPanel({ changes }: { changes: MessagingChange[] }) {
  const { f, dispatch } = usePlaybook();
  const accept = async (c: MessagingChange) => {
    const before = f.version;
    if (!(await dispatch({ type: "foundation.revise", revision: c.revision, source: "voice", at: nowISO() }))) return;
    undoable(`Added to ${c.label.toLowerCase()}. v${before} is kept in the Journal.`, () => void dispatch({ type: "foundation.restore", version: before, at: nowISO() }));
  };
  if (!changes.length) {
    return <p className="mt-3 text-[13px] leading-5 text-fg-3">Their words here are already in your messaging, or none were quoted verbatim. Nothing to add.</p>;
  }
  return (
    <ul className="mt-3 space-y-2">
      {changes.map((c) => (
        <li key={c.id} className="flex flex-col gap-2 rounded-md bg-sunken p-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-fg-3">
              {c.label} · {c.why}
            </p>
            <p className="mt-0.5 text-[14px] leading-[21px] text-fg [overflow-wrap:anywhere]">
              <span className="sr-only">Add: </span>
              {c.revision.after}
            </p>
          </div>
          <Button size="sm" variant="primary" className="self-start sm:self-center" onClick={() => void accept(c)}>
            Accept
          </Button>
        </li>
      ))}
      <li className="flex items-center gap-1.5 text-[12px] text-fg-3">
        <MessagesSquare className="size-3.5" aria-hidden />
        Nothing changes until you accept. Drafts and call prep use your messaging from then on.
      </li>
    </ul>
  );
}

