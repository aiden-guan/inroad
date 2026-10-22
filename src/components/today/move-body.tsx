"use client";

import { ArrowUpRight, Check, ExternalLink, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode, type Ref } from "react";
import { DraftView } from "@/components/compose/composer";
import { ConnectorDialog } from "@/components/intros/connectors";
import { IntroNextPanel } from "@/components/intros/intro-next";
import { ImportFlow } from "@/components/import/import-flow";
import { ForgetPerson } from "@/components/people/forget-person";
import { ReferralLeads } from "@/components/people/referral-leads";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { SourceChip } from "@/components/ui/source";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Action } from "@/lib/domain/actions";
import type { Deal, Move, OutreachPackage, Person, Workspace } from "@/lib/domain/types";
import { nextStep } from "@/lib/intros/rules";
import { QUESTIONS_PER_CARD, RULE_PREFIX } from "@/lib/moves/rules";
import { ago, clip, clockTime, companyName, first, knowsDirectly, plural, shortDay } from "@/lib/moves/util";
import { footerPromisesDeletion, jurisdictionFor } from "@/lib/quality/gates";
import { BookBody } from "./book-body";
import { CheckReplies, type CheckRepliesHandle } from "./check-replies";
import { ConnectorListBody, ConnectorMarksBody } from "./connector-list";
import { DealResolver } from "./deal-resolver";
import { RunInline } from "./parts";
import { ReviewBody } from "./review-panel";
import { RefreshBet, useReviseAfterAnswer } from "@/components/playbook/refresh";

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
    case "first_three":
      return domain ? findDraft(ws, { domain, personId: person?.id, modes: [move.kind === "intro_ask" ? "warm_intro" : move.kind === "linkedin" ? "linkedin" : "cold"], after: move.createdAt }) : undefined;
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
    case "connector_list":
      return <ConnectorListBody {...props} />;
    case "connector_marks":
      return <ConnectorMarksBody {...props} />;
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
    case "unpaid":
    case "stalled":
    case "slipped": {
      const deal = move.ref?.kind === "deal" ? ws.deals[move.ref.id] : undefined;
      if (!deal) break;
      return (
        <div className="space-y-3">
          <Lead>
            {rule === "single_threaded"
              ? "Won deals involve more people than lost ones. Ask your contact who else feels this problem and who signs off, then add them to the deal."
              : rule === "unpaid"
                ? "An unpaid pilot past 30 days has turned into a free trial. Agree a fee, or a written conversion date and price tied to the success criteria."
                : rule === "stalled"
                  ? "A date on the calendar isn't the same as a deal that's moving. Send one line that re-confirms the next step and asks if anything changed on their side. Never just checking in."
                  : "A close date that keeps moving means the reason to buy now has gone soft. Ask what changed, who else has to say yes, and what would have to be true to sign by a date they'll agree to."}
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
    case "pilot_roi":
    case "pilot_convert":
    case "pilot_checkin":
    case "map_overdue": {
      const deal = move.ref?.kind === "deal" ? ws.deals[move.ref.id] : undefined;
      if (!deal) break;
      return <PilotBody {...props} deal={deal} rule={rule} />;
    }
    case "review_monday":
    case "review_friday":
      return <ReviewBody ws={ws} kind={rule === "review_monday" ? "monday" : "friday"} weekStart={props.weekStart} />;
    case "review_monthly":
      return <ReviewBody ws={ws} kind="monthly" weekStart={`${today.slice(0, 8)}01`} />;
    case "refresh_bet":
      return <RefreshBet ws={ws} onResult={props.onChanged} />;
    case "bad_examples":
      return <BadExamplesBody {...props} />;
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
    case "asset":
      return (
        <div className="space-y-3">
          <Lead>
            A draft offers something you don&apos;t have yet, and a cold note can only offer an approved asset. Write it once in the Playbook and approve it, and every draft can attach it. Or edit the offer out of the draft.
          </Lead>
          <Row>
            {move.href && (
              <Link href={move.href} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
                Write it in the Playbook <ArrowUpRight className="size-3.5 opacity-70" />
              </Link>
            )}
            <Button variant="ghost" onClick={onComplete}>
              Done
            </Button>
          </Row>
        </div>
      );
    case "room":
      return (
        <div className="space-y-3">
          <Lead>
            A room of peers gets busy buyers to show up when a cold note wouldn&apos;t. Pick one live question they argue about; no slides and no pitch. Start virtual, and host a dinner only with a co-host or a customer
            who hosts.
          </Lead>
          <Row>
            {move.href && (
              <Link href={move.href} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
                Plan it <ArrowUpRight className="size-3.5 opacity-70" />
              </Link>
            )}
            <Button variant="ghost" onClick={onComplete}>
              Not this week
            </Button>
          </Row>
        </div>
      );
    case "post":
      return <PostBody {...props} />;
    case "first_three":
      return <FirstThreeBody {...props} />;
    case "questions":
      return <QuestionsBody {...props} />;
    case "question":
      return <QuestionBody {...props} />;
    case "pov":
      return <PovBody {...props} />;
    case "network":
    case "connectors":
      return <NetworkBody {...props} />;
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
    // EU, UK and unknown places got the footer that promises deletion on "stop": that comes first there.
    const promised = footerPromisesDeletion(jurisdictionFor(ws, person, person.accountDomain).value);
    // A connected sequencer may have suppressed them already: say so instead of adding them twice.
    const suppressed = person.doNotContact || (!!email && ws.suppression.some((x) => x.email?.toLowerCase() === email.toLowerCase()));
    const suppress = async () => {
      const ok = await dispatch([
        ...(email ? [{ type: "suppression.add" as const, entry: { id: newId("sup"), email: email.toLowerCase(), reason: "unsubscribe" as const, at: nowISO() } }] : []),
        { type: "person.upsert", person: { ...person, doNotContact: true } },
      ]);
      if (ok) onComplete();
    };
    const onList = (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2">
        <Check className="size-3.5 text-success" aria-hidden /> On your suppression list. I won&apos;t draft to them again.
      </span>
    );
    if (promised) {
      return (
        <div className="space-y-3">
          <Quote text={reply.body ?? reply.summary} who={`${person.name} · ${ago(reply.at, new Date(now))}`} />
          <Lead>Your footer told {name} you&apos;d delete their details if they asked, so that&apos;s the answer to a stop. Don&apos;t reply.</Lead>
          <ForgetPerson person={person} reveal={false} />
          {suppressed ? (
            onList
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void suppress()}>
              Only suppress {name}
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <Quote text={reply.body ?? reply.summary} who={`${person.name} · ${ago(reply.at, new Date(now))}`} />
        <Lead>They asked not to be contacted. Suppressing them cancels every draft and keeps them out of future lists. Don&apos;t reply.</Lead>
        <Row>
          {suppressed ? (
            onList
          ) : (
            <Button variant="primary" onClick={() => void suppress()}>
              Suppress {name}
            </Button>
          )}
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

/**
 * One of the first three: the dossier first (its live log, if onboarding's run is still going), then whatever the
 * dossier recommends. The cold or LinkedIn draft starts on its own once the dossier lands; this shows it in place.
 */
function FirstThreeBody(props: BodyProps) {
  const { move, ws, onComplete } = props;
  const { dispatch } = useWorkspace();
  const person = move.ref?.kind === "person" ? ws.people[move.ref.id] : undefined;
  const domain = person?.accountDomain ?? (move.ref?.kind === "account" ? move.ref.id : "");
  const acc = ws.accounts[domain];
  if (!acc) return <Lead>This company is no longer in your workspace.</Lead>;
  if (!acc.dossier) {
    return (
      <div className="space-y-3">
        <Lead>Who to talk to at {acc.name}, why now and the angle worth writing, every fact cited. The first draft follows on its own when the research lands.</Lead>
        <RunInline workflow="dossier" args={{ domain }} runRef={{ kind: "account", id: domain }} label={`Research ${acc.name}`} onResult={props.onChanged} hint="About 2 minutes" />
      </div>
    );
  }
  const rec = acc.dossier.recommendation;
  if (move.kind === "signal") return <ThreadBody {...props} />;
  if (move.kind === "research") {
    const ruleOut = rec.move === "disqualify";
    return (
      <div className="space-y-3">
        <Lead>{rec.why}</Lead>
        <Row>
          {ruleOut ? (
            <Button
              variant="primary"
              onClick={async () => {
                if (await dispatch({ type: "account.disqualify", domain, reason: "not_icp", note: clip(rec.why, 140), at: nowISO() })) onComplete();
              }}
            >
              Rule it out
            </Button>
          ) : (
            <Button variant="primary" icon={<Check className="size-3.5" />} onClick={onComplete}>
              Keep watching
            </Button>
          )}
          <Quiet href={sheet(domain)}>Read the {acc.name} dossier</Quiet>
          {ruleOut && (
            <Button variant="ghost" onClick={onComplete}>
              Keep it
            </Button>
          )}
        </Row>
      </div>
    );
  }
  const mode = move.kind === "intro_ask" ? "warm_intro" : move.kind === "linkedin" ? "linkedin" : "cold";
  if (mode === "cold" && person && knowsDirectly(person)) return <DirectBody {...props} person={person} />;
  return (
    <DraftOrCompose
      {...props}
      compose={{ domain, personId: person?.id, mode }}
      label={mode === "warm_intro" ? "Draft the intro ask" : mode === "linkedin" ? "Draft the invite" : "Draft the first touch"}
      lead={rec.why}
    />
  );
}

/** "Answer 3 questions that change the plan": up to three open questions at once, each saved on its own. */
function QuestionsBody({ ws, onComplete }: BodyProps) {
  const open = (ws.foundation?.founderQuestions ?? []).filter((q) => !q.answer);
  const shown = open.slice(0, QUESTIONS_PER_CARD);
  if (!shown.length) return <Lead>All answered. The playbook has them.</Lead>;
  return (
    <div className="space-y-5">
      {shown.map((q) => (
        <QuestionField key={q.id} q={q} onSaved={() => open.length === 1 && onComplete()} />
      ))}
      {open.length > shown.length && <Quiet href="/playbook#journal">{plural(open.length - shown.length, "more question")} in the Playbook</Quiet>}
    </div>
  );
}

function QuestionField({ q, onSaved }: { q: NonNullable<Workspace["foundation"]>["founderQuestions"][number]; onSaved: () => void }) {
  const { dispatch } = useWorkspace();
  const revise = useReviseAfterAnswer();
  const [answer, setAnswer] = useState("");
  const save = async () => {
    if (answer.trim() && (await dispatch({ type: "foundation.answerQuestion", questionId: q.id, answer: answer.trim(), at: nowISO() }))) {
      revise(q.id);
      onSaved();
    }
  };
  return (
    <div className="space-y-2">
      <p className="font-serif text-[16px] leading-[24px] text-fg">{q.question}</p>
      <Textarea
        aria-label={q.question}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="A sentence or two is plenty"
        className="min-h-16 text-[14px] leading-[22px]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {answer.trim() ? (
        <Button size="sm" variant="primary" kbd="⌘↵" onClick={() => void save()}>
          Save answer
        </Button>
      ) : (
        <p className="text-[12px] text-fg-3">{q.whyItMatters}</p>
      )}
    </div>
  );
}

function QuestionBody({ move, ws, onComplete }: BodyProps) {
  const { dispatch } = useWorkspace();
  const revise = useReviseAfterAnswer();
  const [answer, setAnswer] = useState("");
  const q = ws.foundation?.founderQuestions.find((x) => move.ref?.kind === "playbook" && x.id === move.ref.id);
  if (!q) return <Lead>This question was answered or removed.</Lead>;
  const save = async () => {
    if (!(await dispatch({ type: "foundation.answerQuestion", questionId: q.id, answer: answer.trim(), at: nowISO() }))) return;
    revise(q.id);
    onComplete();
  };
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
            await save();
          }
        }}
      />
      {answer.trim() ? (
        <Button variant="primary" kbd="⌘↵" onClick={() => void save()}>
          Save answer
        </Button>
      ) : (
        <p className="text-[12px] text-fg-3">It updates the playbook: {q.affects.map((a) => a.replace(/_/g, " ")).join(", ")}.</p>
      )}
    </div>
  );
}

