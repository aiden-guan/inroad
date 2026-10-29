import { addDays, daysBetween } from "@/lib/domain/ids";
import type { Market, Partner, PartnerKind, PartnerOffer, PartnerPlatform, PartnerStage, Workspace } from "@/lib/domain/types";
import { CREATOR_OUTREACH } from "./benchmarks";

/**
 * Creators and communities (consumer) or partners (business) as a list the founder works, in code: dedupe keys, whose
 * move it is, and the code-written notes (user-interview invite, referral ask). Pure and isomorphic. One outreach and
 * one follow-up per partner, then let it go: partners are relationships, not a sequence.
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
  linkedin: "LinkedIn",
  reddit: "Reddit",
  discord: "Discord",
  slack: "Slack",
  facebook: "Facebook",
  substack: "Substack",
  podcast: "Podcast",
  web: "Web",
  other: "Other",
};

/** Every platform, for the agent's tools and the finder's schema. */
export const PARTNER_PLATFORMS = ["tiktok", "instagram", "youtube", "x", "linkedin", "reddit", "discord", "slack", "facebook", "substack", "podcast", "web", "other"] as const satisfies readonly PartnerPlatform[];

/**
 * What the list says in each market. Consumer companies reach users through creators and communities; businesses reach
 * buyers through the newsletters, podcasts, communities and people those buyers already follow, and through companies
 * that sell to the same buyers. The workflow, stages and checks are the same; the words, platforms and offers differ.
 */
export interface PartnerCopy {
  title: string;
  /** The list, in a sentence: "Added Maya to your creators." */
  list: string;
  eyebrow: string;
  intro: string;
  find: string;
  findHint: string;
  emptyTitle: string;
  emptyBody: string;
  kinds: Record<PartnerKind, string>;
  /** In the order the add form offers them; the first is the default. */
  platforms: PartnerPlatform[];
  handlePlaceholder: string;
  urlPlaceholder: string;
  fitPlaceholder: string;
  /** The offers this market makes, in order, with its words for them. */
  offers: Partial<Record<PartnerOffer, string>>;
  commission: string;
  codePlaceholder: string;
  termsPlaceholder: string;
  results: { signups: string; orders: string };
  disclosure: { ask: string; confirmed: string; fix: string };
}

const FIND_HINT = "Up to 5 web searches · about $0.10 · only links I can show you";

const COPY: Record<Market, PartnerCopy> = {
  consumer: {
    title: "Creators and communities",
    list: "creators",
    eyebrow: "Where your users gather",
    intro: "The people your users already listen to. Audience fit beats size. One note and one follow-up each, paid or gifted posts say #ad, and every result is counted.",
    find: "Find creators and communities",
    findHint: FIND_HINT,
    emptyTitle: "Most consumer startups found their first users where they already gathered.",
    emptyBody: "I'll look where your segments spend time: the creators they watch, the communities where they ask for help, the newsletters they read.",
    kinds: PARTNER_KIND_LABELS,
    platforms: ["tiktok", "instagram", "youtube", "x", "reddit", "discord", "facebook", "substack", "podcast", "web", "other"],
    handlePlaceholder: "@maya.runs or r/running",
    urlPlaceholder: "tiktok.com/@maya.runs",
    fitPlaceholder: "Beginner runners, weekly training vlogs, mostly US",
    offers: { gifted: "Gifted product", flat_fee: "Flat fee", affiliate: "Commission", hybrid: "Fee + commission", free_access: "Free access", collab: "Collab, no payment" },
    commission: "Commission, %",
    codePlaceholder: "MAYA10",
    termsPlaceholder: "One 45-second video, organic only, paid within 7 days of posting",
    results: { signups: "Signups", orders: "Orders" },
    disclosure: {
      ask: "Check the live post: “#ad” or “Ad” at the start of the caption, said or shown in the video. The brand is responsible for this, not only the creator.",
      confirmed: "You confirmed the post says #ad.",
      fix: "Ask them to add “#ad” at the start of the caption today, before you share or boost it.",
    },
  },
  b2b: {
    title: "Partners",
    list: "partners",
    eyebrow: "Where your buyers listen",
    intro: "The newsletters, podcasts, communities and people your buyers already follow, and companies that sell to the same buyers. Fit beats reach. One note and one follow-up each, sponsored posts say so, and every result is counted.",
    find: "Find newsletters, podcasts and communities",
    findHint: FIND_HINT,
    emptyTitle: "Your buyers already read, listen to and ask someone.",
    emptyBody: "I'll look where your personas spend time: the newsletters and podcasts in their niche, the Slack and LinkedIn communities where they ask peers, and the people they follow.",
    kinds: { ...PARTNER_KIND_LABELS, brand: "Partner company" },
    platforms: ["linkedin", "substack", "podcast", "slack", "x", "youtube", "reddit", "discord", "web", "other"],
    handlePlaceholder: "@ali.writes",
    urlPlaceholder: "financeopsweekly.com",
    fitPlaceholder: "Controllers at mid-market SaaS, a weekly issue on the month-end close",
    offers: { flat_fee: "Sponsorship fee", affiliate: "Referral fee", hybrid: "Fee + referral", free_access: "Free account", collab: "Co-marketing, no payment" },
    commission: "Referral fee, %",
    codePlaceholder: "utm_source=financeops",
    termsPlaceholder: "One sponsored issue in March, paid on publication",
    results: { signups: "Leads", orders: "Deals" },
    disclosure: {
      ask: "Check the live post or issue says it's sponsored: “Sponsored”, “#ad” or the platform's paid-partnership label, where readers see it first.",
      confirmed: "You confirmed the post says it's sponsored.",
      fix: "Ask them to mark it as sponsored today, before you share or boost it.",
    },
  },
};

