import { addDays, daysBetween } from "@/lib/domain/ids";
import type { Partner, PartnerKind, PartnerPlatform, PartnerStage, Workspace } from "@/lib/domain/types";
import { CREATOR_OUTREACH } from "./benchmarks";

/**
 * Creators and communities as a list the founder works, in code: dedupe keys, whose move it is, and the code-written
 * notes (user-interview invite, referral ask). Pure and isomorphic. One outreach and one follow-up per partner, then
 * let it go: partners are relationships, not a sequence.
 */

export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  creator: "Creator",
  community: "Community",
  newsletter: "Newsletter",
  podcast: "Podcast",
  press: "Press",
  brand: "Partner brand",
};

export const PARTNER_STAGE_LABELS: Record<PartnerStage, string> = {
  shortlist: "Shortlist",
  contacted: "Contacted",
  replied: "Replied",
  agreed: "Agreed",
  live: "Live",
  done: "Done",
  passed: "Passed",
};

export const PLATFORM_LABELS: Record<PartnerPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  reddit: "Reddit",
  discord: "Discord",
  facebook: "Facebook",
  substack: "Substack",
  podcast: "Podcast",
  web: "Web",
  other: "Other",
};

export const OPEN_PARTNER_STAGES: PartnerStage[] = ["shortlist", "contacted", "replied", "agreed", "live"];

export function normalizeHandle(h: string): string {
  const t = h.trim();
  if (/^r\//i.test(t)) return `r/${t.slice(2)}`;
  return t.startsWith("@") ? t : `@${t.replace(/^@+/, "")}`;
}

/** Same creator or community, however it was written: platform + handle, else the URL, else the name. */
export function partnerKey(p: Pick<Partner, "name" | "handle" | "url" | "platform">): string {
  if (p.handle) return `${p.platform ?? "any"}:${normalizeHandle(p.handle).toLowerCase()}`;
  if (p.url) {
    return `url:${p.url
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/$/, "")}`;
  }
  return `name:${p.name.trim().toLowerCase()}`;
}

export type PartnerAction = "draft" | "send" | "follow_up" | "reply" | "brief" | "go_live" | "check_disclosure" | "log_results" | "let_go";

export interface PartnerNext {
  action: PartnerAction | null;
  /** The founder's move, in a few words, or what we're waiting on. */
  line: string;
  /** When the move is due (the follow-up waits a week). */
  dueOn?: string;
}

/** Whose move it is for one partner, and when. */
export function partnerNext(p: Partner, today: string): PartnerNext {
  const o = p.outreach;
  switch (p.stage) {
    case "shortlist":
      if (!o) return { action: "draft", line: "Draft the first note" };
      return { action: "send", line: o.channel === "email" ? "Send the email" : `Send the DM${p.platform ? ` on ${PLATFORM_LABELS[p.platform]}` : ""}` };
    case "contacted": {
      if (!o?.sentOn) return { action: "send", line: "Send the note" };
      if (!o.followedUpOn) {
        const due = addDays(o.sentOn, CREATOR_OUTREACH.followUpAfterDays);
        return due <= today ? { action: "follow_up", line: "Send the one follow-up", dueOn: due } : { action: null, line: `Waiting on them · follow-up ${due}`, dueOn: due };
      }
      const letGo = addDays(o.followedUpOn, CREATOR_OUTREACH.letGoAfterDays);
      return letGo <= today ? { action: "let_go", line: "Quiet after the follow-up: let it go", dueOn: letGo } : { action: null, line: "Waiting on them after the follow-up", dueOn: letGo };
    }
    case "replied":
      return { action: "reply", line: "Agree terms: deliverables, fee, usage and dates" };
    case "agreed":
      if (p.kind === "creator" && !p.briefAssetId) return { action: "brief", line: "Send the brief before anything is made" };
      return { action: "go_live", line: "Mark it live when it's posted" };
    case "live": {
      const paidOrGifted = !!p.offer && p.offer.type !== "collab";
      if (p.kind === "creator" && paidOrGifted && p.disclosure !== "confirmed") return { action: "check_disclosure", line: "Check the post says #ad" };
      const liveAt = [...p.stageHistory].reverse().find((h) => h.stage === "live")?.at;
      const since = liveAt ? daysBetween(liveAt.slice(0, 10), today) : 0;
      if (!p.results?.length && since >= 7) return { action: "log_results", line: "Log what it brought: clicks, signups, orders" };
      return { action: null, line: p.results?.length ? "Results logged" : "Live · log results after a week" };
    }
    default:
      return { action: null, line: PARTNER_STAGE_LABELS[p.stage] };
  }
}

export interface PartnerResults {
  costUsd: number;
  signups: number;
  orders: number;
  /** Cost per signup (or per order for DTC), when both are known. */
  costPer?: number;
}

export function partnerResults(p: Partner): PartnerResults {
  const r = p.results ?? [];
  const costUsd = r.reduce((n, x) => n + (x.costUsd ?? 0), 0) || (p.offer?.amountUsd ?? 0);
  const signups = r.reduce((n, x) => n + (x.signups ?? 0), 0);
  const orders = r.reduce((n, x) => n + (x.orders ?? 0), 0);
  const per = orders || signups;
  return { costUsd, signups, orders, costPer: costUsd && per ? costUsd / per : undefined };
}

export function openPartners(ws: Pick<Workspace, "partners">): Partner[] {
  return Object.values(ws.partners ?? {}).filter((p) => OPEN_PARTNER_STAGES.includes(p.stage));
}

/* ───────────────────────────── Code-written notes (zero tokens) ───────────────────────────── */

/**
 * The user-interview invite: short, specific about time, honest about why. Asks about what they did, not what they'd do.
 * Gift cards are optional and never conditioned on what they say.
 */
export function interviewInvite(opts: { founderName: string; product: string; minutes?: number; thanks?: string }): { subject: string; body: string } {
  const first = opts.founderName.split(/\s+/)[0] || "the founder";
  const minutes = opts.minutes ?? 15;
  return {
    subject: `${minutes} minutes about ${opts.product}?`,
    body: [
      "Hi {first name},",
      "",
      `I'm ${first}, I'm building ${opts.product}. You signed up recently, and I'd like to hear how it went: what you were trying to do, and where it got in the way.`,
      "",
      `Would you have ${minutes} minutes for a call this week? No pitch, and nothing to prepare.${opts.thanks ? ` As a thank-you, ${opts.thanks}.` : ""}`,
      "",
      `Thanks,\n${first}`,
    ].join("\n"),
  };
}

/** The questions that work: past behavior, not opinions about the future. */
export const INTERVIEW_QUESTIONS = [
  "Walk me through the last time you needed this. What were you doing right before?",
  "What did you try first? What did you use before you found us?",
  "What happened the first time you opened it? Where did you get stuck?",
  "What would you do if it disappeared tomorrow?",
  "Who else do you know who deals with this?",
];

/** The invite ask after a first win. The reward is optional, double-sided and tied to the friend activating. */
export function referralAsk(opts: { founderName: string; product: string; reward?: string }): string {
  const first = opts.founderName.split(/\s+/)[0] || "the founder";
  return [
    "Hi {first name},",
    "",
    `You've been using ${opts.product} for a few weeks now, which makes you one of the people it's built for. Who's one friend who deals with the same thing?`,
    "",
    opts.reward ? `If they join and get going, you both get ${opts.reward}.` : "Here's a link you can send them: {invite link}",
    "",
    `Thanks,\n${first}`,
  ].join("\n");
}