const PILOT_LEADS: Record<string, string> = {
  pilot_roi:
    "Book the ROI review before the pilot ends, with the economic buyer in the room: results against the baseline and the success criteria, then the conversion decision. A review booked after the end date usually slips.",
  pilot_convert:
    "The pilot is over. Ask for the decision now: walk through the results against the criteria you agreed, then send the order form, or agree a dated conversion with a price. An open-ended pilot turns into a free trial.",
  pilot_checkin:
    "Pilots stall quietly. A short check-in every two or three days, on their first value and any blocker, keeps it on track for the ROI review. One line, about their results.",
  map_overdue:
    "A plan step has slipped. Do yours, or agree a new date with them; a plan nobody keeps current stops being mutual. Their steps get a friendly check, not a chase.",
};

/** Pilot to paid: the ROI review, the conversion ask, the check-in cadence and overdue plan steps, each resolved in one click. */
function PilotBody({ move, ws, today, onComplete, deal, rule }: BodyProps & { deal: Deal; rule: string }) {
  const { dispatch } = useWorkspace();
  const company = companyName(ws, deal.accountDomain);
  const at = nowISO();
  const overdue = rule === "map_overdue" ? (deal.map?.milestones ?? []).filter((m) => (move.subjectIds ?? []).includes(m.id) && m.status !== "done") : [];
  const act = async (actions: Action | Action[]) => {
    if (await dispatch(actions)) onComplete();
  };
  return (
    <div className="space-y-3">
      <Lead>{PILOT_LEADS[rule]}</Lead>
      {overdue.length > 0 && deal.map && (
        <ul className="divide-y divide-border rounded-md ring-1 ring-border">
          {overdue.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 text-fg">{m.step}</span>
              <span className="font-mono text-[12px] text-danger">{shortDay(m.due)}</span>
              <span className="text-[12px] text-fg-3">{m.ownerSide === "buyer" ? company : m.ownerSide === "seller" ? "You" : "Both"}</span>
              <Button
                size="xs"
                variant="ghost"
                icon={<Check className="size-3" />}
                onClick={() => {
                  const map = deal.map!;
                  const milestones = map.milestones.map((x) => (x.id === m.id ? { ...x, status: "done" as const } : x));
                  const update: Action = { type: "deal.update", id: deal.id, patch: { map: { ...map, milestones } }, at };
                  // The card finishes once nothing overdue is left on the plan.
                  void (milestones.some((x) => x.status !== "done" && x.due < today) ? dispatch(update) : act(update));
                }}
              >
                Done
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Row>
        {rule === "pilot_roi" ? (
          <Button variant="primary" icon={<Check className="size-3.5" />} onClick={() => void act({ type: "deal.update", id: deal.id, patch: { checklist: { ...deal.checklist, "pilot.roi": true } }, at })}>
            The review is booked
          </Button>
        ) : rule === "pilot_checkin" ? (
          <Button
            variant="primary"
            icon={<Check className="size-3.5" />}
            onClick={() =>
              void act({
                type: "activity.log",
                activity: { id: newId("act"), at, kind: "note", dealId: deal.id, accountDomain: deal.accountDomain, summary: `Checked in on the ${company} pilot`, source: "founder" },
              })
            }
          >
            I checked in
          </Button>
        ) : (
          <Link href={sheet(deal.accountDomain)} className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]">
            Open {company}
          </Link>
        )}
        {rule !== "pilot_convert" && rule !== "map_overdue" && <Quiet href={sheet(deal.accountDomain)}>Open {company}</Quiet>}
        <Button variant="ghost" onClick={onComplete}>
          {rule === "map_overdue" ? "Dates updated" : "Handled"}
        </Button>
      </Row>
    </div>
  );
}

/**
 * Warm before cold: who can introduce the founder (investors and advisors, with who each can reach) and, when
 * there's no import yet, the LinkedIn connections. Both are things only the founder can bring in.
 */
function NetworkBody({ move, ws, onChanged }: BodyProps) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const withImport = ruleOf(move) === "network";
  const listed = ws.connectors.filter((c) => c.relationship !== "connection");
  const step = (n: number) => (
    <span aria-hidden className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-bg-subtle font-mono text-[11px] text-fg-3 ring-1 ring-border">
      {n}
    </span>
  );
  return (
    <div className="space-y-4">
      <Lead>
        {withImport
          ? "Warm intros get answered far more often than cold email, and people who already know you answer first. Two things only you can bring in:"
          : "Your investors and advisors are the best channel you have once they know exactly who to ask for. Name each one and who they can reach; I match them to the companies you want and ask for one intro at a time."}
      </Lead>
      <ol className="space-y-4">
        <li className="flex gap-3">
          {withImport && step(1)}
          <div className="min-w-0 flex-1 space-y-2">
            {withImport && (
              <p className="text-[13.5px] leading-5 text-fg">
                Your investors and advisors, and who each can reach <span className="text-fg-3">· 2 min</span>
              </p>
            )}
            {listed.length > 0 && <p className="text-[12.5px] text-fg-3">Added {listed.map((c) => first(c.name)).join(", ")}.</p>}
            <Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setAdding(true)}>
              {listed.length ? "Add another" : "Add an investor or advisor"}
            </Button>
          </div>
        </li>
        {withImport && (
          <li className="flex gap-3">
            {step(2)}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[13.5px] leading-5 text-fg">
                Your LinkedIn connections <span className="text-fg-3">· LinkedIn emails the export in about 10 minutes</span>
              </p>
              {importing ? (
                <ImportFlow
                  kind="linkedin"
                  onDone={() => {
                    onChanged();
                    setImporting(false);
                  }}
                />
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
                  Import Connections.csv
                </Button>
              )}
            </div>
          </li>
        )}
      </ol>
      <ConnectorDialog
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) onChanged();
        }}
      />
    </div>
  );
}

