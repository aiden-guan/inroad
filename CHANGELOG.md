# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [v0.2.21] — 2026-10-29

### Added
- Consumer waitlist tracking on Growth and Integrations, with Convex Cloud, Supabase, Neon and other hosted PostgreSQL databases. Paste one deploy key or connection string; Inroad detects the deployment and waitlist table, asking for a named table choice only when necessary.
- Automatic count refresh every 15 minutes while Inroad is open, manual sync, an optional target, net change with its observation date, and daily history. Database reads fetch metadata and counts without downloading signup records. Failures keep the last good count; disconnecting keeps history and the target.
- A waitlist-first Growth view before product-growth weeks have been logged. Product metrics and weekly forms remain available under “Product growth, after launch.” Existing product-growth logs stay visible.

### Validation
- 1,439 unit tests pass with three skipped; typecheck, lint, the production build and the standalone Mac server build pass. All 66 browser checks pass in GitHub CI, including the six new waitlist checks at phone and desktop widths. Actual adapter requests returned the expected counts from a local Convex backend and a PostgreSQL engine with synthetic records; the PostgreSQL read-only transaction rejected a test write. No private database account was queried.

---

## [v0.2.20] — 2026-10-29

### Fixed
- PostHog active-user imports now handle identified-user properties stored as either strings or booleans, fixing the `String, UInt8` query failure during connection and sync. Anonymous activity remains excluded unless enabled in preferences.
- PostHog query failures show a short retry message instead of database internals. Authentication, permissions and rate-limit errors retain their specific guidance, and failed syncs keep the last successful figures.

### Validation
- 1,420 tests pass with three skipped; typecheck, lint and the production build pass. The original type error was reproduced on ClickHouse's public playground; the actual provider query then returned the expected 1-, 7- and 30-day counts against synthetic string and UInt8 properties, excluding anonymous, missing, out-of-window and nonmatching-event records. No private PostHog account was queried.

---

## [v0.2.19] — 2026-10-29

### Changed
- PostHog setup is now **Connect PostHog → approve access**. Inroad uses browser OAuth sign-in, detects the region and projects, connects automatically when there is one project, and asks for one named choice when there are several. No API key, project ID, region or event settings are required up front.
- Stripe and Polar setup each need one credential and connect immediately on paste. Stripe detects and displays currencies separately, deduplicating customers across them; Polar uses the organization already scoped by its token.
- Optional activity, identity and currency preferences live after connection and reuse saved credentials. Existing keys and explicit filters are preserved. PostHog renews expiring OAuth access automatically, and the Mac app returns to the foreground once connected.

### Validation
- 1,414 tests pass with three skipped; typecheck, lint and the production build pass. All 60 browser checks pass in GitHub CI, including zero-field PostHog setup at phone and desktop widths, click-and-approve sign-in, project selection and paste-to-connect for Stripe and Polar. Both Mac builds and the Apple silicon launch check pass.
- Public native-client registration was accepted by PostHog's live OAuth service. Consent, token exchange, refresh, cancellation and metrics are tested with mocks; no live account access was granted or real-account accuracy claimed.

---

## [v0.2.18] — 2026-10-29

### Added
- Connect PostHog Cloud, Stripe and Polar in Integrations to import active users, collected revenue, paying customers, MRR and subscription counts without manually entering them. Connections validate access and import their first snapshot before saving credentials.
- Connected-source metric cards on Revenue and Growth, with last-sync times, test-data labels, reporting windows and expandable counting definitions. Growth links open the page for the current market.
- Read-only automatic sync every 15 minutes while Inroad is visible, immediate manual refresh, per-provider backoff and serialized connection changes. Incomplete or failed syncs preserve the previous figures; sample workspaces never contact real providers.
- Provider setup guide at `docs/business-metrics.md`, including Stripe refund/currency rules, PostHog identity/event filters and Polar's reported metric definitions. Provider aggregates stay separate from deals and historical growth weeks.

### Validation
- 1,397 tests pass with three skipped, and all 55 end-to-end browser tests pass; typecheck, lint, dependency audit and the production build pass. GitHub CI passes. Provider adapter and lifecycle tests cover pagination, refunds, identity filtering, incomplete responses, secret handling, backoff and disconnect/sync races.
- Provider responses are verified with mocks. No live PostHog, Stripe or Polar credentials were used, and no real-account metric accuracy is claimed.

---

## [v0.2.17] — 2026-10-29

