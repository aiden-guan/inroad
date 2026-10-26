import type { StudioAudience, StudioFormatId, StudioOccasion } from "@/lib/domain/types";

/**
 * Studio formats: every channel or surface a founder writes marketing for, with its parts and the
 * limits each part must fit. Pure data, shared by the workflow (prompt + lint), the browser (live
 * lint, previews, counters) and the agent API (`get_copy_guide`, `check_copy`).
 *
 * Every platform number carries its source and how it was verified on 2026-10-26
 * (docs/research/10-marketing-copy.md, channel specs):
 *   fetched   the official page was read directly
 *   official  the official page's text, seen through a search excerpt (spot-check before relying on it)
 *   secondary only secondary sources or observation
 *   house     Inroad's own heuristic, not a platform rule
 * Hard limits fail lint; recommended, observed and house limits only warn.
 */

export type Verification = "fetched" | "official" | "secondary" | "house";

export interface Limit {
  max?: number;
  min?: number;
  /** "weighted" is X's count: each URL is 23, CJK characters count 2. */
  unit: "chars" | "words" | "weighted";
  kind: "hard" | "recommended" | "observed" | "house";
  verified: Verification;
  source?: string;
}

export type PartRole = "hook" | "body" | "cta" | "title" | "meta" | "visual" | "list";

export interface PartSpec {
  key: string;
  label: string;
  /** What belongs here, for the founder and the writer. */
  hint: string;
  role: PartRole;
  /** Platform limits first, then house aims. Every one is checked. */
  limits: Limit[];
  optional?: boolean;
  multiline?: boolean;
  /** One item per line ("lines") or posts split by a line holding only "---" ("posts"). */
  list?: { split: "lines" | "posts"; min: number; max: number };
  /** Fixed text the part must start with ("Show HN: "). */
  prefix?: string;
  /** Characters a feed shows before "…see more", for the preview. */
  fold?: { chars: number; verified: Verification; source?: string };
}

export type FormatGroup = "positioning" | "social" | "launch" | "ads" | "web" | "proof";

export interface Aspect {
  label: string;
  w: number;
  h: number;
  /** Fractions of the frame to keep clear of text (platform UI covers them). */
  safe?: { top: number; bottom: number; side: number };
  note?: string;
  source?: string;
}

export interface FormatSpec {
  id: StudioFormatId;
  label: string;
  group: FormatGroup;
  blurb: string;
  /** Audiences it suits, best first. Every format is available to everyone; this orders the picker. */
  audiences: StudioAudience[];
  parts: PartSpec[];
  /** How many candidates to write. Short lines get more: the best line is usually the twelfth, not the first. */
  options: number;
  /** Short, high-leverage lines run on the strategist tier; the cost is small because the output is short. */
  tier: "strategist" | "operator";
  /** Where the reader meets it, for the critic: "scrolling LinkedIn between meetings". */
  reading: string;
  /** Format rules for the writer. Platform rules cite their source in a comment. */
  rules: string[];
  preview: "line" | "hero" | "feed" | "thread" | "image" | "search" | "store" | "email" | "page" | "video" | "doc";
  aspects?: Aspect[];
  /** Occasions it suits. Omitted means all. */
  occasions?: StudioOccasion[];
  defaultOccasion: StudioOccasion;
  /** The receipts a format can't be written without (checked in code before any tokens are spent). */
  needs?: "customer_proof";
  /** A limit on all parts together (LinkedIn counts the whole post). */
  total?: Limit;
}

const SRC = {
  xCount: "https://docs.x.com/fundamentals/counting-characters",
  liPost: "https://www.linkedin.com/help/linkedin/answer/a528176",
  liFold: "https://www.linkedin.com/pulse/ultimate-linkedin-post-type-guide-peter-lowes",
  liAds: "https://www.linkedin.com/help/lms/answer/a426534",
  phMain: "https://help.producthunt.com/en/articles/5473056-how-to-post-main-info",
  phLaunch: "https://help.producthunt.com/en/articles/17350772-launch-guide",
  phSharing: "https://www.producthunt.com/launch/sharing-your-launch",
  hnShow: "https://news.ycombinator.com/showhn.html",
  hnGuide: "https://news.ycombinator.com/newsguidelines.html",
  hnTitle: "https://news.ycombinator.com/item?id=40677110",
  redditSpam: "https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam",
  redditTitle: "https://github.com/honestbleeps/Reddit-Enhancement-Suite/issues/149",
  rsa: "https://support.google.com/google-ads/answer/7684791",
  rsaPath: "https://support.google.com/google-ads/answer/7046795",
  metaImage: "https://www.facebook.com/business/ads-guide/update/image",
  metaText: "https://www.facebook.com/business/help/980593475366490",
  metaApi: "https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/options/",
  metaFeed: "https://www.facebook.com/business/help/103816146375741",
  metaReels: "https://www.facebook.com/business/ads-guide/update/image/instagram-reels",
  tiktokSpecs: "https://ads.tiktok.com/help/article/video-ads-specifications",
  tiktokHook: "https://ads.tiktok.com/resources/help/article/creative-best-practices",
  apple: "https://developer.apple.com/app-store/product-page/",
  play: "https://support.google.com/googleplay/android-developer/answer/9859152",
  mailchimp: "https://mailchimp.com/help/best-practices-for-email-subject-lines/",
  litmus: "https://www.litmus.com/blog/the-ultimate-guide-to-preview-text-support",
  ftcCompare: "https://www.ftc.gov/legal-library/browse/statement-policy-regarding-comparative-advertising",
} as const;