/** Last Friday's post draft, from the founder's own material: copy it (that applies the proposal) or let it go. */
function PostBody({ move, ws, onComplete }: BodyProps) {
  const { dispatch } = useWorkspace();
  const id = move.subjectIds?.[0];
  const found = Object.entries(ws.briefs)
    .map(([date, b]) => ({ date, p: b.proposals?.find((x) => x.id === id) }))
    .find((x) => x.p);
  const p = found?.p;
  if (!found || !p?.text) return <Lead>This post draft is no longer in your reviews.</Lead>;
  const { date } = found;
  const text = p.text;
  const decide = async (status: "applied" | "dismissed") => {
    if (await dispatch({ type: "brief.setProposal", date, proposalId: p.id, status, at: nowISO() })) onComplete();
  };
  return (
    <div className="space-y-3">
      <Lead>Built only from what you said and wrote this week. Optional: edit it in your words and post it yourself. Writing what you learn on calls makes the next cold note warmer.</Lead>
      <pre className="whitespace-pre-wrap rounded-sm bg-sunken p-3 font-sans text-[14px] leading-[22px] text-fg">{text}</pre>
      <Row>
        {/* A beat for "Copied" to show before the card leaves. */}
        <CopyButton text={text} label="Copy post" onCopied={() => setTimeout(() => void decide("applied"), 600)} />
        <Button variant="ghost" onClick={() => void decide("dismissed")}>
          Not this week
        </Button>
      </Row>
    </div>
  );
}

