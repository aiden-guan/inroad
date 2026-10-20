# Inroad — your AI Head of GTM

**Your first 20 customers, not 20,000 emails.**

Inroad does the job startups usually hire a "head of GTM" for — and does it the way the best operators do:
it finds who to talk to and why now (starting with people who already know you), drafts every touch with sources,
preps every call, debriefs it, keeps the pipeline honest, plans exec dinners and roundtables, and runs a weekly
operating rhythm. **You do the selling.** Inroad never sends, posts, or changes a deal by itself — it drafts and you
approve.

It's also a **hub**: plug in the tools you already use (HubSpot, Attio, Instantly, Smartlead, Lemlist, Slack, Clay,
Zapier/n8n, any AI SDR) and let other agents — Meta Muse, Claude, Cursor, ChatGPT — read your playbook and push leads in
through Inroad's MCP server and REST API.

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000, paste your website, and in about two minutes you'll have three real companies to talk to,
each with a dated reason why now.

Inroad runs on your Anthropic API key. Paste it on the first screen (it's saved only in `.data/settings.json` on this
machine), or set `ANTHROPIC_API_KEY` before starting. Want to look around first? Choose **Explore a sample workspace**.

### Try it without an API key

A mock of the Anthropic API ships with the repo, so you can click through every workflow for free:

```bash
npm run mock:anthropic   # terminal 1 — fake Claude on :4010
npm run dev:mock         # terminal 2 — Inroad on :3100 with its own data folder
```

### Running tests

```bash
npm test             # the whole suite, about 2 seconds
npm run test:watch   # re-runs affected tests as you edit
```

The suite is [Vitest](https://vitest.dev) and covers the logic the product leans on: the workspace reducer, Today's
moves and scoreboard, draft lint and pre-send gates, deal rules, the signal parsers (against saved responses in
`src/test/fixtures/signals`), the SSRF guard, the proxy, the MCP endpoint and the agent engine (against the mock
Anthropic server, started by the test). It is deterministic and offline: every test file gets its own temporary data
folder instead of `.data/`, the clock runs in `America/Los_Angeles`, fetches to anything but localhost fail, and no
Anthropic key is ever used. Tests sit next to the code they cover (`foo.test.ts`); shared builders are in `src/test/`.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: `npm ci`, `next typegen`, `tsc --noEmit`,
`eslint src`, `npm test` and `next build`. On a fresh checkout run `npx next typegen` once before `npm run typecheck`,
so the route types Next generates (`PageProps`, `RouteContext`) exist.

## What's inside

| Surface | What it's for |
|---|---|
| **Today** | One number, at most five moves, each with the draft or action ready. Reviews, reply checks and close-out are moves too. |
| **Companies** | Prospects (with why-now signals and warm paths), Talking (a 6-stage board), Customers. Every company opens a sheet with a sourced dossier, angles, people, the deal, call prep and debriefs. |
| **Events** | Virtual roundtables and exec dinners: themes, scored guest lists, invite copy, timeline, run of show, follow-ups. |
| **Playbook** | What Inroad believes about your business — ICP bet, positioning, messaging, objections, assets, your points of view — all editable. It becomes your first AE's onboarding doc. |
| **Integrations** | Connect your stack, import CSVs and LinkedIn connections, generate keys for other agents. |
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

Every run ends with a receipt — *Worked for 1m 52s · 9 sources · $0.04* — and Settings → Usage shows spend by workflow,
free lookups done in code, and a monthly budget cap.

## Architecture

- **Next.js 16** (App Router) + React 19, Tailwind 4, Motion, Radix primitives.
- **Agent engine** (`src/lib/ai/engine.ts`): one streaming loop over the Claude API with server-side web search/fetch,
  zod-validated app tools, strict structured output via terminal tools, refusal fallbacks, pause/resume, and cost
  accounting per run.
- **Run registry** (`src/lib/runs`): runs outlive the request; any tab can attach to the live log, and finished runs
  keep their receipt and steps.
- **Local-first data** (`src/lib/store`): one JSON workspace with atomic writes in `.data/`. Integration secrets live in
  `.data/secrets.json` and never reach the browser. Nothing leaves your machine except calls to the Anthropic API and
  the tools you connect.
- **Signals** (`src/lib/signals`): the free, deterministic research layer.

The research behind the product — GTM methodology, how elite operators work, the AI GTM landscape, design references,
connector APIs, cost architecture — is in `docs/research/`. The product spec is `docs/SPEC.md`.