const house = (limit: Omit<Limit, "kind" | "verified">): Limit => ({ ...limit, kind: "house", verified: "house" });

/** Words the copy may not contain at all, because the platform's own rules say so. */
export const PLATFORM_BANS: Partial<Record<StudioFormatId, { re: RegExp; part?: string; detail: string }[]>> = {
  // Product Hunt policy: never ask for upvotes; a launch can be disqualified for it (https://www.producthunt.com/launch/sharing-your-launch).
  product_hunt: [{ re: /\bup-?vot(e|es|ing)\b/i, detail: "Product Hunt disqualifies launches that ask for upvotes. Ask people to try it and comment." }],
  // HN guidelines: no uppercase, exclamation points or gratuitous adjectives in titles (https://news.ycombinator.com/newsguidelines.html).
  show_hn: [
    { re: /!/, part: "title", detail: "HN titles can't have exclamation points." },
    { re: /\b(best|amazing|revolutionary|ultimate|powerful|incredible|awesome|game-?chang\w*|blazing(ly)?)\b/i, part: "title", detail: "HN asks for plain titles: no promotional adjectives." },
    { re: /\b(sign ?up|waitlist|wait list|join the beta|request (access|a demo))\b/i, detail: "Show HN is for things people can try now, not sign-up pages or waitlists." },
  ],
};

