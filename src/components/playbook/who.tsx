"use client";

import { motion } from "motion/react";
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Action } from "@/lib/domain/actions";
import { isConsumer } from "@/lib/consumer/market";
import type { DetectionMethod, ICP, ICPCriterion, Persona, PersonaRole, SegmentBet } from "@/lib/domain/types";
import { spring } from "@/lib/motion";
import { usePlaybook } from "./context";
import { RefreshSub } from "./refresh";
import { BET_TOUCHES, DETECTION_LABELS, ROLE_LABELS, SIGNAL_LABELS, betProgress, hypothesisSentence, plural, provenance } from "./model";
import { AddRow, Choice, Editable, FieldLabel, RemoveButton, ResearchCite, Section, Stamp, StringList, Sub, TagList, undoable } from "./ui";

const KIND_LABELS: Record<ICPCriterion["kind"], string> = {
  firmographic: "Firmographic",
  technographic: "Technographic",
  situational: "Situational",
  demographic: "Demographic",
  behavioral: "Behavioral",
};
const STATUS_LABELS: Record<ICPCriterion["status"], string> = { hypothesis: "Hypothesis", validated: "Validated" };
const ROLE_ORDER: PersonaRole[] = ["champion", "economic_buyer", "technical_approver", "user", "blocker"];
const CONSUMER_ROLE_ORDER: PersonaRole[] = ["user", "early_adopter", "payer", "influencer"];
const CONSUMER_KIND_LABELS: Record<"behavioral" | "situational" | "demographic", string> = { behavioral: "Behavioral", situational: "Situational", demographic: "Demographic" };
const CONSUMER_DETECTION: DetectionMethod[] = ["community", "social", "app_reviews", "search_trends", "survey", "site", "press", "founder_knowledge"];

export function WhoSection() {
  const { ws } = usePlaybook();
  const prov = provenance(ws, "who");
  return (
    <Section id="who" title="Who" kicker={<Stamp label={prov.label} isBet={prov.isBet} />}>
      <RefreshSub />
      <SegmentBetBlock />
      <Criteria />
      <NotAFit />
      <Personas />
    </Section>
  );
}

/* ───────────────────────────── Segment bet ───────────────────────────── */

