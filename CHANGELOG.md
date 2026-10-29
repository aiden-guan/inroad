# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Summary
A revenue operating system and signal-based plays for Heads of GTM and GTM engineers, computed in code from the deal ledger.

### Added
- **Revenue** (`/revenue`): quarterly target; evidence-based commit / best case / pipeline calls with owner overrides; floor, call and ceiling; exact chance of hitting the target; coverage and next-period coverage; week-over-week changes from weekly snapshots; reverse-waterfall plan with the new-pipeline cutoff and a channel-by-channel view; what's working by source, signal and persona; loss patterns.
- **Deal risk**: research-backed flags (slips, overdue or unconfirmed next steps, thin threading, no economic buyer, stalls, silence, pricing silent) with a fix for each, on the Revenue page and in every deal's sheet.
- **Plays** (`/plays`): 13 signal-based plays with live matches, a backtest against won and lost deals, a skipped-and-why audit trail and attributed results. Running plays feed Today; pausing one takes its cards off.
- **Weekly GTM update** workflow (`gtm_update`) for the CEO, board or team, with a code-built numbers table.
- Ask answers forecast and at-risk questions instantly in code; MCP and REST gain `get_forecast` and `list_plays`.
- Research notes `docs/research/10-revenue-operating-system.md` and `11-gtm-engineering-and-plays.md`.

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
