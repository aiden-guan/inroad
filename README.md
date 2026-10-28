
<div align="center">

# Inroad

**An AI Head of GTM for founder-led sales — finds who to talk to and why now, drafts every touch with verifiable sources, preps every call, and coordinates outbound pipeline.**

[Architecture](#architecture) · [Core Capabilities](#core-capabilities) · [Engineering Deep Dives](#engineering-deep-dives) · [Quick Start](#quick-start) · [Mac App](#the-mac-app) · [Token Economics](#how-it-keeps-token-spend-low)

<br/>

[![CI](https://github.com/aiden-guan/inroad/actions/workflows/ci.yml/badge.svg)](https://github.com/aiden-guan/inroad/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: 20.9+](https://img.shields.io/badge/Node-20.9%2B-green.svg)](package.json)
[![Next.js: 16](https://img.shields.io/badge/Next.js-16-black.svg)](package.json)

<br/>

![Inroad Hero Banner](assets/readme/hero.png)

</div>

---

## What It Does

**Your first 20 customers, not 20,000 cold emails.**

Inroad automates the operational groundwork that high-performing heads of GTM execute for early-stage companies:
it discovers high-intent accounts and verifiable buying signals (starting with warm connections already in your network), drafts hyper-targeted touches with primary source citations, prepares deal dossiers for calls, debriefs meetings, maintains pipeline velocity, plans local executive dinners, and runs a focused weekly operating rhythm.

**You do the selling.** Inroad never sends an email, posts a message, or modifies deal stages autonomously. Every outbound artifact is presented as a draft for founder review and one-click approval.

**Studio writes the marketing.** Launch posts, homepage heroes, ads, image text, short-video scripts, Show HN and Product Hunt launches, store listings and comparison pages, for founders of any kind of company (B2B, consumer, prosumer, developer tools). It writes from the founder's own material, gives several options built on different moves from campaigns that worked (Wispr Flow, Ramp, Supabase, Linear), and checks every option in code for AI tells, unsourced numbers and platform limits before a blind reader ranks them. The research behind it is in [`docs/research/10-marketing-copy.md`](docs/research/10-marketing-copy.md).

**A campaign library is built in.** Studio has separate Create, Campaign library and Your work views. Fifteen sourced campaign records include Wispr Flow, Notion, Spotify, Cider and others, with clear labels for reported results, reach and creative references. Relevant approaches are recommended automatically; you can inspect the source, choose another approach, or add your own example. Your product claims still come from your own material. Brand and material settings stay in a drawer, and unfinished briefs survive browsing the library. The source ledger is in [`docs/research/11-studio-campaign-library.md`](docs/research/11-studio-campaign-library.md).

**Studio also makes the graphics.** For any option, Claude designs the graphic (LinkedIn and X images, 4:5 feed, square, 9:16 story, link previews, Product Hunt gallery) as SVG around the option's checked words. Code strips anything unsafe and checks every word against the approved copy, plus contrast, safe zones and type size, then renders the PNG on your machine. Claude looks at that render and fixes what fails. A design can sit over a real screenshot you upload, or over a photo or illustration painted by OpenAI's GPT Image if you add an OpenAI key in Settings. Without a key, Claude writes the prompt for you to paste into ChatGPT. Painted pictures never contain words, never stand in for your product's UI, and are labeled as AI imagery so you can disclose them where Meta and TikTok ask. The Claude API reads images but doesn't output them, which is why Claude designs in code.

Inroad also operates as an **agentic coordination hub**: connect external systems (HubSpot, Attio, Instantly, Smartlead, Lemlist, Slack, Clay, Zapier, n8n, Firecrawl) and allow peer agents—Claude Code, Cursor, ChatGPT, Meta Muse—to query your playbook, inspect warm network paths, and inject qualified leads through Inroad's native MCP server and REST endpoints.

It runs on the AI provider you choose — Anthropic Claude (what it was built and tuned on), OpenAI, Google Gemini, xAI, Groq, OpenRouter, Mistral, DeepSeek, Together AI, Vercel AI Gateway, Cloudflare AI Gateway, a local Ollama model, or any OpenAI-compatible API — in a browser or as a [Mac app](#the-mac-app). Save multiple accounts, select models per task or Ask message, and enable automatic task routing in Settings. See [AI connections and routing](docs/AI-ROUTING.md) for setup and gateway requirements.

### Research and existing tools

**Research** in the sidebar brings web search, evidence, connections, monitors and outcomes together. Search with
source/date filters, inspect the actual queries and pages, reopen recent searches, track useful websites, or run
playbook-based company qualification. Results share ranking, deduplication, caching, cancellation and daily request
limits across providers. Missing dates and provider failures remain visible.

Connect read-only MCP tools or OpenAPI GET operations, map their inputs and results, preview nested JSON records,
and import them through the existing dedupe and suppression rules. Source opt-outs survive imports and undo.
Salesforce, Pipedrive and Attio CSV presets are included, along with n8n starter workflows and the existing
Zapier/Make/REST routes. Optional TinyFish browser rendering handles pages that ordinary fetches cannot read.

Saved topic/page monitors include leadership, dormant-deal and meeting-preparation recipes, catch-up after restarts,
change deduplication, visible errors and pause controls. They run while this computer and Inroad run. Outcomes link
retained research provenance to accepted accounts, replies, meetings and wins, with unknown costs labeled.

See the [Research guide](docs/RESEARCH.md) for setup, supported protocol scope, templates and verification limits.

### Consumer companies

Inroad also runs a consumer mode for apps, subscriptions, DTC brands, marketplaces, social products and prosumer tools. It picks the mode from your site (store links, a cart, two-sided signup), and you can change it in onboarding or Settings. In consumer mode:

- **Retention comes before acquisition.** You log last week's numbers, and code checks week-4 retention against the bar for your category (DTC uses 90-day repeat purchase). Inroad tells you to hold paid spend until retention clears the bar. Activation, the Sean Ellis 40% survey, the quick ratio, CAC and payback are all computed in code.
- **Creators and communities replace accounts.** The agent keeps only creators and communities whose links appeared in its own search results, and it never stores follower counts it reports. Each one gets one note and one follow-up a week later; if they stay quiet, Inroad suggests letting them go. Briefs must tell creators to disclose, and Inroad asks you to confirm that each paid or gifted post carries `#ad`.
- **A weekly growth rhythm.** You talk to five users a week, run one ICE-ranked experiment sized with Lehr's rule, and get a Monday growth review.
- **Consumer marketing rules in the linter.** It covers FTC endorsement disclosure, the 16 CFR 465 fake-review rule, app-store rating rules, health and earnings claims, "free" terms and false urgency.

The sources, figures and their limits are in [`docs/research/10-consumer-gtm.md`](docs/research/10-consumer-gtm.md).

---

## Core Capabilities

| Today's Moves & Pipeline Rhythm | Warm Intro State Machine |
| :--- | :--- |
| **Actionable 5-Move Queue**<br/>Surfaces at most 5 high-priority actions per day (reply checks, deal reviews, touch approvals, closeouts), each paired with ready-to-send copy. | **Deterministic Relationship Ledger**<br/>Tracks intros end-to-end (ask, forward, intro, meeting, close-the-loop). Enforces connector etiquette: one open ask per connector, 14-day rest intervals, and give-before-get thresholds in code. |

| Deterministic Signal Radar | Multi-Agent Coordination Hub |
| :--- | :--- |
| **Free, Code-First Research Layer**<br/>Monitors job boards (Greenhouse, Lever, Ashby, Workable), tech stack indicators, news, and Hacker News via plain HTTP before any LLM inference occurs. | **Native Model Context Protocol (MCP)**<br/>Exposes workspace state, playbook positioning, and warm paths to external coding agents and tools via standard MCP tools and REST webhooks. |

| Studio: Marketing Copy That Sounds Human | Copy Tools for Outside Agents |
| :--- | :--- |
| **Receipts, Moves, Lint, a Blind Reader**<br/>20 formats with real platform limits (each with its source and how it was verified). Every specific must trace to the founder's material or an approved claim. Deterministic lint for AI tells (Wikipedia's signs, Kobak et al. excess vocabulary, density scoring), "up to" vs "on average" drift and unproven superlatives. | **`get_copy_guide` and `check_copy`**<br/>Claude Code, Cursor or n8n get the same format specs, moves and receipts over MCP and REST, and lint their own drafts at zero token cost to Inroad. |

| Event & Executive Dinner Planning | Sourced Deal Dossiers |
| :--- | :--- |
| **Geographic Prospect Clustering**<br/>Visualizes pipeline deals and customers on a local map. Set a dinner venue and radius to instantly generate scored guest lists and tailored invites. | **Verifiable Provenance**<br/>Every angle, prospect pain point, and qualification hypothesis links to exact source URLs and dates. Speculative inferences are stamped as unconfirmed bets. |

---

## Architecture

Inroad is structured around a local-first reactive model where deterministic signal scrapers, atomic JSON storage, and a multi-tiered LLM orchestration loop interact through typed boundaries.

```mermaid
flowchart LR
    subgraph Client["Client Surface (Next.js 16 / React 19)"]
        UI["Today / Moves / Board UI"]
        CmdK["Command Palette (Ask ⌘K)"]
        SSEListener["SSE Stream Consumer"]
    end

    subgraph Gateway["Application Layer & Integrations"]
        API["Route Handlers (/api/*)"]
        MCPEndpoint["MCP Server & REST Gateway"]
        WebhookHandler["Webhook Dispatcher"]
    end

    subgraph Core["Execution Engine"]
        Engine["Agent Engine (src/lib/ai/engine.ts)"]
        SignalPipeline["Signal Fetchers (src/lib/signals/*)"]
        SSRFGuard["Guarded Undici Dispatcher"]
        IntroSM["Intro & Move State Machine"]
    end

    subgraph Storage["Persistence Layer (data folder)"]
        FileDB["Atomic FileDB (JSON Store)"]
        SecretVault["Secrets (secrets.json + OS credential store)"]
    end

    UI -->|REST / Mutations| API
    CmdK -->|Prompt Stream| API
    SSEListener <---|Event Stream (SSE)| Engine

    MCPEndpoint <-->|External Tools & Agents| API
    API --> Engine
    API --> IntroSM

    Engine -->|Web / News / Job Signals| SignalPipeline
    SignalPipeline --> SSRFGuard
    SSRFGuard -->|Sanitized HTTP| ExternalWeb[("Public Web")]

    Engine -->|LLM Inference (Opus / Sonnet / Haiku)| ClaudeAPI[("Anthropic API or OpenAI-compatible provider")]
    IntroSM --> FileDB
    Engine --> FileDB
    API --> SecretVault
```

### End-to-End Execution Flow

1. **Intake & Signal Scanning**: A scheduled task or founder prompt triggers `src/lib/signals/http.ts` to crawl public company endpoints, career portals (Greenhouse, Ashby, Lever), and news feeds using an SSRF-hardened HTTP client.
2. **Deterministic Pre-Processing**: Signal parsers extract structured events (new leadership hires, platform migrations, seed funding) and summarize them into a compact plaintext digest entirely in Node.js runtime code.
3. **Multi-Tier Agent Reasoning**: The compiled digest is handed to `src/lib/ai/engine.ts`. On Anthropic, the engine dispatches synthesis to Claude (Opus 5.5 for ICP positioning, Sonnet 5.5 for draft generation, Haiku 5.5 for triage), and prompts use structured cache breakpoints to prevent re-billing stable system contexts. Every other provider goes through the OpenAI-compatible Chat Completions API (`src/lib/ai/openai-compat.ts`) with the model you pick; see [Choosing your AI provider](#choosing-your-ai-provider).
4. **Validation & Quality Gates**: The agent invokes zod-validated tools (`submit_playbook`, `draft_touch`). Terminal tools halt generation and stream structured JSON through `src/lib/quality/gates.ts` to verify length constraints, link presence, and tone guidelines.
5. **Atomic Persistence & UI Event Stream**: Validated moves and deal updates are committed to the data folder (`.data/` by default) using write-and-rename atomic semantics via `src/lib/store/file-db.ts` and pushed to the client over Server-Sent Events (SSE).

---

## Engineering Deep Dives

### 1. SSRF Guard with Anti-DNS-Rebinding Dispatcher

- **Problem**: Inroad ingests arbitrary website URLs and webhook targets submitted by external agents, webhooks, and founder inputs. Standard Node.js `fetch` is vulnerable to Server-Side Request Forgery (SSRF) and DNS rebinding attacks where a public host name resolves to a private IP (e.g. `127.0.0.1`, cloud metadata `169.254.169.254`, or IPv4-mapped IPv6 `::ffff:127.0.0.1`) after initial validation.
- **Approach**: Implemented a custom `undici` Agent with a `guardedLookup` hook in `src/lib/signals/http.ts`. The resolver checks every resolved IP against an explicit `net.BlockList` of IPv4/IPv6 private, link-local, loopback, and CGNAT subnets at socket connection time, repeating the verification across every HTTP redirect hop.
- **Why**: Pre-validating URLs via a standalone `dns.resolve()` call leaves a time-of-check to time-of-use (TOCTOU) gap that DNS rebinding exploits. Hooking resolution inside socket connection guarantees that the actual connected remote address is validated.
- **Tradeoff**: Increases outbound request latency by ~10–20ms for double DNS lookups and prevents indexing intranet test servers without explicit loopback exemptions in test fixtures.

### 2. Tiered LLM Orchestration with Two-Point Prompt Caching

- **Problem**: Generating thorough account dossiers and multi-touch outbound campaigns consumes large token volumes when full system instructions, ICP definitions, and company dossiers are repeatedly re-sent across conversational turns.
- **Approach**: Built a single streaming loop (`src/lib/ai/engine.ts`) enforcing strict model separation and prompt-cache architecture. Heavy positioning tasks run on Opus 5.5, research synthesis runs on Sonnet 5.5, and rapid screening runs on Haiku 5.5. System prompts are structured into ordered blocks where cache breakpoints (`cache_control`) are placed on the immutable foundation and ICP blocks, while dynamic per-account signals are isolated to user turns.
- **Why**: Flat monolithic prompt chains inflate token costs linearly with conversation depth. Hierarchical block caching allows 70–85% of input tokens to hit Anthropic prompt cache reads at a 90% discount.
- **Tradeoff**: Editing the core ICP definition or system prompt invalidates the cache for downstream requests, incurring a one-time cold write penalty.

### 3. Pure-Code Warm Intro Engine & Connector Etiquette Ledger

- **Problem**: Using generative LLMs to manage relationship state, intro timings, and nudge cadences frequently results in inconsistent status evaluations, duplicated messages, and boundary violations (e.g. badgering mutual contacts).
- **Approach**: Built a deterministic finite-state machine in `src/lib/intros/rules.ts` that manages the intro lifecycle (`asked` → `forwarded` → `introduced` → `meeting` → `done`). The engine maintains an explicit give/get ledger with strict timing constants (`connectorRest: 14 days`, `nudgeAfter: 5 days`, `giveFirstAfter: 3 asks`).
- **Why**: Connector etiquette requires deterministic guarantees that cannot fail due to model drift or hallucinations. Running relationship rules in TypeScript ensures 0 token cost, instant evaluation, and verifiable invariants tested across 14 regression cases.
- **Tradeoff**: Rules require explicit code modifications to change timing thresholds rather than prompt-based natural language adjustments.

---

## How It Keeps Token Spend Low

Inroad enforces strict token economics to ensure sustainable operating costs:

1. **Code Gathers, Claude Writes**: Public company websites, career portals (Greenhouse, Lever, Ashby, Workable), news, and DNS records are scraped via plain HTTP, cached locally, and compressed into compact digests before any model invocation.
2. **Model Tiering by Cognitive Complexity**:
   - **Opus 5.5**: High-level positioning and ICP strategy definition.
   - **Sonnet 5.5**: Deep research synthesis and personalized draft composition.
   - **Haiku 5.5**: Candidate screening, classification, and metadata extraction.
   - **TypeScript**: Ranking, scoring, deduplication, and syntax linting (0 tokens).
3. **Capped Search Fallback**: Direct scraping is prioritized; external web searches are limited to fallback queries with strict call quotas.
4. **Prompt Cache Breakpoints**: Static system context and workspace definitions remain warm in cache across turns.
5. **External Agent Token Decoupling**: When peer agents (Cursor, Claude Code) interact via Inroad's MCP server, their host environments fund their own inference.
6. **Rule-Driven Warm Intros**: Relationship workflows, follow-up timers, and connector cooldowns run completely in code.
7. **Offline Geocoding & Mapping**: Over 200 startup hubs are mapped using offline coordinates and mathematical radius calculations; map tiles load via OpenFreeMap with zero model involvement.
8. **Structured People Lookup**: Employee identification and email resolution leverage direct API integrations (Apollo, FullEnrich) with credit limits instead of expensive LLM search loops.

Every execution outputs a transparent receipt:
`Worked for 1m 52s · 9 sources · $0.04`

---

## Technology Stack

### Client Layer
- **Framework**: Next.js 16 (App Router, Server Actions)
- **UI Primitives**: React 19, Radix UI (Dialog, Dropdown, Popover, Tooltip), cmdk
- **Styling & Motion**: Tailwind CSS 4, Motion 14, `@number-flow/react`

### Orchestration & AI
- **LLM SDK**: `@anthropic-ai/sdk` with adaptive thinking integration; every other provider through the OpenAI-compatible Chat Completions API
- **Model Tiers**: Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5 on Anthropic; elsewhere, the model you pick and its smaller sibling
- **Validation**: Zod 4 for tool schemas and runtime type safety
- **Agent Integration**: Model Context Protocol (MCP) server over Streamable HTTP (`/api/mcp`) and a REST API, both authenticated with agent keys

### Signals & Security
- **HTTP Client**: `undici` with custom `guardedLookup` and `net.BlockList` anti-SSRF protections
- **HTML Parsing**: `node-html-parser` for high-throughput DOM digestion
- **Mapping**: MapLibre GL, OpenFreeMap tiles, and local geometric distance algorithms

### Persistence & Storage
- **Workspace Store**: Local-first atomic JSON persistence (`src/lib/store/file-db.ts`)
- **Secrets Management**: AI provider keys in the system credential store via `@napi-rs/keyring` (or an AES-256-GCM encrypted file where there is none); connector keys in `secrets.json`; neither ever reaches the browser

### Desktop & Testing
- **Mac App**: Electron and electron-builder (`desktop/`)
- **Tests**: Vitest (unit tests and recorded workflow replays), Playwright (browser end to end)

---

## Getting Started

### Prerequisites
- Node.js 20.9 or newer (24 is what CI uses; `.nvmrc` says so for `nvm use`)
- npm (version 10 or later)
- A key for the AI provider you choose (optional with the built-in mock server, and Ollama needs none)

### Quick Start

1. **Clone and install dependencies**:
   ```bash
   git clone https://github.com/aiden-guan/inroad.git
   cd inroad
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env.local
   # Optionally add a provider key (e.g. ANTHROPIC_API_KEY), or paste it on the first screen
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to start.

Inroad runs on the AI provider you choose: paste a key on the first screen (or in Settings → General → AI provider)
and the provider follows the key. See [Choosing your AI provider](#choosing-your-ai-provider). Want to look around first? Choose
**Explore a sample workspace**; it's labelled as made up everywhere, and **Start with my company** leaves it in one
click.

For using Inroad every day (a production server, where your data lives, backups, a public URL that doesn't change),
see [Running Inroad day to day](#running-inroad-day-to-day).

### Choosing your AI provider

| Provider | Key looks like | Notes |
|---|---|---|
| Anthropic (Claude) | `sk-ant-…` | What Inroad was built and tuned on: built-in web search, prompt caching, the best results. |
| OpenAI | `sk-proj-…` | |
| Google Gemini | `AIza…` | A Google AI Studio key. |
| xAI (Grok) | `xai-…` | |
| Groq | `gsk_…` | Open models (Llama, Qwen, gpt-oss) on fast hardware. |
| OpenRouter | `sk-or-…` | Hundreds of models from one key; its model list includes prices, so spend is counted. |
| Mistral, DeepSeek, Together AI | | |
| Ollama | no key | Models running on your own computer, free and private. Pick one that supports tools. |
| Other | | Any OpenAI-compatible API: paste its base URL (https, or http on this computer) and key. |

Everything but Anthropic goes through the OpenAI-compatible Chat Completions API. When you connect, Inroad checks the
key by reading the models it can use, picks one to run everything (and its smaller sibling, like `…-mini`, for quick
sorting and rewrites), and lets you change it or split models by task in Settings.

Two differences off Anthropic:

- **Web search** is chosen independently under Settings → General → Web search: Firecrawl, DeepSeek, TinyFish,
  Tavily, Exa, Brave Search, or a custom HTTP search adapter. Existing Firecrawl connections keep working. Without
  a search connection, research reads company sites, filings and public records but cannot search the web. Pages
  are read by this app. Search charges are separate from model token usage.
- **Spend** is counted only for models with a known price. Anthropic's are built in and OpenRouter publishes its own;
  for the rest, add the price per million tokens under Settings → AI provider → Prices, or the receipts and monthly
  budget can't count real money (they say so instead of showing $0 as free). Set a spend limit with your provider too.

Web search keys saved in Settings use the existing local integration secret store (`secrets.json`), separate from
workspace exports and backups. **Test search** makes one request and may use provider credits. Choosing **Off**
disables external search for compatible models; Claude retains its built-in search. See the
[provider contracts, competitor research, and compatibility roadmap](docs/research/frontrunner-tinyfish-compatibility.md)
for the custom adapter format and the limits of connecting arbitrary tools.

The prompts were written and tested on Claude. Other capable models (with tool calling) work through the same
workflows; small local models may need a retry now and then.

**Where your key is kept.** In your computer's credential store: macOS Keychain, Windows Credential Manager, or the
Secret Service (GNOME Keyring, KWallet) on Linux. Where there's none (a headless server, a container), it's an
AES-256-GCM encrypted file (`ai-keys.json`, with its own random key in `ai-keys.secret`, both readable by your user
only). Either way the key is never sent to the browser after you save it (you see the provider and the last four
characters), never in a backup or an export, and sent only to the provider you chose. A key saved by an earlier version
of Inroad in `settings.json` is moved into the credential store the first time Inroad reads it.

---

### Zero-Key Offline Mock Mode

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

---

## The Mac app

Inroad is also a Mac app: the same Inroad in its own window, no Terminal needed. It runs its server inside the app,
on this Mac only, keeps your work in `~/Library/Application Support/Inroad/Workspace`, and your AI key in the Mac
Keychain.

**Get it.** On GitHub, open **Actions → Mac app**, pick the latest green run, and download **Inroad-mac-arm64**
(Apple silicon: M1 and later) or **Inroad-mac-x64** (Intel). Tagged versions (`v0.2.0`) are also attached to a
**Release**. Open the `.dmg` and drag Inroad into Applications.

**The first time you open it.** Until the app is signed with an Apple Developer ID (below), macOS blocks it as coming
from an unidentified developer. Open it once, then go to **System Settings → Privacy & Security**, find the line
saying Inroad was blocked, and choose **Open Anyway**. Or, in Terminal: `xattr -dr com.apple.quarantine
/Applications/Inroad.app`. You only do this once per version.

**Day to day.** Closing the window keeps Inroad in the Dock; quitting stops its server. **Inroad → Settings…** (⌘,)
opens Settings; **Help** opens the data folder and the server log (`~/Library/Application Support/Inroad/Logs`).
**Inroad → Open at Login** starts it when you log in, so hooks, the public URL and agents keep reaching it. Opened
from the disk image or Downloads, Inroad offers to move itself to Applications. If its server quits after running a
while, the app starts it again by itself (once in ten minutes) and puts you back on the page you were on.

**Updates, in one click.** Every 6 hours (and from **Inroad → Check for Updates…** or Settings → General → Updates)
the app asks GitHub for the latest release. A newer one downloads in the background, is checked against the SHA-256
GitHub publishes for it (or the release's `SHA256SUMS.txt`), and then by macOS: a valid signature, from the same
developer as the copy you have when that copy is signed, and the version it claims. When it's ready, the sidebar says
so: **Restart to update** backs up your workspace, quits, swaps the new app in where the old one was and opens it. If
the swap fails, the old app is put back and opened. Your data and Keychain key aren't touched. This works for ad hoc
builds too (Electron's own updater only installs into apps signed with a Developer ID). It needs Inroad in a folder
your account can change (Applications, for an admin account); otherwise Settings says why and links the download.
Automatic checks can be turned off in Settings. A check tells GitHub your IP address and which version you run,
as any download would, and nothing about your work.

**Build it yourself on a Mac:**

```bash
npm ci
npm run desktop:server -- --platform darwin --arch arm64   # the app's server (x64 for Intel)
npm run desktop:dist -- --arm64 -c.mac.identity=-          # desktop/dist/Inroad-<version>-arm64.dmg
npm run desktop:dev                                        # or run the shell from the repository
npm run desktop:test                                       # check the shell (on Linux: xvfb-run npm run desktop:test)
```

**Signing for release.** A paid Apple Developer Program membership gives you a Developer ID Application certificate.
Add these repository secrets and the Mac app workflow signs every build and has Apple notarize it, so it opens like any
app from the internet: `MAC_CERTIFICATE` (the certificate exported as .p12, base64), `MAC_CERTIFICATE_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. Before the first release, change `appId` in
`desktop/electron-builder.yml` to a reverse-DNS name you own. The Mac App Store would need App Sandbox, which this
build doesn't use.

**Publishing an update.** `npm run release -- 0.2.0` sets the version in `package.json`, `package-lock.json` and
`desktop/app/package.json`, moves the changelog's Unreleased notes under `v0.2.0`, commits and tags. Pushing the tag
(`git push origin main v0.2.0`) runs the Mac app workflow, which refuses a tag that doesn't match those versions,
builds both chips and publishes the release with `SHA256SUMS.txt`. Installed apps find it within 6 hours. Keep signing
the same way from release to release: an app signed with a Developer ID only accepts updates signed by the same team.

---

## Verification & Testing

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

### Test Suite Highlights
- **Coverage**: 1,146 tests across 109 files (about 27 seconds in one measured run).
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
offline suite replays whichever tape of a workflow was recorded last, the real one or the mock's, so it replays real
wire shapes until `npm run tapes:record` records that workflow again.

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

### Continuous integration

CI (`.github/workflows/ci.yml`) runs on every push and pull request: `npm ci`, `next typegen`, `tsc --noEmit`,
`eslint src`, `npm test`, the evals and `next build`, and the browser tests above as a separate `e2e` job that uploads
the Playwright report when it fails. The Mac app is built by `.github/workflows/desktop.yml` on GitHub's Mac runners.

---

## Running Inroad day to day

Inroad is a single-user app that runs on your own computer, and it is built that way on purpose (SPEC non-goal 6):
your prospects, notes and keys never sit on someone else's server.

### The production server

```bash
npm run build      # once (an update from Settings builds again by itself)
npm start          # http://localhost:3000; `npm start -- -p 3001` for another port
```

It's faster and lighter than `npm run dev`. To have it running whenever you are, make `npm start` (run in this
folder) a login item: a LaunchAgent on macOS, a Task Scheduler task "at log on" on Windows, a systemd user service on
Linux. Webhooks, the public URL and remote agents only reach Inroad while the computer is awake and Inroad is running;
while it's open, connected sequencers, booking tools and CRMs are also polled every few minutes, so nothing is lost
when a webhook can't get through.

### Updating

Settings → General → Updates shows the commits on GitHub that this copy doesn't have yet, and the sidebar says when
there are some. **Update now** does the rest:

1. It backs up the workspace (Settings → Data → Backups lists it as "Before an update").
2. The launcher (`scripts/serve.mjs`) stops the server and shows an "Updating Inroad" page on the same port, which the
   open tab follows step by step.
3. It fast-forwards the branch this copy follows (`git merge --ff-only`), runs `npm ci` when `package-lock.json` or
   `package.json` changed, and `next build` under `npm start`.
4. It starts Inroad again, and the tab reloads into the new version.

If installing or building fails, it puts the commit it was on back (`git reset --hard` to it), installs and builds
that again and starts it, so you're back where you were; Settings and a message say what failed. It only ever moves
forward: it won't update while one of Inroad's own tracked files is changed on this computer, or when this copy has
commits that aren't on GitHub, and says what to do instead (untracked files, like `.data/`, are never touched).
Anything running when you update (research, drafts) stops, so the button asks first. A check is a `git fetch` of
the branch this copy follows, every 6 hours while Inroad runs; turn it off in Settings. Started without the launcher
(a bare `next start`), Inroad can't restart itself, so it shows the commands instead: `git pull`, `npm ci`,
`npm run build`. A new version of the launcher itself takes effect the next time you run `npm start`.

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
Inroad's own older files are tightened when it starts (anything else in the folder is left alone). That keeps other accounts from reading them on disk; while Inroad is
running, the app itself answers anyone on this computer (see "Only this computer" above). Your AI provider key is in
the system credential store (or `ai-keys.json`, encrypted), connector keys and the named tunnel's token in
`secrets.json`, agent keys (hashed) in `keys.json`: those belong to this computer and are never in a backup or an
export.

**What leaves your machine:** calls to your AI provider with the context a task needs (none with Ollama); free public
lookups that carry company names and domains (company websites, job boards, news, Hacker News, DNS); place names to
OpenStreetMap (can be turned off) and map tiles from OpenFreeMap; update checks to GitHub (a `git fetch`, or the Mac
app reading the latest release; nothing about your work, and they can be turned off); and what you push to the tools
you connect. Company
icons are first letters unless you turn on fetching each company's icon from its own site (Settings → General); no
favicon service ever sees your list.

### Backups

- **Automatic:** a copy of every workspace file each day you open Inroad and before every reset, sample, restore or update,
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
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY` | Other providers' keys, the same way. `OPENAI_API_KEY` also paints Studio's image layers when no OpenAI key is saved under Settings → General. |
| `INROAD_AI_PROVIDER`, `INROAD_AI_MODEL`, `INROAD_AI_BASE_URL`, `INROAD_AI_KEY` | Pick a provider without the app (servers, scripts): its id (`openai`, `gemini`, `xai`, `groq`, `openrouter`, `mistral`, `deepseek`, `together`, `ollama`, `custom`), the model, and for `custom` the base URL and key. The choice in Settings wins. |
| `OPENAI_BASE_URL` | Send OpenAI calls (chat and Studio images) somewhere else (a gateway); `npm run dev:mock` points it at the mock. |
| `INROAD_KEYCHAIN` | `off` keeps keys in the encrypted file instead of the system credential store. |
| `INROAD_UPDATE_CHECK` | `off` stops this server from asking GitHub for updates by itself; Settings → Updates → Check now still asks. |
| `FIRECRAWL_API_KEY` | A Firecrawl key for web search off Anthropic, if it is not saved under Web search or connected under Integrations. |
| `INROAD_SEARCH_PROVIDER` | External search provider: `auto` (default), `off`, `firecrawl`, `deepseek`, `tinyfish`, `tavily`, `exa`, `brave`, `custom`, or `connected`. A saved selection wins. DeepSeek requires an explicit choice. |
| `TINYFISH_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_SEARCH_API_KEY` | Search provider keys; DeepSeek search uses `DEEPSEEK_API_KEY` or the saved DeepSeek model key. |
| `INROAD_SEARCH_CONNECTION_ID` | Id of an enabled MCP/OpenAPI connection with a mapped search capability, when using `connected` without saved settings. |
| `INROAD_SEARCH_URL`, `INROAD_SEARCH_KEY` | Full custom search adapter URL and optional bearer key. Receives `{query, limit}` and returns `{results: [{url, title, description}]}`. HTTPS, or HTTP on loopback. |
| `PORT` | The port (default 3000; `-- -p` works too). |
| `INROAD_HOST` | The address to listen on (default 127.0.0.1). |
| `ANTHROPIC_BASE_URL`, `FIRECRAWL_API_URL` | Where those APIs are; `npm run dev:mock` points both at the mock. |
| `MOCK_PORT` | The mock's port (default 4010), for `npm run mock:anthropic` and `npm run dev:mock`. |

---

## Repository Structure

```text
inroad/
├── desktop/                     # The Mac app: Electron shell and its updater, electron-builder config, its tests
├── docs/                        # Architecture specs and GTM research notes
│   ├── SPEC.md                  # Comprehensive product specification
│   └── research/                # Operator interviews, API evaluations, token studies
├── e2e/                         # Playwright browser tests, offline against the mock
├── public/                      # Static brand and icon assets
├── scripts/                     # Launcher (serve.mjs) and its updater, mock AI APIs, live smoke, tape recorder, evals, desktop build, release
├── src/
│   ├── app/                     # Next.js 16 App Router pages and API routes
│   │   ├── api/                 # Endpoints: companies, deals, intros, mcp, settings
│   │   ├── companies/           # Account dossiers, stage tracking, warm paths
│   │   ├── events/              # Executive dinner and roundtable planning
│   │   ├── intros/              # Relationship ledger and warm intro board
│   │   ├── playbook/            # Founder ICP, messaging bets, and objections
│   │   └── studio/              # Marketing and launch copy from the founder's material
│   ├── components/              # React UI components organized by domain surface
│   │   ├── today/               # Daily 5-move queue and scoreboard
│   │   ├── shell/               # Navigation, command palette, and run feeds
│   │   └── map/                 # Interactive geospatial prospect clustering
│   ├── lib/                     # Core business logic and infrastructure
│   │   ├── ai/                  # Agent engine, providers (Anthropic, OpenAI-compatible), prompts, SSE streaming
│   │   ├── consumer/            # Consumer mode: market read, benchmarks, growth math, creator rules, compliance
│   │   ├── api-keys/            # MCP server implementation, REST auth, tools
│   │   ├── connectors/          # Firecrawl, Apollo, and FullEnrich clients
│   │   ├── domain/              # Workspace entities, actions, and reducer
│   │   ├── intros/              # Warm intro state machine and etiquette rules
│   │   ├── moves/               # Daily action generation and priority scoreboard
│   │   ├── quality/             # Content safety gates, draft linters, sequences
│   │   ├── signals/             # SSRF-guarded HTTP client, job board and news parsers
│   │   ├── store/               # Atomic local-first JSON database (FileDB), AI key storage
│   │   └── studio/              # Copy formats, moves, receipts, intake and marketing lint
│   └── test/                    # Test fixtures, mock servers, and test setup
├── .env.example                 # Documented environment variable template
├── package.json                 # Dependency definitions and lifecycle scripts
├── playwright.config.ts         # Playwright configuration for the browser tests
└── vitest.config.mts            # Vitest configuration for hermetic test execution
```

---

## Project Status & Limitations

- **Maturity**: Functional MVP with complete local-first persistence, offline mock test environment, production Next.js 16 build, and a Mac app.
- **Model Support**: Built and tuned on Anthropic Claude (Opus, Sonnet, Haiku 5.5). OpenAI, Gemini, xAI, Groq, OpenRouter, Mistral, DeepSeek, Together AI, Ollama and any OpenAI-compatible API run the same workflows through Chat Completions; off Anthropic, web search uses the independently selected search provider and model spend is counted only for models with a known price. External search charges are billed separately by the search provider. Studio graphics can also paint an optional picture layer with OpenAI GPT Image, on a separate OpenAI key the founder saves under Settings → General.
- **Studio graphics limits**: the image path through OpenAI was tested against a local mock of the Images API, not against OpenAI itself (the build environment couldn't reach api.openai.com). OpenAI may require organization verification before GPT Image models work. Graphics render with the fonts installed on your machine (the designs name Georgia, Inter or Helvetica, and Menlo, with fallbacks), so the same SVG can look slightly different on macOS, Windows and Linux.
- **Single Fixed Workstation**: Data resides in the data folder on the local machine; cross-device multi-tenant cloud synchronization requires an external database adapter. See [What it can't do](#what-it-cant-do).
- **Email Dispatch Boundary**: Inroad deliberately omits automated SMTP/IMAP senders. All outreach requires manual founder approval to prevent automated spam penalties.
- **Studio research limits**: most campaign quotes and platform limits were read through search excerpts of the cited pages (direct fetches were blocked when the research ran), so each limit records how it was verified. B2B research beyond Ramp and the B2B effectiveness literature (95:5, Binet & Field) are not yet verified and are left out. No campaign line has controlled evidence linking it to conversion; Studio tells founders to test options against paid conversions.

---

## License

This project is licensed under the terms of the [MIT License](LICENSE).