export const FORMATS: Record<StudioFormatId, FormatSpec> = {
  /* ───────────── Words that define you ───────────── */
  one_liner: {
    id: "one_liner",
    label: "One-liners",
    group: "positioning",
    blurb: "Taglines and the line you say when someone asks what you do.",
    audiences: ["b2c", "prosumer", "b2b", "developer"],
    parts: [{ key: "line", label: "Line", hint: "One line someone could repeat to a friend.", role: "hook", limits: [house({ max: 12, unit: "words" }), house({ max: 90, unit: "chars" })] }],
    options: 8,
    tier: "strategist",
    reading: "hearing it once, from a friend, and deciding whether to ask a follow-up question",
    rules: [
      "Say what it is or what changes for the reader. Clever never at the cost of clear.",
      "Each line uses a different move. Short beats complete.",
      "It must fail the swap test: a competitor couldn't put their name on it.",
    ],
    preview: "line",
    defaultOccasion: "evergreen",
    occasions: ["evergreen", "launch"],
  },
  homepage_hero: {
    id: "homepage_hero",
    label: "Homepage hero",
    group: "positioning",
    blurb: "Headline, subhead, button and proof line above the fold.",
    audiences: ["b2b", "prosumer", "developer", "b2c"],
    parts: [
      { key: "headline", label: "Headline", hint: "What it does or what changes, in the reader's words.", role: "hook", limits: [house({ max: 10, unit: "words" }), house({ max: 70, unit: "chars" })] },
      { key: "subhead", label: "Subhead", hint: "Who it's for and how it works, concretely.", role: "body", limits: [house({ max: 28, unit: "words" })] },
      { key: "cta", label: "Button", hint: "What happens when they click, 2–4 words.", role: "cta", limits: [house({ max: 4, unit: "words" })] },
      { key: "proof", label: "Proof line", hint: "One receipt: a number, a named customer, a quote. Leave empty without one.", role: "meta", optional: true, limits: [house({ max: 16, unit: "words" })] },
    ],
    options: 5,
    tier: "strategist",
    reading: "landing on the homepage from a link, deciding in a few seconds whether this is for them",
    rules: [
      "The headline and subhead together answer: what is it, who is it for, why it beats what they do today.",
      "The button says what happens next (\"Start a 14-day trial\", \"See it on your repo\"), never \"Get started\" alone.",
      "The proof line is empty unless a receipt supports it. Never invent logos, numbers or quotes.",
    ],
    preview: "hero",
    defaultOccasion: "evergreen",
    occasions: ["evergreen", "launch"],
  },
  billboard: {
    id: "billboard",
    label: "Billboard line",
    group: "positioning",
    blurb: "Big type for a billboard, a subway card, a booth or a slide.",
    audiences: ["b2b", "b2c", "prosumer", "developer"],
    parts: [
      { key: "line", label: "Line", hint: "Readable in the time it takes to walk past.", role: "hook", limits: [house({ max: 8, unit: "words" })] },
      { key: "sign", label: "Sign-off", hint: "The name, or the name and a few words.", role: "meta", optional: true, limits: [house({ max: 6, unit: "words" })] },
    ],
    options: 8,
    tier: "strategist",
    reading: "walking past it on the way somewhere else",
    rules: ["One idea. No sentence the reader must parse twice.", "Wit is welcome when it's true; meanness about real people or groups is not."],
    preview: "line",
    defaultOccasion: "evergreen",
    occasions: ["evergreen", "launch", "event"],
  },

  /* ───────────── Social ───────────── */
  linkedin_post: {
    id: "linkedin_post",
    label: "LinkedIn post",
    group: "social",
    blurb: "A founder post: a launch, a lesson, a number, a customer win.",
    audiences: ["b2b", "developer", "prosumer", "b2c"],
    parts: [
      {
        key: "hook",
        label: "Opening",
        hint: "The lines above “…see more”. It carries the whole post.",
        role: "hook",
        multiline: true,
        limits: [{ max: 140, unit: "chars", kind: "observed", verified: "secondary", source: SRC.liFold }],
        fold: { chars: 140, verified: "secondary", source: SRC.liFold },
      },
      {
        key: "body",
        label: "Body",
        hint: "One story or one insight, with the receipt. Normal paragraphs.",
        role: "body",
        multiline: true,
        limits: [house({ min: 60, max: 250, unit: "words" })],
      },
    ],
    total: { max: 3000, unit: "chars", kind: "hard", verified: "official", source: SRC.liPost },
    options: 3,
    tier: "operator",
    reading: "scrolling LinkedIn between meetings, past a dozen launch posts that all sound the same",
    rules: [
      "Opening + body together stay under LinkedIn's 3,000-character limit.",
      "Write in paragraphs of 1–3 sentences. Not one sentence per line.",
      "No hashtag wall: two at most, at the end, only if people actually follow them.",
      "End with a question only if you'd genuinely want the answers.",
    ],
    preview: "feed",
    defaultOccasion: "lesson",
  },
  x_post: {
    id: "x_post",
    label: "X post or thread",
    group: "social",
    blurb: "One post, or a short thread when the story needs it.",
    audiences: ["developer", "prosumer", "b2c", "b2b"],
    parts: [
      {
        key: "posts",
        label: "Posts",
        hint: "One post, or up to 6. Put a line with only --- between posts.",
        role: "list",
        multiline: true,
        list: { split: "posts", min: 1, max: 6 },
        limits: [{ max: 280, unit: "weighted", kind: "hard", verified: "official", source: SRC.xCount }],
      },
    ],
    options: 3,
    tier: "operator",
    reading: "scrolling X fast, stopping only for something specific, funny or useful",
    rules: [
      "Post 1 stands alone: if nobody opens the thread, it still lands.",
      "Each post is 280 weighted characters or fewer; every link counts as 23.",
      "No thread emoji, no \"A thread\", no \"Let me explain\".",
    ],
    preview: "thread",
    defaultOccasion: "launch",
  },
  community_post: {
    id: "community_post",
    label: "Community post",
    group: "social",
    blurb: "Reddit, Slack groups, Discord, forums: useful first, never a pitch.",
    audiences: ["developer", "prosumer", "b2c", "b2b"],
    parts: [
      { key: "title", label: "Title", hint: "What a member would search for or ask.", role: "title", limits: [{ max: 300, unit: "chars", kind: "hard", verified: "secondary", source: SRC.redditTitle }, house({ max: 100, unit: "chars" })] },
      { key: "body", label: "Body", hint: "What you learned or built, how, and what you'd like to hear back.", role: "body", multiline: true, limits: [house({ min: 60, max: 300, unit: "words" })] },
    ],
    options: 3,
    tier: "operator",
    reading: "reading a community they belong to, allergic to anyone selling",
    rules: [
      "Say you're the founder. Give something useful that stands without the product.",
      "Reddit's own guidance: self-promotion isn't spam by itself, but keep it to about 1 in 10 of what you share; each community sets stricter rules (https://support.reddithelp.com/hc/en-us/articles/360043504051-Spam).",
      "Read the community's rules before posting; many allow promotion only in weekly threads.",
      "At most one link, at the end, and only if it's the thing being discussed.",
    ],
    preview: "doc",
    defaultOccasion: "lesson",
  },
  show_hn: {
    id: "show_hn",
    label: "Show HN",
    group: "launch",
    blurb: "A Hacker News launch: plain title, how it works, what you want to hear.",
    audiences: ["developer", "prosumer", "b2b", "b2c"],
    parts: [
      {
        key: "title",
        label: "Title",
        hint: "“Show HN: Name – what it does”, plainly.",
        role: "title",
        prefix: "Show HN: ",
        limits: [{ max: 80, unit: "chars", kind: "observed", verified: "secondary", source: SRC.hnTitle }],
      },
      { key: "body", label: "Text", hint: "What it is, why you built it, how it works, what's rough, what feedback you want.", role: "body", multiline: true, limits: [house({ min: 80, max: 300, unit: "words" })] },
    ],
    options: 3,
    tier: "operator",
    reading: "on Hacker News, skeptical of marketing, curious about how things work",
    rules: [
      // https://news.ycombinator.com/showhn.html
      "Show HN is for something you've made that people can play with now, and you'll be in the thread to discuss it. Not a landing page, sign-up page, waitlist, fundraiser or blog post.",
      // https://news.ycombinator.com/newsguidelines.html
      "Title: no uppercase for emphasis, no exclamation points, no promotional adjectives, no editorializing.",
      "Write like an engineer explaining to engineers: what it does, how it works, what's different, what's still rough.",
      "Never ask for upvotes or comments-for-votes.",
    ],
    preview: "doc",
    defaultOccasion: "launch",
    occasions: ["launch", "feature"],
  },
  product_hunt: {
    id: "product_hunt",
    label: "Product Hunt",
    group: "launch",
    blurb: "Tagline, description and the maker's first comment.",
    audiences: ["prosumer", "b2c", "developer", "b2b"],
    parts: [
      { key: "tagline", label: "Tagline", hint: "What it does, concretely.", role: "hook", limits: [{ max: 60, unit: "chars", kind: "hard", verified: "official", source: SRC.phLaunch }] },
      {
        key: "description",
        label: "Description",
        hint: "Who it's for, what it does, what's different.",
        role: "body",
        multiline: true,
        // One Product Hunt page says 500; the main-info page says 260. The stricter number holds.
        limits: [{ max: 260, unit: "chars", kind: "hard", verified: "official", source: SRC.phMain }],
      },
      { key: "first_comment", label: "Maker comment", hint: "Why you built it, the story, what's in this launch, what you'd love feedback on.", role: "body", multiline: true, limits: [house({ min: 80, max: 250, unit: "words" })] },
    ],
    options: 3,
    tier: "operator",
    reading: "browsing today's Product Hunt launches, opening the ones whose tagline is specific",
    rules: [
      "The tagline says what it does; Product Hunt asks taglines to avoid catchphrases and slogans. The name field is the product name only (https://help.producthunt.com/en/articles/5473056-how-to-post-main-info).",
      "Never ask for upvotes: Product Hunt can disqualify the launch. Ask people to try it and leave feedback (https://www.producthunt.com/launch/sharing-your-launch).",
      "The maker comment sounds like a person: one story, one honest limitation, one question.",
    ],
    preview: "store",
    defaultOccasion: "launch",
    occasions: ["launch", "feature"],
  },

  /* ───────────── Email ───────────── */
  email_announcement: {
    id: "email_announcement",
    label: "Announcement email",
    group: "launch",
    blurb: "To your users, waitlist or newsletter: what's new and why it matters.",
    audiences: ["b2c", "prosumer", "b2b", "developer"],
    parts: [
      {
        key: "subject",
        label: "Subject",
        hint: "Specific. The hook is in the first 35–40 characters on a phone.",
        role: "hook",
        limits: [
          { max: 60, unit: "chars", kind: "recommended", verified: "official", source: SRC.mailchimp },
          { max: 9, unit: "words", kind: "recommended", verified: "official", source: SRC.mailchimp },
        ],
      },
      { key: "preheader", label: "Preview text", hint: "Continues the subject; never repeats it.", role: "meta", limits: [{ max: 90, unit: "chars", kind: "recommended", verified: "official", source: SRC.litmus }] },
      { key: "body", label: "Body", hint: "What's new, what they can do now, one link.", role: "body", multiline: true, limits: [house({ min: 50, max: 220, unit: "words" })] },
      { key: "cta", label: "Button", hint: "What happens when they click.", role: "cta", limits: [house({ max: 5, unit: "words" })] },
    ],
    options: 3,
    tier: "operator",
    reading: "triaging their inbox on a phone, deciding from the subject and preview whether to open",
    rules: ["One announcement per email.", "Write from the founder, by name, to people who signed up. No \"Dear valued customer\"."],
    preview: "email",
    defaultOccasion: "launch",
  },

  /* ───────────── Ads & creative ───────────── */
  meta_ad: {
    id: "meta_ad",
    label: "Facebook / Instagram ad",
    group: "ads",
    blurb: "Primary text, headline and description for a feed ad.",
    audiences: ["b2c", "prosumer", "developer", "b2b"],
    parts: [
      {
        key: "primary",
        label: "Primary text",
        hint: "The hook is the first sentence; the rest may be cut.",
        role: "hook",
        multiline: true,
        limits: [
          { max: 1024, unit: "chars", kind: "hard", verified: "official", source: SRC.metaApi },
          { min: 50, max: 150, unit: "chars", kind: "recommended", verified: "official", source: SRC.metaImage },
        ],
      },
      {
        key: "headline",
        label: "Headline",
        hint: "Under the image: the offer or the outcome.",
        role: "title",
        limits: [
          { max: 255, unit: "chars", kind: "hard", verified: "official", source: SRC.metaApi },
          { max: 27, unit: "chars", kind: "recommended", verified: "official", source: SRC.metaImage },
        ],
      },
      { key: "description", label: "Description", hint: "Optional supporting line.", role: "meta", optional: true, limits: [{ max: 255, unit: "chars", kind: "hard", verified: "official", source: SRC.metaApi }, house({ max: 30, unit: "chars" })] },
    ],
    options: 5,
    tier: "operator",
    reading: "thumbing through Instagram or Facebook, not looking for anything",
    rules: ["The first sentence is the ad. Assume nothing after it is read.", "Write like a person posting, not a brand advertising."],
    preview: "feed",
    defaultOccasion: "evergreen",
  },
  linkedin_ad: {
    id: "linkedin_ad",
    label: "LinkedIn ad",
    group: "ads",
    blurb: "Sponsored content for a buyer: intro text and headline.",
    audiences: ["b2b", "developer", "prosumer", "b2c"],
    parts: [
      {
        key: "intro",
        label: "Intro text",
        hint: "Keep the point in the first 150 characters, where LinkedIn truncates.",
        role: "hook",
        multiline: true,
        // LinkedIn's current page says 3,000 maximum (an older copy said 600); 150 avoids truncation.
        limits: [
          { max: 3000, unit: "chars", kind: "hard", verified: "official", source: SRC.liAds },
          { max: 150, unit: "chars", kind: "recommended", verified: "official", source: SRC.liAds },
        ],
      },
      {
        key: "headline",
        label: "Headline",
        hint: "Under the image: the offer or the outcome.",
        role: "title",
        limits: [
          { max: 200, unit: "chars", kind: "hard", verified: "official", source: SRC.liAds },
          { max: 70, unit: "chars", kind: "recommended", verified: "official", source: SRC.liAds },
        ],
      },
    ],
    options: 5,
    tier: "operator",
    reading: "scrolling LinkedIn at work; one person on a buying committee who answers to others",
    rules: ["Speak to one role on the buying committee and the number they're measured on.", "Offer something worth the click: a tool, a benchmark, a demo of their case. Not \"Learn more about our platform\"."],
    preview: "feed",
    defaultOccasion: "evergreen",
  },
  search_ad: {
    id: "search_ad",
    label: "Google search ad",
    group: "ads",
    blurb: "Responsive search ad: headlines and descriptions Google mixes.",
    audiences: ["b2b", "b2c", "prosumer", "developer"],
    parts: [
      {
        key: "headlines",
        label: "Headlines",
        hint: "One per line, 8–15 of them. Any two must make sense together.",
        role: "list",
        multiline: true,
        list: { split: "lines", min: 3, max: 15 },
        limits: [{ max: 30, unit: "chars", kind: "hard", verified: "official", source: SRC.rsa }],
      },
      {
        key: "descriptions",
        label: "Descriptions",
        hint: "One per line, 2–4 of them.",
        role: "list",
        multiline: true,
        list: { split: "lines", min: 2, max: 4 },
        limits: [{ max: 90, unit: "chars", kind: "hard", verified: "official", source: SRC.rsa }],
      },
      { key: "path", label: "Display path", hint: "Up to two words for the URL, e.g. pricing/teams.", role: "meta", optional: true, limits: [{ max: 31, unit: "chars", kind: "hard", verified: "official", source: SRC.rsaPath }] },
    ],
    options: 2,
    tier: "operator",
    reading: "searching with a problem in mind, comparing the top results in a second",
    rules: ["Match the words they searched. Mix in proof, the offer and who it's for.", "Every headline must stand alone; Google shows them in any order."],
    preview: "search",
    defaultOccasion: "evergreen",
    occasions: ["evergreen", "launch", "feature"],
  },
  image: {
    id: "image",
    label: "Social image or ad creative",
    group: "ads",
    blurb: "The words on the image, what the image shows, and its alt text.",
    audiences: ["b2c", "prosumer", "b2b", "developer"],
    parts: [
      { key: "headline", label: "On-image headline", hint: "Big type. Few words.", role: "hook", limits: [house({ max: 7, unit: "words" }), house({ max: 50, unit: "chars" })] },
      { key: "support", label: "Supporting line", hint: "Optional small line.", role: "body", optional: true, limits: [house({ max: 12, unit: "words" })] },
      { key: "cta", label: "Button text", hint: "Optional.", role: "cta", optional: true, limits: [house({ max: 4, unit: "words" })] },
      { key: "visual", label: "What the image shows", hint: "The real product, a real moment, a real person. Specific enough to shoot or design.", role: "visual", multiline: true, limits: [house({ max: 70, unit: "words" })] },
      { key: "alt", label: "Alt text", hint: "What a screen reader should say.", role: "meta", limits: [house({ max: 250, unit: "chars" })] },
    ],
    options: 5,
    tier: "operator",
    reading: "scrolling a feed where the image decides whether the words get read",
    rules: [
      "Meta reports images with under 20% text tend to perform better (https://www.facebook.com/business/help/980593475366490). Keep on-image text short.",
      "Show the product doing the thing, or the moment of the problem. No stock-photo handshakes, robots, glowing brains or rockets.",
      "Keep text out of the safe zones the platform covers (Reels: top 14%, bottom 35%, 6% each side).",
    ],
    preview: "image",
    aspects: [
      { label: "4:5 feed", w: 1080, h: 1350, note: "Meta's recommended feed ratio", source: SRC.metaFeed },
      { label: "1:1 square", w: 1080, h: 1080 },
      { label: "1.91:1 link", w: 1200, h: 628, note: "LinkedIn single image", source: SRC.liAds },
      { label: "9:16 Reels", w: 1080, h: 1920, safe: { top: 0.14, bottom: 0.35, side: 0.06 }, note: "Keep text out of the shaded areas", source: SRC.metaReels },
    ],
    defaultOccasion: "evergreen",
  },
  short_video: {
    id: "short_video",
    label: "Short video script",
    group: "ads",
    blurb: "Reels, TikTok, Shorts: the hook, the beats and the caption.",
    audiences: ["b2c", "prosumer", "developer", "b2b"],
    parts: [
      { key: "hook", label: "Hook (first 3 seconds)", hint: "What's said and shown before anyone decides to scroll.", role: "hook", limits: [house({ max: 14, unit: "words" })] },
      { key: "onscreen", label: "On-screen text", hint: "The hook as text, for people watching muted.", role: "hook", limits: [house({ max: 8, unit: "words" })] },
      { key: "beats", label: "Beats", hint: "One line per beat: what we see, what's said. 3–8 beats.", role: "list", multiline: true, list: { split: "lines", min: 3, max: 8 }, limits: [house({ max: 30, unit: "words" })] },
      { key: "cta", label: "Ending", hint: "What to do next, said and shown.", role: "cta", limits: [house({ max: 12, unit: "words" })] },
      {
        key: "caption",
        label: "Caption",
        hint: "Ad text under the video.",
        role: "meta",
        limits: [
          { max: 100, unit: "chars", kind: "hard", verified: "official", source: SRC.tiktokSpecs },
          { min: 4, max: 60, unit: "chars", kind: "recommended", verified: "official", source: SRC.tiktokSpecs },
        ],
      },
    ],
    options: 3,
    tier: "operator",
    reading: "swiping vertical video with the sound on, deciding in about three seconds",
    rules: [
      "TikTok's own creative guidance: the value lands in the first 3 seconds, sound on, shot vertical (https://ads.tiktok.com/resources/help/article/creative-best-practices).",
      "Show the product in use by a person, in the place they'd really use it. Native to the feed, not a commercial.",
      "Every beat is filmable: a place, an action, a line of dialogue.",
    ],
    preview: "video",
    aspects: [{ label: "9:16", w: 1080, h: 1920, safe: { top: 0.14, bottom: 0.35, side: 0.06 }, source: SRC.metaReels }],
    defaultOccasion: "evergreen",
  },
  creator_brief: {
    id: "creator_brief",
    label: "Creator brief",
    group: "ads",
    blurb: "A brief for a creator or customer to make their own video about you.",
    audiences: ["b2c", "prosumer", "developer", "b2b"],
    parts: [
      { key: "one_thing", label: "The one thing to show", hint: "The single moment the video must capture.", role: "hook", limits: [house({ max: 30, unit: "words" })] },
      { key: "hooks", label: "Hook ideas", hint: "3–5 opening lines in the creator's own voice. One per line.", role: "list", multiline: true, list: { split: "lines", min: 3, max: 5 }, limits: [house({ max: 16, unit: "words" })] },
      { key: "facts", label: "Facts they can say", hint: "Only receipts. One per line.", role: "list", multiline: true, list: { split: "lines", min: 1, max: 6 }, limits: [house({ max: 25, unit: "words" })] },
      { key: "avoid", label: "Don't say", hint: "Claims they must not make. One per line.", role: "list", multiline: true, list: { split: "lines", min: 1, max: 6 }, limits: [house({ max: 20, unit: "words" })] },
      { key: "cta", label: "Ending", hint: "What viewers should do.", role: "cta", limits: [house({ max: 15, unit: "words" })] },
    ],
    options: 2,
    tier: "operator",
    reading: "a creator deciding whether this brief lets them make something their audience will like",
    rules: [
      "Give creators the one thing to show and the facts; let them say it their way.",
      "Paid or gifted creators must disclose the relationship (#ad or the platform's paid-partnership label). Say so in the brief.",
      "Facts they can say come only from receipts. Anything else goes under Don't say.",
    ],
    preview: "doc",
    defaultOccasion: "evergreen",
  },

  /* ───────────── Web & stores ───────────── */
  app_store: {
    id: "app_store",
    label: "App Store listing",
    group: "web",
    blurb: "Name, subtitle, promotional text and the opening of the description.",
    audiences: ["b2c", "prosumer", "developer", "b2b"],
    parts: [
      { key: "name", label: "App name", hint: "The name, plus a few words only if they help search.", role: "title", limits: [{ max: 30, unit: "chars", kind: "hard", verified: "fetched", source: SRC.apple }] },
      { key: "subtitle", label: "Subtitle", hint: "What it does, concretely.", role: "hook", limits: [{ max: 30, unit: "chars", kind: "hard", verified: "fetched", source: SRC.apple }] },
      { key: "promo", label: "Promotional text", hint: "What's new or why now. You can change it without a new release.", role: "body", limits: [{ max: 170, unit: "chars", kind: "hard", verified: "fetched", source: SRC.apple }] },
      { key: "play_short", label: "Google Play short description", hint: "Optional, for the Play Store.", role: "body", optional: true, limits: [{ max: 80, unit: "chars", kind: "hard", verified: "official", source: SRC.play }] },
      { key: "description", label: "Description opening", hint: "The first lines people see before “more”.", role: "body", multiline: true, limits: [{ max: 4000, unit: "chars", kind: "hard", verified: "official", source: SRC.play }, house({ max: 60, unit: "words" })] },
    ],
    options: 3,
    tier: "operator",
    reading: "comparing three apps in a store search, reading the subtitle and the first screenshot",
    rules: ["Lead with the job it does in the reader's words.", "No \"the best\" or \"#1\" without a receipt."],
    preview: "store",
    defaultOccasion: "evergreen",
    occasions: ["evergreen", "launch", "feature"],
  },
  waitlist_page: {
    id: "waitlist_page",
    label: "Waitlist page",
    group: "web",
    blurb: "Headline, subhead, button and the line that gets people to share.",
    audiences: ["b2c", "prosumer", "developer", "b2b"],
    parts: [
      { key: "headline", label: "Headline", hint: "What they'll get, specifically.", role: "hook", limits: [house({ max: 10, unit: "words" })] },
      { key: "subhead", label: "Subhead", hint: "Who it's for, when, and why it's worth waiting for.", role: "body", limits: [house({ max: 28, unit: "words" })] },
      { key: "cta", label: "Button", hint: "2–4 words.", role: "cta", limits: [house({ max: 4, unit: "words" })] },
      { key: "share", label: "Share line", hint: "After sign-up: why to invite someone. Optional.", role: "meta", optional: true, limits: [house({ max: 24, unit: "words" })] },
    ],
    options: 3,
    tier: "operator",
    reading: "clicking through from a post, deciding whether to leave an email for something that doesn't exist yet",
    rules: ["Say when access opens, if you know. Never invent a waitlist size or a spot number."],
    preview: "hero",
    defaultOccasion: "launch",
    occasions: ["launch", "evergreen"],
  },
  comparison_page: {
    id: "comparison_page",
    label: "Comparison page",
    group: "web",
    blurb: "Us versus an alternative, honestly, including when they're the better pick.",
    audiences: ["b2b", "developer", "prosumer", "b2c"],
    parts: [
      { key: "h1", label: "Headline", hint: "Name the alternative and the real difference.", role: "hook", limits: [house({ max: 12, unit: "words" })] },
      { key: "subhead", label: "Subhead", hint: "Who should pick which.", role: "body", limits: [house({ max: 30, unit: "words" })] },
      { key: "rows", label: "Rows", hint: "Topic | Us | Them, one per line. 4–8 rows. Only checkable facts.", role: "list", multiline: true, list: { split: "lines", min: 4, max: 8 }, limits: [house({ max: 30, unit: "words" })] },
      { key: "when_them", label: "When they're the better pick", hint: "One honest paragraph.", role: "body", multiline: true, limits: [house({ max: 60, unit: "words" })] },
      { key: "cta", label: "Button", hint: "2–5 words.", role: "cta", limits: [house({ max: 5, unit: "words" })] },
    ],
    options: 2,
    tier: "operator",
    reading: "evaluating two tools side by side, suspicious of any page that says the vendor wins every row",
    rules: [
      "Comparative claims must be truthful and substantiated (FTC policy on comparative advertising, https://www.ftc.gov/legal-library/browse/statement-policy-regarding-comparative-advertising). Facts about them come from their public pages, dated.",
      "Include where they win. A page that wins every row reads as an ad and loses trust.",
      "Never disparage. State differences.",
    ],
    preview: "page",
    defaultOccasion: "evergreen",
    occasions: ["evergreen"],
  },
  changelog: {
    id: "changelog",
    label: "Changelog entry",
    group: "launch",
    blurb: "What shipped, written for the person who'll use it.",
    audiences: ["developer", "b2b", "prosumer", "b2c"],
    parts: [
      { key: "title", label: "Title", hint: "What you can now do.", role: "title", limits: [house({ max: 10, unit: "words" })] },
      { key: "body", label: "Body", hint: "What changed, how to use it, what's next. Short.", role: "body", multiline: true, limits: [house({ min: 30, max: 200, unit: "words" })] },
    ],
    options: 3,
    tier: "operator",
    reading: "a user skimming what's new to see if the thing they asked for shipped",
    rules: ["Lead with what the reader can do now, not what the team did.", "Credit the users who asked for it, if they agreed to be named."],
    preview: "doc",
    defaultOccasion: "feature",
    occasions: ["feature", "launch"],
  },

  /* ───────────── Proof ───────────── */
  customer_story: {
    id: "customer_story",
    label: "Customer story",
    group: "proof",
    blurb: "A short case study post from a real result.",
    audiences: ["b2b", "prosumer", "developer", "b2c"],
    parts: [
      { key: "headline", label: "Headline", hint: "The result, with the number if there is one.", role: "hook", limits: [house({ max: 14, unit: "words" })] },
      { key: "body", label: "Story", hint: "Before, the moment it changed, after. Their words where you have them.", role: "body", multiline: true, limits: [house({ min: 80, max: 300, unit: "words" })] },
      { key: "quote", label: "Quote", hint: "Only a quote you have permission to use. Leave empty otherwise.", role: "meta", optional: true, limits: [house({ max: 45, unit: "words" })] },
    ],
    options: 2,
    tier: "operator",
    reading: "a buyer in the same seat as the customer, checking whether this would work for them",
    rules: [
      "Name the customer only when the claim's permission is public; otherwise describe them (\"a 40-person logistics company\").",
      "Every number comes from an approved claim or the founder's material, exactly as written.",
    ],
    preview: "doc",
    defaultOccasion: "customer_win",
    occasions: ["customer_win", "milestone"],
    needs: "customer_proof",
  },
};

