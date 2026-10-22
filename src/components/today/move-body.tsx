"use client";

import { ArrowUpRight, Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode, type Ref } from "react";
import { DraftView } from "@/components/compose/composer";
import { IntroNextPanel } from "@/components/intros/intro-next";
import { ImportFlow } from "@/components/import/import-flow";
import { ForgetPerson } from "@/components/people/forget-person";
import { ReferralLeads } from "@/components/people/referral-leads";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { SourceChip } from "@/components/ui/source";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Move, OutreachPackage, Person, Workspace } from "@/lib/domain/types";
import { nextStep } from "@/lib/intros/rules";
import { RULE_PREFIX } from "@/lib/moves/rules";
import { ago, clip, clockTime, companyName, first, knowsDirectly } from "@/lib/moves/util";
import { BookBody } from "./book-body";
import { CheckReplies, type CheckRepliesHandle } from "./check-replies";
import { DealResolver } from "./deal-resolver";
import { RunInline } from "./parts";
import { ReviewBody } from "./review-panel";

/** Intro follow-through: the same panel as the Intros page, finishing the card when the founder records the move. */
function IntroMoveBody({ move, ws, today, onComplete }: BodyProps) {
  const intro = move.subjectIds?.[0] ? ws.intros?.[move.subjectIds[0]] : undefined;
  if (!intro) return <Lead>This intro was removed.</Lead>;
  const next = nextStep(intro, ws, today);
  if (next.owner !== "you" || !next.action) {
    return (
      <div className="space-y-3">
        <Lead>{next.line}.</Lead>
        <Row>
          <Quiet href={`/intros?i=${encodeURIComponent(intro.id)}`}>Open in Intros</Quiet>
          <Button variant="ghost" onClick={onComplete}>
            Done
          </Button>
        </Row>
      </div>
    );
  }
  return <IntroNextPanel intro={intro} next={next} today={today} onDone={onComplete} />;
}

export interface BodyProps {
  move: Move;
  ws: Workspace;
  now: number;
  today: string;
  weekStart: string;
  focused: boolean;
  /** The card's work is finished: collapse it with the done animation and mark it done. */
  onComplete: () => void;
  /** Re-rank after something changed underneath (a draft landed, a run finished). */
  onChanged: () => void;
}

const sheet = (domain: string) => `/companies?c=${encodeURIComponent(domain)}`;

function ruleOf(move: Move): string {
  return move.rule.startsWith(RULE_PREFIX) ? move.rule.slice(RULE_PREFIX.length) : move.rule;
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{children}</div>;
}

