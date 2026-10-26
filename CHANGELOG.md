# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added

- **Studio** (`/studio`, G M): marketing and launch copy for founders of any kind of company. 20 formats (one-liners, homepage hero, billboard, LinkedIn and X posts, community posts, Show HN, Product Hunt, announcement email, Meta, LinkedIn and Google ads, image creative, short video, creator brief, App Store, waitlist, comparison page, changelog, customer story), each with sourced platform limits.
- Studio writes several options per piece with different moves drawn from the research (Wispr Flow, Ramp, Supabase, Linear, Granola, Cursor and others), lints them in code, revises failures, has a blind Haiku reader rank them and name AI tells, and rewrites the best two when the reader wouldn't act.
- Marketing lint (`src/lib/studio/lint.ts`): AI tells by density, negative parallelism, staged openers and closers, marketing clichés, unsourced numbers, "up to" vs "on average", unproven superlatives, competitor claims, Show HN and Product Hunt rules, X's weighted count and LinkedIn's whole-post limit.
- Intake questions and founder material (the old way, a moment, a number with its source, users' words, the demo, what it can't do yet, beliefs); copy may only state specifics from material, approved claims or the playbook.
- MCP and REST tools `get_copy_guide` and `check_copy` (read scope) so outside agents write to the same bar.
- Research: `docs/research/10-marketing-copy.md`.

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
