# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **Consumer mode** for apps, subscriptions, DTC brands, marketplaces, social products and prosumer tools. Inroad reads the market from the founder's site, and the founder can change it in onboarding or Settings.
- A consumer playbook with an audience bet, segments, hooks and a growth model (north star, first win, retention bar, loop, first 100 users). It adds model-specific channel plans with at most three active channels and paid last, plus consumer pricing structures.
- A weekly growth log and code-computed verdicts: week-4 retention against category bars, activation, quick ratio, CAC, payback, referral share and the 40% survey. Inroad tells you to hold paid spend until retention clears the bar.
- **Creators** (`/partners`): a sourced creator and community list, one note and one follow-up, offers, briefs, `#ad` checks and per-partner results.
- Experiments ranked by ICE and sized with Lehr's rule, plus a Monday growth review.
- Consumer marketing checks in the draft linter: FTC disclosure, 16 CFR 465 reviews, app-store rating rules, health, earnings and environmental claims, "free" terms and false urgency.
- MCP and REST tools `get_growth`, `log_growth_week` and `add_partners`.
- Research notes: `docs/research/10-consumer-gtm.md`.

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
