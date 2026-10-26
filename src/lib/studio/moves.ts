import type { StudioAudience, StudioFormatId, StudioOccasion } from "@/lib/domain/types";
import type { Receipt } from "./receipts";

/**
 * Moves: named techniques the writer picks from, one per option, so a set of options covers
 * different angles instead of five rewordings of one. Each move is drawn from campaigns studied in
 * docs/research/10-marketing-copy.md and carries its examples with sources, how strong the
 * evidence is, and when it backfires.
 *
 * Evidence labels, honestly: "tested" means a controlled test or peer-reviewed study; "reported"
 * means the company or press reported results (self-reported, not independently measured);
 * "opinion" means practitioner advice. No move here has public A/B evidence unless it says so.
 *
 * Examples are short quotes for reference. They were read through search excerpts, public GitHub
 * source or podcast transcripts on 2026-10-26 (the network policy blocked most live pages), so
 * `seen` says how. They're shown to the writer as patterns to learn from, never to copy.
 */

export type Need = "number" | "customer_words" | "proof" | "story" | "demo" | "competitor" | "belief" | "offer" | "limit";

export interface MoveExample {
  text: string;
  who: string;
  when: string;
  source: string;
  seen: "page" | "excerpt" | "repo" | "transcript";
}

export interface Move {
  id: string;
  name: string;
  /** One line: what it is. */
  line: string;
  /** The structure to write to. */
  how: string;
  /** Receipt kinds it needs; any one is enough. Empty = always available. */
  needs: Need[];
  formats: StudioFormatId[] | "all";
  audiences: StudioAudience[] | "all";
  occasions?: StudioOccasion[];
  examples: MoveExample[];
  evidence: { level: "tested" | "reported" | "opinion"; note: string };
  backfires: string;
  /** Bold moves trade trust for attention. Used only when the founder turns them on. */
  risk?: "bold";
}

const SHORT: StudioFormatId[] = ["one_liner", "homepage_hero", "billboard", "image", "meta_ad", "linkedin_ad", "search_ad", "app_store", "waitlist_page", "product_hunt", "short_video"];