/** "Show me what bad looks like": a few AI-written sales emails the founder got, as counter-examples. */
function BadExamplesBody({ onComplete }: BodyProps) {
  const { dispatch } = useWorkspace();
  const [texts, setTexts] = useState(["", "", ""]);
  const filled = texts.filter((t) => t.trim().split(/\s+/).length >= 15);
  const save = async () => {
    if (filled.length && (await dispatch({ type: "voice.addBadExamples", texts: filled, at: nowISO() }))) onComplete();
  };
  return (
    <div className="space-y-2.5">
      <Lead>
        The quickest way to sound different is to know what everyone else sends. Paste up to three AI-written sales emails from your inbox. I warn you when a draft reads like one, and they keep my own checks honest. They stay on this
        machine.
      </Lead>
      {texts.map((t, i) => (
        <Textarea
          key={i}
          aria-label={`AI-written email ${i + 1}`}
          value={t}
          onChange={(e) => setTexts((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
          placeholder={i === 0 ? "Paste one here, greeting to sign-off" : "Another, if you have it"}
          className="min-h-16 text-[13.5px] leading-[21px]"
        />
      ))}
      <Row>
        <Button variant="primary" disabled={!filled.length} onClick={() => void save()}>
          {filled.length > 1 ? `Keep these ${filled.length}` : "Keep it"}
        </Button>
        <Button variant="ghost" onClick={onComplete}>
          Not now
        </Button>
      </Row>
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
