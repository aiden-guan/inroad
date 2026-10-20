"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { proofCounts, themeNeedsProof } from "@/components/playbook/model";
import { Badge } from "@/components/ui/badge";
import { Favicon } from "@/components/ui/favicon";
import { SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import type { Foundation, FoundationSection, Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";

export const SECTIONS: { key: FoundationSection; title: string }[] = [
  { key: "positioning", title: "Positioning" },
  { key: "icp", title: "Ideal customer" },
  { key: "personas", title: "Who buys" },
  { key: "messaging", title: "Messaging" },
  { key: "questions", title: "Questions for you" },
];

const STYLE = { head_to_head: "Head-to-head", big_fish_small_pond: "Big fish, small pond", new_game: "New game" } as const;
const ALT = { competitor: "Competitor", status_quo: "Status quo", in_house: "Build in-house", hire: "Hire someone" } as const;
const DETECT = {
  job_posts: "job posts",
  form_d: "SEC Form D",
  press: "press",
  site: "their site",
  yc_directory: "YC directory",
  github: "GitHub",
  dns: "DNS",
  hn: "Hacker News",
  founder_knowledge: "only you know",
} as const;
const ROLE = { economic_buyer: "Economic buyer", champion: "Champion", technical_approver: "Technical approver", user: "User", blocker: "Blocker" } as const;
export const SIGNAL: Record<string, string> = {
  champion_job_change: "Champion changed jobs",
  first_hire: "First hire in the function",
  jd_names_pain: "Job post names the pain",
  new_leader: "New leader",
  funding: "Funding",
  stack_change: "Stack change",
  launch: "Launch",
  compliance_deadline: "Compliance deadline",
  persona_post: "Wrote about the problem",
  community_request: "Asked for help in public",
  public_pain: "Public incident",
  filing: "Filing",
  hiring: "Hiring",
  sensitive: "Sensitive",
};

function Sub({ children }: { children: ReactNode }) {
  return <h4 className="mb-1.5 text-[12px] font-medium text-fg-3">{children}</h4>;
}

function Positioning({ f, ws }: { f: Foundation; ws: Workspace }) {
  const p = f.positioning;
  return (
    <div className="space-y-5">
      {p.warning && <p className="rounded-md bg-warning-subtle px-3 py-2 text-[13px] leading-5 text-warning">{p.warning}</p>}
      <div>
        <Sub>Category</Sub>
        <p className="prose-agent">
          {p.category.name} <span className="font-sans text-[12px] text-fg-3">· {STYLE[p.category.style]}</span>
        </p>
        {p.category.why && <p className="mt-1 text-pretty text-[13px] leading-5 text-fg-2">{p.category.why}</p>}
      </div>
      <div>
        <Sub>Instead of you, they use</Sub>
        <ul className="divide-y divide-border">
          {p.alternatives.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex gap-2.5 py-2">
              <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                {a.domain ? <Favicon domain={a.domain} name={a.name} size={16} /> : <span className="size-1.5 rounded-full bg-fg-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] leading-5 text-fg">
                  <span className="font-medium">{a.name}</span> <span className="text-[12px] text-fg-3">{ALT[a.kind]}</span>
                  {a.sourceUrl && (
                    <>
                      {" "}
                      <SourceChip url={a.sourceUrl} />
                    </>
                  )}
                </p>
                {a.whyChosenToday && <p className="text-pretty text-[13px] leading-5 text-fg-2">{a.whyChosenToday}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {p.differentiators.length > 0 && (
        <div>
          <Sub>What&rsquo;s different</Sub>
          <ul className="space-y-1.5">
            {p.differentiators.map((d, i) => (
              <li key={i} className="text-pretty text-[13.5px] leading-5 text-fg">
                {d.capability} <span className="text-[12px] text-fg-3">vs {d.vsAlternative}</span>{" "}
                <Badge tone={d.status === "proven" ? "success" : "outline"} className="align-[1px]">
                  {d.status}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.valueThemes.length > 0 && (
        <div>
          <Sub>Value</Sub>
          <ul className="space-y-2">
            {p.valueThemes.map((t) => (
              <li key={t.id} className="text-pretty text-[13.5px] leading-5 text-fg">
                <span className="font-medium">{t.theme}.</span> <span className="text-fg-2">{t.outcome}</span>{" "}
                {themeNeedsProof(ws, t) ? (
                  <Badge tone="outline" className="align-[1px]">
                    needs proof
                  </Badge>
                ) : (
                  t.proof.map((pr, i) => {
                    const ev = pr.evidenceId && proofCounts(ws, pr) ? ws.evidence[pr.evidenceId] : undefined;
                    return ev ? <SourceChip key={i} url={ev.url} quote={ev.quote} claim={ev.claim} confidence={ev.confidence} publishedAt={ev.publishedAt} /> : null;
                  })
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.bestFit.length > 0 && (
        <div>
          <Sub>Who cares most</Sub>
          <ul className="list-disc space-y-1 pl-4 text-[13.5px] leading-5 text-fg-2 marker:text-fg-4">
            {p.bestFit.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Icp({ f }: { f: Foundation }) {
  const icp = f.icp;
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <h4 className="text-[12px] font-medium text-fg-3">My bet</h4>
          <Badge tone="outline">a bet</Badge>
        </div>
        <p className="prose-agent text-pretty">{icp.hypothesis.sentence}</p>
      </div>
      {icp.criteria.length > 0 && (
        <div>
          <Sub>How I&rsquo;d spot them</Sub>
          <ul className="space-y-2">
            {icp.criteria.map((c) => (
              <li key={c.id} className="text-pretty text-[13.5px] leading-5">
                <span className="text-fg">{c.text}</span>
                <span className="ml-2 whitespace-nowrap font-mono text-[11.5px] text-fg-3">{DETECT[c.detection]}</span>
                {c.mustHave && (
                  <Badge tone="neutral" className="ml-2 align-[1px]">
                    must have
                  </Badge>
                )}
                {c.status === "validated" && (
                  <Badge tone="success" className="ml-2 align-[1px]">
                    validated
                  </Badge>
                )}
                {c.howToTest && <span className="block text-[12.5px] text-fg-3">To test: {c.howToTest}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {icp.antiIcp.length > 0 && (
        <div>
          <Sub>Not a fit</Sub>
          <ul className="space-y-1">
            {icp.antiIcp.map((a, i) => (
              <li key={i} className="text-pretty text-[13.5px] leading-5 text-fg">
                {a.text} <span className="text-fg-3">· {a.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {icp.triggers.length > 0 && (
        <div>
          <Sub>What makes it urgent</Sub>
          <ul className="space-y-1">
            {icp.triggers.map((t, i) => (
              <li key={i} className="text-pretty text-[13.5px] leading-5">
                <span className="font-medium text-fg">{SIGNAL[t.type] ?? t.type}</span>
                <span className="ml-1.5 font-mono text-[11.5px] text-fg-3">{t.windowDays}d</span>
                <span className="text-fg-2"> · {t.implication}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(icp.confirmIf || icp.killIf) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {icp.confirmIf && (
            <div className="rounded-md bg-bg-subtle px-3 py-2.5">
              <Sub>Confirms it</Sub>
              <p className="text-pretty text-[13px] leading-5 text-fg-2">{icp.confirmIf}</p>
            </div>
          )}
          {icp.killIf && (
            <div className="rounded-md bg-bg-subtle px-3 py-2.5">
              <Sub>Kills it</Sub>
              <p className="text-pretty text-[13px] leading-5 text-fg-2">{icp.killIf}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Personas({ f }: { f: Foundation }) {
  return (
    <ul className="space-y-4">
      {f.personas.map((p) => (
        <li key={p.id}>
          <p className="text-[12px] font-medium text-fg-3">{ROLE[p.role]}</p>
          <p className="text-[14px] font-medium leading-5 text-fg">{p.titles.slice(0, 3).join(" · ")}</p>
          {p.line && <p className="mt-1 text-pretty font-serif text-[16px] leading-[24px] text-fg-2">{p.line}</p>}
          {p.pains.length > 0 && <p className="mt-1 text-pretty text-[12.5px] leading-[18px] text-fg-3">Pains: {p.pains.slice(0, 3).join(" · ")}</p>}
        </li>
      ))}
    </ul>
  );
}

function Messaging({ f, ws }: { f: Foundation; ws: Workspace }) {
  const m = f.messaging;
  const issues = ws.company?.messagingIssues ?? [];
  return (
    <div className="space-y-5">
      <div>
        <Sub>In one line</Sub>
        <p className="prose-agent text-pretty">{m.oneLiner}</p>
      </div>
      {m.themes.length > 0 && (
        <div>
          <Sub>Themes</Sub>
          <ul className="space-y-1">
            {m.themes.map((t, i) => (
              <li key={i} className="text-pretty text-[13.5px] leading-5 text-fg">
                {t.headline} <span className="text-fg-3">vs {t.vsAlternative}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {issues.length > 0 && (
        <div>
          <Sub>On your site today</Sub>
          <ul className="space-y-3">
            {issues.map((x, i) => (
              <li key={i} className="text-pretty text-[13.5px] leading-5">
                <p className="text-fg">{x.issue}</p>
                <p className="mt-0.5 font-serif text-[14px] italic leading-5 text-fg-3">&ldquo;{x.quote}&rdquo;</p>
                <p className="mt-0.5 text-fg-2">Try: {x.fix}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Questions({ f }: { f: Foundation }) {
  const qs = f.founderQuestions.filter((q) => !q.id.startsWith("onb_"));
  return (
    <div>
      <ol className="space-y-2.5">
        {qs.map((q, i) => (
          <li key={q.id} className="flex gap-3 text-[13.5px] leading-5">
            <span className="w-4 shrink-0 font-mono text-[12px] leading-5 text-fg-3">{i + 1}</span>
            <span className="min-w-0 text-pretty">
              <span className="text-fg">{q.question}</span>
              <span className="block text-[12.5px] text-fg-3">{q.whyItMatters}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12.5px] text-fg-3">Answer these in your Playbook whenever you like. Each one moves the bet more than anything on your site.</p>
    </div>
  );
}

function SectionBody({ k, f, ws }: { k: FoundationSection; f: Foundation; ws: Workspace }) {
  switch (k) {
    case "positioning":
      return <Positioning f={f} ws={ws} />;
    case "icp":
      return <Icp f={f} />;
    case "personas":
      return <Personas f={f} />;
    case "messaging":
      return <Messaging f={f} ws={ws} />;
    case "questions":
      return <Questions f={f} />;
  }
}

function hasContent(k: FoundationSection, f: Foundation) {
  switch (k) {
    case "positioning":
      return f.positioning.alternatives.length > 0;
    case "icp":
      return !!f.icp.hypothesis.sentence;
    case "personas":
      return f.personas.length > 0;
    case "messaging":
      return !!f.messaging.oneLiner;
    case "questions":
      return f.founderQuestions.some((q) => !q.id.startsWith("onb_"));
  }
}

/**
 * The first bet as a document. Sections land whole (no word-by-word reveal), each stamped with where it came from.
 * While the run is live, the next section shows as being written; later ones wait as quiet headers.
 */
export function BetDocument({ ws, live }: { ws: Workspace; live: boolean }) {
  const f = ws.foundation;
  if (!f) return null;
  const landed = ws.onboarding.sections ?? {};
  const done = (k: FoundationSection) => (ws.onboarding.status === "hired" || !live ? hasContent(k, f) : !!landed[k] && hasContent(k, f));
  const writing = live ? SECTIONS.find((s) => !done(s.key))?.key : undefined;

  return (
    <div className="divide-y divide-border rounded-lg bg-surface shadow-sm ring-1 ring-border">
      {SECTIONS.map(({ key, title }) => {
        const isDone = done(key);
        const isWriting = writing === key;
        if (!live && !isDone) return null;
        return (
          <section key={key} aria-labelledby={`bet-${key}`} className="px-4 py-4 sm:px-6 sm:py-5">
            <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span
                aria-hidden
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  isDone ? "bg-fg-2" : isWriting ? "bg-accent" : "ring-1 ring-inset ring-fg-4",
                )}
              />
              <h3 id={`bet-${key}`} className={cn("text-[14px] font-medium", isDone ? "text-fg" : isWriting ? "shimmer-text" : "text-fg-3")}>
                {title}
                {isWriting && <span className="font-normal"> · writing</span>}
              </h3>
              {isDone && f.provenance?.[key] && <span className="ml-auto font-mono text-[11px] text-fg-3">{f.provenance[key]!.label}</span>}
            </header>
            <AnimatePresence initial={false}>
              {isDone && (
                <motion.div key="body" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: ease.out }} className="mt-4">
                  <SectionBody k={key} f={f} ws={ws} />
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        );
      })}
    </div>
  );
}