export const MOVES: Move[] = [
  {
    id: "villain_object",
    name: "Name the old way",
    line: "Pick the thing the reader does today and tell them to stop.",
    how: "Imperative against the old habit or tool, then the new way, in as few words as possible: “Don't [old], just [new].” The old way is a concrete object or habit, not a vague pain.",
    needs: [],
    formats: [...SHORT, "linkedin_post", "x_post", "short_video", "creator_brief"],
    audiences: "all",
    examples: [
      { text: "Don't type, just speak", who: "Wispr Flow homepage", when: "indexed 2026", source: "https://wisprflow.ai/", seen: "excerpt" },
      { text: "Wispr Raises $12M and Launches Wispr Flow to Replace Keyboards With Voice", who: "Wispr launch release", when: "2024-09-30", source: "https://www.businesswire.com/news/home/20240930079034/en/Wispr-Raises-$12M-and-Launches-Wispr-Flow-to-Replace-Keyboards-With-Voice", seen: "excerpt" },
    ],
    evidence: { level: "reported", note: "Wispr kept the keyboard as the villain from 2024 to 2026 while reporting fast growth (self-reported). No public A/B test." },
    backfires: "When the old way is something the reader is proud of, or when the new way isn't clearly better at the moment they try it.",
  },
  {
    id: "finally_works",
    name: "Admit the category's past",
    line: "Say out loud that this kind of product used to disappoint, and that this one works.",
    how: "Name the category the reader has tried before, then promise it now does the job: “[category] that actually works.” Only with a receipt that shows it works.",
    needs: ["proof", "demo", "number", "story"],
    formats: [...SHORT, "linkedin_post", "x_post", "email_announcement"],
    audiences: ["prosumer", "b2c", "developer", "b2b"],
    examples: [
      { text: "voice dictation that actually works", who: "Wispr Flow iOS launch post", when: "2025-06", source: "https://wisprflow.ai/post/flow-on-iphone", seen: "excerpt" },
      { text: "Voice that finally works is here.", who: "Wispr Flow homepage banner", when: "indexed 2026-10", source: "https://wisprflow.ai/", seen: "excerpt" },
    ],
    evidence: { level: "reported", note: "Used by Wispr across launches; no public test. It works on readers who already tried the category." },
    backfires: "If it doesn't clearly work better on first try: the reader was primed to be disappointed and reviews will say so.",
  },
  {
    id: "one_number",
    name: "One number",
    line: "Lead with the single number that would make a skeptic stop.",
    how: "The number first or in the first five words, attached to what the reader cares about (time, money, errors). One number per line. The number must be in a receipt, exactly.",
    needs: ["number"],
    formats: "all",
    audiences: "all",
    examples: [
      { text: "4x faster than typing", who: "Wispr Flow homepage", when: "indexed 2026-10", source: "https://wisprflow.ai/", seen: "excerpt" },
      { text: "Get rewards and perks, and up to 5%¹ savings.", who: "Ramp corporate card page", when: "undated", source: "https://ramp.com/corporate-cards", seen: "excerpt" },
    ],
    evidence: { level: "tested", note: "Concrete language raised satisfaction and purchase in five studies (Packard & Berger, Journal of Consumer Research). Specific numbers are the most concrete form." },
    backfires: "When the number drifts between pages (Ramp's own pages showed “up to 5%”, “5% or more on average” and 3.5%) or can't be substantiated. Regulators act on unproven numbers.",
  },
  {
    id: "offer_first",
    name: "Offer in the headline",
    line: "Put the concrete offer where the reader looks first.",
    how: "The headline names what they get and on what terms (a free trial, a pilot, a price, a limit). The subhead says what it is.",
    needs: ["offer"],
    formats: ["homepage_hero", "waitlist_page", "meta_ad", "linkedin_ad", "search_ad", "image", "email_announcement", "app_store"],
    audiences: "all",
    examples: [{ text: "30-day free trial (moved into the headline: +30% signups)", who: "Highrise signup page test", when: "2009-01", source: "https://signalvnoise.com/posts/1525-writing-decisions-headline-tests-on-the-highrise-signup-page", seen: "excerpt" }],
    evidence: { level: "tested", note: "37signals' A/B test: leading with “30-day free trial” converted 30% better than “Start a Highrise Account”." },
    backfires: "When the offer is weak or ordinary; then it advertises that there's nothing else to say.",
  },
  {
    id: "their_words",
    name: "Their words",
    line: "Build the line from a phrase customers actually say.",
    how: "Take a customer phrase verbatim (from customer words or a quote) and make it the headline or hook. Change as little as possible.",
    needs: ["customer_words"],
    formats: "all",
    audiences: "all",
    examples: [
      { text: "“Dude, you have to use it, it's really fucking fast.” (how users pitched Superhuman to friends: the cocktail party test)", who: "Rahul Vohra, Lenny's Podcast", when: "undated", source: "https://github.com/mpnikhil/lenny-rag-mcp/blob/main/transcripts/Rahul%20Vohra.txt", seen: "transcript" },
    ],
    evidence: { level: "opinion", note: "Copyhackers' message-mining method and Superhuman's “cocktail party test” (founder-reported). No published percentage lift found." },
    backfires: "When the phrase is jargon only one customer uses, or quotes a customer without permission.",
  },
  {
    id: "category_feeling",
    name: "Category plus a feeling",
    line: "Name the familiar category, then the feeling nobody associates with it.",
    how: "“The [boring category] you'll [enjoy / not dread].” Works when the category is known for pain and your product is genuinely nicer to use.",
    needs: [],
    formats: ["one_liner", "homepage_hero", "billboard", "app_store", "product_hunt", "linkedin_ad", "meta_ad"],
    audiences: ["b2b", "developer", "prosumer"],
    examples: [{ text: "The issue tracking tool you'll enjoy using", who: "Linear", when: "2021-02 to 2025-07", source: "https://github.com/linear/linear/commit/3a1906970affdf824e8b7ec5512529067ca05b03", seen: "repo" }],
    evidence: { level: "reported", note: "Linear kept this line for over four years; Karri Saarinen reports a ~4,000-person waitlist in about a month (self-reported)." },
    backfires: "When the product is only marginally nicer; the promise is about feel, so the first session has to deliver it.",
  },
  {
    id: "x_alternative",
    name: "The alternative to a name they know",
    line: "Borrow a known name: “the [adjective] [incumbent] alternative.”",
    how: "Name the incumbent the reader already uses and the one difference that matters (open source, cheaper, self-hosted, for X). Only when the comparison is fair.",
    needs: ["competitor"],
    formats: ["one_liner", "homepage_hero", "show_hn", "product_hunt", "search_ad", "community_post", "comparison_page"],
    audiences: ["developer", "b2b", "prosumer"],
    examples: [{ text: "Supabase is an open source Firebase alternative.", who: "Supabase blog", when: "2020-08-05", source: "https://github.com/supabase/supabase/blob/master/apps/www/_blog/2020-08-05-supabase-auth.mdx", seen: "repo" }],
    evidence: { level: "reported", note: "Supabase's early Hacker News launch: 1,400+ signups in 7 days (self-reported). Later outgrew the line." },
    backfires: "It ties your identity to someone else's; outgrow it once you're known. Claims about the incumbent must stay true (FTC comparative advertising).",
  },
  {
    id: "two_ends",
    name: "Both ends of the journey",
    line: "Promise the first day and the hundredth in one couplet.",
    how: "Two short sentences: how fast it starts, how far it goes. “Build in a weekend. Scale to millions.” Both halves must be true.",
    needs: [],
    formats: ["one_liner", "homepage_hero", "billboard", "image", "app_store"],
    audiences: ["developer", "b2b", "prosumer"],
    examples: [
      { text: "Build in a weekend / Scale to millions", who: "Supabase homepage source", when: "2026-10", source: "https://github.com/supabase/supabase/blob/master/apps/www/data/home/content.tsx", seen: "repo" },
      { text: "Develop. Preview. Ship.", who: "Vercel README", when: "2026-10", source: "https://github.com/vercel/vercel/blob/main/README.md", seen: "repo" },
    ],
    evidence: { level: "reported", note: "Durable lines at Supabase and Vercel; no public test." },
    backfires: "When either end is a stretch (\"scale to millions\" with no customer at scale invites the obvious question).",
  },
  {
    id: "two_buyers",
    name: "One line, two buyers",
    line: "Serve two people on the buying committee in one sentence.",
    how: "Name what the budget owner gets and what the daily user gets, joined so each sees themselves. B2B: finance and the team; the CTO and the engineer.",
    needs: [],
    formats: ["one_liner", "homepage_hero", "billboard", "linkedin_ad", "image"],
    audiences: ["b2b"],
    examples: [{ text: "Time is money. Save both.", who: "Ramp savings page", when: "undated", source: "https://ramp.com/savings", seen: "excerpt" }],
    evidence: { level: "reported", note: "Ramp's long-running slogan; Ramp reports 85,000+ customers and $2B+ annualized revenue as of Oct 2026 (self-reported). No test isolates the line." },
    backfires: "When the two halves pull apart; a line that tries to please everyone on the committee pleases no one.",
  },
  {
    id: "against_the_model",
    name: "Against the industry's incentive",
    line: "Promise the thing your category profits from not doing.",
    how: "Name the incumbent business model's incentive and say you do the opposite: a card that helps you spend less; a tool that wants you to use it less.",
    needs: [],
    formats: ["one_liner", "homepage_hero", "billboard", "linkedin_post", "x_post", "email_announcement"],
    audiences: ["b2b", "b2c", "prosumer"],
    occasions: ["launch", "evergreen", "funding"],
    examples: [{ text: "the first and only corporate card that helps your company spend less", who: "Eric Glyman, Ramp launch post", when: "2020-02-12", source: "https://medium.com/@eglyman/ramp-the-corporate-card-that-helps-your-company-spend-less-97ca5a0f86f", seen: "excerpt" }],
    evidence: { level: "reported", note: "Ramp's positioning since launch; growth is self-reported." },
    backfires: "When the incentive claim isn't structurally true for you, or “first and only” can't be proven: superlatives need substantiation.",
  },
  {
    id: "never_promise",
    name: "The never promise",
    line: "Define the product by a pain it refuses to cause.",
    how: "“I'll never…” / “[Thing] is coming to [category]. But not to [us].” The pain is specific and the reader has felt it.",
    needs: [],
    formats: ["one_liner", "billboard", "image", "meta_ad", "x_post", "linkedin_post"],
    audiences: ["b2c", "prosumer", "b2b", "developer"],
    examples: [
      { text: "I'll never leave dirty dishes in the sink", who: "Friend subway ads", when: "2025-09", source: "https://www.fastcompany.com/91413814/friend-ai-ad-campaign-founder-qa", seen: "excerpt" },
      { text: "Ads are coming to AI. But not to Claude.", who: "Anthropic Super Bowl LX", when: "2026-02", source: "https://www.tomsguide.com/ai/chatgpt/so-clearly-dishonest-sam-altman-responds-to-anthropics-super-bowl-ad-targeting-chatgpt-heres-what-he-said", seen: "excerpt" },
    ],
    evidence: { level: "reported", note: "Attention measured by third parties (Appfigures estimated Claude downloads +211% in Super Bowl week). Friend sold about 3,000 units after spending over $1M (founder-reported): attention isn't sales." },
    backfires: "When it implies a competitor does the bad thing and they can argue otherwise (OpenAI's CEO called the Claude ads “clearly dishonest”), or when the promise is one you can't keep forever.",
  },
  {
    id: "before_after",
    name: "The moment before",
    line: "Show the exact moment the problem bites, then what happens instead.",
    how: "One concrete scene from a story receipt: who, where, what they were doing, what went wrong. Then the same scene with the product. Objects and numbers, not adjectives.",
    needs: ["story", "demo"],
    formats: "all",
    audiences: "all",
    examples: [],
    evidence: { level: "tested", note: "Concrete, picturable language raised satisfaction and purchase (Packard & Berger). Harry Dry's test (opinion): can I visualize it?" },
    backfires: "When the scene is invented. Only scenes from the founder's material or a customer's permitted story.",
  },
  {
    id: "show_it",
    name: "Show it working",
    line: "Let the product do the talking in the first seconds.",
    how: "Video or image: the product doing the one thing, on screen, in the first 3 seconds; words caption what we see. Text posts: describe the demo moment step by step.",
    needs: ["demo"],
    formats: ["short_video", "image", "creator_brief", "x_post", "linkedin_post", "show_hn", "product_hunt"],
    audiences: "all",
    occasions: ["launch", "feature", "evergreen"],
    examples: [{ text: "Launch video shot over a weekend with “a ring light and iPhone camera”, at no cost (founder-reported)", who: "Tanay Kothari on Wispr Flow's launch", when: "2024 (post date unconfirmed)", source: "https://x.com/tankots", seen: "excerpt" }],
    evidence: { level: "tested", note: "Facebook and Nielsen: up to 47% of a video campaign's value lands in the first 3 seconds. TikTok's guidance puts the proposition in the first 3 seconds." },
    backfires: "When the payoff takes longer than a few seconds to see; then lead with the result, not the setup.",
  },
  {
    id: "i_stopped",
    name: "“I stopped …” confession",
    line: "A first-person confession from someone who quit the old way.",
    how: "Creator or founder voice: “I stopped [old habit] [time] ago and I'm not going back,” then show why in one beat. The creator says it their way; facts stay receipts.",
    needs: [],
    formats: ["short_video", "creator_brief", "x_post", "linkedin_post", "meta_ad"],
    audiences: ["prosumer", "b2c", "developer"],
    examples: [{ text: "I stopped typing months ago and I'm not going back.", who: "Creator Short about Wispr Flow (paid status unknown)", when: "2025–26", source: "https://www.youtube.com/shorts/VZTg8yxkpwI", seen: "excerpt" }],
    evidence: { level: "reported", note: "Wispr pays about 50 creators 7% of the ad spend behind their videos, for 500–700 Meta ads a month (staff accounts, Oct 2026); profitability isn't public." },
    backfires: "When the person hasn't actually stopped, or a paid creator doesn't disclose the relationship.",
  },
  {
    id: "for_you_news",
    name: "News, written for the user",
    line: "Announce your news by what it changes for the reader.",
    how: "Title the announcement “[news], and what it means for you.” First paragraph: the change for users (price, speed, a feature). The money, hire or milestone comes second.",
    needs: [],
    formats: ["linkedin_post", "x_post", "email_announcement", "changelog"],
    audiences: "all",
    occasions: ["funding", "milestone", "hiring", "launch"],
    examples: [{ text: "Our Series B, and what it means for you", who: "Wispr Flow blog", when: "2026-08-17", source: "https://wisprflow.ai/post/series-b", seen: "excerpt" }],
    evidence: { level: "opinion", note: "Wispr's pattern; no measured effect. Contrast with the “thrilled to announce” cliché lint flags." },
    backfires: "When nothing actually changes for users; then it's a funding post in disguise.",
  },
  {
    id: "builder_note",
    name: "The builder's note",
    line: "The person who built it explains it, in first person, with the how.",
    how: "What it does, the hard part, how we solved it, what's still rough, what to try first. Technical detail is welcome; adjectives aren't.",
    needs: [],
    formats: ["show_hn", "changelog", "linkedin_post", "x_post", "community_post", "product_hunt", "email_announcement"],
    audiences: ["developer", "b2b", "prosumer"],
    occasions: ["launch", "feature", "lesson"],
    examples: [{ text: "Launch week day headers: “Monday: Pricing”, “Tuesday: Storage”, … “Friday: One more thing”", who: "Supabase launch week", when: "2021-03-25", source: "https://github.com/supabase/supabase/blob/master/apps/www/_blog/2021-03-25-launch-week.mdx", seen: "repo" }],
    evidence: { level: "reported", note: "Supabase and Lovable have the engineer who built a feature write its announcement (founder-reported)." },
    backfires: "When it becomes a changelog of internals with no reason for the reader to care.",
  },
  {
    id: "honest_scope",
    name: "Honest scope",
    line: "Say plainly what it does today and what's still rough, before the reader finds out.",
    how: "“It's early days, but right now [product] can [a few specific things].” Then one honest line on what it doesn't do yet, from the founder's own list, and what's next.",
    needs: ["limit"],
    formats: ["show_hn", "product_hunt", "community_post", "linkedin_post", "x_post", "comparison_page", "changelog", "email_announcement"],
    audiences: ["developer", "b2b", "prosumer", "b2c"],
    occasions: ["launch", "feature", "evergreen", "lesson"],
    examples: [
      { text: "It's early days, but right now Cursor can help you with a few things...", who: "Cursor README", when: "2023-03", source: "https://github.com/getcursor/cursor/commit/5473e8d4144d4b9f30a6afb3933d72c71e57528d", seen: "repo" },
      { text: "Top comment on Wispr's Show HN asked whether it is “fully local, or is there a cloud involved?”", who: "Hacker News", when: "2024-09-30", source: "https://news.ycombinator.com/item?id=41696153", seen: "excerpt" },
    ],
    evidence: { level: "opinion", note: "Technical audiences raise the gaps anyway (Wispr's privacy question came back a year later as a controversy); naming them first keeps the thread on your terms." },
    backfires: "When the limitation is a dealbreaker for the target reader, or “early days” becomes an excuse for repeated failures.",
  },
  {
    id: "situation_qualifier",
    name: "For people in a situation",
    line: "Name the reader by the situation they're in, not their job title.",
    how: "“The [object] for people [in a specific situation].” The situation is one the reader recognizes instantly, ideally in their own words.",
    needs: [],
    formats: ["one_liner", "homepage_hero", "product_hunt", "app_store", "meta_ad", "linkedin_ad", "billboard", "waitlist_page"],
    audiences: ["prosumer", "b2b", "developer", "b2c"],
    examples: [{ text: "The AI notepad for people in back-to-back meetings", who: "Granola, Product Hunt", when: "2024", source: "https://www.producthunt.com/products/granola", seen: "excerpt" }],
    evidence: { level: "reported", note: "Granola's launch line; no public test." },
    backfires: "When the situation is too narrow to grow from, or the product adds team features the line doesn't cover.",
  },
  {
    id: "footnoted_claim",
    name: "Claim, unit, footnote",
    line: "B2B proof in order: the claim, the number with its unit, the method in a footnote.",
    how: "Lead with the outcome and its number exactly as the receipt states it (“up to” stays “up to”, “average” stays “average”), add ¹, and put the method and its limits in the footnote line.",
    needs: ["number"],
    formats: ["homepage_hero", "linkedin_ad", "comparison_page", "image", "email_announcement", "linkedin_post", "customer_story"],
    audiences: ["b2b", "prosumer"],
    examples: [
      { text: "Get rewards and perks, and up to 5%¹ savings.", who: "Ramp corporate card page", when: "undated", source: "https://ramp.com/corporate-cards", seen: "excerpt" },
      { text: "We calculate average savings as a percentage of an illustrative customer's total card spending.", who: "Ramp Help Center (the method)", when: "undated", source: "https://support.ramp.com/how-ramp-can-save-your-business-time-and-money", seen: "excerpt" },
    ],
    evidence: { level: "reported", note: "Ramp's proof structure; Ramp calls its savings figure “an estimate, not a guarantee”." },
    backfires: "When the qualifier drifts between pages (Ramp showed “up to 5%”, “5% or more on average” and 3.5%). Lint checks the qualifier against the source.",
  },
  {
    id: "referral_after_use",
    name: "Referral that pays after real use",
    line: "Both people get the reward once the friend actually uses the product.",
    how: "“You and [friend] both get [reward] when they [reach a usage milestone].” The milestone is reachable in the first week of normal use.",
    needs: ["offer"],
    formats: ["waitlist_page", "email_announcement", "app_store", "x_post", "linkedin_post"],
    audiences: ["prosumer", "b2c", "developer"],
    examples: [
      { text: "Both get a free month “when they hit 2,000 words or upgrade to Pro”", who: "Wispr Flow referral", when: "2025–26", source: "https://wisprflow.ai/students", seen: "excerpt" },
      { text: "Both the referrer and the friend get a free month", who: "Superhuman, per Rahul Vohra", when: "undated", source: "https://github.com/mpnikhil/lenny-rag-mcp/blob/main/transcripts/Rahul%20Vohra.txt", seen: "transcript" },
    ],
    evidence: { level: "reported", note: "Wispr and Superhuman both ran two-sided referrals; no conversion data is public." },
    backfires: "When the milestone is out of reach, or the reward is one the founder hasn't actually set up.",
  },
  {
    id: "name_the_job",
    name: "Name the job or the category",
    line: "Give the practice a name people can put in their title.",
    how: "Name the new job, practice or category in two or three words, then what it means in one plain sentence. Use it consistently everywhere.",
    needs: [],
    formats: ["one_liner", "homepage_hero", "linkedin_post", "x_post", "billboard"],
    audiences: ["b2b", "developer"],
    occasions: ["evergreen", "funding", "launch", "lesson"],
    examples: [{ text: "GTM engineering represents the first true AI-native profession", who: "Clay, Series C release", when: "2025-08-05", source: "https://www.businesswire.com/news/home/20250805719448/en/AI-GTM-Leader-Clay-Raises-%2524100M-Series-C-to-Fuel-GTM-Engineering-Roles-Industrywide", seen: "excerpt" }],
    evidence: { level: "reported", note: "A podcast later counted 1,000+ people with the title; a critic called the label self-serving." },
    backfires: "When nobody adopts the label, or it reads as a vendor inventing a need.",
  },
  {
    id: "honest_comparison",
    name: "Honest comparison",
    line: "Compare on checkable facts, including where the other option wins.",
    how: "Name the alternative, the 3–6 differences that matter with numbers (price, limits, eligibility), dated, and one line on who should pick them.",
    needs: ["competitor"],
    formats: ["comparison_page", "linkedin_post", "community_post", "search_ad", "x_post"],
    audiences: ["b2b", "developer", "prosumer"],
    examples: [{ text: "$12 vs. $15 per user per month", who: "Ramp blog, Brex vs. Mercury vs. Ramp", when: "undated", source: "https://ramp.com/blog/brex-vs-mercury-vs-ramp", seen: "excerpt" }],
    evidence: { level: "reported", note: "Ramp runs about nine three-way comparison posts; effect not public." },
    backfires: "Stale or one-sided facts. Comparative claims must be truthful and substantiated (FTC).",
  },
  {
    id: "scoreboard",
    name: "Running scoreboard",
    line: "A live total of what customers got: hours, dollars, words.",
    how: "“[Big number] [unit] saved for [N]+ customers.” Only from a receipt with a date; update it everywhere at once.",
    needs: ["number"],
    formats: ["homepage_hero", "billboard", "image", "linkedin_post", "x_post", "email_announcement"],
    audiences: ["b2b", "prosumer", "b2c"],
    occasions: ["milestone", "evergreen"],
    examples: [
      { text: "Over 20 million hours saved for 30,000+ customers", who: "Ramp homepage capture", when: "undated", source: "https://ramp.com/?rc=FV6FQ2", seen: "excerpt" },
      { text: "27.5M+ hours and $10B+ saved (the calculator page: 27M+ hours and $12B+)", who: "Ramp savings pages", when: "undated", source: "https://ramp.com/savings", seen: "excerpt" },
    ],
    evidence: { level: "reported", note: "Social proof and outcome proof together; self-reported totals." },
    backfires: "When pages disagree (Ramp's own pages showed different totals). One source of truth, dated.",
  },
  {
    id: "data_drop",
    name: "Data only you have",
    line: "Publish a finding from your own product data, with the method.",
    how: "Lead with the one surprising number, then the sample and method in one line, then what it means for the reader.",
    needs: ["number"],
    formats: ["linkedin_post", "x_post", "email_announcement", "image", "community_post"],
    audiences: ["b2b", "developer", "prosumer"],
    occasions: ["data_drop", "lesson"],
    examples: [{ text: "Ramp AI Index, built from Ramp transaction data and published on the St. Louis Fed's FRED", who: "Ramp", when: "2025–26", source: "https://fred.stlouisfed.org/data/RAMPAICONSTRUCTION", seen: "excerpt" }],
    evidence: { level: "reported", note: "Ramp's index is cited as an economic series; no conversion data is public." },
    backfires: "Small samples dressed up as trends, or data customers didn't agree to share. State the sample size.",
  },
  {
    id: "lesson",
    name: "The lesson that costs nothing",
    line: "Give away one thing the founder learned the hard way.",
    how: "The moment you learned it, what you believed before, what you believe now, one number or detail as proof. The product appears once, at most.",
    needs: ["story", "belief"],
    formats: ["linkedin_post", "x_post", "community_post", "email_announcement"],
    audiences: "all",
    occasions: ["lesson", "milestone", "evergreen"],
    examples: [],
    evidence: { level: "opinion", note: "Founder-led content is the standard early motion; reach claims about LinkedIn and X algorithms are unverified." },
    backfires: "When the lesson is generic (\"talk to your customers\") or the story is a thinly veiled pitch.",
  },
  {
    id: "taboo_literal",
    name: "The taboo, said literally",
    line: "A short imperative that says the uncomfortable thing your product does.",
    how: "3–6 words, imperative, literal about the product's effect. Must be true and must not target people's livelihoods or identity.",
    needs: [],
    formats: ["billboard", "one_liner", "x_post", "short_video", "image"],
    audiences: "all",
    examples: [
      { text: "Stop Hiring Humans", who: "Artisan billboards", when: "2024-12", source: "https://petapixel.com/2024/12/10/billboards-around-san-francisco-urge-you-to-stop-hiring-humans/", seen: "excerpt" },
      { text: "cheat on everything", who: "Cluely", when: "2025-04", source: "https://techcrunch.com/2025/04/21/columbia-student-suspended-over-interview-cheating-tool-raises-5-3m-to-cheat-on-everything", seen: "excerpt" },
    ],
    evidence: { level: "reported", note: "Huge attention, at a cost: Artisan reported death threats and weekly vandalism and later changed course; Cluely dropped the line and its CEO admitted a false revenue figure." },
    backfires: "Often. It trades trust for attention, attracts regulators and press scrutiny, and can define the company for years.",
    risk: "bold",
  },
];