function Quiet({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  const cls = "inline-flex items-center gap-1 text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
      <ExternalLink className="size-3" />
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
      <ArrowUpRight className="size-3" />
    </Link>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">{children}</p>;
}

/** The newest package with a draft step that a card started (or that matches its target). */
function findDraft(ws: Workspace, q: { domain?: string; personId?: string; modes: OutreachPackage["mode"][]; after: string }): OutreachPackage | undefined {
  return Object.values(ws.outreach)
    .filter(
      (p) =>
        q.modes.includes(p.mode) &&
        (!q.domain || p.accountDomain === q.domain) &&
        (!q.personId || p.personId === q.personId) &&
        p.createdAt >= q.after &&
        p.steps.some((s) => s.status === "draft"),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * The draft a card is currently showing, if any. The page's own A key stands down for these:
 * DraftView owns A / E / ] while it's focused.
 */
export function cardDraft(ws: Workspace, move: Move): OutreachPackage | undefined {
  if (move.draft) return ws.outreach[move.draft.packageId];
  const person = move.ref?.kind === "person" ? ws.people[move.ref.id] : undefined;
  const domain = person?.accountDomain ?? (move.ref?.kind === "account" ? move.ref.id : undefined);
  switch (ruleOf(move)) {
    case "reply": {
      const reply = ws.activities.find((a) => a.id === move.activityId);
      return reply && person ? findDraft(ws, { personId: person.id, modes: ["reply"], after: reply.at }) : undefined;
    }
    case "follow_up":
      return person ? findDraft(ws, { domain: person.accountDomain, personId: person.id, modes: ["follow_up", "cold"], after: move.createdAt }) : undefined;
    case "cold_draft":
    case "signal":
      return domain && move.kind !== "signal" ? findDraft(ws, { domain, personId: person?.id, modes: ["cold"], after: move.createdAt }) : undefined;
    case "warm_path":
    case "connector":
    case "intro_draft":
      return domain ? findDraft(ws, { domain, modes: ["warm_intro"], after: move.createdAt }) : undefined;
    case "linkedin":
      return domain ? findDraft(ws, { domain, personId: person?.id, modes: ["linkedin"], after: move.createdAt }) : undefined;
    default:
      return undefined;
  }
}

function draftStepOf(pkg: OutreachPackage): number | undefined {
  return pkg.steps.find((s) => s.status === "draft")?.step;
}

/** Shows the card's draft if one exists; otherwise one button that drafts it, with the live log in place. */
function DraftOrCompose({
  ws,
  move,
  focused,
  onComplete,
  onChanged,
  compose,
  label,
  lead,
}: Pick<BodyProps, "ws" | "move" | "focused" | "onComplete" | "onChanged"> & {
  compose: { domain: string; personId?: string; mode: OutreachPackage["mode"]; connectorId?: string; replyText?: string; angleId?: string };
  label: string;
  lead?: ReactNode;
}) {
  const fromMove = move.draft ? ws.outreach[move.draft.packageId] : undefined;
  const modes: OutreachPackage["mode"][] = compose.mode === "follow_up" ? ["follow_up", "cold"] : [compose.mode];
  const pkg = fromMove ?? findDraft(ws, { domain: compose.domain, personId: compose.personId, modes, after: move.createdAt });
  if (pkg) {
    return <DraftView pkg={pkg} step={fromMove ? move.draft?.step : draftStepOf(pkg)} focused={focused} onApproved={onComplete} moveId={move.id} />;
  }
  return (
    <div className="space-y-3">
      {lead && <Lead>{lead}</Lead>}
      <RunInline
        workflow="compose"
        args={compose}
        runRef={{ kind: "account", id: compose.domain }}
        label={label}
        onResult={onChanged}
        hint="One draft, sourced. You approve before anything goes out."
      />
    </div>
  );
}

export function MoveBody({ repliesHandle, ...props }: BodyProps & { repliesHandle?: Ref<CheckRepliesHandle> }) {
  const { move, ws, today, onComplete } = props;
  const rule = ruleOf(move);
  const person = move.ref?.kind === "person" ? ws.people[move.ref.id] : undefined;
  const domain = person?.accountDomain ?? (move.ref?.kind === "account" ? move.ref.id : undefined);

  switch (rule) {
    case "reply":
      return <ReplyBody {...props} />;
    case "check_replies":
      return <CheckReplies ws={ws} now={props.now} active={props.focused} onFinished={onComplete} onChanged={props.onChanged} ref={repliesHandle} />;
    case "reply_book":
      return <BookBody {...props} />;
    case "referrals": {
      const meeting = move.ref?.kind === "meeting" ? ws.meetings[move.ref.id] : undefined;
      if (!meeting) break;
      return (
        <div className="space-y-3">
          <Lead>They named people worth meeting. A note that says who sent you is the warmest first touch there is, and it doesn&apos;t need a dated signal.</Lead>
          <ReferralLeads meeting={meeting} />
          <Row>
            <Button variant="ghost" onClick={onComplete}>
              Done for now
            </Button>
          </Row>
        </div>
      );
    }
    case "meeting_prep":
      return <PrepBody {...props} />;
    case "debrief":
      return <DebriefBody {...props} />;
    case "recap":
      return <RecapBody {...props} />;
    case "follow_up":
      if (!person) break;
      return (
        <DraftOrCompose
          {...props}
          compose={{ domain: person.accountDomain, personId: person.id, mode: "follow_up" }}
          label="Draft the follow-up"
          lead="Follow-ups are written when they're due, on a new angle: never a bump. Step 3 is the last email; after that, one blank LinkedIn invite."
        />
      );
    case "cold_draft":
    case "signal":
    case "linkedin":
    case "linkedin_dm":
    case "intro_draft":
    case "warm_path":
    case "connector": {
      if (move.kind === "signal") return <ThreadBody {...props} />;
      const target = domain ?? (move.ref?.kind === "account" ? move.ref.id : "");
      if (!target) break;
      // Someone the founder knows: no intro ask and no cold template (it would count toward the cold cap).
      if ((rule === "warm_path" || rule === "signal" || rule === "cold_draft") && person && knowsDirectly(person) && !cardDraft(ws, move)) {
        return <DirectBody {...props} person={person} />;
      }
      const isIntro = rule === "warm_path" || rule === "connector" || rule === "intro_draft";
      const connectorId = rule === "connector" ? move.subjectIds?.[0] : undefined;
      return (
        <DraftOrCompose
          {...props}
          compose={{ domain: target, personId: person?.id, mode: rule === "linkedin" || rule === "linkedin_dm" ? "linkedin" : isIntro ? "warm_intro" : "cold", connectorId }}
          label={isIntro ? "Draft the intro ask" : "Draft the first touch"}
          lead={
            isIntro ? (
              <>Warm paths reply far more often than cold. I&apos;ll draft a short ask plus a forwardable note they can pass on unchanged. Intro asks don&apos;t count toward your email cap.</>
            ) : (
              <>
                I&apos;ll write one note on this signal with your point of view and a single question, cited line by line.
                {move.source && (
                  <>
                    {" "}
                    <SourceChip url={move.source.url} publishedAt={move.source.date} />
                  </>
                )}
              </>
            )
          }
        />
      );
    }
    case "intro_reply":
    case "intro_send":
    case "intro_close_loop":
    case "intro_nudge":
    case "intro_check_in":
    case "intro_book":
    case "intro_check_how":
    case "intro_thank":
    case "intro_let_go":
      return <IntroMoveBody {...props} />;
    case "switch_channel":
      return (
        <div className="space-y-3">
          <Lead>Three emails went unanswered. Send one connection request with no note, then stop. If they accept, a short DM a day later is fine.</Lead>
          <Row>
            {move.href && (
              <a href={move.href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
                Open LinkedIn profile <ExternalLink className="size-3.5 opacity-70" />
              </a>
            )}
            <Button variant="ghost" onClick={onComplete}>
              I sent the invite
            </Button>
          </Row>
        </div>
      );
    case "next_step": {
      const deal = move.ref?.kind === "deal" ? ws.deals[move.ref.id] : undefined;
      if (!deal) break;
      return <DealResolver deal={deal} today={today} company={companyName(ws, deal.accountDomain)} onResolved={onComplete} />;
    }
    case "close_out":
      return <CloseOutBody {...props} />;
    case "single_threaded":
    case "unpaid": {
      const deal = move.ref?.kind === "deal" ? ws.deals[move.ref.id] : undefined;
      if (!deal) break;
      return (
        <div className="space-y-3">
          <Lead>
            {rule === "single_threaded"
              ? "Won deals involve more people than lost ones. Ask your contact who else feels this problem and who signs off, then add them to the deal."
              : "An unpaid pilot past 30 days has turned into a free trial. Agree a fee, or a written conversion date and price tied to the success criteria."}
          </Lead>
          <Row>
            <Link href={sheet(deal.accountDomain)} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
              Open {companyName(ws, deal.accountDomain)}
            </Link>
            <Button variant="ghost" onClick={onComplete}>
              Handled
            </Button>
          </Row>
        </div>
      );
    }
    case "review_monday":
    case "review_friday":
      return <ReviewBody ws={ws} kind={rule === "review_monday" ? "monday" : "friday"} weekStart={props.weekStart} />;
    case "research": {
      const acc = domain ? ws.accounts[domain] : undefined;
      if (!acc) break;
      if (acc.dossier) {
        return (
          <Row>
            <Link href={sheet(acc.domain)} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
              Read the {acc.name} dossier
            </Link>
            <Button variant="ghost" onClick={onComplete}>
              Done
            </Button>
          </Row>
        );
      }
      return (
        <div className="space-y-3">
          <Lead>
            Who to talk to at {acc.name}, why now, the angles worth writing, and what&apos;s still unknown. Every fact cited. Free sources first; web search only if they come back thin.
          </Lead>
          <RunInline workflow="dossier" args={{ domain: acc.domain }} runRef={{ kind: "account", id: acc.domain }} label={`Research ${acc.name}`} onResult={props.onChanged} hint="About 2 minutes" />
        </div>
      );
    }
    case "discover":
      return (
        <div className="space-y-3">
          <Lead>I&apos;ll look for companies that fit your ICP and have a dated reason to talk now: a first hire for the role you replace, a raise, a launch. Warm paths first.</Lead>
          <RunInline workflow="discovery" args={{ source: "weekly" }} label="Find companies" onResult={props.onChanged} hint="A few minutes, runs in the background" />
        </div>
      );
    case "event_task":
      return <EventBody {...props} />;
    case "event_nearby": {
      const ids = move.subjectIds ?? [];
      const names = ids.map((id) => ws.people[id]?.name).filter(Boolean) as string[];
      return (
        <div className="space-y-3">
          <Lead>
            {names.slice(0, 4).join(", ")}
            {names.length > 4 ? ` and ${names.length - 4} more` : ""} {names.length === 1 ? "is" : "are"} close enough to come and {names.length === 1 ? "isn't" : "aren't"} on the guest list.
            People you already know or are selling to fill a table first, and a seat moves a deal faster than another call.
          </Lead>
          <Row>
            {move.href && (
              <Link href={move.href} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
                See them on the map <ArrowUpRight className="size-3.5 opacity-70" />
              </Link>
            )}
            <Button variant="ghost" onClick={onComplete}>
              Not this time
            </Button>
          </Row>
        </div>
      );
    }
    case "question":
      return <QuestionBody {...props} />;
    case "pov":
      return <PovBody {...props} />;
    case "import":
      return (
        <div className="space-y-3">
          <Lead>Export Connections.csv from LinkedIn (Settings → Data privacy → Get a copy of your data). I screen it in code for people at companies that fit, and names never go to the model in bulk.</Lead>
          <ImportFlow
            kind="linkedin"
            onDone={() => {
              props.onChanged();
              onComplete();
            }}
          />
          <Quiet href="/integrations?import=linkedin">Open the importer</Quiet>
        </div>
      );
  }

  // Moves from other surfaces, or a card whose subject was deleted.
  return (
    <div className="space-y-3">
      <Lead>{move.why}</Lead>
      <Row>
        {move.href && (
          <Link href={move.href} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
            Open
          </Link>
        )}
        <Button variant="ghost" onClick={onComplete}>
          Done
        </Button>
      </Row>
    </div>
  );
}

/* ───────────────────────────── bodies ───────────────────────────── */

function ReplyBody(props: BodyProps) {
  const { move, ws, now, onComplete } = props;
  const { dispatch } = useWorkspace();
  const reply = ws.activities.find((a) => a.id === move.activityId);
  const person = reply?.personId ? ws.people[reply.personId] : undefined;
  if (!reply || !person) return <Lead>This reply is no longer in your workspace.</Lead>;
  const name = first(person.name);

  if (reply.sentiment === "unsubscribe") {
    const email = person.email ?? person.contactPaths.find((c) => c.value.includes("@"))?.value;
    return (
      <div className="space-y-3">
        <Quote text={reply.body ?? reply.summary} who={`${person.name} · ${ago(reply.at, new Date(now))}`} />
        <Lead>They asked not to be contacted. Suppressing them cancels every draft and keeps them out of future lists. Don&apos;t reply.</Lead>
        <Row>
          <Button
            variant="primary"
            onClick={async () => {
              const ok = await dispatch([
                { type: "suppression.add", entry: { id: newId("sup"), email: email?.toLowerCase(), reason: "unsubscribe", at: nowISO() } },
                { type: "person.upsert", person: { ...person, doNotContact: true } },
              ]);
              if (ok) onComplete();
            }}
          >
            Suppress {name}
          </Button>
          <DeleteDetails person={person} />
        </Row>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Quote text={reply.body ?? reply.summary} who={`${person.name}${person.title ? `, ${person.title}` : ""} · ${ago(reply.at, new Date(now))}`} />
      <DraftOrCompose
        {...props}
        compose={{ domain: person.accountDomain, personId: person.id, mode: "reply", replyText: reply.body ?? reply.summary }}
        label={`Draft a reply to ${name}`}
        lead={reply.sentiment === "positive" ? "They're interested. Reply within the hour, offer two specific times, and keep it under 80 words." : undefined}
      />
    </div>
  );
}

/** "Stop" can also mean "delete what you hold on me" (the footer promises it): one quiet link, then hold to confirm. Deleting takes the card with it. */
function DeleteDetails({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline">
        Delete their details
      </button>
    );
  }
  return <ForgetPerson person={person} onCancel={() => setOpen(false)} className="w-full animate-[fade-in_150ms_var(--ease-out)]" />;
}

/** Words from a buyer: Inter (it's theirs, not ours), a hairline rule in ink, never the agent's blue. */
function Quote({ text, who }: { text: string; who: string }) {
  return (
    <figure className="border-l-2 border-border-strong pl-3">
      <blockquote className="whitespace-pre-wrap text-[14px] leading-[22px] text-fg">{text}</blockquote>
      <figcaption className="mt-1 text-[12px] text-fg-3">{who}</figcaption>
    </figure>
  );
}

function PrepBody({ move, ws, onComplete, onChanged }: BodyProps) {
  const meeting = move.ref?.kind === "meeting" ? ws.meetings[move.ref.id] : undefined;
  if (!meeting) return <Lead>This meeting is no longer on your calendar.</Lead>;
  const domain = ws.deals[meeting.dealId]?.accountDomain;
  const b = meeting.brief;
  if (!b) {
    return (
      <div className="space-y-3">
        <Lead>
          {meeting.title} at {clockTime(meeting.startsAt)}. I&apos;ll write a 10-minute brief: what&apos;s new at {companyName(ws, domain)}, who&apos;s in the room, the one thing to learn, the questions to ask and the next step to aim for.
        </Lead>
        <RunInline workflow="prep" args={{ meetingId: meeting.id }} runRef={{ kind: "meeting", id: meeting.id }} label="Prepare the brief" onResult={onChanged} hint="About 90 seconds" />
      </div>
    );
  }
  const must = b.questions.filter((q) => q.mandatory).slice(0, 3);
  return (
    <div className="space-y-4">
      <p className="prose-agent max-w-[62ch]">{b.fiveMinuteSummary}</p>
      <dl className="grid gap-3 text-[13.5px] leading-[21px] sm:grid-cols-2">
        <div>
          <dt className="text-[12px] font-medium text-fg-3">The one thing to learn</dt>
          <dd className="mt-0.5 text-fg">{b.oneThingToLearn}</dd>
        </div>
        <div>
          <dt className="text-[12px] font-medium text-fg-3">Leave with</dt>
          <dd className="mt-0.5 text-fg">{b.desiredNextStep}</dd>
        </div>
      </dl>
      {must.length > 0 && (
        <div>
          <p className="text-[12px] font-medium text-fg-3">Must ask</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-[13.5px] leading-[21px] text-fg">
            {must.map((q) => (
              <li key={q.q}>{q.q}</li>
            ))}
          </ol>
        </div>
      )}
      <Row>
        <Button variant="primary" icon={<Check className="size-3.5" />} onClick={onComplete}>
          I&apos;ve read it
        </Button>
        {domain && <Quiet href={sheet(domain)}>Full brief</Quiet>}
      </Row>
    </div>
  );
}

function DebriefBody({ move, ws, onComplete, onChanged }: BodyProps) {
  const [notes, setNotes] = useState("");
  const meeting = move.ref?.kind === "meeting" ? ws.meetings[move.ref.id] : undefined;
  if (!meeting) return <Lead>This meeting is no longer in your workspace.</Lead>;
  const domain = ws.deals[meeting.dealId]?.accountDomain;
  if (meeting.debrief) {
    return (
      <Row>
        {domain && (
          <Link href={sheet(domain)} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
            Review and apply
          </Link>
        )}
        <Button variant="ghost" onClick={onComplete}>
          Done
        </Button>
      </Row>
    );
  }
  return (
    <div className="space-y-3">
      <Lead>Paste your notes or the transcript. I&apos;ll update the qualification card, draft the same-day recap in their words, and flag a missing next step.</Lead>
      <Textarea
        aria-label="Call notes or transcript"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Paste notes or a transcript"
        className="min-h-28 text-[14px] leading-[22px]"
      />
      {notes.trim().length >= 20 ? (
        <RunInline workflow="debrief" args={{ meetingId: meeting.id, notes }} runRef={{ kind: "meeting", id: meeting.id }} label="Debrief this call" onResult={onChanged} hint="About 40 seconds" />
      ) : (
        <p className="text-[12px] text-fg-3">A few lines are enough. Transcripts get verbatim quotes; notes are kept as your paraphrase.</p>
      )}
    </div>
  );
}

function RecapBody({ move, ws, onComplete }: BodyProps) {
  const meeting = move.ref?.kind === "meeting" ? ws.meetings[move.ref.id] : undefined;
  const domain = meeting ? ws.deals[meeting.dealId]?.accountDomain : undefined;
  const recap = meeting?.debrief?.recap;
  return (
    <div className="space-y-3">
      {recap && (
        <div className="draft-rule rounded-md py-2 pl-4 pr-2">
          <p className="text-[12px] font-medium text-fg-3">Draft recap · {recap.subject}</p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[14px] leading-[22px] text-fg-2">{recap.body}</p>
        </div>
      )}
      <Row>
        {domain && (
          <Link href={sheet(domain)} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
            Apply updates and send the recap
          </Link>
        )}
        <Button variant="ghost" onClick={onComplete}>
          Already sent
        </Button>
      </Row>
    </div>
  );
}

function CloseOutBody({ move, ws, today, onComplete, onChanged }: BodyProps) {
  const ids = move.subjectIds ?? [];
  const [resolved, setResolved] = useState<string[]>([]);
  const left = ids.filter((id) => !resolved.includes(id) && ws.deals[id]);
  return (
    <div className="space-y-4">
      <Lead>Every open deal should leave the day with a dated next step the buyer agreed to, or be parked or closed. Nothing is blocked if you skip this.</Lead>
      {left.length === 0 ? (
        <Button variant="primary" icon={<Check className="size-3.5" />} onClick={onComplete}>
          All deals have a next step
        </Button>
      ) : (
        <ul className="divide-y divide-border rounded-md ring-1 ring-border">
          {left.map((id) => {
            const deal = ws.deals[id];
            const company = companyName(ws, deal.accountDomain);
            return (
              <li key={id} className="space-y-2 p-3">
                <p className="text-[13.5px] font-medium text-fg">{company}</p>
                <DealResolver
                  deal={deal}
                  today={today}
                  company={company}
                  compact
                  onResolved={() => {
                    setResolved((r) => [...r, id]);
                    onChanged();
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DirectBody({ ws, person, onComplete }: BodyProps & { person: Person }) {
  const name = first(person.name);
  const company = companyName(ws, person.accountDomain);
  return (
    <div className="space-y-3">
      <Lead>
        You know {name}, so skip the intro ask and the cold template. Send a short personal note in your own words: what you&apos;re working on and one question about {company}. Notes like this
        don&apos;t count toward your cold-email cap.
      </Lead>
      {person.notes && <p className="text-[12.5px] leading-5 text-fg-3">Your note: {clip(person.notes, 140)}</p>}
      <Row>
        {person.linkedinUrl && (
          <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
            Message {name} on LinkedIn <ExternalLink className="size-3.5 opacity-70" />
          </a>
        )}
        <Button variant="ghost" onClick={onComplete}>
          I wrote to {name}
        </Button>
        <Quiet href={sheet(person.accountDomain)}>Open {company}</Quiet>
      </Row>
    </div>
  );
}

function ThreadBody({ move, onComplete }: BodyProps) {
  return (
    <div className="space-y-3">
      <Lead>Someone asked in public for what you build. Answer in the thread, helpfully and as yourself; don&apos;t pitch and don&apos;t move it to email.</Lead>
      <Row>
        {move.href && (
          <a href={move.href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
            Open the thread <ExternalLink className="size-3.5 opacity-70" />
          </a>
        )}
        <Button variant="ghost" onClick={onComplete}>
          I answered
        </Button>
      </Row>
    </div>
  );
}

function EventBody({ move, ws, onComplete }: BodyProps) {
  const { dispatch } = useWorkspace();
  const ev = move.ref?.kind === "event" ? ws.events[move.ref.id] : undefined;
  const index = Number(move.subjectIds?.[0] ?? -1);
  if (!ev) return <Lead>This event is no longer in your workspace.</Lead>;
  return (
    <Row>
      <Button
        variant="primary"
        icon={<Check className="size-3.5" />}
        onClick={async () => {
          // Set, not toggle: the task may already have been ticked on the timeline in another tab.
          const ok = index >= 0 && ev.plan?.timeline[index] ? await dispatch({ type: "event.toggleTask", id: ev.id, index, done: true }) : true;
          if (ok) onComplete();
        }}
      >
        Mark done
      </Button>
      <Quiet href={move.href ?? `/events/${encodeURIComponent(ev.id)}?tab=timeline`}>Open the timeline</Quiet>
    </Row>
  );
}

function QuestionBody({ move, ws, onComplete }: BodyProps) {
  const { dispatch } = useWorkspace();
  const [answer, setAnswer] = useState("");
  const q = ws.foundation?.founderQuestions.find((x) => move.ref?.kind === "playbook" && x.id === move.ref.id);
  if (!q) return <Lead>This question was answered or removed.</Lead>;
  return (
    <div className="space-y-2.5">
      <p className="font-serif text-[17px] leading-[26px] text-fg">{q.question}</p>
      <Textarea
        aria-label="Your answer"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="A sentence or two is plenty"
        className="text-[14px] leading-[22px]"
        onKeyDown={async (e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && answer.trim()) {
            e.preventDefault();
            if (await dispatch({ type: "foundation.answerQuestion", questionId: q.id, answer: answer.trim(), at: nowISO() })) onComplete();
          }
        }}
      />
      {answer.trim() ? (
        <Button
          variant="primary"
          kbd="⌘↵"
          onClick={async () => {
            if (await dispatch({ type: "foundation.answerQuestion", questionId: q.id, answer: answer.trim(), at: nowISO() })) onComplete();
          }}
        >
          Save answer
        </Button>
      ) : (
        <p className="text-[12px] text-fg-3">It updates the playbook: {q.affects.map((a) => a.replace(/_/g, " ")).join(", ")}.</p>
      )}
    </div>
  );
}

function PovBody({ onComplete }: BodyProps) {
  const { dispatch } = useWorkspace();
  const [text, setText] = useState("");
  const [basis, setBasis] = useState("");
  const save = async () => {
    if (!text.trim()) return;
    const ok = await dispatch({ type: "pov.upsert", pov: { id: newId("pov"), text: text.trim(), evidence: basis.trim() || "Founder's view", createdAt: nowISO(), uses: 0 } });
    if (ok) onComplete();
  };
  return (
    <div className="space-y-2.5">
      <Lead>
        Cold notes work when they carry a view the reader hasn&apos;t heard ten times. Write one belief you hold from experience that most of your market would argue with. For example: <span className="italic text-fg">“Nobody budgets for reconciliation until the person who wrote the script leaves.”</span>
      </Lead>
      <Textarea aria-label="Your point of view" value={text} onChange={(e) => setText(e.target.value)} placeholder="One opinion, in your words" className="text-[14px] leading-[22px]" />
      <Input aria-label="Where it comes from" value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Where it comes from: “30 calls with platform leads”" />
      {text.trim() ? (
        <Button variant="primary" onClick={() => void save()}>
          Add to my POV bank
        </Button>
      ) : (
        <p className="text-[12px] text-fg-3">Only you can write this. I never invent a point of view for you.</p>
      )}
    </div>
  );
}