### Added
- Switch between selling to businesses and to consumers from the company row at the top of the sidebar, the phone menu or ⌘K ("Switch to selling to…"). Switching keeps everything, offers Undo from ⌘K, and gives each market back its own goal and kind of consumer company when you return to it.
- Growth (`/growth`), the consumer counterpart of Revenue: the goal and the straight-line pace to its date, last week's numbers and what they say (moved here from Playbook → How we grow, which now links to it), what it takes at the retention bar, what's working (the channel that led each week, creator results, referrals, experiments) and the Monday growth review.
- Partners for businesses: the Creators list now serves B2B companies as Partners (newsletters, podcasts, communities, people who post for your buyers, and partner companies), with LinkedIn and Slack, sponsorship, referral-fee and co-marketing offers, leads and deals as results, a B2B finder and B2B outreach rules. Follow-ups show on Today for both markets.
- Research for consumer companies: it asks where your users gather, finds creators and communities from your search, and adds any result to Creators, including Reddit, YouTube, TikTok and Substack links it used to block. Businesses can add those links to Partners.

### Changed
- Each market shows only its own pages, in the sidebar, the phone menu, "G then …", ⌘K and the shortcuts list. Businesses: Today, Revenue, Companies, Plays, Research, Intros, Partners, Events, Playbook and Studio. Consumer companies: Today, Growth, Creators, Research, Playbook and Studio. Switching away from a page the new market doesn't use lands on its counterpart (Revenue and Growth) or Today; old links still open.
- Today follows the market: after a switch to consumer, first touches, account research, plays, room suggestions and the pipeline reviews stop, while replies, meetings, deals and intros already in flight stay. Consumer Today shows the growth goal instead of the revenue commit and counts user conversations against the weekly target.
- The sidebar goal line reads "Weekly active users 44 of 100 · Signups a week 38 of 28" for a consumer company and opens Growth.
- When the playbook on file was written for the other market, the Playbook, the switch and Settings → Company say so and offer to rewrite it (the sample explains instead of spending tokens).
- Partners and Research use the shared page header.
- The reasoning stream catches up when thinking arrives in a burst: with more than two lines waiting, they show 240ms apart instead of 720ms, so a long run's reasoning isn't still trailing when the answer lands.

### Validation
- 1,366 tests pass with three skipped; lint, typecheck and the production build pass; 38 end-to-end tests (first run, phone, palette, sample, Today cards, providers, usability and settings navigation) pass. The switch, both sidebars, the phone menu, ⌘K, "G then …", the shortcuts list, Growth with five logged weeks, Partners and Creators, Research in both markets, Today's tiles and the Playbook note were checked in the browser on the sample workspace at desktop and phone width.
- Growth's pace is a straight line over the last four weeks of change: a guide to the goal date, not a forecast. It waits for two weeks of the goal's number.

---

## [v0.2.16] — 2026-10-29

### Added
- Revenue (`/revenue`): a quarterly target; commit, best case and pipeline called deal by deal from evidence, with owner overrides; floor, call and ceiling; the exact chance of reaching the target; coverage and next-period coverage; week-over-week changes from weekly snapshots; the plan from the gap back to first meetings, with the new-pipeline cutoff and a channel-by-channel view; what's working by source, signal and persona; loss patterns.
- Deal risk with one fix per risk (slips, overdue or unconfirmed next steps, thin threading, no economic buyer, stalls, silence, no price discussed), on Revenue and in each deal's sheet.
- Plays (`/plays`): 13 signal-based plays with live matches, a backtest against won and lost deals, what each one skipped and why, and attributed results. Running plays put cards on Today; pausing one takes them off.
- A weekly GTM update (workflow `gtm_update`) for the CEO, board or team, with its numbers table built in code.
- Agent keys choose the model and thinking level for the new `ask_inroad` tool (MCP and `POST /api/v1/ask`).
- Ask answers forecast and at-risk questions in code; MCP and REST add `get_forecast` and `list_plays`.
- Research notes: `docs/research/12-revenue-operating-system.md` and `docs/research/13-gtm-engineering-and-plays.md`.
- A live reasoning stream for agent runs: while one works, its thinking scrolls by, three lines at most; when it's done it folds into one line you can open. The lines stay in the tab and are never saved.
- Answer cards in Ask for the forecast, the week and deal lists (at risk, no next step, gone quiet, open pipeline): the numbers, how many records they came from, and for the forecast a Commit / call / best-case switch. While Ask works, its window shows the question and what it's doing.

