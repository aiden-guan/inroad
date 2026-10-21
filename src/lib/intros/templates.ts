import type { Intro, IntroSide, Workspace } from "@/lib/domain/types";
import { first } from "@/lib/moves/util";
import { introMeeting, targetFirstName, targetLabel, type IntroAction } from "./rules";

/**
 * The note behind each intro move, written in code (zero tokens) and always editable. Short,
 * plain, easy to say no to: a connector who's never cornered keeps introducing. No em dashes,
 * no exclamation marks, one ask per note.
 */

export interface IntroMessage {
  to?: string;
  subject?: string;
  body: string;
  /** Where to send it from, in a few words ("Reply all in the intro thread"). */
  where: string;
  /** For let_go: the note is optional. */
  optional?: boolean;
}

function sign(ws: Workspace): string {
  return first(ws.sender?.name || ws.founder.name) || "";
}

function timesLine(ws: Workspace): string {
  if (ws.founder.schedulingUrl) return `If it's easier, grab any time here: ${ws.founder.schedulingUrl}`;
  if (ws.founder.availability) return `Would ${ws.founder.availability} work for 20 minutes? Happy to fit around you.`;
  return "What does your week look like for 20 minutes?";
}

const body = (...lines: (string | null | false | undefined)[]) =>
  lines
    .filter((l): l is string => typeof l === "string")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function targetPhrase(ws: Workspace, intro: Intro): string {
  const acc = intro.accountDomain ? ws.accounts[intro.accountDomain] : undefined;
  const person = intro.personId ? ws.people[intro.personId] : undefined;
  if (person) return `${first(person.name)}${acc ? ` at ${acc.name}` : ""}`;
  const label = targetLabel(intro);
  return acc && !label.toLowerCase().includes(acc.name.split(" ")[0].toLowerCase()) ? `${label} at ${acc.name}` : label;
}

function connectorEmail(ws: Workspace, intro: Intro): string | undefined {
  return ws.connectors.find((c) => c.id === intro.connectorId)?.email;
}

/** What happened after the meeting, in one honest line built from the deal. */
function outcomeLine(ws: Workspace, intro: Intro, today: string): string {
  const name = targetFirstName(intro) ?? "They";
  const deal = intro.accountDomain ? ws.deals[ws.accounts[intro.accountDomain]?.dealId ?? ""] : undefined;
  const met = introMeeting(ws, intro, today);
  const metOn = met ? ` on ${new Date(`${met.on}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })}` : "";
  if (intro.outcome === "not_a_fit") return `${name} and I spoke${metOn}. It isn't a fit right now, but I learned a lot from how their team works.`;
  if (intro.outcome === "pilot" || (deal && (deal.stage === "pilot" || deal.stage === "proposal" || deal.stage === "won"))) {
    return `${name} and I met${metOn}, and ${ws.accounts[intro.accountDomain ?? ""]?.name ?? "they"} ${deal?.stage === "won" ? "signed on" : "is moving ahead with a pilot"}.`;
  }
  if (deal?.nextStep?.what) return `${name} and I met${metOn}. Next step: ${deal.nextStep.what.replace(/\.$/, "")}.`;
  return `${name} and I met${metOn}. It was a genuinely useful conversation.`;
}