export const FORMAT_IDS = Object.keys(FORMATS) as StudioFormatId[];

export const GROUPS: { id: FormatGroup; label: string }[] = [
  { id: "positioning", label: "Words that define you" },
  { id: "launch", label: "Launch and news" },
  { id: "social", label: "Social and community" },
  { id: "ads", label: "Ads and creative" },
  { id: "web", label: "Web and app stores" },
  { id: "proof", label: "Proof" },
];

export const AUDIENCES: Record<StudioAudience, { label: string; blurb: string; reader: string }> = {
  b2b: { label: "Businesses", blurb: "A team buys it; several people sign off.", reader: "a busy manager who answers to a boss and a budget" },
  prosumer: { label: "Professionals", blurb: "People buy it for their own work.", reader: "a professional who pays for tools that save them real time" },
  developer: { label: "Developers", blurb: "Engineers try it before anyone buys.", reader: "a software engineer who distrusts marketing and reads the docs first" },
  b2c: { label: "Consumers", blurb: "People buy it for themselves.", reader: "someone scrolling on their phone, not looking for anything" },
};

export const OCCASIONS: Record<StudioOccasion, { label: string; guide: string }> = {
  evergreen: { label: "No news", guide: "No announcement: sell the change the product makes, with the strongest receipt." },
  launch: { label: "Launch", guide: "Something new exists today. Show it working; say who it's for and what's rough." },
  feature: { label: "New feature", guide: "One thing users can now do. Lead with the job, credit who asked." },
  funding: { label: "Funding", guide: "Say what the money is for and what that means for users. Thank people by name only with permission." },
  milestone: { label: "Milestone", guide: "A number reached. Say what it means for the reader, not only for you." },
  customer_win: { label: "Customer result", guide: "A real customer outcome, told as their story with their numbers." },
  lesson: { label: "Lesson", guide: "Something the founder learned first-hand that the reader can use without buying anything." },
  data_drop: { label: "Data", guide: "A finding from data only you have. Method in one line; one surprising number first." },
  hiring: { label: "Hiring", guide: "The work, the problem, who'd love it. Not perks." },
  event: { label: "Event", guide: "Who it's for, what they'll leave with, when and where." },
};