### Changed
- A refreshed look in light and dark: new palettes, Geist for text, and one page header (eyebrow, serif title, short description) with shared spacing on Companies, Revenue, Plays, Intros, Events, Playbook, Integrations and Settings. Today and setup use the same eyebrow.
- Buttons and inputs are a step larger, with a visible keyboard focus ring. Invalid fields are marked, selects share one style, and a busy button says so to screen readers.
- Loading shows an indeterminate signal instead of a made-up percentage, with a workspace-wide fallback while a page opens.
- The sidebar leads with the Inroad mark and your workspace, then the agent and navigation, and scrolls when the window is shorter than it is.
- Today's masthead shows progress tiles: conversations this week, and the revenue commit when a target is set.
- A "Skip to content" link for keyboard users.
- Motion where it explains something: a finished move stamps, strikes through and folds away; Revenue's first look of a session builds its bar and rolls its numbers; the sidebar selection glides on a click and snaps from the keyboard; counts pop in; the theme spreads out from its switch; and each company sheet carries a pattern drawn from its domain. Big reveals play once a session, and reduced motion turns movement off.

### Validation
- 1,349 tests pass with three skipped, and all 55 end-to-end tests pass; lint, typecheck and production build pass. Today, Revenue, Plays, Companies, Integrations, Settings, Studio, Research and Ask's forecast card were checked in the browser on the sample workspace at desktop width, and Today and the menu at phone width.
- Forecast accuracy on real pipelines is unmeasured: win rates and cycle times lean on stated priors until 30 deals are decided.

---

## [v0.2.15] — 2026-10-28

### Added
- Research-driven Studio art direction from 25 primary-source brand studies, with seven visual approaches and Focused, Bold and Unexpected creative ranges.
- Shared concept exploration, composition, materials, lighting, copy-space and brand guidance for ChatGPT, OpenAI, copyable prompts and SVG graphics.
- Generated-image review for concept, originality and finish, with one targeted refinement on full design runs and exact prompt/reference history.

### Changed
- Replace stock-scene and flat-card defaults with message-specific visual ideas, richer art direction and context from previous images to encourage variety.
- Revise generic designs even when their overall review score is high, rank by the weakest creative dimension, and retain the better reviewed result.
- Show unresolved or unavailable visual reviews clearly; image-only ChatGPT generation keeps its single-connection flow and identifies when a separate review was not run.

### Validation
- 1,300 tests pass with three skipped; lint, typecheck, production build and GitHub browser checks pass. Research notes, a generated example, prompts and responsive screenshots are included.
- Live Inroad provider generation and engagement impact remain unmeasured.

---

## [v0.2.14] — 2026-10-28

### Added
- Choose Claude plan in Studio for copy, code-rendered SVG/PNG graphics, prompt writing, visual review and repair through the official local Claude runtime.
- Claude subscription connection, managed browser sign-in, cancellation and disconnect controls, with persistent creator choice and no API-key fallback.
- Independent subscription-budget handling, including Claude composition around ChatGPT-generated images, with explicit API image billing kept separate.

---

## [v0.2.13] — 2026-10-28

### Added
- Connect ChatGPT in Studio Graphics through local Codex and generate downloadable images using the ChatGPT plan, with no OpenAI API key or API fallback.
- A direct image generation action that skips API prompt-writing, layout and review calls, with independent API-budget handling.
- Managed browser sign-in when no existing ChatGPT session is available, cancellation and disconnect controls, and clear runtime and plan-limit errors.

### Changed
- Keep ChatGPT and OpenAI API image generation as explicit, separate choices, and retain generated-image attribution and screenshot restrictions for both.

---

## [v0.2.12] — 2026-10-28

### Added
- A visible Graphics workspace in Studio for choosing a saved message, designing with typography, uploaded images or AI imagery, and reviewing and downloading PNG/SVG graphics.

### Changed
- Replace the hidden image-icon entry on copy options with a labeled Design graphics action, and explain the message-to-graphic path on Create.
- Label the existing generated-picture mode AI image so its purpose is clear.

---

## [v0.2.11] — 2026-10-28

### Added
- Twenty campaign studies with execution breakdowns, creative analysis, adaptation briefs, source details and measurement limits.
- Twenty-two verified, full-frame local creative previews, including offline first-launch coverage and three click-to-play official campaign films.

### Changed
- Streamline discovery with compact cards, audience and approach filters, deep-linked study tabs and a persistent creation action.
- Preserve brief and optional example input through studies and browser history; retain archived IDs for older saved pieces.
- Replace black, unrelated and broken previews, correct captions and attribution, and keep campaign outcomes separate from product evidence.

