import type { Asset, LintCode, Workspace } from "@/lib/domain/types";
import { allowWordsFor } from "./context";
import { lintDraft } from "./lint";

/**
 * Code checks for founder content (a weekly post, a community answer, a Show HN post), run after the draft is written.
 * The founder posts these by hand, so nothing here blocks; each note becomes a gap on the draft. Posts get the post
 * lint (120–250 words, plain words); answers and launch posts get the same template-tell checks without the length.
 */

const KEEP: LintCode[] = ["BANNED_PHRASE", "HYPE_WORD", "AI_VOCAB", "NOT_JUST_BUT", "EXCLAMATION", "EMOJI", "ALL_CAPS", "EM_DASH", "FK_GRADE"];
const LENGTH: LintCode[] = ["LEN_OVER", "LEN_UNDER"];

const HASHTAG = /(^|\s)#[A-Za-z][\w-]*/g;
const UPVOTE = /\b(upvote|up-vote|support us|please vote|vote for us)\b/i;
const DISCLOSED = /\b(i|we) (built|make|made|run|started|work on|founded)\b|\bdisclosure\b|\bfull disclosure\b|\bmy (company|startup|product)\b|\bi'm (the )?(founder|building)\b/i;

/** The draft without its Markdown title, for counting words the reader sees. */
function prose(body: string): string {
  return body
    .replace(/^#\s+.*$/m, "")
    .replace(/[*_`>]/g, "")
    .trim();
}

export function contentNotes(ws: Workspace, kind: Asset["kind"], body: string): string[] {
  if (kind !== "post" && kind !== "community_answer" && kind !== "launch") return [];
  const text = prose(body);
  const notes: string[] = [];
  const lint = lintDraft({ subject: null, body: text, frame: "founder_card", step: 1, kind: "post", allowWords: allowWordsFor(ws) });
  const codes = kind === "post" ? [...KEEP, ...LENGTH] : KEEP;
  for (const v of lint.violations) if (codes.includes(v.code)) notes.push(v.detail);

  const tags = text.match(HASHTAG)?.length ?? 0;
  if (kind === "post") {
    if (tags > 2) notes.push(`${tags} hashtags. Two at most.`);
    const hook = text.split("\n").find((l) => l.trim())?.trim() ?? "";
    const hookWords = hook.split(/\s+/).filter(Boolean).length;
    if (hookWords > 12) notes.push(`The first line is ${hookWords} words. A hook lands at 12 or fewer.`);
  } else if (tags) notes.push("Drop the hashtags. They read as marketing here.");

  const name = ws.company?.name?.trim();
  if (kind === "community_answer") {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 200) notes.push(`${words} words. A useful answer fits in 200.`);
    if (name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text) && !DISCLOSED.test(text)) {
      notes.push(`It names ${name} without saying you built it. Say so, or leave it out.`);
    }
    if (/https?:\/\//i.test(text)) notes.push("A link in a first answer reads as a pitch. Leave it out unless they asked for one.");
  }
  if (kind === "launch") {
    const title = body.match(/^#\s+(.*)$/m)?.[1]?.trim() ?? "";
    if (!/^show hn:/i.test(title)) notes.push("Start the title with “Show HN:”.");
    if (title.length > 80) notes.push(`The title is ${title.length} characters. Hacker News allows 80.`);
    if (UPVOTE.test(text)) notes.push("Don't ask for upvotes. Hacker News penalizes it.");
  }
  return [...new Set(notes)];
}