function SegmentBetBlock() {
  const { ws, p, set, dispatch } = usePlaybook();
  const icp = p.icp;
  const h = icp.hypothesis;
  const consumer = isConsumer(ws);
  // Consumer bets are judged on their users' retention, not on cold touches.
  const progress = consumer ? null : betProgress(ws, icp.segmentLockedAt);

  const setSlot = (key: keyof ICP["hypothesis"], value: string) => {
    const next = { ...h, [key]: value };
    void dispatch([
      { type: "foundation.set", path: ["icp", "hypothesis", key], value },
      { type: "foundation.set", path: ["icp", "hypothesis", "sentence"], value: hypothesisSentence(next) },
    ]);
  };

  /** Ends the open bet with a verdict. "Keep" starts the next 25 touches on the same segment. */
  const closeBet = (verdict: NonNullable<SegmentBet["verdict"]>, nextSegment?: string): Action[] => {
    const at = nowISO();
    const history = [...(icp.betHistory ?? [])];
    const open = history.findLastIndex((b) => !b.endedAt);
    const stats = betProgress(ws, icp.segmentLockedAt);
    const closed: SegmentBet = {
      ...(open >= 0 ? history[open] : { segment: icp.primarySegment, startedAt: icp.segmentLockedAt ?? at }),
      endedAt: at,
      verdict,
      touches: stats?.touches ?? 0,
      positiveReplies: stats?.positiveReplies ?? 0,
      meetings: stats?.meetings ?? 0,
    };
    if (open >= 0) history[open] = closed;
    else history.push(closed);
    const actions: Action[] = [];
    if (verdict === "keep") {
      history.push({ segment: icp.primarySegment, startedAt: at });
      actions.push({ type: "foundation.lockSegment", at });
    } else {
      actions.push({ type: "foundation.set", path: ["icp", "segmentLockedAt"], value: undefined });
    }
    if (nextSegment !== undefined) actions.push({ type: "foundation.set", path: ["icp", "primarySegment"], value: nextSegment });
    actions.unshift({ type: "foundation.set", path: ["icp", "betHistory"], value: history });
    return actions;
  };

  const lock = () => {
    const at = nowISO();
    void dispatch([
      { type: "foundation.lockSegment", at },
      { type: "foundation.set", path: ["icp", "betHistory"], value: [...(icp.betHistory ?? []), { segment: icp.primarySegment, startedAt: at }] },
    ]);
    toast("Bet locked. I'll report back after 25 cold first touches.");
  };

  const setSegment = (value: string) => {
    if (icp.segmentLockedAt) {
      void dispatch(closeBet("switch", value));
      toast("Segment changed, so the old bet is closed. Lock the new one when you're ready.");
    } else set(["icp", "primarySegment"], value);
  };

  return (
    <Sub
      id="icp"
      title={consumer ? "Audience bet" : "Segment bet"}
      hint={
        consumer
          ? "One audience at a time, specific enough to find in one place. It's judged on behavior: whether its users reach the first win and come back in week 4."
          : "One segment at a time. A bet is judged after 25 cold first touches, on positive replies and meetings, not on rates."
      }
    >
      <Editable
        value={h.sentence}
        label={consumer ? "the audience bet sentence" : "the segment bet sentence"}
        multiline
        placeholder={consumer ? "Who it's for, the moment they need it, and what changes." : "Who you sell to, what they struggle with, and what changes."}
        onSave={(v) => set(["icp", "hypothesis", "sentence"], v)}
        className="font-serif text-[21px] leading-[31px] tracking-[-0.005em] text-fg [font-variation-settings:'opsz'_24]"
      />

      <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {(
          [
            ["companyGroup", consumer ? "Audience" : "Companies"],
            ["role", consumer ? "In the moment" : "Who struggles"],
            ["obstacle", "With what"],
            ["cause", "Because"],
            ["improvement", consumer ? "What changes" : "We deliver"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className={cn(key === "improvement" && "sm:col-span-1")}>
            <dt>
              <FieldLabel>{label}</FieldLabel>
            </dt>
            <dd>
              <Editable value={h[key]} label={label} multiline onSave={(v) => setSlot(key, v)} className="text-[14px] leading-[21px]" />
            </dd>
          </div>
        ))}
        <div className={cn(consumer && "hidden")}>
          <dt>
            <FieldLabel>Company size</FieldLabel>
          </dt>
          <dd className="flex items-center gap-2 text-[13px] text-fg-3">
            <Choice
              label="Company size"
              value={icp.employeeBand ?? "mixed"}
              options={{ lt50: "Under 50", "50_300": "50–300", gt300: "300+", mixed: "Not set" }}
              onChange={(v) => set(["icp", "employeeBand"], v)}
            />
            employees · sets your price anchors
          </dd>
        </div>
      </dl>

      <div className="mt-8 rounded-lg bg-surface p-4 ring-1 ring-border sm:p-5">
        <FieldLabel>Primary segment</FieldLabel>
        <Editable value={icp.primarySegment} label="primary segment" onSave={setSegment} className="text-[15px] font-medium leading-[22px]" />

        {progress ? (
          <BetProgress lockedAt={icp.segmentLockedAt!} progress={progress} onVerdict={(v) => void dispatch(closeBet(v))} />
        ) : consumer && icp.segmentLockedAt ? (
          <p className="mt-4 border-t border-border pt-4 text-[13px] leading-5 text-fg-2">
            Locked {shortDate(icp.segmentLockedAt)}. Judge it on how many of this audience&apos;s users reach the first win and come back in week 4. The numbers live under How we grow.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[46ch] text-[13px] leading-5 text-fg-2">
              Not locked yet. Until it is, every reply is an anecdote about a moving target.
            </p>
            <Button variant="primary" size="sm" onClick={lock} disabled={!icp.primarySegment}>
              {consumer ? "Lock this bet" : `Lock this bet for the next ${BET_TOUCHES} touches`}
            </Button>
          </div>
        )}

        <div className="mt-5 border-t border-border pt-4">
          <FieldLabel>Test slices</FieldLabel>
          <p className="mb-2 text-[12.5px] leading-[18px] text-fg-3">{consumer ? "Up to two, each judged on its own users' week-4 retention." : "Up to two, each compared after 25 touches of its own."}</p>
          <StringList items={icp.testSlices} max={2} label="test slice" addLabel="Add a test slice" onChange={(v) => set(["icp", "testSlices"], v)} />
        </div>
      </div>
    </Sub>
  );
}

function BetProgress({
  lockedAt,
  progress,
  onVerdict,
}: {
  lockedAt: string;
  progress: NonNullable<ReturnType<typeof betProgress>>;
  onVerdict: (v: NonNullable<SegmentBet["verdict"]>) => void;
}) {
  const ratio = Math.min(1, progress.touches / BET_TOUCHES);
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
        <span className="text-fg-2">
          Locked {shortDate(lockedAt)} ·{" "}
          <span className="font-mono tnum text-fg">
            {Math.min(progress.touches, 999)} of {BET_TOUCHES}
          </span>{" "}
          touches
        </span>
        <span className="font-mono text-[12px] tnum text-fg-3">
          {plural(progress.positiveReplies, "positive reply", "positive replies")} · {plural(progress.meetings, "meeting")}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={BET_TOUCHES} aria-valuenow={progress.touches} aria-label="Touches in this bet">
        <motion.div className="h-full origin-left rounded-full bg-fg" initial={false} animate={{ scaleX: ratio }} transition={spring.smooth} />
      </div>
      {progress.due ? (
        <div className="mt-4">
          <p className="font-serif text-[16px] leading-6 text-fg">
            {progress.positiveReplies === 0 && progress.meetings === 0
              ? "Twenty-five touches and nothing positive. That's a signal about the segment or the angle, not about volume."
              : `${plural(progress.positiveReplies, "positive reply", "positive replies")} and ${plural(progress.meetings, "meeting")} from ${progress.touches} touches. Your call.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => onVerdict("keep")}>
              Keep it for 25 more
            </Button>
            <Button size="sm" onClick={() => onVerdict("adjust")}>
              Adjust the segment
            </Button>
            <Button size="sm" onClick={() => onVerdict("switch")}>
              Switch segments
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => onVerdict("adjust")} className="mt-3 text-[12.5px] text-fg-3 underline-offset-2 transition-colors hover:text-fg hover:underline">
          End this bet early
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────── Criteria ───────────────────────────── */

function Criteria() {
  const { ws, p, set } = usePlaybook();
  const consumer = isConsumer(ws);
  // Consumer audiences use their own kinds and detection methods; the cast keeps Choice's key type (it lists only these).
  const kindOptions = (consumer ? CONSUMER_KIND_LABELS : KIND_LABELS) as Record<ICPCriterion["kind"], string>;
  const detectionOptions = (consumer ? Object.fromEntries(CONSUMER_DETECTION.map((d) => [d, DETECTION_LABELS[d]])) : DETECTION_LABELS) as Record<DetectionMethod, string>;
  const criteria = p.icp.criteria;
  const save = (next: ICPCriterion[]) => set(["icp", "criteria"], next);
  const patch = (id: string, change: Partial<ICPCriterion>) => save(criteria.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const triggers = p.icp.triggers;
  return (
    <Sub
      id="criteria"
      title="Criteria"
      hint={
        consumer
          ? "Each one should show up in public or by asking users, and say how to detect it. What people do and the moment they're in predict use better than demographics. Validated once 3 engaged users share it."
          : "Each one should be visible from the outside, for free, and say how to detect it. A criterion is validated once 3 customers or design partners share it."
      }
    >
      {criteria.length === 0 && <p className="mb-2 text-[13px] text-fg-3">No criteria yet.</p>}
      <ul className="divide-y divide-border border-y border-border">
        {criteria.map((c) => (
          <li key={c.id} className="group/row flex items-start gap-3 py-3">
            <button
              type="button"
              aria-pressed={c.mustHave}
              onClick={() => patch(c.id, { mustHave: !c.mustHave })}
              title={c.mustHave ? "Must-have. Click to make it nice-to-have." : "Nice-to-have. Click to make it a must-have."}
              className={cn(
                "mt-0.5 inline-flex h-5 w-11 shrink-0 items-center justify-center rounded-xs text-[10.5px] font-medium uppercase tracking-[0.06em] ring-1 ring-inset transition-colors duration-150",
                c.mustHave ? "bg-bg-subtle text-fg ring-border-strong" : "text-fg-3 ring-border hover:text-fg-2",
              )}
            >
              {c.mustHave ? "Must" : "Nice"}
            </button>
            <div className="min-w-0 flex-1">
              <Editable value={c.text} label="criterion" onSave={(v) => patch(c.id, { text: v })} className="text-[14px] leading-[21px]" />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
                <Choice label="Kind" value={c.kind} options={kindOptions} onChange={(v) => patch(c.id, { kind: v })} />
                <span>detect via</span>
                <Choice label="Detection" value={c.detection} options={detectionOptions} onChange={(v) => patch(c.id, { detection: v })} />
                <Choice
                  label="Status"
                  value={c.status}
                  options={STATUS_LABELS}
                  onChange={(v) => patch(c.id, { status: v })}
                  className={cn(c.status === "validated" && "text-fg")}
                />
              </div>
            </div>
            <RemoveButton
              label="Remove criterion"
              onClick={() => {
                save(criteria.filter((x) => x.id !== c.id));
                undoable("Criterion removed", () => save(criteria));
              }}
            />
          </li>
        ))}
      </ul>
      <AddRow
        label="Add a criterion"
        className="mt-2"
        onAdd={(text) => save([...criteria, { id: newId("crit"), text, kind: "situational", mustHave: false, detection: "founder_knowledge", status: "hypothesis" }])}
      />

      {triggers.length > 0 && (
        <div className="mt-8">
          <FieldLabel className="mb-2">Why-now signals I watch for</FieldLabel>
          <ul className="space-y-3">
            {triggers.map((t, i) => (
              <li key={`${t.type}-${i}`} className="group/row flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
                <div className="shrink-0 pt-px text-[13px] font-medium text-fg-2 sm:w-44">
                  {SIGNAL_LABELS[t.type] ?? t.type}
                  <span className="block font-mono text-[11px] font-normal text-fg-3">within {t.windowDays} days</span>
                </div>
                <div className="min-w-0 flex-1">
                  <Editable
                    value={t.implication}
                    label="what this signal means"
                    multiline
                    onSave={(v) => set(["icp", "triggers", i, "implication"], v)}
                    className="text-[14px] leading-[21px] text-fg-2"
                  />
                </div>
                <RemoveButton
                  label="Stop watching this signal"
                  onClick={() => {
                    set(["icp", "triggers"], triggers.filter((_, j) => j !== i));
                    undoable("Signal removed", () => set(["icp", "triggers"], triggers));
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sub>
  );
}

/* ───────────────────────────── Anti-ICP ───────────────────────────── */

function NotAFit() {
  const { ws, p, set } = usePlaybook();
  const items = p.icp.antiIcp;
  const save = (next: typeof items) => set(["icp", "antiIcp"], next);
  const consumer = isConsumer(ws);
  return (
    <Sub
      id="anti-icp"
      title={consumer ? "Not for" : "Not a fit"}
      hint={
        consumer
          ? "Saying who it isn't for keeps the first users dense. People who need it rarely, or are happy with a free habit, rarely come back."
          : "Disqualifying early is a good outcome. If nobody owns the problem or spends money or time on it today, it's not a deal."
      }
    >
      <ul className="space-y-3">
        {items.map((a, i) => (
          <li key={`${i}-${a.text.slice(0, 10)}`} className="group/row flex items-start gap-3">
            <span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-fg-3" />
            <div className="min-w-0 flex-1">
              <Editable value={a.text} label="disqualifier" onSave={(v) => save(items.map((x, j) => (j === i ? { ...x, text: v } : x)))} className="text-[14px] font-medium leading-[21px]" />
              <Editable
                value={a.reason}
                label="why it disqualifies"
                placeholder="Why it disqualifies"
                onSave={(v) => save(items.map((x, j) => (j === i ? { ...x, reason: v } : x)))}
                className="text-[13px] leading-5 text-fg-3"
              />
            </div>
            <RemoveButton
              label="Remove disqualifier"
              onClick={() => {
                save(items.filter((_, j) => j !== i));
                undoable("Removed", () => save(items));
              }}
            />
          </li>
        ))}
      </ul>
      <AddRow label="Add a disqualifier" className="mt-2" onAdd={(text) => save([...items, { text, reason: "" }])} />
    </Sub>
  );
}

/* ───────────────────────────── Personas ───────────────────────────── */

function Personas() {
  const { ws, p, set } = usePlaybook();
  const consumer = isConsumer(ws);
  const order = consumer ? CONSUMER_ROLE_ORDER : ROLE_ORDER;
  const personas = [...p.personas].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  const missing = order.filter((r) => r !== "blocker" && !p.personas.some((x) => x.role === r));
  const add = (role: PersonaRole) =>
    set(["personas"], [...p.personas, { id: newId("per"), role, titles: [], kpis: [], pains: [], triggers: [], objections: [], wateringHoles: [], line: "" } satisfies Persona]);
  return (
    <Sub
      id="personas"
      title={consumer ? "Segments" : "Personas"}
      hint={
        consumer ? (
          "Lead with the people who use it. The places each segment gathers seed your list of creators and communities."
        ) : (
          <>
            Lead with the champion and multi-thread up once you&apos;re talking. C-level executives reply to cold email about 30% less often.
            <ResearchCite url="https://www.gong.io/blog/do-execs-really-reply-to-cold-email-here-s-what-the-data-says" quote="C-level executives are 30.2% less likely to reply to cold email." />
          </>
        )
      }
      right={
        missing.length > 0 && (
          <Menu
            trigger={
              <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />}>
                {consumer ? "Add segment" : "Add persona"}
              </Button>
            }
          >
            {missing.map((r) => (
              <MenuItem key={r} onSelect={() => add(r)}>
                {ROLE_LABELS[r]}
              </MenuItem>
            ))}
          </Menu>
        )
      }
    >
      {personas.length === 0 && <p className="text-[13px] text-fg-3">{consumer ? "No segments yet." : "No personas yet."}</p>}
      <div className="space-y-4">
        {personas.map((persona) => (
          <PersonaCard key={persona.id} persona={persona} index={p.personas.findIndex((x) => x.id === persona.id)} />
        ))}
      </div>
    </Sub>
  );
}

function PersonaCard({ persona, index }: { persona: Persona; index: number }) {
  const { ws, p, set } = usePlaybook();
  const [open, setOpen] = useState(false);
  const prov = provenance(ws, { role: persona.role });
  const consumer = isConsumer(ws);
  const path = ["personas", index] as const;
  const field = (key: keyof Persona, value: unknown) => set([...path, key], value);
  const remove = () => {
    const before = p.personas;
    set(["personas"], before.filter((x) => x.id !== persona.id));
    undoable(`${ROLE_LABELS[persona.role]} removed`, () => set(["personas"], before));
  };
  return (
    <article className="group/card rounded-lg bg-surface p-4 ring-1 ring-border sm:p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-fg-3">{ROLE_LABELS[persona.role]}</p>
          <div className="mt-1.5">
            <TagList items={persona.titles} label={consumer ? "how they describe themselves" : "title"} placeholder={consumer ? "How they describe themselves" : "Add a title"} onChange={(v) => field("titles", v)} />
          </div>
        </div>
        <RemoveButton label={`Remove ${ROLE_LABELS[persona.role]}`} onClick={remove} className="group-hover/card:opacity-100" />
      </header>
      <div className="mt-3">
        <Editable
          value={persona.line}
          label="how to talk to them"
          multiline
          maxWords={25}
          placeholder="How to talk to them, in one line"
          onSave={(v) => field("line", v)}
          className="font-serif text-[17px] leading-[26px] text-fg"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Stamp label={prov.label} isBet={prov.isBet} className="text-[13px]" />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-7 items-center gap-1 rounded-xs px-1.5 text-[12.5px] text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg"
        >
          {open ? "Less" : consumer ? "Pains, jobs, objections" : "Pains, KPIs, objections"}
          <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </div>
      <motion.div initial={false} animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }} transition={spring.smooth} className="overflow-hidden" aria-hidden={!open}>
        {open && (
          <div className="mt-4 grid gap-x-8 gap-y-5 border-t border-border pt-4 sm:grid-cols-2">
            <div>
              <FieldLabel className="mb-1.5">{consumer ? "Jobs they want done" : "Measured on"}</FieldLabel>
              <TagList items={persona.kpis} label={consumer ? "job" : "KPI"} onChange={(v) => field("kpis", v)} />
            </div>
            <div>
              <FieldLabel>Pains</FieldLabel>
              <StringList items={persona.pains} label="pain" addLabel="Add a pain" onChange={(v) => field("pains", v)} />
            </div>
            <div>
              <FieldLabel>What makes them look now</FieldLabel>
              <StringList items={persona.triggers} label="trigger" addLabel="Add a trigger" onChange={(v) => field("triggers", v)} />
            </div>
            <div>
              <FieldLabel>What they push back with</FieldLabel>
              <StringList items={persona.objections} label="objection" addLabel="Add an objection" onChange={(v) => field("objections", v)} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>Where they spend time</FieldLabel>
              {persona.wateringHoles.length ? (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {persona.wateringHoles.map((w) => (
                    <li key={w.name} className="inline-flex h-6 items-center gap-1.5 rounded-xs bg-bg-subtle px-2 text-[12.5px] text-fg-2 ring-1 ring-border">
                      {w.url ? (
                        <a href={w.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
                          {w.name}
                        </a>
                      ) : (
                        w.name
                      )}
                      <span className="text-fg-3">{w.kind}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-fg-3">None yet.</p>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </article>
  );
}
