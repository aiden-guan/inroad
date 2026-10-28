# Campaign library: local verification

Checked October 27, 2026, America/Los_Angeles. This records the local continuation of the cloud handoff, before the release version bump.

## Checkout and installed application

| Item | Verified state |
| --- | --- |
| Original checkout | Clean on `feat/agent-key-models`, commit `2954164aa9ea11e05661fdc678878736caf0054b`. Left on that branch with its local commit intact. |
| Remote | `https://github.com/aiden-guan/inroad.git`; fetched with prune and tags. |
| Published baseline | `origin/main` and peeled `v0.2.10` at `d2174d93556e63317638173feeaea0e0aeab7971`. Latest release was `v0.2.10`. Its annotated tag object remains `ac771aef557b16b15e5dc22b87234d8fb9ae1492`. |
| Campaign starting point | `75949391a5cf69f7f862f9c4bda3339f1b1a5635`, matching `origin/codex/campaign-library-casebook`. Contains the main baseline. |
| Active work | Separate managed worktree on local branch `codex/campaign-library-casebook`, tracking the fetched branch. The original checkout was not reset, switched or stashed. |
| Installed app | `/Applications/Inroad.app`: bundle version, build version and bundled server package all `0.2.10`. The running executable resolves to this copy and serves port 3737. Its visible Studio is the previous nine-example library. |
| Older copies | Mounted installers contain `0.1.0` and `0.2.0`; neither is the running application. Left untouched. |

Dependencies were installed with `npm ci`, which reported zero vulnerabilities. Runtime: Node `24.22.0`, npm `11.19.1`, Next `16.4.2`, React/React DOM `19.3.0`, TypeScript `5.9.3`, Vitest `4.1.12`, Electron `44.10.0`, Playwright `1.56.1`. The installed packages match this worktree's lockfile; the original checkout's package version is not the redesign's version.

The launcher served the preview on port 3310 with a separate temporary data directory, mock providers, updates disabled and Keychain disabled. All 22 API image responses matched the bundled asset hashes. The installed application on 3737 was inspected separately; it was not used as evidence that the source redesign had shipped.

## Live media and copy review

- All 22 final image/poster URLs downloaded and decoded successfully. Original and resized images were visually checked. The manifest records each source, credit, dimensions, byte size and SHA-256.
- Wispr `9KqGpxtsawc`, Ramp `1-mgrFS00B0` and Volvo `cQX-QXxwGvA` passed public metadata checks and played in the study's privacy-enhanced embed. Volvo's displayed YouTube title is Meet the new Volvo EX90; its family narrative matches the cited four-minute campaign film.
- Replaced the black CeraVe thumbnail, the Duolingo commentator frame, the unrelated Pop-Tarts opening frame, DoorDash's case-film montage and AXA's uninformative opening still. Corrected Ocado's escaped URL suffix and caption. Verified the Vaseline Cloudinary asset successfully.
- Bundled 22 full-frame WebP previews (1,875,486 bytes), retaining publisher links and credits. Fresh offline workspaces can show them; a missing bundle still falls back to the existing validated publisher/cache path.
- Reviewed the study claims against their sources. In particular: CeraVe's sales baseline/window is undisclosed; Barbie's original unit is tool uses, not verified shares; Liquid Death sold ten collectibles; Ocado's CPA result describes a wider program. ASICS's documented-action figure was checked on page 19 of its original 2024 report. Wispr and Ramp remain unmeasured creative references.
- Rewrote the source ledger and README for the final 20 studies. Removed the unused Supabase cover while keeping archived IDs resolvable for saved work.

See [the sources and measurement ledger](research/11-studio-campaign-library.md) and [asset manifest](research/campaign-media-manifest.json).

## Validation

| Check | Result |
| --- | --- |
| Unit suite | **127 files / 1,273 tests passed** with `npx vitest run --maxWorkers=2 --testTimeout=30000`. The initial default run timed out in five existing native SVG/rendering tests on this Mac; all passed with lower concurrency and the longer allowance. |
| Full browser suite | **49 / 49 passed**, including all 11 Studio tests, against mock providers and a temporary workspace. |
| TypeScript | `npm run typecheck` passed after the final source changes. |
| ESLint | `npx eslint src e2e/studio.spec.ts` passed. |
| Production build | `npm run build` passed with a temporary data directory. Existing dynamic filesystem-tracing warnings remain in the source updater/storage code; no build error. |
| Mock eval harnesses | Critic and classifier commands exited successfully in `EVAL_MOCK=1` mode. Their synthetic scores do not validate real model quality. |
| Diff hygiene | `git diff --check` passed. |

The browser command used:

```sh
E2E_APP_PORT=3311 E2E_MOCK_PORT=4311 NEXT_TELEMETRY_DISABLED=1 npm run e2e -- --output=/tmp/inroad-campaign-e2e-results
```

Playwright's matching Chromium 141 / build 1194 was installed first. The default in-checkout trace output produced a Fast Refresh feedback loop on this Mac before onboarding; placing the same recordings outside the source tree resolved it without changing application behavior or skipping tests.

Visual QA used loaded media at desktop 1440x1000 and mobile 390x844, in light and dark themes. All 20 card images loaded. Automated coverage also exercises 850px. Checked sheet scrolling, persistent creation, full-frame media, sources, keyboard tab focus, Back/Forward, unfinished input and unavailable media. Fixed section changes retaining the previous scroll position and mobile tabs overflowing their row. Mobile coverage is a browser viewport, not a physical phone. Video playback is an observation on this connection and date, not a promise of permanent or worldwide availability.

## Release

Use the existing version/tag workflow for `v0.2.11`, which was unused at preflight. The release workflow checks matching web/app/tag versions, runs CI, builds arm64 and x64 Mac packages, tests the arm64 application and publishes checksums. The old `v0.2.10` tag must remain unchanged. A source preview and a successful local build are separate from a published and installed Mac release.
