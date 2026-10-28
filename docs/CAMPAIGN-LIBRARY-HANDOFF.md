# Campaign library: continue locally

This branch preserves the campaign library redesign from the cloud workspace so work can continue on the user's Mac. The user requested the move to local and asked to avoid an outdated checkout. Do not discard local edits, reset their checkout, or replace their application data to make it match this branch.

**Local continuation:** the media, source-ledger and visual QA work below has now been completed in a separate Mac worktree. See [local verification](CAMPAIGN-LIBRARY-VERIFICATION.md) for checkout/app versions, asset replacements, live playback and test results. The remaining-work section below records the historical cloud handoff, rather than the final collection's current state. Release publication and installation are separate verification steps.

## Version baseline

As checked on 2026-10-28, GitHub `main` and the latest published release `v0.2.10` point to `d2174d93556e63317638173feeaea0e0aeab7971`. This branch, `codex/campaign-library-casebook`, contains newer, **unreleased** work on top of that release. Its package version is intentionally still `0.2.10`; the version number alone does not identify the redesign.

The cloud tools could not access the Mac's terminal, checkout or installed Inroad application. Local freshness has not been verified yet.

## Start the local task

1. Locate the local checkout and read its `AGENTS.md`. Check `git status --short`, `git remote -v`, the current branch and `git log -1 --oneline` before changing it. Confirm the remote is `aiden-guan/inroad`.
2. Run `git fetch origin --prune --tags` and inspect both `origin/main` and `origin/codex/campaign-library-casebook`. Recheck the newest GitHub release; the baseline above is a timestamped observation.
3. Preserve any existing local work. Prefer a separate worktree from `origin/codex/campaign-library-casebook` if the current checkout has changes or another task. Otherwise create a local branch tracking that remote branch. Verify `HEAD` matches the remote branch before continuing. If `main` advanced after this handoff, incorporate those changes without overwriting local edits.
4. Install dependencies in the new worktree with `npm ci`. Start through `npm run dev:mock` for a mock preview, or the documented launcher for real use. Plain `next dev` omits the launcher's required coordination setup. Use a separate temporary `GTM_DATA_DIR` for mock/sample testing; leave the user's workspace and credentials intact.
5. Confirm the browser is connected to the server launched from this worktree, rather than an older process on another port. The packaged Mac app is a separate build: inspect its About/version information and compare it with the current GitHub release. The redesigned library will only appear in the source preview until a new release is built and installed.

Example for a separate worktree, run from the existing repository after fetching (choose an unused sibling directory and local branch name):

```sh
git worktree add ../inroad-campaign-library -b local/campaign-library origin/codex/campaign-library-casebook
cd ../inroad-campaign-library
npm ci
GTM_DATA_DIR="$TMPDIR/inroad-campaign-library-preview" INROAD_UPDATE_CHECK=off npm run dev:mock
```

## User's intended result

Make Studio streamlined and useful for producing high-quality campaigns. The library should show actual campaign images or videos, explain the specific campaign and why its execution worked, provide honest evidence and context, and help the user apply the approach. Pasting custom inspiration remains optional. Remove dead media, unrelated creator videos and old product launches from the active collection. The user previously requested pushing and deploying the completed update.

The redesign now includes 20 specific studies: Duolingo, CeraVe, Vaseline, Spotify, Notion, Heinz, DoorDash, IKEA, Pedigree, Orange, Pop-Tarts, Specsavers, AXA, ASICS, Barbie, Liquid Death, Wispr Flow, Ramp, Volvo and Ocado. Most are from 2024–2025; a few documented 2023 campaigns are retained for distinct lessons. Wispr's official film has no published date, so it is explicitly an undated creative reference.

## Implementation preserved

- `src/lib/studio/campaign-studies.ts`: campaign context, audience and objective; execution steps; creative analysis; adaptation prompts; fit and failure conditions; measurement limits; source URLs and notes.
- `campaign-types.ts`, `campaigns.ts`, `campaign-archive.ts`: typed studies, search and recommendations. Retired records remain resolvable for older saved work but are excluded from active discovery. Campaign metrics are not imported as claims about the user's product.
- `src/components/studio/campaign-library.tsx`: compact cards and filters; deep-linked study sheet with The campaign / Why it worked / Make it yours tabs; persistent creation action; source details. Client-only study navigation uses Next's supported native History API to preserve filter state.
- `campaign-media.ts`, `campaign-media-cache.ts`, the campaign-media API route and `youtube-player.tsx`: original publisher asset registry; bounded image downloads with binary and dimension checks; last-good local cache; click-to-load YouTube with public-availability checks, embed error handling and source links.
- Unit and Studio browser tests cover curation, archival compatibility, media validation, filtering, study content, mobile layouts, history and unavailable-media behavior.

## Important remaining work

**Media needs live verification before release.** The cloud workspace still enforced an old restricted network policy even after the user enabled Internet access in the environment UI. Public research identified source pages and asset URLs, but the workspace could not reliably download publisher images or verify playback. No complete set of creative images has been bundled or visually verified. Search connector previews are not evidence that a video plays.

On the Mac, visit and check every active media URL, inspect the actual returned image and play every retained video. Replace dead, stale or unrelated assets with actual campaign creative from the credited brand, agency or publisher. The Vaseline Cloudinary asset in particular needs checking/replacing. Verify fallback behavior too. The current registry retains only Wispr, Ramp and Volvo YouTube films; other studies use campaign images rather than pretending a case-study webpage is a playable video. Decide whether more verified films would improve the collection.

Review all study copy against its cited sources. Reported metrics retain their units, window and attribution limits; do not silently convert views to customers or self-reported agency outcomes into causal proof. In particular, CeraVe's sales period/baseline is undisclosed, Liquid Death's sellout was a ten-item collectible drop, and Ocado's CPA change describes a wider program. Wispr and Ramp remain creative references without verified campaign performance. Rewrite the existing source ledger (`docs/research/11-studio-campaign-library.md`) and README to describe the final collection rather than the previous 15 entries. Remove unused old assets if appropriate.

Finish visual QA with loaded media on desktop and mobile, light and dark themes. Recheck study scrolling, creation continuity, keyboard tabs, browser Back/Forward and image/video failures. Existing cloud screenshots with blank media are not evidence of finished visual QA.

## Verification at handoff

The full unit suite passed: **127 files / 1,270 tests**. The final Studio browser rerun passed **11 / 11 tests**, including filtering, browser history and lazy-loaded image failure recovery. TypeScript, scoped ESLint and `git diff --check` passed. Browser media are mocked, so these checks do not verify live publisher availability.

Production build, the full repository browser suite and live media QA still need to run after the remaining work. Do not treat this branch as a finished release. Once complete, follow the repository's existing release workflow for the next version (likely `0.2.11`, recheck first), and verify the published Mac build corresponds to the final source commit. Do not move the existing `v0.2.10` tag.