### Fixed
- Open each study section at its beginning when switching tabs after scrolling, and fit all three tabs on a 390px phone viewport.

---

## [v0.2.10] — 2026-10-28

### Fixed
- Stop repeated Next.js server Keychain password prompts in ad hoc Mac builds by importing saved keys once into the existing owner-only AES-256-GCM encrypted store. Developer ID builds retain Keychain, and deletion cannot restore an older Keychain value.

### Added
- Original creative previews for nine Studio campaigns: official brand films, creator videos, launch demos, campaign photography and artwork, with source attribution and alternate cuts.
- Click-to-play videos, original-media links and graceful unavailable-preview states; supporting research without verified creative is kept in a separate collapsed section.

---

## [v0.2.9] — 2026-10-27

### Added
- Studio campaign library with 15 sourced records, audience and evidence filters, campaign details, and direct use in a new piece.
- Automatic campaign recommendations matched to the format, audience, occasion and available material; optional custom examples remain supported.
- Saved campaign direction and supplied examples reused by Write more; automatic campaign recommendations are also included in the agent copy guide.

### Changed
- Separate Studio into Create, Campaign library and Your work, with brand settings and supporting material in a drawer.
- Keep the write action accessible in smaller windows and preserve unfinished inputs while browsing campaigns.
- Distinguish reported campaign results, reported reach and creative references; technique labels no longer imply a generated draft was tested.
- Campaign approaches guide the writer while product claims still require the founder's own evidence and existing quality checks.

---

## [v0.2.8] — 2026-10-27

### Changed
- Organize Settings into focused topics under Workspace, AI & research, and Manage, with one topic visible at a time.
- Add settings search that opens the matching control directly, while keeping existing deep links and unfinished edits.
- Show one major Playbook section at a time, with direct subsection links and a topic picker on smaller screens.
- Keep settings search and the section picker accessible while scrolling on phones and narrower windows.

### Validation
- Add browser regression checks for settings search, history, deep links, unfinished forms, mobile layouts, and business and consumer Playbook navigation.

---

## [v0.2.7] — 2026-10-27

### Fixed
- Publish the clipboard fix from the unpublished v0.2.6 after correcting the app test to accept an existing workspace opening on Today.

---

## [v0.2.6] — 2026-10-27

This version was not published. The clipboard regression test incorrectly expected a fresh workspace after earlier app tests had created one. Its changes ship in v0.2.7.

### Fixed
- Copy prompt, Copy key, and other copy actions work in the Mac app: only Inroad's own main window can write to the clipboard, while clipboard reads and other permissions remain denied.
- Copy buttons show an error when the browser refuses clipboard access instead of failing silently.

### Validation
- Add a packaged-app test that copies the Muse setup prompt, checks the system clipboard, and verifies that page scripts still cannot read it.

---

## [v0.2.5] — 2026-10-27

### Fixed
- Publish the security and correctness changes from the unpublished v0.2.4 after updating the phone orb-transition browser assertion to its new layout-specific name.

---

## [v0.2.4] — 2026-10-27

This version was not published; the browser release gate caught a stale phone animation assertion. Its changes ship in v0.2.5.

### Security
- Update Electron to 44.10.0, Undici to 7.30.1, and Vitest to 4.1.12 to address published dependency advisories.
- Save Studio media with owner-only permissions and repair existing Studio files and encrypted AI key material on startup, including in shared data folders.
- Enforce public MCP, REST, and webhook upload limits in UTF-8 bytes while reading the stream.
- Drop custom API headers across research redirects and reject Studio provider redirects, preventing off-endpoint credential forwarding and prompt replay.
- Prevent framing of the app and add content-type and referrer protections.

### Fixed
- Permission-migration tests now create explicit legacy permissions, so they work with restrictive host umasks.
- Give desktop and phone orb transitions distinct names to prevent duplicate-name animation errors during resizing and hydration.
- Exclude generated browser reports and coverage from linting so concurrent browser checks cannot race ESLint's directory scan.

### Changed
- Dependency security auditing is part of CI. Mac releases wait for typechecking, linting, tests, the production build, browser workflows, and both Mac packages before publication.
- Document supported deployment and security boundaries in SECURITY.md.

---

## [v0.2.3] — 2026-10-27

### Fixed
- The Mac app opens again: its server now includes playwright-core, which v0.2.2's research reader needs. v0.2.2 was never published.