/** Does the workspace hold a receipt of this kind? */
function has(need: Need, receipts: Receipt[]): boolean {
  switch (need) {
    case "number":
      return receipts.some((r) => r.fact && /\d/.test(r.text));
    case "customer_words":
      return receipts.some((r) => r.kind === "customer_words" || (r.kind === "material" && r.label === "User quote"));
    case "proof":
      return receipts.some((r) => r.kind === "claim" && ["Metric", "Customer", "Logo"].includes(r.label));
    case "story":
      return receipts.some((r) => r.kind === "material" && (r.label === "Your story" || r.label === "User quote"));
    case "demo":
      return receipts.some((r) => r.kind === "material" && r.label === "Demo moment");
    case "belief":
      return receipts.some((r) => r.kind === "pov" || (r.kind === "material" && r.label === "Your belief"));
    case "offer":
      return receipts.some((r) => r.id === "co_price" || (r.kind === "material" && /\b(free|trial|pilot|discount|off|month|price|\$)/i.test(r.text)));
    case "limit":
      return receipts.some((r) => r.kind === "material" && r.label === "What it can't do yet");
    case "competitor":
      return false; // resolved by the caller from the playbook's competitor list
  }
}

export interface MoveChoice {
  move: Move;
  /** Why it's unavailable, when it is. */
  missing?: string;
}

