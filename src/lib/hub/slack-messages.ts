import "server-only";
import { todayISO } from "@/lib/domain/ids";
import { OPEN_STAGES, type Activity, type Workspace } from "@/lib/domain/types";
import { computeScoreboard } from "@/lib/moves/scoreboard";
import { capUsage } from "@/lib/quality/gates";

/**
 * Block Kit messages built entirely in code from numbers we already have: zero tokens.
 * Limits: header ≤150 chars plain_text, section text ≤3,000, fields ≤10 × 2,000, top-level `text`
 * always set (it's the notification fallback). Links are mrkdwn `<url|label>`, never buttons,
 * because buttons expect an interactivity endpoint we don't have.
 */

/** Anything that came from outside (names, reply text) is escaped so it can't inject links or mentions. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A link only for a plain http(s) URL, so outside text can't break out of `<url|label>`. */
const safeUrl = (u?: string) => (u && /^https?:\/\/[^\s<>|]+$/.test(u) ? u : undefined);

export function dailyBriefMessage(ws: Workspace, appUrl: string, now = new Date()) {
  // The same numbers as Today's scoreboard and the send cap (this week, Mon–Sun), computed live.
  const today = todayISO(now);
  const sb = computeScoreboard(ws, now);
  const cap = capUsage(ws, today);
  const open = Object.values(ws.deals).filter((d) => OPEN_STAGES.includes(d.stage));

  const moves = Object.values(ws.moves)
    .filter((m) => m.status === "open" && m.dueOn <= today)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);
  const brief = ws.briefs[today];
  const worth = brief?.matters?.[0];

  const date = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const first = ws.founder.name.trim().split(/\s+/)[0];
  const greeting = brief?.greeting ?? (moves.length ? `${moves.length} move${moves.length === 1 ? "" : "s"} for today.` : "Nothing urgent today.");

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: clip(`GTM brief · ${date}`, 150) } },
    { type: "section", text: { type: "mrkdwn", text: clip(esc(greeting), 3000) } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Conversations (this week)*\n${sb.conversations[0]} of ${sb.conversations[1]}` },
        { type: "mrkdwn", text: `*Cold first touches (this week)*\n${cap.thisWeek} of ${ws.caps.firstTouchesPerWeek}` },
        { type: "mrkdwn", text: `*Replies (this week)*\n${sb.replies}${sb.positiveReplies ? ` · ${sb.positiveReplies} interested` : ""}` },
        { type: "mrkdwn", text: `*Open deals*\n${open.length}${sb.qualifiedDeals ? ` · ${sb.qualifiedDeals} qualified` : ""}` },
        { type: "mrkdwn", text: `*${esc(ws.goal.targetLabel.charAt(0).toUpperCase() + ws.goal.targetLabel.slice(1))}*\n${sb.goalProgress[0]} of ${sb.goalProgress[1]}` },
      ],
    },
  ];
  if (moves.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: clip(`*Your moves*\n${moves.map((m, i) => `${i + 1}. ${esc(m.title)}${m.why ? ` · _${esc(clip(m.why, 140))}_` : ""}`).join("\n")}`, 3000),
      },
    });
  }
  if (worth) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: clip(`*Worth knowing*\n${esc(worth.text)}${safeUrl(worth.url) ? ` <${safeUrl(worth.url)}|source>` : ""}`, 3000) } });
  }
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `From your Head of GTM in Inroad · <${appUrl}/today|Open Today>` }],
  });

  const text = `GTM brief ${date}${first ? ` for ${first}` : ""}: ${moves.length} move${moves.length === 1 ? "" : "s"}, ${sb.replies} repl${sb.replies === 1 ? "y" : "ies"} this week`;
  return { text, blocks };
}

const SENTIMENT_LABEL: Record<NonNullable<Activity["sentiment"]>, string> = {
  positive: "Interested reply",
  referral: "Referral",
  neutral: "Reply",
  negative: "Not interested",
  ooo: "Out of office",
  unsubscribe: "Unsubscribe",
};

export function hotReplyMessage(ws: Workspace, activity: Activity, via: string, appUrl: string) {
  const person = activity.personId ? ws.people[activity.personId] : undefined;
  const account = activity.accountDomain ? ws.accounts[activity.accountDomain] : undefined;
  const who = person?.name ?? activity.summary;
  const where = [person?.title, account?.name].filter(Boolean).join(", ");
  const label = SENTIMENT_LABEL[activity.sentiment ?? "neutral"];
  const quote = activity.body ? clip(activity.body.replace(/\s+/g, " ").trim(), 280) : "";
  const url = activity.accountDomain ? `${appUrl}/companies?c=${encodeURIComponent(activity.accountDomain)}` : `${appUrl}/today`;

  return {
    text: `${label} from ${esc(who)}${account ? ` at ${esc(account.name)}` : ""} via ${esc(via)}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: clip(`*${label}* from *${esc(who)}*${where ? `, ${esc(where)}` : ""}${quote ? `\n>${esc(quote)}` : ""}`, 3000),
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `via ${esc(via)} · The reply move is waiting on Today · <${url}|Open in Inroad>` }],
      },
    ],
  };
}