---

## [v0.2.2] — 2026-10-27

### Added
- Research workspace for finding companies and researching the web, with domain/date filters, ranked and deduplicated sources, saved sessions, caching, cancellation, and daily request limits.
- Independent search providers: DeepSeek, TinyFish, Tavily, Exa, Brave, Firecrawl, custom HTTP endpoints, and mapped MCP/OpenAPI connections. Optional TinyFish browser research has separate limits and isolated sessions.
- Read-only MCP and OpenAPI connections, reusable field mappings and import profiles, CRM import presets, and n8n starter workflows for connecting existing tools.
- Persistent topic and page monitors with baselines, unseen-source detection, retry backoff, and pause controls. Monitors run while the server is awake.
- Research provenance and outcome tracking for replies, meetings, and wins. Automation data participates in backups, restores, resets, and privacy erasure.
- Any number of saved AI connections, including multiple accounts per provider, each with separate credentials and model settings.
- Per-task model selection, a model override for each Ask message, and optional automatic routing by task fit and known costs.
- Vercel AI Gateway and Cloudflare AI Gateway integrations, including Cloudflare named dynamic routes, gateway selection, and request-log controls.

### Changed
- Company discovery and web research share configurable search providers and source-quality improvements.
- AI receipts report serving model IDs and flag unknown prices; gateway routing does not price an unknown fallback using the requested alias's rates.
- Connection credentials remain in the system credential store or machine-local encrypted storage and are excluded from workspace exports.

### Validation
- 1,218 unit and integration tests pass across 119 files. Browser checks cover provider switching, multiple accounts, task and message overrides, web research, monitors, connections, mappings, and outcomes.
- Typecheck, lint, and production build pass. Live gateway calls require configured credentials and billing.

---

## [v0.2.1] — 2026-10-26

### Changed
- Clearer setup fields, AI connection guidance, and a single “Build my GTM plan” action. Connection checks can be retried, and a sample workspace is available without an API key.
- Shorter plan review with optional profile details and one action to start the workflow. Business and consumer workspaces can open Today while prospect research continues.
- Simpler first-day guidance from finding prospects to reviewing drafts and sending outreach.
- Optional integrations grouped by imports, outreach and CRM sync. People lookup, meetings, alerts and automation expand under “More tools”; saved links still open the right tool.
- Shorter settings and connector descriptions, keyboard-accessible customer selection, and readable integration statuses on mobile.

### Fixed
- Pressing Enter in setup descriptions now adds a line instead of starting a workflow. Ctrl/Cmd+Enter still submits.
- Setup waits for the AI connection check instead of starting a run with an unknown connection state.

---

## [v0.2.0] — 2026-10-27

