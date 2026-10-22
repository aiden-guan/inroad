# Inroad — your AI Head of GTM

**Your first 20 customers, not 20,000 emails.**

Inroad does the job startups usually hire a "head of GTM" for — and does it the way the best operators do:
it finds who to talk to and why now (starting with people who already know you), drafts every touch with sources,
preps every call, debriefs it, keeps the pipeline honest, plans exec dinners and roundtables, and runs a weekly
operating rhythm. **You do the selling.** Inroad never sends, posts, or changes a deal by itself — it drafts and you
approve.

It's also a **hub**: plug in the tools you already use (HubSpot, Attio, Instantly, Smartlead, Lemlist, Slack, Clay,
Zapier/n8n, any AI SDR, and Firecrawl for people data) and let other agents — Meta Muse, Claude, Cursor, ChatGPT —
read your playbook, check your warm paths and push leads in through Inroad's MCP server and REST API.

---

## Quick start

You need [Node.js](https://nodejs.org) 20.9 or newer (24 is what CI uses; `.nvmrc` says so for `nvm use`).

```bash
npm install
npm run dev
```

Open http://localhost:3000, paste your website, and in about two minutes you'll have three real companies to talk to,
each with a dated reason why now.

Inroad runs on your Anthropic API key. Paste it on the first screen (it's saved only in `settings.json` in your data
folder, readable by you alone), or set `ANTHROPIC_API_KEY` before starting. Want to look around first? Choose
**Explore a sample workspace**; it's labelled as made up everywhere, and **Start with my company** leaves it in one
click.

For using Inroad every day (a production server, where your data lives, backups, a public URL that doesn't change),
see [Running Inroad day to day](#running-inroad-day-to-day).

### Try it without an API key

A mock of the Anthropic API ships with the repo, so you can click through every workflow for free:

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

In mock mode any key starting with `fc-` connects Firecrawl; `fc-terms…` shows what happens when a data provider's
terms haven't been accepted yet.

### Running tests

```bash
npm test             # the whole suite, about 6 seconds
npm run test:watch   # re-runs affected tests as you edit
```

The suite is [Vitest](https://vitest.dev) and covers the logic the product leans on: the workspace reducer, Today's
moves and scoreboard, draft lint and pre-send gates, deal rules, the signal parsers (against saved responses in
`src/test/fixtures/signals`), the SSRF guard, the proxy, the MCP endpoint, the agent engine and its failure paths
(against the mock Anthropic server, started by the test), and the main workflows end to end: the first run with the
discovery it starts, Find companies, research, drafts and replies, and an Ask thread. Those replay recorded Anthropic
exchanges ("tapes", `src/test/fixtures/anthropic`), and each also checks that no run fell back to compatibility mode,
nothing was cut off at `max_tokens`, every submit tool was called and every receipt costs what the usage says. Replay
checks the requests the code sends now, not the recorded ones: a request whose cache TTL, `max_tokens`, effort or tool
set differs from the tape's fails the test, and assertions about caching read what was sent. It is
deterministic and offline: every test file gets its own temporary data folder instead of `.data/`, the clock runs in
`America/Los_Angeles`, fetches to anything but localhost fail, and no Anthropic key is ever used. Tests sit next to the
code they cover (`foo.test.ts`); shared builders are in `src/test/`.

After changing a workflow's prompts or tools (or the mock), re-record its tapes from the mock and commit them:

```bash
npm run tapes:record            # all of them
npm run tapes:record -- dossier # one file
```

### End to end in a browser

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

### Live smoke (real API, not in CI)

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
offline suite prefers those over the mock's tapes, so it then replays real wire shapes.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: `npm ci`, `next typegen`, `tsc --noEmit`,
`eslint src`, `npm test` and `next build`, and the browser tests above as a separate `e2e` job that uploads the
Playwright report when it fails. On a fresh checkout run `npx next typegen` once before `npm run typecheck`,
so the route types Next generates (`PageProps`, `RouteContext`) exist.

### Draft-quality evals

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

## Running Inroad day to day

Inroad is a single-user app that runs on your own computer, and it is built that way on purpose (SPEC non-goal 6):
your prospects, notes and keys never sit on someone else's server.

### The production server

```bash
npm run build      # once, and again after each update
npm start          # http://localhost:3000; `npm start -- -p 3001` for another port
```

It's faster and lighter than `npm run dev`. To have it running whenever you are, make `npm start` (run in this
folder) a login item: a LaunchAgent on macOS, a Task Scheduler task "at log on" on Windows, a systemd user service on
Linux. Webhooks, the public URL and remote agents only reach Inroad while the computer is awake and Inroad is running;
while it's open, connected sequencers, booking tools and CRMs are also polled every few minutes, so nothing is lost
when a webhook can't get through.

### Only this computer

`npm run dev` and `npm start` go through `scripts/serve.mjs`, which listens on 127.0.0.1 only, so other devices on
your network can't connect at all. It also stamps every request with the address its connection really comes from,
and Inroad decides "this is the founder's computer" from that, never from headers a caller can write. Started any
other way (a bare `next dev` listens on every interface), Inroad refuses every page and says how to start it.
`INROAD_HOST=0.0.0.0` (or `-- -H …`) listens elsewhere, for a VM or a container; other devices then reach only the
endpoints that check a key or secret on every call (MCP, the REST API and hook URLs).

The computer itself is the trust boundary: while Inroad runs, anything on it that can open a connection to
127.0.0.1, including another user account on a shared computer, can use the app as you do (read the workspace,
download a backup). The data files are readable by your user only, but that protects them on disk, not through the
running app. Run Inroad on a computer only you use.

### Where your data lives

Everything is a set of JSON files in one folder: `.data/` inside this repository unless `GTM_DATA_DIR` says
otherwise. Deleting or re-cloning the repository, or `git clean -xfd`, deletes `.data/` with it, so point
`GTM_DATA_DIR` at a folder of its own, ideally one your computer already backs up:

```bash
GTM_DATA_DIR="$HOME/Library/Application Support/Inroad" npm start   # macOS
GTM_DATA_DIR="$HOME/.local/share/inroad" npm start                  # Linux
```

```powershell
$env:GTM_DATA_DIR = "$env:APPDATA\Inroad"; npm start                # Windows PowerShell
```

Settings → Data shows which folder is in use. The files are readable by your user only (0600, folder 0700), and
older files are tightened when Inroad starts. That keeps other accounts from reading them on disk; while Inroad is
running, the app itself answers anyone on this computer (see "Only this computer" above). Your Anthropic key is in `settings.json`, connector keys and the named
tunnel's token in `secrets.json`, agent keys (hashed) in `keys.json`: those three belong to this computer and are
never in a backup or an export.

### Backups

- **Automatic:** a copy of every workspace file each day you open Inroad and before every reset, sample or restore,
  gzipped in `backups/` inside the data folder. Each is kept for 14 days at most (and no more than the last 14 daily
  and 10 others), so someone whose details you delete is gone from them within 14 days.
- **Download:** Settings → Data → **Download backup** gives one JSON file with everything: playbook, companies,
  people, deals, drafts, Ask threads, LinkedIn connections, imports and run history.
- **Restore:** Settings → Data → Backups restores any automatic backup or a downloaded file, here or on another
  computer, after backing up what's there. A workspace JSON exported by an older version restores too. Your
  suppression list survives a restore: anyone who unsubscribed, bounced or asked to be deleted after the backup was
  made stays suppressed, and anyone who asked to have their details deleted is deleted again from what the backup
  brings back. That holds across a reset or the sample too: before either replaces your workspace, its opt-outs are
  added to `opt-outs.json` in the data folder, which nothing replaces and every restore reads.

The automatic backups live in the data folder, so they don't survive deleting it: keep a downloaded backup somewhere
else now and then.

### A public URL that doesn't change

Cloud tools (Calendly, Cal.com, Clay, Zapier, n8n) and remote agents (Meta Muse) need a public https address to
reach Inroad. Integrations → **Enable public URL** starts a Cloudflare tunnel (`cloudflared` must be installed; the
page shows the command). A quick tunnel needs no account but gets a new address every start, so tools stop reaching
Inroad until you paste the new one. **Keep the same address after restarts** sets up a named tunnel on your own domain
(free with a Cloudflare account): one address forever, started again by itself whenever Inroad starts. Only MCP, the
REST API and hook URLs answer through either kind.

No public URL? Instantly, Smartlead, lemlist, HubSpot and Attio are polled for replies and changes while Inroad is
open, and Calendly and Cal.com can be connected with a key so bookings are polled too (Calendly's webhooks need a
paid plan anyway).

### What it can't do

Inroad can't be deployed to Vercel, a serverless platform or a shared host, and two people can't share one
workspace. Every page and internal API answers only the computer it runs on; data is files on local disk (read-only
or temporary on serverless); each server process keeps its own copy of each file in memory, so two processes would
overwrite each other; research runs keep working after the request that started them has been answered, which
serverless platforms stop; and the tunnel is a child process. A hosted, multi-user Inroad would need a login and a
real database; that isn't v1.

### Environment variables

| Variable | What it does |
|---|---|
| `GTM_DATA_DIR` | The data folder (default `.data/` in this repository). |
| `ANTHROPIC_API_KEY` | Your Anthropic key, if you'd rather not paste it in the app. A key saved in the app wins. |
| `PORT` | The port (default 3000; `-- -p` works too). |
| `INROAD_HOST` | The address to listen on (default 127.0.0.1). |
| `ANTHROPIC_BASE_URL`, `FIRECRAWL_API_URL` | Where those APIs are; `npm run dev:mock` points both at the mock. |
| `MOCK_PORT` | The mock's port (default 4010), for `npm run mock:anthropic` and `npm run dev:mock`. |

## What's inside

| Surface | What it's for |
|---|---|
| **Today** | One number, at most five moves, each with the draft or action ready. Reviews, reply checks and close-out are moves too. |
| **Companies** | Prospects (with why-now signals and warm paths), Talking (a 6-stage board), Customers. Every company opens a sheet with a sourced dossier, angles, people, the deal, call prep and debriefs. |
| **Intros** | Every warm intro, double opt-in, from the ask to the thank-you, always showing whose move it is. Drafts the one nudge, the reply to the intro (connector to BCC, your times) and the close-the-loop note in code. Tracks the people who introduce you with a give/get ledger (one open ask each, two weeks between asks, give before a fourth ask), and intros you make for others. Every company shows its **Ways in**: people you know there, connections who work or used to work there, connectors who can reach it, ranked with why and concerns. |
| **Map** | Companies → Map shows where your leads are, which metros would fill a dinner (one click plans it there), and “I'm in…” lists who's near any city or address. Each dinner gets a **Nearby** tab: set the venue and a radius, see every pipeline deal, prospect and customer inside it, and add them to the guest list in one click. With Firecrawl, buyers near the venue who aren't in Inroad yet are a free search away. About 200 startup cities are built in; anything else is looked up on OpenStreetMap (place text only, cached, can be turned off). |
| **Events** | Virtual roundtables and exec dinners: themes, scored guest lists, invite copy, timeline, run of show, follow-ups. |
| **Playbook** | What Inroad believes about your business — ICP bet, positioning, messaging, objections, assets, your points of view — all editable. It becomes your first AE's onboarding doc. |
| **Integrations** | Connect your stack, import CSVs and LinkedIn connections, generate keys for other agents. |
| **People data** | With a Firecrawl key, every company's People section can find who works there (Apollo, free) and add them with a work email (up to 30 credits), and any person or draft missing an email gets a one-click lookup (FullEnrich, up to 20 credits). Misses cost nothing, there's a monthly credit limit, and personal emails and phone numbers are never requested. |
| **Ask (⌘K)** | Ask anything, with your workspace as context. Proposed changes come back as one-click actions. |

## How it keeps your token spend low

1. **Code gathers, Claude writes.** Websites, job boards (Greenhouse, Lever, Ashby, Workable), news, Hacker News and
   DNS are read with plain HTTP, cached on disk, and compressed into a small digest before any model sees them.
2. **The right model for each job.** Opus 5.5 only for strategy (positioning, ICP). Sonnet 5.5 for research synthesis
   and writing. Haiku 5.5 for screening and short copy. Code for ranking, scoring, dedupe and lint.
3. **Web search is a capped fallback**, not the default way to research.
4. **Results are reused** (dossiers stay fresh for 7 days) and prompts are laid out for prompt caching.
5. **Your other tools and agents do their own inference.** When Muse or Claude calls Inroad's MCP server, Inroad
   spends zero tokens.
6. **Warm intros run on rules, not tokens.** Whose move it is, the nudge, the reply to the intro and the thank-you,
   the connector ledger and every company's ways in are all computed and drafted in code.
7. **Places are code, too.** Leads are placed from a built-in city list, distances and radii are plain math, and
   the map's tiles come from OpenFreeMap. No model ever sees a location.
8. **People data comes from a data provider, not a model.** Who works at a company and their work email come from
   Apollo and FullEnrich through Firecrawl Alexandria, in code, so finding a contact never costs a web search or a token.

Every run ends with a receipt — *Worked for 1m 52s · 9 sources · $0.04* — and Settings → Usage shows spend by workflow,
free lookups done in code, and a monthly budget cap.

## Architecture

- **Next.js 16** (App Router) + React 19, Tailwind 4, Motion, Radix primitives.
- **Agent engine** (`src/lib/ai/engine.ts`): one streaming loop over the Claude API with server-side web search/fetch,
  zod-validated app tools, strict structured output via terminal tools, refusal fallbacks, pause/resume, and cost
  accounting per run.
- **Run registry** (`src/lib/runs`): runs outlive the request; any tab can attach to the live log, and finished runs
  keep their receipt and steps.
- **Local-first data** (`src/lib/store`): one JSON workspace with atomic, owner-only writes in the data folder, daily and
  pre-change backups, and restore. Integration secrets live in `secrets.json` and never reach the browser. What leaves
  your machine: calls to the Anthropic API with the context a task needs; free public lookups that carry company
  names and domains (company websites, job boards, news, Hacker News, DNS); place names to OpenStreetMap (can be
  turned off) and map tiles from OpenFreeMap; and what you push to the tools you connect. Company icons are first
  letters unless you turn on fetching each company's icon from its own site (Settings → General); no favicon service
  ever sees your list.
- **Signals** (`src/lib/signals`): the free, deterministic research layer.

The research behind the product — GTM methodology, how elite operators work, the AI GTM landscape, design references,
connector APIs, cost architecture — is in `docs/research/`. The product spec is `docs/SPEC.md`.
