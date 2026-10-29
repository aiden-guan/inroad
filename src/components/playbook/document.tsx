"use client";

import { motion } from "motion/react";
import { Download, FileDown, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { focusAnchor, navigateToHash, useLocationHash } from "@/lib/client/location-hash";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PlaybookMismatch } from "@/components/shell/market-switch";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Orb } from "@/components/ui/orb";
import { cn } from "@/lib/client/cn";
import { spring } from "@/lib/motion";
import { usePlaybook } from "./context";
import { GrowSection } from "./grow";
import { HowSection } from "./how";
import { JournalSection } from "./journal";
import { CONSUMER_SECTIONS, SECTIONS, nextAction, playbookMarkdown, sectionsFor, CONTENT_KINDS, type NavSection, type SectionId } from "./model";
import { VoiceSection } from "./voice";
import { WhySection } from "./why";
import { WhoSection } from "./who";

/** Every anchor in document order (each section followed by its subsections), and which section each belongs to. */
function anchors(sections: readonly NavSection[]) {
  const ids: string[] = sections.flatMap((s) => [s.id, ...s.children.map((c) => c.id)]);
  const of = new Map<string, SectionId>(sections.flatMap((s) => [[s.id, s.id] as const, ...s.children.map((c) => [c.id, s.id] as const)]));
  return { ids, of };
}
const B2B_ANCHORS = anchors(SECTIONS);
const CONSUMER_ANCHORS = anchors(CONSUMER_SECTIONS);
const anchorsFor = (consumer: boolean) => (consumer ? CONSUMER_ANCHORS : B2B_ANCHORS);