const NEED_LABEL: Record<Need, string> = {
  number: "a number with a source",
  customer_words: "customer words or a user quote",
  proof: "an approved customer or metric claim",
  story: "a story from you or a user",
  demo: "a demo moment",
  competitor: "a named competitor in your playbook",
  belief: "a point of view",
  offer: "an offer (pricing, trial or pilot terms)",
  limit: "what it can't do yet, in your words",
};

/** Moves that fit this format and audience, split into usable now and blocked (with what's missing). */
export function movesFor(opts: { format: StudioFormatId; audience: StudioAudience; occasion: StudioOccasion; receipts: Receipt[]; competitors: number; bold: boolean }): MoveChoice[] {
  const out: MoveChoice[] = [];
  for (const move of MOVES) {
    if (move.formats !== "all" && !move.formats.includes(opts.format)) continue;
    if (move.audiences !== "all" && !move.audiences.includes(opts.audience)) continue;
    if (move.occasions && !move.occasions.includes(opts.occasion)) continue;
    if (move.risk === "bold" && !opts.bold) continue;
    const ok = !move.needs.length || move.needs.some((n) => (n === "competitor" ? opts.competitors > 0 : has(n, opts.receipts)));
    out.push(ok ? { move } : { move, missing: move.needs.map((n) => NEED_LABEL[n]).join(" or ") });
  }
  return out;
}

export function moveById(id: string): Move | undefined {
  return MOVES.find((m) => m.id === id);
}