export function partnerCopy(market: Market): PartnerCopy {
  return COPY[market];
}

export const OPEN_PARTNER_STAGES: PartnerStage[] = ["shortlist", "contacted", "replied", "agreed", "live"];

export function normalizeHandle(h: string): string {
  const t = h.trim();
  if (/^r\//i.test(t)) return `r/${t.slice(2)}`;
  return t.startsWith("@") ? t : `@${t.replace(/^@+/, "")}`;
}

/**
 * What a link is, when it's somewhere people follow or gather: the platform, the kind of partner and the handle the
 * URL shows. Null for an ordinary website, which may be a company instead.
 */
export function partnerFromUrl(url: string): { platform: PartnerPlatform; kind: PartnerKind; handle?: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean);
  const at = seg[0]?.startsWith("@") ? seg[0] : undefined;
  if (host.endsWith("reddit.com")) return { platform: "reddit", kind: "community", handle: seg[0] === "r" && seg[1] ? `r/${seg[1]}` : undefined };
  if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") return { platform: "youtube", kind: "creator", handle: at };
  if (host === "tiktok.com") return { platform: "tiktok", kind: "creator", handle: at };
  if (host === "instagram.com") return { platform: "instagram", kind: "creator", handle: seg[0] && !["p", "reel", "explore"].includes(seg[0]) ? `@${seg[0]}` : undefined };
  if (host === "x.com" || host === "twitter.com") return { platform: "x", kind: "creator", handle: seg[0] && seg[0] !== "i" ? `@${seg[0]}` : undefined };
  if (host.endsWith("linkedin.com")) return { platform: "linkedin", kind: seg[0] === "company" ? "brand" : seg[0] === "groups" ? "community" : "creator" };
  if (host === "substack.com" || host.endsWith(".substack.com")) return { platform: "substack", kind: "newsletter", handle: at };
  if (host === "discord.gg" || host === "discord.com") return { platform: "discord", kind: "community" };
  if (host.endsWith("slack.com")) return { platform: "slack", kind: "community" };
  if (host === "facebook.com") return { platform: "facebook", kind: seg[0] === "groups" ? "community" : "creator" };
  if (host === "podcasts.apple.com" || (host === "open.spotify.com" && seg[0] === "show")) return { platform: "podcast", kind: "podcast" };
  if (host === "medium.com") return { platform: "web", kind: "creator", handle: at };
  return null;
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
