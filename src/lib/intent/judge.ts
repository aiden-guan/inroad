import { z } from "zod";
import { bestSentence, clipQuote, verbatim, type Candidate } from "./parse";
import { words, type IntentProfile } from "./profile";
import type { IntentCompany, IntentItem, IntentMatch } from "./types";

/**
 * The one model pass: a fast, cheap model reads posts that code already found and filtered, and says for each one
 * whether it describes a problem the founder solves, asks for a tool, compares the competitors, or is noise. Code
 * checks everything it returns: quotes must be verbatim, matches must be playbook terms, and a company is kept only
 * when the post itself names the author's employer. Pure, so the checks are tested.
 */

export const JUDGE_BATCH = 15;
/** Cap per scan, so a noisy week can't run up the bill. */
export const JUDGE_MAX = 60;

export const JUDGE_RULES = `INTENT JUDGE
You read public posts that a search found for a company's playbook terms. For each post decide what it is doing:
- ask: the author asks for a tool, a vendor, a recommendation, or how others solve the problem.
- problem: the author describes the problem the company solves as their own, current problem.
- compare: the author compares, evaluates or asks about the listed competitors or alternatives.
- irrelevant: anything else. That includes vendors promoting their own product, job posts, news, jokes, résumés, and
  posts that use the same words for a different thing.
relevance (0 to 3): 3 = the author clearly has this problem now and could buy; 2 = related and plausibly a buyer;
1 = tangential; 0 = irrelevant. Be strict: when in doubt, 1.
matched: ids from TERMS that the post is about (up to 4). Never invent an id.
quote: copy up to 40 words exactly from the post that show the need. Copy the characters exactly, no ellipsis in the
middle. Empty when irrelevant.
why: at most 18 plain words on what they need, for the founder. No hype.
company: only when the author names their own employer in the post ("we at Acme", "I run billing at Acme"). Never
guess it from a username, a link, or a product they say they use. Otherwise null.
Call submit_intent once with one entry per post.`;

