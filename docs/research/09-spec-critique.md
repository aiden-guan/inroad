# Inroad v1 spec review: Jobs on taste, a 3× YC GTM head on substance

**Verdict.** The positioning is right ("founders × judgment", no sending, receipts), and so are the evidence ledger and the code-ranked moves. But the spec is ~2× too big. It builds a Salesforce-shaped pipeline and an events product for founders who have 0–3 deals. Its own defaults also contradict each other: the funnel math cannot work under its own send cap. The real risk is the writing. The prompts encode the 2024 Lavender/Braun playbook ("Saw X → usually means Y → peers did Z → Worth a look?"), which every Clay+LLM stack now sends at scale. Inroad's drafts will look like AI-SDR email with nicer citations.

*Method note: the shared web-search budget ran out at the start of this review. Claims here were checked with direct fetches of primary pages, the bundled Claude API docs, the local scaffold (`src/lib/ai/*.ts`, `node_modules/next/dist/docs`), and computation (contrast ratios, hues, funnel math, sample sizes). Anything I couldn't verify is labeled.*

---

## 1. Confusing or overbuilt: cut or merge

| # | What the spec has | Problem | Change |
|---|---|---|---|
| 1 | **5 surfaces** (Today, Accounts, Pipeline, Events, Playbook) | Accounts and Pipeline show the same entity: an `Account` with a `dealId`. Events is a second product. A pre-PMF founder has no city cluster, no customers to host, and no $3.5–7K a month. | **3 surfaces.** **Today** · **Companies** (one list with a segmented control: *Prospects / Talking / Customers*; *Talking* has a Board toggle) · **Playbook**. Events moves to v1.1. In v1 a virtual roundtable is just a move type. Navigation: `G T / G C / G P`. |
| 2 | **10 stages** (Contacted → Engaged → Discovery → Qualified → Solution → Pilot → Proposal → Won/Lost/Nurture) | Contacted and Engaged are *touches*, not deals. They will fill the board with 25 cards a week, and "Solution" vs "Pilot" vs "Proposal" means nothing at n=3. | **6 stages:** Talking (first meeting held) · Qualified · Pilot · Proposal · Won · Lost/Nurture. Touches stay on the person's timeline. |
| 3 | **SPICED and MEDDICC-lite**, both, plus a 0–12 ring | "Pain" appears twice. Two frameworks, one score, three UI blocks. | **One qualification card:** the 6 score dimensions (Pain, Spend, Critical event, Champion, Economic buyer, Fit) plus *Decision & paper process*. The fields and the score become the same object. |
| 4 | **Today** has 5 regions: brief header + 5-metric strip, "Three things that matter", Your moves, Everything else, Weekly card, Close-out bar | A fact without an action is noise. "Northwind posted the role" belongs on a move ("Write to Dana: Northwind posted the role"). | Today = a masthead with **one** number ("4 of 10 conversations this week"), then ≤5 moves, then "Later (n)". Monday and Friday reviews, close-out and founder questions are **moves**, not panels. |
| 5 | **Composer**: a 760px modal over a 560px sheet over a list. The Ask panel (440px, right) and the side sheet (560px, right) have no defined rule for coexisting. | Three layers deep, and two right-docked layers collide. | **Never stack.** Compose expands inside the move card on Today, or the sheet widens to 880px. When a sheet is open, Ask becomes a thread inside it. |
| 6 | **3 touch-1 variants** + the full sequence + LinkedIn note + DM on every compose, each critiqued, plus a checks panel (words, grade, you:I, evidence, critic score) | About 3× the tokens and real choice paralysis. Variants are mostly paraphrases. Critic scores mean nothing to a founder. | **One draft.** `]` = "different angle" (a new angle, not a paraphrase), generated lazily. Follow-ups are generated when they come due, not up front. The checks panel collapses to one line ("Ready" or the single worst issue). |
| 7 | **Playbook: 11 sections** | It reads like a consulting deliverable. | **5:** Who (ICP, anti-ICP, personas) · Why us (positioning, claims, proof) · How we sell (channels, pricing, objections) · Voice · Journal. Connectors move to the network import (§2). |
| 8 | **First-run foundation: 7 sections** (including channel plan with funnel math and "How you'll charge") | Pricing and channel math generated from a marketing site is confident fiction, and it adds ~45s before value. | First run = **snapshot + positioning + ICP bet** only. Commercial advice is generated when the first deal reaches Qualified. The channel plan is generated at the first Monday review. |
| 9 | **The offer letter with "Hold to hire"** | (a) Hold is also the guard for *Close lost* and *Delete person*. The same gesture for joy and for destruction is a semantic collision. (b) "Hire" framing contradicts your own Air AI / "replaces employees" argument. (c) It's cute, but the founder's magic moment is *names of companies to email*, not a contract. | Replace it with **"Here's who I'd talk to first"**: 3 accounts with why-now and warm-path count, the ICP sentence labeled as a bet, and the 4-line working agreement (keep that copy, it's the best trust copy in the spec). CTA: **Research these 3 ↵**. |
| 10 | **Day-1 moves**: 4 of 5 are homework (questions, lock segment, import, sender details) | This is the setup wizard the design law bans, in disguise. | Ask sender details **just in time**, on the first email approve. Founder questions are asked *during* the reading phase (§4.6). The first move must be a real company with a draft. |
| 11 | **Two brand names** (Inroad + Ember) for one thing: "Ask Ember", "Hire Ember", Inroad wordmark | Doubles the cognitive load. Granola has no agent name. Linear's guideline requires an AI *badge*, not a name. | Consider one name: the orb + `AI` badge + first person ("I found 3 accounts…"). If Ember stays, never show "Inroad" and "Ember" in the same sentence. |
| 12 | **Infrastructure**: 06:00 scheduler via `instrumentation.ts`, job queue, RunRegistry | The app runs on a laptop. At 06:00 the lid is closed. | Keep RunRegistry (reattach after reload). Drop the scheduler: prepare on first open, and show carry-over moves instantly. |
| 13 | **Rigid weekday rituals** (Tue post, Wed intros, Thu events) | Founders' weeks don't run like that, and missing a Wednesday means missing the intro ritual. | Weekly **quotas** ("3 intro asks this week") that surface as moves when they're due. Keep Monday and Friday. |
| 14 | **Close-out disables "Done for today"** | Nagware. People will just close the tab. | Make it a move with a count. Never disable a button the user can't satisfy in 30 seconds. |
| 15 | **"Hiring readiness" every Friday**; pipeline header showing coverage, win rate and median cycle | At n<10 closed deals these numbers are noise in a dashboard costume. | Hide them until 10 deals have closed. Hiring readiness becomes monthly, or appears once thresholds are near. |

---

## 2. What's missing that matters most for landing clients (ranked)

1. **Start from warm assets, not cold discovery.** The spec's own trust order puts the founder network first, yet the first run is website → ICP → `yc_companies`/ATS cold discovery, and connections are only a *join* onto those cold accounts. Flip it:
   - **Import anything warm:** LinkedIn Connections.csv, waitlist or signup CSV, Stripe or app users, GitHub stargazers (`github_org` exists already), and past conversation names.
   - Ember screens these for ICP fit **locally** and produces *"37 of your 1,240 connections work at ICP companies; 6 are buyer titles."*
   - This is the reactivation motion Lemkin calls "money" (landscape research). Expect it to be the #1 source of the first 10 customers.
   - Constraint: Connections.csv includes email "only for connections who have allowed their connections to see or download their email address" (https://www.linkedin.com/help/linkedin/answer/a566336). So these paths are LinkedIn DM or intro, not email. Design for that.
2. **Champion job-change detection, free and legitimate.** It's your strongest signal (strength 3), and the spec has no way to detect it. Fix:
   - Prompt a monthly re-import of Connections.csv.
   - Diff `Company`/`Position` per person → `champion_job_change` signal when a past user, design partner or ex-colleague moves to an ICP company.
   - No scraping, no LinkedIn fetch.
3. **An asset library**, because your CTAs promise assets that don't exist. The spec's own examples say "Want the one-pager?" and "offer a perspective or resource, not a meeting" (`problem_prompter`), and Ember never produces a resource.
   - Add a Playbook *Assets* list: one-pager, 2-minute demo script, security-posture page, design-partner terms, and one "insight" asset (e.g. "what we learned from 30 calls").
   - Lint `ASSET_MISSING`: a CTA that offers a resource must reference an existing asset id.
4. **A design-partner program kit.** For pre-revenue founders (your core user) this *is* the GTM, yet it only exists as a `Motion` enum and a commercial default. Ship:
   - a selection scorecard;
   - a terms sheet (10–20% upfront, 2–6 months, written conversion date and price, exec + technical + business contacts: https://review.firstround.com/sierra-design-partnership/);
   - a kickoff agenda;
   - a weekly-standup debrief template.

   This matters more than dinners.
5. **An outcome-capture loop that works without inbox access.** Every Friday review, experiment and reply rate depends on the founder pasting replies, and they won't paste most of them, so reply rates will read low and the learning loop starves. Fix, within the v1 constraints:
   - A daily **"Check replies"** move with a single Gmail search deeplink covering everyone touched in the last 14 days: `https://mail.google.com/mail/u/?authuser={u}#search/from:(a@x.com OR b@y.com …)` (split by URL length).
   - The founder sees all replies at once, then marks each person **R** (replied, then paste), **N** (no reply) or **B** (bounced) with one key.
   - "Approve = sent" gets reconciled here the next morning.
6. **A founder POV bank.** The only thing an AI-SDR stack can't copy is the founder's first-hand insight. Collect 5–10 opinions with one-line evidence ("From 30 calls with platform leads: nobody budgets for X until Y breaks"). Sources: the onboarding questions, debriefs (`customerWords`, `newObjections`) and an explicit prompt. Every cold draft must use a POV item or a founder credential (§4.1).
7. **A scheduling link and availability.** The positive-reply rule says "2 specific times", but Ember doesn't know the founder's calendar. Add `Settings.schedulingUrl` and `availability` ("Tue–Thu 10–16 PT"), used only after the prospect engages.
8. **A one-page pilot proposal and order form** (move it out of non-goals). The first paid pilot stalls on "can you send something over?". It's pure text reuse of debrief, success-criteria and commercial data: Koomen/Blomfield's one-pager, which the research corpus already specifies.
9. **Let the connector mark the list.** The Wednesday flow assumes the founder can see an investor's connections. Many investors hide them. Generate a copy-ready list of ≤20 targets for the **investor** to mark, then generate forwardables only for the marked rows (https://www.ascend.vc/blog/best-practices-for-requesting-warm-intros-from-your-investors).
10. **Schema gaps that break features:**
    - Guest scoring uses `sameCity`, and the dinner trigger needs "≥8 accounts share a city", but no `Account` or `Person` has a city (only `hq.country`). Add `Account.hqCity` and `Person.location` with evidence ids.
    - `Person.jurisdiction` has no source. GDPR follows the *person*: a US company's Berlin employee is EU. Derive it from the person's location evidence, or mark it `unknown` and apply the strictest footer.

---

## 3. Where the GTM expertise is wrong, generic or outdated

1. **The default funnel can't work under your own cap.** With 20 customers / 26 weeks / win .25 / disc→qual .5 / warm .4 / meeting rate .04:

   | Step | Spec defaults | Under the 25/week cap |
   |---|---|---|
   | Qualified opportunities | 80 | 80 |
   | Discovery calls | 160 | 160 |
   | Cold meetings | 96 | 26 (650 contacts × 4%) |
   | Cold contacts | 2,400 (**92 a week**) | 650 total |
   | Warm share needed | 40% | **84%** (76% even at a 6% meeting rate) |

   - The channel-plan warning fires on day 1, forever, and the scoreboard sits red.
   - Fix: make the goal an **output**. "At 25 signal-backed touches/week plus your network, the realistic target is N paid pilots by {date}. Want to raise warm intros to close the gap?"
   - Default the first goal to **5 paid pilots or design partners in 12 weeks**. Keep "20" as the long arc.
   - State plainly whether LinkedIn DMs and intro asks count against the 25 cap. Recommendation: the cap covers **cold email first touches only**.
2. **The weekly A/B experiment is statistically impossible at founder volume** (two-proportion test, α=.05, power .8):

   | Comparison | Needed per arm | Weeks at 25 touches/week |
   |---|---|---|
   | 10% vs 15% reply | 686 | 55 |
   | 5% vs 10% | 434 | 35 |
   | 5% vs 15% | 140 | 11 |

   - "Exactly ONE experiment… a success threshold, a sample size" will produce false conclusions every Friday.
   - Replace it with a **monthly message bet** judged qualitatively: read every reply, count *positive* replies, tag objections.
   - Keep the variant tags for later. No pass/fail verdicts below n=100 per arm.
3. **The speed-to-lead "~7×" claim is misapplied, and it's in a prompt example.** The source is HBR 2011, "The Short Life of *Online Sales Leads*" (https://hbr.org/2011/03/the-short-life-of-online-sales-leads; record at https://scholarsarchive.byu.edu/facpub/9711): inbound web queries, not replies to founder cold email. Your own `NUMBER_UNSOURCED` rule would reject this copy. The timer also starts when the reply is *pasted*, not received.
   - Fix the copy to *"Replied 40 min ago."* and stop there.
   - Add an optional "received at" field when pasting.
4. **The frames are the 2024 playbook, now mass-produced.**
   - 4T, Mouse Trap, Problem Prompter, "Worth a look?", "might be off base", and lowercase 2-word subjects were differentiated when Lavender and Braun published them. In 2026 they are the default template of Clay+LLM outbound.
   - The landscape research notes that even autonomous vendors now say they "refuse to spam". A well-targeted, AI-disclosed email still landed as unwelcome with the HN founder (https://dbpro.app/blog/i-posted-on-hacker-news-two-ai-agents-emailed-me).
   - Job-post triggers (`first_hire`, `jd_names_pain`) are the most commoditized signal in the market. They still work, but only with a POV the recipient hasn't heard ten times.
   - Fixes:
     - Default pre-proof founders to **advice and expert-interview asks** (founder_card, First Round's framing).
     - Require a POV-bank item (§2.6).
     - Drop forced lowercase subjects; follow the founder's voice card.
5. **The LinkedIn plan assumes notes you can't send.** Free members get "a personalized message to up to three connection requests per month… up to 200 characters"; Premium gets unlimited (https://www.linkedin.com/help/linkedin/answer/a563153).
   - Default `recommendNoNote=true`. Design the motion as a blank invite, then a post-accept DM.
   - Ask once whether the founder has Premium.
6. **Some signals can't be detected inside your constraints:**
   - `persona_post` (7-day LinkedIn posts) can't be seen, because you never fetch LinkedIn.
   - The 16:00 "LinkedIn engagement block with fresh persona posts" will be empty.

   Swap in sources Ember can actually read: X, Substack, company blogs, podcasts (`podcast_search`), HN comments, GitHub issues.
7. **Price anchors are not segment-aware.** "Enterprise first deals $75–150K; avoid $10K" (Jen Abel) is enterprise advice. The spec's own example ICP is "Series A–B fintechs hiring their first platform engineer", where $15–40K is often the right first contract.
   - Condition `priceAnchor` on ICP employee band.
   - Paid pilot length should derive from time-to-first-value. 7–14 days is Blomfield's AI-support case; integration-heavy infra may need 30.
8. **"Lock your first segment" in 1 minute, from a website guess, is premature.** Call it a **bet**: "Bet on this segment for the next 25 touches". Compare test slices after ≥25 touches with positive-reply counts, not after 50 each (that's 4 weeks at the cap).
9. **Dollar pipeline before any price exists is fake precision.** "Qualified pipeline $180K" for a founder who has never quoted a price is invented. Show a *count* of qualified deals until the first `priceQuotes` entry, then switch to dollars.
10. **Dinners as specified don't fit seed reality.**
    - The 12-seat mix needs 2 customers and an anchor that pre-revenue founders don't have.
    - 50–80 personal invites would consume 2–3 weeks of the outreach cap.
    - The cheapest working version is **borrowing a VC platform team's or co-host's brand** for the invite (SignalFire and BCV, the sources already in the spec), or a 6-person virtual roundtable.

    For v1, ship the roundtable as a move plus 3 templates. Move the full planner to v1.1.
11. **Unverified claim in principle #1.** The "73% avoid suppliers that send irrelevant outreach" figure is attributed to the Gartner release, but the spec's own playbook research says secondary sources cite it. The primary page returned 403 to my fetch. Verify it before it goes into site copy.
12. **Rules that are right; keep them.** Founder sells. Paid by default. Next step or soft no. Champion vs coach. Recap "Did I miss or misstate anything?". Multi-thread at Qualified. Kill or nurture after 14 days with no next step. Hiring two pathfinder AEs.

---

## 4. Slop risks, and prompt and guardrail fixes

**4.1 Template convergence is the #1 risk.** Every cold draft currently runs Signal → Think → Third-party → Interest CTA under identical length and grade rules, so 25 drafts a week will share one skeleton. Fixes:
- **Ban 2025–26 outbound tells.** Add to `BANNED`. Each rule is case-insensitive, and the scope noted applies:
  ```ts
  /^(saw|noticed|looks like|congrats)\b/m,       // line 1 only
  /worth a (look|chat|conversation|quick)\b/,
  /open to (a |learning|exploring|chatting)/,
  /curious (if|whether|how)\b/,
  /teams like yours|companies like yours/,
  /(usually|typically|often) (that|this) means/,
  /might be off base|no worries if not/,
  /the (usual|real) (blocker|problem|issue) isn'?t .{1,40}, it'?s/,
  /i put together/,
  /(quick|short) (teardown|breakdown)/,           // unless assetId set
  /hope (this|it) helps/
  ```
- **Check skeleton diversity across drafts.** Embed the first sentence and the CTA of the week's drafts. If more than 30% share an opener pattern, or any two drafts to *different* accounts have cosine > 0.85 after masking entity names, regenerate the newer one with "vary structure".
- **POV requirement.** `DraftStep.povId | credentialId` is required for `cold` mode. The critic checks that the POV sentence is non-obvious to the persona.
- **Advice-first default.** If `claims.approved.length === 0`, the frame is `founder_card` or an expert-interview ask, never 4T with invented "peers".

**4.2 Lint rules that fail good copy (your own examples break them):**

| Rule | Failure | Fix |
|---|---|---|
| `HYPE` bans `platform`, `solution` | Kills "first platform hire". That is your example subject *and* your example ICP. | Ban only `\bplatforms?\b(?! (team\|engineer\|eng\|lead\|hire))` and the phrase "AI-powered platform". Add a per-workspace allowlist from ICP and persona vocabulary. |
| `FK_GRADE ≤7` | Penalizes "infrastructure", "reconciliation", "Kubernetes". Technical buyers reward precision. | Exclude allowlisted domain terms from syllable counts. Make it a warning, not a fail. |
| `I_OPENER`, `YOU_RATIO` | `founder_card` *is* "I'm building… I built billing infra at Stripe". | Make lint frame-aware: skip both for `founder_card` and `referral`. |
| `NUMBER_UNSOURCED` | Fails "20 minutes", "Tue 2pm", "Q3", "2 times". The forwardable template's "across N teams" invites a fabricated N. | Check only numbers adjacent to claim tokens (`%`, `x`, `$`, customers, teams, hours saved). Delete "N teams" unless the founder supplies N. |

**4.3 Evidence is attached per draft, not per span.** `evidenceIds: ID[]` on a draft is a fig leaf: any id can be attached. Require `personalizedSpans: {text, evidenceId}[]`. In code, verify that each span's entities and numbers appear in the quote. Then ask the critic one yes/no entailment question per span ("does this follow from the quote?"). Render the source chips from the spans.

**4.4 The critic will pass everything.** LLM judges are lenient. A 0–2 × 5 rubric with pass ≥8 compresses to 8–10.
- Calibrate before shipping: collect 40 labeled emails. Ask the founder to paste 5 AI-SDR emails *they* received (every founder has these) as negatives, plus their own sent emails that got replies as positives.
- Switch to **pairwise**: "Which would you answer: A (draft) or B (reference human email)?"
- Gate on the binary `would_reply`. Never show scores.

**4.5 Fixed cardinality forces padding.** "Exactly 5 founder questions", "unknowns ≥3", "3 discovery openers", "2–3 angles", "≤3 matters" daily, "3 themes". Thin evidence plus a required count produces filler. Change every one to "**up to N**; fewer if evidence is thin" and enforce `min(1)` only where needed. Make the brief's "matters" optional.

**4.6 The first-run foundation is fiction derived from a seed-stage website.**
- Use the idle 35–120 seconds: while the ledger streams, ask **two inline, skippable questions**: *"Who are your last 3 users or design partners?"* and *"What were they doing before you?"* Phase B consumes the answers.
- Stamp every foundation section with provenance: *"From your site · 0 conversations confirm this."* That turns the ICP from a claim into a bet.

**4.7 Template the brief in code.** The LLM writing move titles and why lines every morning is a slop generator. Code already knows the person, account, kind and evidence:
- Title: `Reply to {first} at {company}`.
- Why: `{signal.headline} · {age}`.
- Use the LLM only for a "matters" item when one exists. Greeting: deterministic from counts, or none.

**4.8 Debrief "quotes" from shorthand notes.** Founder notes ("CTO keen, budget Q1?") are not buyer quotes. Add `source: "transcript" | "founder_notes"`. The recap's "What I heard in their words" uses verbatim quotes only from transcripts. With notes, paraphrase and lean on "Did I miss anything?".

**4.9 Persona tics.** "Pushes back once" on every response gets grating fast. Restrict pushback to defined triggers: request > cap, unapproved claim, unpaid engagement > 30 days, mass send.

**4.10 Compliance copy that lies.** The EU footer says *"I found your work email on {source host}"*, but `pattern_guess` addresses have no source. Change it to *"I guessed your work email from {company}'s address format"*, or block EU and UK pattern guesses outright (Art. 14 requires the *actual* source: https://gdpr-info.eu/art-14-gdpr/).

**4.11 Engineering corrections** (checked against the bundled Claude API docs and the scaffold):
- ✅ Correct: Opus 5.5 returns 400 on forced `tool_choice` `any`/`tool`, and `output_config.format` is incompatible with citations. **Add `strict: true` to every `submit_*` tool**, and retry when no submit call arrives.
- ❌ *"Two cached system blocks… so the cache keeps hitting"* is only true within one workflow. Cache render order is **tools → system → messages**, and each route has a different client-tool list, so `[EMBER_CORE]` is never shared across routes. Either give every route one identical tool superset (with unused tools disabled by instruction), or accept per-route caches. Use `ttl:"1h"` for bursty runs (classify batches, 5 pre-generated drafts).
- ❌ *"Date in the first user message"* breaks for Ask threads that span days. Under preserved thinking, editing `messages[0]` is rejected for accounts created on or after 2026-08-31. Append the new date and context as a **mid-conversation `role:"system"` message**, which Opus 5.5 supports with no beta. Never edit history.
- ⚠️ The scaffold's `src/lib/ai/models.ts` already routes strategist→Opus, operator→Sonnet 5.5 ($2/$10), fast→Haiku 5.5 ($0.10/$0.50). "Opus 5.5 for every route" is a defensible simplification: one cache namespace, and low effort on a top model often beats a cascade. Except **W3 `classify()`**: 60–300 candidates on Opus at $4/MTok input versus Haiku at $0.10/MTok input is a 40× input-cost gap on your most bulk-heavy step. Build the eval now: the founder's track and dismiss decisions are free labels.

---

## 5. Design critique: stunning, or generic?

It's tasteful, but not distinctive. The research itself calls warm ivory + editorial serif + mono + one accent "the 2025–26 consensus" (Cursor, Anthropic, Harvey, Granola, Cognition, Superhuman, Linear). Specific problems:

1. **The hot color is your competitor's color.** Ember `#E5532D` has hue **12.4°**. 11x's `#C64A2A` is **12.3°**, Anthropic clay `#D97757` / `#C6613F` is 14.8–15.1°, and Cursor `#F54E00` is 19.1°. You are positioned against 11x and wear its hue. Ivory + Instrument Serif + clay-orange also reads as the claude.ai skin, so users will assume an Anthropic demo.
   - Fix: make the identity **structural**, not chromatic (item 2).
   - If you keep the name Ember, shift the hue at least ~10° away from 12–19° and re-check contrast.
   - If you go with one name (§1.11), pick an unowned hue. Avoid orange (Claude, Cursor, 11x), indigo (Linear, Decagon), green (Granola, Sierra) and yellow highlighter (Harvey).
2. **Make "receipts" the signature: sidenotes.**
   - At ≥1280px, citations live in a ~200px right margin aligned to their sentence (Tufte/Distill style): `host · 12d · first 8 words of the quote`. Hover draws a 1px hairline from note to span.
   - Below 1280px, fall back to chips.
   - No competitor makes provenance a layout feature (landscape gap #6). This is the screenshot people will share.
3. **Typography: make the serif the reading face, not decoration.**
   - Inter + Instrument Serif is Raycast's exact pairing (per your own research) and the most common AI-template pairing.
   - Use **Newsreader** (Google Fonts, `opsz` 6–72) for all *agent long-form* text at 17/27: brief, dossier, Playbook, drafts. Keep the sans for UI.
   - Result: everything Ember writes reads like a memo from a senior hire, which is your persona thesis expressed in type.
4. **The draft wash breaks the one-hot-color rule.** Today shows 5 moves with drafts, so 5 peach `accent-subtle` blocks, and ember is everywhere.
   - Drafts become `fg-2` on `surface` with a 1px ember rule.
   - The wash appears **only on the focused card**.
   - Ember is reserved for the orb, "needs you" counts and the cursor.
5. **Contrast fails WCAG AA.** `fg-3 #8F8A82` measures 3.26:1 on `bg`, 3.07:1 on `bg-subtle` (sidebar) and 2.98:1 on `sunken`. You use it for source-chip ages, timestamps and footnotes, which are informational text at 12px (AA needs 4.5:1).
   - Change it to **`#726D65`**: 4.88 / 4.59 / 4.47.
   - `fg-4` measures 1.98:1, so it can't be used for readable "lost" deal text.
6. **Cut the 7 stage hues.** Column position already encodes stage. Color encodes **risk** only: overdue (danger), at risk (warning).
7. **Motion to cut or change:**
   - Per-word blur streaming on all text is the "artificial typing" anti-pattern from your own research, and `filter: blur` on hundreds of spans is expensive. Keep it for the greeting and Ask answers only; structured sections appear whole.
   - Cut the "Learned · 14" counter with an ember sweep on *skips*. It celebrates rejection.
   - The brief reveal should end in ≤600ms total, and any keypress skips it.
   - Orb flight from `/welcome` to `/today`: don't use Motion `layoutId` across a route change. React 19.3's `<ViewTransition name="ember-orb" share="morph" default="none">` works in Next 16's App Router "with no configuration" (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`). Wrap the trigger in a transition.
8. **Phone.** Local-only means the 8am brief can't be read on a phone. That's acceptable for v1, but say so. If you want it in v1.1: a read-only, token-protected LAN view opened from a QR code in Settings.

---

## 6. Prioritized changes

**P0: before any code**
1. Surfaces 5 → 3 (Today · Companies · Playbook). Stages 10 → 6. One qualification card. Events → v1.1, roundtable-only as a move.
2. Rewrite first run: two questions during reading → snapshot + positioning + ICP **bet** → discovery seeded from the answers runs **in parallel** → "Here's who I'd talk to first" (3 accounts) replaces the offer letter and the hold. Sender details just in time.
3. Warm import before cold: Connections.csv, signups and stargazers screened locally for ICP fit. Connections re-import diff → `champion_job_change`.
4. Fix the funnel. The goal becomes an output computed from caps and warm capacity; default 5 paid pilots or design partners in 12 weeks; the cap covers cold email only.
5. Anti-convergence: the new `BANNED` set (§4.1), the cross-draft skeleton check, a required `povId`/`credentialId`, frame-aware lint, scoped `NUMBER_UNSOURCED`, the `platform` allowlist, FK as a warning.
6. Span-level evidence with an entailment check. The critic switches to calibrated pairwise and its scores are hidden.

**P1: v1 scope**
7. Asset library plus `ASSET_MISSING` lint. Design-partner kit. One-page pilot proposal (out of non-goals).
8. "Check replies" Gmail-search move with one-key R/N/B outcomes. Next-morning reconcile of approve = sent.
9. Remove weekly A/B verdicts; monthly message bet; no rates below n=20 (already a rule), no verdicts below 100 per arm.
10. All fixed counts → "up to N". Templated brief titles and why lines. Delete the 7× line.
11. Prices segment-aware; pilot length from time-to-value; dollar pipeline only after the first quote.
12. LinkedIn: `recommendNoNote` defaults to true; ask about Premium; replace `persona_post` and the 16:00 block with fetchable sources.
13. Schema: `Account.hqCity`, `Person.location`, evidence-derived `jurisdiction`, `Settings.schedulingUrl`/`availability`, `Debrief.source`. Fix the EU footer for guessed addresses.
14. Engine: `strict:true` on `submit_*`; date and context via appended mid-conversation system messages; a shared tool superset (or accept per-route caching) plus 1h TTL for bursts; Haiku `classify()` behind a track/dismiss eval.

**P2: design and polish**
15. Sidenote citations at ≥1280px. Newsreader for agent long-form text. Wash on the focused card only. `fg-3 → #726D65`. Drop stage hues.
16. Ember hue off 11x/Claude, or one-name identity with an unowned hue. Drop Instrument Serif.
17. Motion cuts: streaming blur only on greeting and Ask; remove the skip counter; skippable reveal; hold only for destructive actions; orb flight via `<ViewTransition>`.
18. Remove the 06:00 scheduler, rigid weekday rituals, the disabled close-out button, and the weekly hiring-readiness block.

**Relevant local paths:** `src/lib/ai/models.ts` (existing Sonnet/Haiku routing), `src/lib/ai/engine.ts` (single cached system block, `requireTerminal`/nudge, fallbacks beta), `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`. All relative to the repo root.