/** The deepest anchor crossing the top third of the viewport. */
function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const current = ids.filter((id) => visible.has(id)).at(-1);
        if (current) setActive(current);
      },
      { rootMargin: "-12% 0px -62% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

export function scrollToAnchor(id: string) {
  navigateToHash(id, SECTIONS.some((section) => section.id === id));
}

/** "Needs you" counts per section: drafts to approve and questions to answer. */
function useCounts(): Record<SectionId, number> {
  const { ws, p } = usePlaybook();
  return {
    who: p.icp.segmentLockedAt || !p.icp.primarySegment ? 0 : 1,
    why: ws.claims.filter((c) => !c.approved).length,
    how: ws.objections.filter((o) => !o.approved).length,
    voice: ws.povs.length ? 0 : 1,
    journal: p.founderQuestions.filter((q) => !q.answer).length,
  };
}

function CountPill({ n }: { n: number }) {
  if (!n) return null;
  return <span className="min-w-[18px] rounded-full bg-accent px-1.5 text-center font-mono text-[10.5px] font-medium leading-[18px] text-accent-fg">{n}</span>;
}

function SubNav({ activeId, section }: { activeId: string | null; section: SectionId }) {
  const { ws } = usePlaybook();
  const counts = useCounts();
  const sections = sectionsFor(ws);
  return (
    <nav aria-label="Playbook sections" className="sticky top-8 pt-1">
      <ol className="space-y-0.5">
        {sections.map((s) => {
          const active = s.id === section;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToAnchor(s.id);
                }}
                aria-current={active ? "location" : undefined}
                className={cn("relative flex h-8 items-center gap-2 rounded-sm px-2.5 text-[13.5px] transition-colors duration-150", active ? "font-medium text-fg" : "text-fg-2 hover:text-fg")}
              >
                {active && <motion.span layoutId="playbook-nav" transition={spring.snappy} className="absolute inset-0 rounded-sm bg-surface shadow-xs ring-1 ring-border" />}
                <span className="relative flex-1">{s.label}</span>
                <span className="relative">
                  <CountPill n={counts[s.id]} />
                </span>
              </a>
              {active && (
                <ol className="mb-2 ml-3 mt-1 border-l border-border">
                  {s.children.map((c) => (
                    <li key={c.id}>
                      <a
                        href={`#${c.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          scrollToAnchor(c.id);
                        }}
                        aria-current={activeId === c.id ? "location" : undefined}
                        className={cn(
                          "-ml-px block border-l py-1 pl-3 text-[12.5px] leading-4 transition-colors duration-150",
                          activeId === c.id ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg-2",
                        )}
                      >
                        {c.label}
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MobileNav({ section }: { section: SectionId }) {
  const { ws } = usePlaybook();
  const counts = useCounts();
  const sections = sectionsFor(ws);
  return (
    <nav aria-label="Playbook sections" className="sticky top-12 z-30 -mx-6 mb-8 border-b border-border bg-bg/90 px-6 backdrop-blur md:top-0 md:-mx-10 md:px-10 @min-[1000px]/page:hidden">
      <ol className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto px-1 py-2">
        {sections.map((s) => {
          const active = s.id === section;
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToAnchor(s.id);
                }}
                aria-current={active ? "location" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[13px] transition-colors duration-150",
                  active ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-border" : "text-fg-2 hover:text-fg",
                )}
              >
                {s.label}
                <CountPill n={counts[s.id]} />
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ExportMenu() {
  const { ws, today } = usePlaybook();
  const name = (ws.company?.name ?? "playbook").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <Menu
      trigger={
        <Button size="sm" variant="ghost" icon={<FileDown className="size-3.5" />}>
          <span className="hidden sm:inline">Export</span>
        </Button>
      }
    >
      <MenuItem
        icon={<FileDown className="size-3.5" />}
        onSelect={async () => {
          await navigator.clipboard.writeText(playbookMarkdown(ws, today));
          toast("Copied as Markdown. Paste it into a doc, an onboarding page or another AI tool.");
        }}
      >
        Copy as Markdown
      </MenuItem>
      <MenuItem
        icon={<Download className="size-3.5" />}
        onSelect={() => {
          const blob = new Blob([playbookMarkdown(ws, today)], { type: "text/markdown" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${name}-playbook-${today}.md`;
          a.click();
          URL.revokeObjectURL(a.href);
        }}
      >
        Download .md
      </MenuItem>
    </Menu>
  );
}

function NextActionCard() {
  const { ws } = usePlaybook();
  const next = nextAction(ws);
  if (!next) return null;
  return (
    <motion.div
      key={next.anchor}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      className="mb-14 flex flex-col gap-3 rounded-lg bg-accent-subtle/70 p-4 ring-1 ring-inset ring-accent/15 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Orb state="needs" size={18} className="mt-1" />
        <p className="font-serif text-[16.5px] leading-[25px] text-fg">{next.text}</p>
      </div>
      <Button size="sm" variant="agent" className="self-start sm:self-center" onClick={() => scrollToAnchor(next.anchor)}>
        {next.cta}
      </Button>
    </motion.div>
  );
}

export function PlaybookDocument() {
  const { ws, openAsk } = usePlaybook();
  const consumer = ws.company?.market === "consumer";
  const { ids, of } = anchorsFor(consumer);
  const hash = useLocationHash();
  const params = useSearchParams();
  const assetTarget = hash.startsWith("asset:") ? `asset-${hash.slice(6)}` : hash;
  const hasAssetDestination = hash.startsWith("asset:") || hash.startsWith("asset-") || (!hash && (params.has("asset") || params.has("new")));
  const section = of.get(hash) ?? (hasAssetDestination ? "how" : "who");
  const activeId = useScrollSpy(ids);
  const sections = sectionsFor(ws);
  const selected = sections.find((item) => item.id === section)!;

  useEffect(() => {
    const kind = params.get("new");
    const asset = params.get("asset");
    const composerTarget = kind ? (CONTENT_KINDS.some((content) => content === kind) ? "content" : "assets") : "";
    const target = assetTarget || (asset ? `asset-${asset}` : composerTarget);
    if (!target) return;
    const frame = requestAnimationFrame(() => focusAnchor(target, SECTIONS.some((section) => section.id === target)));
    return () => cancelAnimationFrame(frame);
  }, [assetTarget, params, section]);
  const company = ws.company?.name ?? "you";
  return (
    <div className="@container/page">
      <div
        className={cn(
          "mx-auto w-full max-w-[1240px] px-6 pb-32 pt-8 md:px-10 md:pt-12",
          "@min-[1000px]/page:grid @min-[1000px]/page:grid-cols-[156px_minmax(0,720px)] @min-[1000px]/page:justify-center @min-[1000px]/page:gap-x-12",
          "@min-[1272px]/page:grid-cols-[156px_minmax(0,720px)_200px]",
        )}
      >
        <aside className="hidden @min-[1000px]/page:block">
          <SubNav activeId={activeId} section={section} />
        </aside>

        <div className="mx-auto w-full min-w-0 max-w-[720px] @min-[1000px]/page:mx-0">
          <PageHeader
            title="Playbook"
            eyebrow="A point of view, in progress"
            description={<>What I believe about how {company} wins, and how sure I am. Edit anything; your version is the one I use.</>}
            className="mb-8"
            actions={<>
              <Button size="sm" variant="ghost" icon={<MessageCircle className="size-3.5" />} onClick={() => openAsk(section)}>Ask</Button>
              <ExportMenu />
            </>}
          />

          <PlaybookMismatch className="mb-6" />
          <MobileNav section={section} />
          <div className="mb-6 @min-[1000px]/page:hidden">
            <label htmlFor="playbook-jump" className="mb-1.5 block text-[12px] font-medium text-fg-2">Jump to a topic</label>
            <select id="playbook-jump" value={selected.children.some((child) => child.id === hash) ? hash : section} onChange={(event) => scrollToAnchor(event.target.value)} className="h-10 w-full rounded-sm bg-surface px-3 text-[13px] text-fg ring-1 ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
              <option value={section}>Overview</option>
              {selected.children.map((child) => <option key={child.id} value={child.id}>{child.label}</option>)}
            </select>
          </div>
          <NextActionCard />

          <div>
            <div hidden={section !== "who"}><WhoSection /></div>
            <div hidden={section !== "why"}><WhySection /></div>
            <div hidden={section !== "how"}>{consumer ? <GrowSection /> : <HowSection />}</div>
            <div hidden={section !== "voice"}><VoiceSection /></div>
            <div hidden={section !== "journal"}><JournalSection /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
