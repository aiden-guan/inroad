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
npm run mock:anthropic   # terminal 1 — fake Claude (and fake Firecrawl) on :4010
npm run dev:mock         # terminal 2 — Inroad on :3100 with its own data folder
```

In mock mode any key starting with `fc-` connects Firecrawl; `fc-terms…` shows what happens when a data provider's
terms haven't been accepted yet.

## What's inside

| Surface | What it's for |
|---|---|
| **Today** | One number, at most five moves, each with the draft or action ready. Reviews, reply checks and close-out are moves too. |
| **Companies** | Prospects (with why-now signals and warm paths), Talking (a 6-stage board), Customers. Every company opens a sheet with a sourced dossier, angles, people, the deal, call prep and debriefs. |
| **Intros** | Every warm intro, double opt-in, from the ask to the thank-you, always showing whose move it is. Drafts the one nudge, the reply to the intro (connector to BCC, your times) and the close-the-loop note in code. Tracks the people who introduce you with a give/get ledger (one open ask each, two weeks between asks, give before a fourth ask), and intros you make for others. Every company shows its **Ways in**: people you know there, connections who work or used to work there, connectors who can reach it, ranked with why and concerns. |
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
7. **People data comes from a data provider, not a model.** Who works at a company and their work email come from
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
- **Local-first data** (`src/lib/store`): one JSON workspace with atomic writes in `.data/`. Integration secrets live in
  `.data/secrets.json` and never reach the browser. Nothing leaves your machine except calls to the Anthropic API and
  the tools you connect.
- **Signals** (`src/lib/signals`): the free, deterministic research layer.

The research behind the product — GTM methodology, how elite operators work, the AI GTM landscape, design references,
connector APIs, cost architecture — is in `docs/research/`. The product spec is `docs/SPEC.md`.