export function messageFor(action: IntroAction, intro: Intro, ws: Workspace, today: string, side?: 0 | 1): IntroMessage {
  const me = sign(ws);
  const c = first(intro.connectorName) || "there";
  const target = targetPhrase(ws, intro);
  const targetFirst = targetFirstName(intro);
  const askSubject = `Re: Intro to ${intro.targetName.split(",")[0]}?`;

  if (intro.kind === "give") return giveMessage(action, intro, ws, me, side);

  switch (action) {
    case "nudge":
      return {
        to: connectorEmail(ws, intro),
        subject: askSubject,
        where: `Reply on your ask to ${c}`,
        body: body(`Hi ${c},`, "", `Circling back on my note about ${target}. If it isn't a fit or the timing is off, no problem at all. Just say so and I'll take it off your plate.`, "", "Thanks,", me),
      };
    case "check_in":
      return {
        to: connectorEmail(ws, intro),
        subject: askSubject,
        where: `Reply on your ask to ${c}`,
        body: body(`Hi ${c},`, "", `${targetFirst ? `Any word from ${targetFirst}?` : "Any word back?"} No pressure either way, and thanks again for checking with them.`, "", me),
      };
    case "let_go":
      return {
        to: connectorEmail(ws, intro),
        subject: askSubject,
        where: `Optional: reply on your ask to ${c}`,
        optional: true,
        body: body(`Hi ${c},`, "", `I'll take this one off your list. Thanks for thinking of me, and I hope things are good on your side.`, "", me),
      };
    case "reply": {
      const person = intro.personId ? ws.people[intro.personId] : undefined;
      return {
        to: person?.email,
        where: `Reply all in ${c}'s intro thread`,
        body: body(`Thanks, ${c} (moving you to BCC).`, "", `${targetFirst ?? "Great to meet you"}${targetFirst ? ", great to meet you" : ""}. I'd value 20 minutes to compare notes.`, timesLine(ws), "", "Best,", me),
      };
    }
    case "book": {
      const person = intro.personId ? ws.people[intro.personId] : undefined;
      return {
        to: person?.email,
        where: "Reply in the same thread",
        body: body(`Hi ${targetFirst ?? "there"},`, "", `Floating this back up. ${timesLine(ws)} And if now isn't the right time, just say so.`, "", "Best,", me),
      };
    }
    case "close_loop":
      return {
        to: connectorEmail(ws, intro),
        subject: `Thank you for the intro${targetFirst ? ` to ${targetFirst}` : ""}`,
        where: `Email ${c}`,
        body: body(`Hi ${c},`, "", `Quick update: ${outcomeLine(ws, intro, today)}`, "", "Thank you for making the intro. If I can return the favor, I'd be glad to.", "", me),
      };
    case "thank":
      return {
        to: connectorEmail(ws, intro),
        subject: askSubject,
        where: `Reply on your ask to ${c}`,
        body: body(`Hi ${c},`, "", "Thanks for checking, I appreciate it. Completely understand.", "", me),
      };
    default:
      return { where: "", body: "" };
  }
}

function sideLine(s: IntroSide): string {
  return `${s.name}${s.title ? `, ${s.title}` : ""}`;
}

function giveMessage(action: IntroAction, intro: Intro, ws: Workspace, me: string, side?: 0 | 1): IntroMessage {
  const [a, b] = intro.sides!;
  switch (action) {
    case "nudge": {
      const i = side ?? (a.consent === "pending" ? 0 : 1);
      const s = intro.sides![i];
      const o = intro.sides![i === 0 ? 1 : 0];
      const asked = !!s.askedOn;
      return {
        to: s.email,
        subject: asked ? `Re: Intro to ${first(o.name)}?` : `Intro to ${first(o.name)}?`,
        where: `Email ${first(s.name)}`,
        body: asked
          ? body(`Hi ${first(s.name)},`, "", `Floating this up: happy to introduce you to ${first(o.name)} if it's useful. No worries at all if not.`, "", me)
          : body(`Hi ${first(s.name)},`, "", `Would you like an intro to ${sideLine(o)}? ${s.why.replace(/\.?$/, ".")}`, "", "Happy to connect you if it's useful, and no worries if not.", "", me),
      };
    }
    case "send_intro":
      return {
        to: [a.email, b.email].filter(Boolean).join(", ") || undefined,
        subject: `${first(a.name)} <> ${first(b.name)}`,
        where: "Email them both",
        body: body(
          `${first(a.name)}, ${first(b.name)}: as promised, introducing you two.`,
          "",
          `${first(a.name)}, meet ${sideLine(b)}. ${a.why.replace(/\.?$/, ".")}`,
          "",
          `${first(b.name)}, meet ${sideLine(a)}. ${b.why.replace(/\.?$/, ".")}`,
          "",
          "I'll let you two take it from here.",
          "",
          me,
        ),
      };
    case "check_how":
      return {
        to: [a.email, b.email].filter(Boolean).join(", ") || undefined,
        subject: `Re: ${first(a.name)} <> ${first(b.name)}`,
        where: "Reply in the intro thread",
        body: body(`Hi ${first(a.name)} and ${first(b.name)},`, "", "Did you two get a chance to talk? Curious how it went.", "", me),
      };
    case "let_go": {
      const s = intro.sides![side ?? (a.consent === "pending" ? 0 : 1)];
      return { to: s.email, where: `Optional: email ${first(s.name)}`, optional: true, body: body(`Hi ${first(s.name)},`, "", "No worries on the intro, I'll leave it there.", "", me) };
    }
    default:
      return { where: "", body: "" };
  }
}
