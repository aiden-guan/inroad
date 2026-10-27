# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

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