### Added
- **Updates in one click.** Settings → General → Updates and a sidebar notice show what a new version brings; one click installs it. Every update backs up the workspace first ("Before an update" in Backups), and the button asks first when research or drafting would be stopped.
- From a git checkout (`npm start`, `npm run dev`): the launcher stops the server, shows an "Updating Inroad" page the open tab follows, fast-forwards the branch, runs `npm ci` when dependencies changed and `next build` for `npm start`, and starts Inroad again. A failed install or build puts the old commit back and builds it again. It never updates over local changes or commits that aren't on GitHub, and says what to do instead.
- The Mac app updates itself from GitHub's releases: it downloads in the background, checks the SHA-256 and the code signature (same developer, same version), and "Restart to update" swaps the new app in, putting the old one back if the swap fails. It works for ad hoc builds as well as Developer ID ones. **Inroad → Check for Updates…** in the menu.
- Automatic update checks every 6 hours, which can be turned off in Settings.
- Mac app: offers to move itself to Applications, **Open at Login** in the Inroad menu, and a server that quits after running a while is started again by itself (once in ten minutes), back on the page you were on.
- `npm run release -- <version>` sets the version everywhere, dates the changelog, commits and tags. The Mac app workflow refuses a tag that doesn't match the app's version and publishes `SHA256SUMS.txt` with each release.
- **Consumer mode** for apps, subscriptions, DTC brands, marketplaces, social products and prosumer tools. Inroad reads the market from the founder's site, and the founder can change it in onboarding or Settings.
- A consumer playbook with an audience bet, segments, hooks and a growth model (north star, first win, retention bar, loop, first 100 users). It adds model-specific channel plans with at most three active channels and paid last, plus consumer pricing structures.
- A weekly growth log and code-computed verdicts: week-4 retention against category bars, activation, quick ratio, CAC, payback, referral share and the 40% survey. Inroad tells you to hold paid spend until retention clears the bar.
- **Creators** (`/partners`): a sourced creator and community list, one note and one follow-up, offers, briefs, `#ad` checks and per-partner results.
- Experiments ranked by ICE and sized with Lehr's rule, plus a Monday growth review.
- Consumer marketing checks in the draft linter: FTC disclosure, 16 CFR 465 reviews, app-store rating rules, health, earnings and environmental claims, "free" terms and false urgency.
- MCP and REST tools `get_growth`, `log_growth_week` and `add_partners`.
- Research notes: `docs/research/10-consumer-gtm.md`.
- **Studio** (`/studio`, G M): marketing and launch copy for founders of any kind of company. 20 formats (one-liners, homepage hero, billboard, LinkedIn and X posts, community posts, Show HN, Product Hunt, announcement email, Meta, LinkedIn and Google ads, image creative, short video, creator brief, App Store, waitlist, comparison page, changelog, customer story), each with sourced platform limits.
- Studio writes several options per piece with different moves drawn from the research (Wispr Flow, Ramp, Supabase, Linear, Granola, Cursor and others), lints them in code, revises failures, has a blind Haiku reader rank them and name AI tells, and rewrites the best two when the reader wouldn't act.
- Marketing lint (`src/lib/studio/lint.ts`): AI tells by density, negative parallelism, staged openers and closers, marketing clichés, unsourced numbers, "up to" vs "on average", unproven superlatives, competitor claims, Show HN and Product Hunt rules, X's weighted count and LinkedIn's whole-post limit.
- Intake questions and founder material (the old way, a moment, a number with its source, users' words, the demo, what it can't do yet, beliefs); copy may only state specifics from material, approved claims or the playbook.
- MCP and REST tools `get_copy_guide` and `check_copy` (read scope) so outside agents write to the same bar.
- Research: `docs/research/10-marketing-copy.md`.
- **Studio graphics** (workflow `visual`): Claude (Opus) designs 1–3 graphics per option as SVG around its checked words. Code sanitizes the SVG to an allowlist and checks it: only approved words, WCAG contrast, platform safe zones, type size, likely overflow, and text share for Meta ads. resvg renders the PNG locally, Claude (Sonnet) reviews the render by vision, and failing designs get one revision. Six sizes: LinkedIn/X 1.91:1, feed 4:5, square, story 9:16, link preview and the Product Hunt gallery.
- Picture layers: a real screenshot the founder uploads (shown whole), or a photo or illustration painted by OpenAI GPT Image (`gpt-image-2.5-sunburst` by default) on the founder's own key. Without a key, Claude writes a ChatGPT-ready prompt instead. Image prompts are checked for words, painted UI, fake customers and AI-art clichés; painted graphics are marked as AI imagery.
- Settings: optional OpenAI key and image model. Brand colors in Studio's profile. Image library in the Studio aside. PNG and SVG downloads. Graphics are marked when their option's words change.
- MCP and REST: `get_copy_guide` returns a `visual` block (sizes, safe zones, layouts, rules, image-prompt rules), and new `check_graphic` (read scope, `POST /api/v1/copy/graphic`) runs the same SVG checks for outside agents.

---

## [v0.1.0] — 2026-10-22

### Summary
Production presentation showcase pass with architecture specifications, hermetic test verification, and repository hygiene.

### Detailed Changes

#### Tooling & Hygiene

- **General**: Bring the merged test suite up to date (`4eaf632`)
- **General**: Merge branch 'claude/recursing-germain-1c583f': Vitest suite and CI (`21f67b5`)
- **General**: Merge branch 'claude/polling-public-url': polling sync and one-click public URL (`d0079eb`)
- **General**: Add the lead map, event Nearby, and ease-of-use polish (`3a02fab`)
- **General**: Add Intros: double opt-in intros from the ask to the thank-you (`467f01c`)
- **General**: Add people data through Firecrawl Alexandria (`9b31a94`)
- **General**: Add a Vitest suite and CI (`7725fe1`)
- **General**: Poll connected tools when no webhook can reach the app, and add a one-click public URL (`1ff14f2`)
- **General**: Close the open items from the review pass (`858ab3c`)
- An AI Head of GTM for founder-led sales (`8e3caf2`)

### Verification Proof
All 17 Vitest test suites (365 tests) passing offline; validate_readme.py passed in strict mode.
