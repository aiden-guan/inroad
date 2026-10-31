# Testing and the offline mock

Everything here runs without an API key unless a section says otherwise.

## Zero-key offline mock

A mock of the AI APIs (Anthropic's and the OpenAI-compatible one) ships with the repo, so you can click through every
workflow for free. In mock mode, choosing OpenAI in Settings talks to the mock too, with any key:

```bash
npm run mock:anthropic   # terminal 1 — fake Claude (and fake Firecrawl) on :4010
npm run dev:mock         # terminal 2 — Inroad on :3100 with its own data folder (.data-mock)
```

Both work the same in bash, zsh, PowerShell and cmd: `dev:mock` is a small Node launcher, not shell syntax. To move
the mock, set `MOCK_PORT` for both commands.

The mock works each workflow's tools the way a model would, from what the request contains (it quotes your site,
saves the bet section by section, screens every candidate, records evidence before it writes a dossier), and it
bills like the API: token counts that follow the request, prompt caching (5-minute and 1-hour), web-search counts,
and reasoning that counts toward `max_tokens`. It also fails on demand, so error states can be clicked through:

```bash
MOCK_FAULT=credit npm run mock:anthropic      # every request: out of credits
curl -X POST localhost:4010/__mock/faults -d '{"faults":[{"type":"overloaded","times":4}]}'
```

In PowerShell, set the variable first: `$env:MOCK_FAULT = "credit"; npm run mock:anthropic` (in cmd,
`set MOCK_FAULT=credit` and then the command). The same goes for every `NAME=value command` line below.

Faults: `credit`, `org_disabled`, `auth`, `permission`, `model_unavailable`, `too_large`, `context_too_long`,
`rate_limit`, `overloaded`, `server_error`, `bad_request`, `reject_betas`, `reject_strict`, `overloaded_midstream`,
`refusal`, `refusal_fallback`, `pause_turn`, `max_tokens`, `no_submit`, `invalid_submit`. `GET /__mock/requests`
lists what the app sent. Discovery and research still read real websites and job boards, so they need a network.

- In mock mode, any key prefix `fc-` simulates connected Firecrawl services; `fc-terms…` shows what happens when a data
  provider's terms haven't been accepted yet.
- Data is stored in `.data-mock/` and never overwrites production workspaces.

## Unit tests

Inroad maintains an offline, deterministic Vitest suite covering all domain logic, reducers, and safety gates:

```bash
# Run complete test suite
npm test

# Run tests in interactive watch mode
npm run test:watch

# Run TypeScript compilation check (on a fresh checkout, run `npx next typegen` once first)
npm run typecheck

# Run linter
npm run lint
```

## Test Suite Highlights
- **Coverage**: 1,481 tests across 143 files, 3 skipped (about 70 seconds on a cold run on the development machine, v0.2.22).
- **Hermetic Execution**: Each test runs in an isolated ephemeral filesystem directory; system clock is locked to `America/Los_Angeles`.
- **Network Isolation**: Outbound network requests to non-localhost addresses are rejected during test runs.
- **Workflow Replays**: The main workflows (the first run with the discovery it starts, Find companies, research, drafts
  and replies, and an Ask thread) replay recorded Anthropic exchanges ("tapes", `src/test/fixtures/anthropic`). Each
  also checks that no run fell back to compatibility mode, nothing was cut off at `max_tokens`, every submit tool was
  called and every receipt costs what the usage says. Replay checks the requests the code sends now, not the recorded
  ones: a request whose cache TTL, `max_tokens`, effort or tool set differs from the tape's fails the test.

After changing a workflow's prompts or tools (or the mock), re-record its tapes from the mock and commit them:

```bash
npm run tapes:record            # all of them
npm run tapes:record -- dossier # one file
```

## End to end in a browser

```bash
npx playwright install chromium   # once
npm run e2e
```

[Playwright](https://playwright.dev) walks a founder's first session in Chromium: paste a site and a sentence on the
welcome screen, watch the bet get written, land on Today, then add a company and read its researched dossier. Then, at
390px on that workspace, Today and the dossier must fit without sideways scroll, and research the API turns down (an
out-of-credits fault queued on the mock) must say why once, in plain words, with the Add credits link. Last, it tries
the sample workspace (labelled as made up, left with one click) and brings the founder's own work back from the backup
taken before the sample replaced it. It starts the mock and the app (through the launcher, as `npm run dev` does) on
ports 4301 and 3301 (`E2E_MOCK_PORT`, `E2E_APP_PORT`) with a fresh data folder (a new temp
folder, or `E2E_DATA_DIR`, emptied first) and with outbound DNS off (`e2e/offline.cjs`), so it reads nothing from the
web, spends nothing and runs the same on every machine. A preinstalled Chromium is used when
`PLAYWRIGHT_BROWSERS_PATH` points at one. Traces and screenshots of a failure land in `test-results/`.

## Live smoke (real API, not in CI)

Before a release, run the same workflow tests once against the real Anthropic API. It costs about $1–1.50 and can't
cost more than its cap (default $3): a local proxy holds the key and refuses any request whose worst case (its prompt
uncached, all of `max_tokens`, every allowed search and a refusal fallback) would cross the cap.

```bash
INROAD_LIVE=1 ANTHROPIC_API_KEY=sk-ant-… npm run smoke:live
INROAD_LIVE=1 ANTHROPIC_API_KEY=sk-ant-… npm run smoke:live -- --record   # also save real tapes
INROAD_LIVE=1 ANTHROPIC_API_KEY=sk-ant-… npm run smoke:live -- --cap 1.5  # tighter cap
npm run smoke:live -- --mock                                              # the whole run against the mock, free
```

On top of each test's own assertions it fails if compatibility mode ever triggers, a run that needs a submit tool
ends without one, a response is cut off, the second Ask turn doesn't read the prompt cache, or a receipt disagrees
with the usage the API reported. `--record` writes the real responses to `src/test/fixtures/anthropic/live/`; the
offline suite replays whichever tape of a workflow was recorded last, the real one or the mock's, so it replays real
wire shapes until `npm run tapes:record` records that workflow again.

## Draft-quality evals

```bash
npm run eval:critic     # the critic's calibration gate: accept ≥70% of emails that got replies, reject ≥85% of AI-SDR ones
npm run eval:classify   # the reply reader against a hand-labeled bench: ≥95% agreement, ≤3% of live replies dropped
```

Both call the real API when a key is set (about $0.10 and $0.05) and fail when the gate fails; with no key they do
nothing, and `EVAL_MOCK=1` runs them against the mock to check the plumbing. CI runs them against the mock on every push,
and against the real model when the repository has an `ANTHROPIC_API_KEY` secret. The bundled calibration emails model the
patterns but aren't real: put permissioned ones in `calibration.json` (and critic references in `references.json`) in
the data folder to use them instead. Settings → Usage shows how drafting is going on your own work (critic pass rate,
edit distance, flagged evidence, first-run timings), computed on your machine.

## Continuous integration

CI (`.github/workflows/ci.yml`) runs on every push and pull request: `npm ci`, `next typegen`, `tsc --noEmit`,
`eslint src`, `npm test`, the evals and `next build`, and the browser tests above as a separate `e2e` job that uploads
the Playwright report when it fails. The Mac app is built by `.github/workflows/desktop.yml` on GitHub's Mac runners.