/* ───────────── Counting ───────────── */

const URL_RE = /https?:\/\/\S+|\bwww\.\S+/gi;
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** X's weighted count: each URL is 23, wide (CJK) characters count 2, everything else 1 per code point. */
export function weightedLength(text: string): number {
  let n = 0;
  const rest = text.replace(URL_RE, () => {
    n += 23;
    return "";
  });
  for (const ch of rest) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

export function measure(text: string, unit: Limit["unit"]): number {
  if (unit === "words") return countWords(text);
  if (unit === "weighted") return weightedLength(text);
  return [...text].length;
}

/** The items of a list part: lines, or posts split by a line holding only "---". */
export function listItems(part: PartSpec, text: string): string[] {
  if (!part.list) return [text];
  const raw = part.list.split === "posts" ? text.split(/\n\s*-{3,}\s*\n/) : text.split("\n");
  return raw.map((s) => s.trim()).filter(Boolean);
}

/** Formats in picker order for an audience: the ones that suit it first, then the rest. */
export function formatsFor(audience: StudioAudience): FormatSpec[] {
  const all = FORMAT_IDS.map((id) => FORMATS[id]);
  return [...all].sort((a, b) => rankFor(a, audience) - rankFor(b, audience));
}

function rankFor(f: FormatSpec, audience: StudioAudience): number {
  const i = f.audiences.indexOf(audience);
  return i === -1 ? 9 : i;
}

/** The limit a counter shows: the tightest one with a max in the part's own unit, hard first. */
export function headlineLimit(part: PartSpec): Limit | undefined {
  const withMax = part.limits.filter((l) => l.max !== undefined);
  return withMax.find((l) => l.kind === "hard" && l.unit !== "words") ?? withMax.find((l) => l.kind !== "hard") ?? withMax[0];
}