export const JudgeOutput = z.object({
  posts: z
    .array(
      z.object({
        i: z.number().int().min(0).max(99),
        label: z.enum(["ask", "problem", "compare", "irrelevant"]),
        relevance: z.number().int().min(0).max(3),
        matched: z.array(z.string().max(8)).max(4).describe("Ids from TERMS, up to 4"),
        quote: z.string().max(400).describe("Up to 40 words copied exactly from the post; empty when irrelevant"),
        why: z.string().max(200).describe("At most 18 words"),
        company: z.string().max(80).nullable().describe("The author's employer, only when the post names it; else null"),
      }),
    )
    .max(25),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;
export type Judgement = Omit<JudgeOutput["posts"][number], "i">;

const day = (iso?: string) => (iso ? iso.slice(0, 10) : "date unknown");

/** What the company sells and the TERMS list: the same for every batch of a scan, so it sits in the cached system prompt. */
export function judgeContext(profile: IntentProfile): string {
  const terms = [...profile.pains, ...profile.competitors, ...profile.categoryTerms].map((t) => `${t.id} ${t.kind}: ${t.label}`);
  return [
    `THE COMPANY: ${profile.product || "the founder's company"}. ${profile.oneLiner}`.trim(),
    profile.personas.length ? `Its buyers: ${profile.personas.join(", ")}.` : "",
    profile.consumer ? "It sells to consumers: an individual asking for an app or product like it counts as a buyer." : "",
    "",
    "TERMS",
    ...terms,
  ]
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n");
}

/** The batch as the model sees it. Authors' names are left out on purpose: nothing to guess a company from. */
export function judgeMessage(batch: Candidate[]): string {
  const posts = batch.map((c, i) => {
    const where = [c.source === "hn" ? "Hacker News" : c.source === "stackexchange" ? "Stack Exchange" : c.source === "github" ? "GitHub issue" : "Reddit", c.site].filter(Boolean).join(", ");
    const body = (c.text || "(no text, title only)").replace(/\s+/g, " ").slice(0, 700);
    return `[${i}] ${where} · ${day(c.postedAt)} · ${c.title}\n${body}`;
  });
  return `Judge these ${batch.length} posts.\n\nPOSTS\n${posts.join("\n\n")}`;
}

const QUESTION = /\?|\b(how do (you|i|we)|anyone (here )?(use|know|tried)|recommend|what do (you|people) use|looking for|best way to|alternatives? to)\b/i;

/**
 * The zero-token verdict, used when no AI is set up: a post that mentions at least three playbook terms and reads
 * as a question. Marked as found in code, so the founder knows nothing judged it.
 */
export function codeVerdict(c: Candidate & { lex: number; lexMatched: IntentMatch[] }): Judgement | null {
  if (c.lex < 3) return null;
  const text = `${c.title}\n${c.text}`;
  const competitors = c.lexMatched.filter((m) => m.kind === "competitor").length;
  if (!QUESTION.test(text) && !competitors) return null;
  const comparing = competitors >= 2 || (competitors === 1 && /\b(vs\.?|versus|alternatives? to|instead of|compared (to|with))\b/i.test(text));
  const label = comparing ? "compare" : QUESTION.test(text) ? "ask" : "problem";
  const names = c.lexMatched.slice(0, 2).map((m) => m.label.toLowerCase());
  return { label, relevance: 2, matched: [], quote: "", why: `Found in code, not checked by AI: mentions ${names.join(" and ")}.`, company: null };
}

const lc = (s: string) => s.toLowerCase();
const squashName = (s: string) => lc(s).replace(/[^a-z0-9]/g, "");

/** A company the author names as their own: the name must be in the post, and must not just be their username. */
export function saidCompany(c: Candidate, name: string | null | undefined): IntentCompany | undefined {
  const n = name?.trim();
  if (!n || n.length < 2 || n.length > 80) return undefined;
  const text = `${c.title}\n${c.text}`;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu");
  if (!re.test(text)) return undefined;
  if (c.author && squashName(c.author).includes(squashName(n))) return undefined;
  const sentence = text.split(/(?<=[.!?])\s+|\n+/).find((s) => re.test(s)) ?? n;
  return { name: n, basis: "said_in_post", evidence: `In the post: “${clipQuote(sentence.trim(), 140)}”` };
}

/** The model's verdict, checked, as a feed item; null when it isn't worth the founder's time. */
export function toItem(c: Candidate, j: Judgement, profile: IntentProfile, opts: { now: string; lexMatched?: IntentMatch[]; id: string; byCode?: boolean }): IntentItem | null {
  if (j.label === "irrelevant" || j.relevance < 2) return null;
  const terms = new Map([...profile.pains, ...profile.competitors, ...profile.categoryTerms].map((t) => [t.id.toUpperCase(), t]));
  const matched: IntentMatch[] = [];
  const push = (m: IntentMatch) => {
    if (!matched.some((x) => x.kind === m.kind && x.label === m.label)) matched.push(m);
  };
  for (const id of j.matched) {
    const t = terms.get(id.trim().toUpperCase());
    if (t) push({ kind: t.kind, label: t.label });
  }
  for (const m of opts.lexMatched ?? []) push(m);
  const body = c.text || c.title;
  const tokens = matched.flatMap((m) => words(m.label));
  const quote = verbatim(body, j.quote) ?? verbatim(c.title, j.quote) ?? bestSentence(body, tokens);
  const company = saidCompany(c, j.company);
  return {
    id: opts.id,
    key: c.key,
    thread: c.thread,
    source: c.source,
    ...(c.site ? { site: c.site } : {}),
    url: c.url,
    title: c.title,
    quote,
    author: c.author,
    ...(c.authorUrl ? { authorUrl: c.authorUrl } : {}),
    ...(c.postedAt ? { postedAt: c.postedAt } : {}),
    kind: j.label,
    relevance: j.relevance >= 3 ? 3 : 2,
    why: clipQuote(j.why.replace(/\s+/g, " "), 160),
    ...(opts.byCode ? { byCode: true } : {}),
    matched: matched.slice(0, 4),
    ...(company ? { company } : {}),
    query: c.query,
    queryKey: c.queryKey,
    foundAt: opts.now,
  };
}
