# Inroad build contract

Inroad is an AI Head of GTM for technical founders (founder-led sales, first paying customers) and an
all-in-one GTM hub that other tools and agents plug into. Read this before writing code. It overrides
anything in `docs/SPEC.md` where they disagree.

**Spec translation table** (SPEC.md rev 2 → this build):
- "Ember" (agent name) → no agent name. The agent speaks in first person and is labeled "your Head of GTM" + `AI` badge.
  Read "Ask Ember" as "Ask", "Ember found…" as "I found…". The product name Inroad appears in the wordmark/title only.
- "Ink & Ember" / amber accent → **Paper, Ink & Blue Pencil** (tokens already in `globals.css`). Everything SPEC says
  is "ember-colored" uses `accent` (blue pencil).
- Everything else in SPEC.md rev 2 (surfaces, stages, workflows W1–W12, copy, rules, schemas) applies, adapted to the
  types in `src/lib/domain/types.ts` (which are authoritative for field names).

## Product decisions (final)

- **One name: Inroad.** The agent has no human name. It speaks in first person ("I found 3 accounts…"),
  is shown as the blue-pencil **orb** plus an `AI` badge (`<AiBadge/>`), and is called "your Head of GTM" in copy.
- **Surfaces:** Today · Companies · Events · Playbook, plus Integrations and Settings. The Ask window (⌘K → Ask) is global.
- **Stages (6):** talking · qualified · pilot · proposal · won · lost/nurture. A deal starts at the first real
  conversation. Touches live on the person/company timeline, not the board.
- **One qualification card** (`QualificationCard` + `Qualification` score): pain, spend, critical event, champion,
  economic buyer, fit, decision process. Qualified = score ≥ 8/12.
- **Goal:** default 5 paid pilots or design partners in 12 weeks (long arc 20 customers). The goal is an output of
  capacity; never tell the founder to "send more".
- **Caps:** 25 cold-email first touches/week, max 20/day. LinkedIn and intro asks don't count.
- **Warm first:** the LinkedIn Connections.csv import (screened for ICP fit, job-change diffs) is a first-class source.
- **Drafting:** one draft at a time; "different angle" generates a new angle (not a paraphrase), lazily. Follow-ups
  are generated when due. Cold drafts must use a founder POV item (`ws.povs`) or a credential. With zero approved
  claims the frame is advice/expert-interview (`founder_card`). Evidence is per span (`personalizedSpans`).
- **Human in the loop, always.** Inroad never sends, posts, connects, or changes a deal stage by itself. It drafts and proposes.
- **Receipts.** Every run ends with "Worked for 1m 52s · 9 sources · $0.04". Every fact shows its source.
- **No 06:00 scheduler.** Things are prepared on first open of the day; carry-over moves show instantly.

## Cost policy (the founder asked to minimize token spend)

1. **Code gathers, Claude writes.** Use `gatherSignals()` (`src/lib/signals`) — website crawl, job boards, news,
   Hacker News, DNS — all free and disk-cached. Give Claude the compact `digest`, never raw HTML.
2. **Route models** via `tier` on `ctx.agent(...)`:
   - `strategist` (Opus 5.5): positioning/ICP/playbook only.
   - `operator` (Sonnet 5.5): dossiers, drafting, prep, debrief, reviews, dinner plan, Ask.
   - `fast` (Haiku 5.5): classification, screening, extraction, short copy. **No web tools on Haiku.**
3. **Web search is a capped fallback** (`webSearch: 3–5`), used only when free sources come back thin. Set `webFetch`
   only when a URL truly needs reading and isn't in the digest.
4. **Reuse results:** dossiers are fresh for 7 days; don't regenerate unless asked or a high-strength signal arrived.
5. **Deterministic first:** ranking, scoring, dedupe, lint, templated titles — all in code. No LLM for things code can do.
6. Effort: `low` for Haiku and simple Sonnet copy, `medium` for synthesis, `high` only for the Opus playbook.
7. **People data is a lookup, not a search.** With Firecrawl connected, contacts come from Apollo and FullEnrich via
   `src/lib/people/directory.ts` (code, zero tokens). Search is free; every paid lookup is one founder click with its
   most-cost shown first, checked against the monthly credit limit. Work emails only: never personal email or phone.
8. **Intros are rules, not prompts.** `src/lib/intros/rules.ts` decides whose move an intro is, the connector
   ledger and every company's ways in; `templates.ts` writes the nudge, reply-to-intro and thank-you notes. Pure
   and shared by Today, /intros, the sheet and the agent API. One nudge per ask; one open ask per connector and
   per company; nothing about one side of a give reaches the other until both said yes.

## Architecture you must use

- **Data:** `src/lib/domain/types.ts` (the model), `src/lib/domain/actions.ts` (founder mutations, pure reducer).
  - Client: `useWorkspace()` → `{ ws, dispatch(actions), refresh }`. `dispatch` is optimistic. Generate ids with
    `newId(prefix)` and timestamps with `nowISO()` in the caller (see `src/lib/domain/ids.ts`).
  - Server (workflows/routes): `readWorkspace()` / `mutateWorkspace(fn)` from `src/lib/store/workspace.ts`.
  - Secrets (integration API keys) **never** go in the workspace: `getSecret/setSecrets/secretKeysSet`.
  - You may make **additive** edits to `types.ts` and `actions.ts` (new optional fields, new action types). Re-read the
    file right before each edit and keep edits small; other builders edit these files concurrently. Never rename or
    remove existing fields.
- **Agent runs:** define workflows in `src/lib/workflows/<id>.ts` with `defineWorkflow` (already registered in
  `src/lib/workflows/index.ts`; edit only your own file). Inside `run(ctx)`:
  - `ctx.agent({ tier, system: [EMBER_CORE, RULES, companyContext(ws)], messages, tools, webSearch, webFetch, effort, requireTerminal })`
    — see `src/lib/ai/engine.ts`. Structured output = a **terminal tool** (`defineTool({ name: "submit_x", terminal: true, schema })`);
    terminal tools are sent with `strict: true` (size constraints are moved into descriptions automatically and enforced
    by zod afterwards). "Up to N, never pad": use `.max(n)` not exact lengths, and allow empty arrays.
    Put `taskHeader()` (today's date) and per-request data in the user message, never in `system`.
  - Stream progress with `ctx.emit({ type: "status" | "action" | "read" ... })` so the work log feels alive even during code-only steps
    (e.g. emit `read` for each page `gatherSignals` crawled).
  - Persist results with `ctx.mutate(ws => …)` **inside the workflow** (runs outlive the tab). Return a small summary
    object (include `drafts: n` if you created drafts — it shows on the receipt).
  - Call `ctx.noteFreeSignals(signals.lookups)` after free lookups.
  - Start from the client with `useRuns().start(workflowId, args, { onResult })`. Show progress with
    `<WorkLog run={...}/>`; find a run for an entity with `useRunFor(ref, workflow)`.
- **Prompts:** `src/lib/ai/prompts/core.ts` has `EMBER_CORE`, `companyContext(ws)`, `taskHeader()`. Put your
  workflow's expertise rules in a `RULES` string in your workflow file (or `src/lib/ai/prompts/<area>.ts`). Encode the
  real GTM expertise from `docs/research/` — concrete numbers, frameworks, banned phrases — not generic advice.
  Every field description in a submit schema should state its length limit.
- **Cross-surface components (contracts are fixed, implementations owned by one builder):**
  - `CompanySheet({ domain, onClose })` — `src/components/companies/sheet/company-sheet.tsx` (owner: company-sheet).
    Open via URL: `/companies?c=<domain>`.
  - `DraftView({ pkg, step, focused, onApproved })` and `ComposeButton({ domain, personId, angleId, mode, label })` —
    `src/components/compose/composer.tsx` (owner: composer).
  - `lintDraft(input)` — `src/lib/quality/lint.ts` (owner: composer).
  - `AskDialog` — `src/components/ask/ask-dialog.tsx` (owner: ask). Open with `useAsk().openAsk({ context, prefill })`.
  - `AskPanel({ context })` — `src/components/ask/ask-panel.tsx` (owner: ask): the same conversation embedded inline.
    The company sheet renders it as an "Ask" tab, so Ask never stacks on top of a sheet.
  - `ImportFlow({ kind: "csv" | "linkedin", onDone })` — `src/components/import/import-flow.tsx` (owner: agents-api).
  - `AgentsCard()` — `src/components/agents/agents-card.tsx` (owner: agents-api), rendered on /integrations.
  - `POST /api/integrations/push { packageId, step, integrationId?, campaignId? }` (owner: integrations) — composer calls it.
  - `FindPeople({ account })` and `FindEmailButton({ person })` — `src/components/people/find-people.tsx` (owner:
    integrations): the company sheet's People section and the composer's missing-email form use them. They call
    `POST /api/people/find { domain, titles? }`, `POST /api/people/add { domain, id }` and `POST /api/people/email { personId }`.
- **URL params other surfaces rely on:** `/companies?c=<domain>` (open sheet), `/companies?add=<domain>` (add &
  research), `/companies?view=prospects|talking|customers`, `/companies?log=1` (log a call), `/events?new=1`,
  `/integrations?import=linkedin`, `/integrations#firecrawl` (opens that row), `/intros?i=<id>` (open an intro),
  `/intros?new=give|ask|connector`, `/settings#usage`.

## Design system (follow exactly)

- Read `src/app/globals.css` tokens. **Paper, Ink & Blue Pencil:** warm paper + ink; the single accent (`accent`,
  an editor's blue pencil) belongs to the agent only — orb, citations/margin notes, "needs you" counts, agent CTAs
  (`<Button variant="agent">`). Never color stages or charts with it. Color encodes risk only (danger = overdue,
  warning = at risk).
- Type: Inter for UI (13–14px), **Newsreader** (`font-serif`, `.prose-agent` 17/27) for everything the agent says *to
  the founder* at length (briefs, dossiers, reviews, playbook, Ask answers) and big display lines (masthead dates, empty
  states). **Drafts that go out under the founder's name stay in Inter** (what the recipient will see). Geist Mono
  (`font-mono`) for machine output (domains, timestamps, costs, durations, keys).
- Use the kit: `Button`, `IconButton`, `Input`, `Textarea`, `Label`, `Badge`, `AiBadge`, `Card`, `SectionLabel`,
  `Kbd`, `Tooltip`, `Dialog`, `Sheet`, `Menu`/`MenuItem`, `Popover`, `Segmented`, `Num` (NumberFlow), `Skeleton`,
  `EmptyState`, `CopyButton`, `Markdown`, `Orb`, `Favicon`, `SourceChip`, `MarginNote`, `Cited`, `WorkLog`, `Receipt`.
  Icons: `lucide-react`. Toasts: `toast` from `sonner`. Motion: `motion/react` with tokens from `src/lib/motion.ts`.
- **Provenance is the signature:** at ≥1280px show citations as margin notes in a right gutter beside the sentence
  (`MarginNote`); below that, inline `SourceChip`s.
- Motion rules: UI ≤ 200ms ease-out; exits faster than entrances; `active:scale-[0.97]` on pressables; list stagger
  ≤ 8 items × 40ms, first load only; never animate keyboard-driven or high-frequency actions; no idle loops; respect
  reduced motion (MotionConfig is global). Never `transition: all`. Animate transform/opacity only.
- Layout: content columns max 720px for reading surfaces (Today, Playbook), 1080px for lists. Page padding
  `px-6 md:px-10`, top `pt-8 md:pt-12`. Page titles: Newsreader 32/36. Section labels: `SectionLabel`.
  Must work at 375px width (no horizontal scroll), with visible keyboard focus.
- Gmail handoff URL: `https://mail.google.com/mail/u/{gmailAuthUser || 0}/?tf=cm&to=…&su=…&body=…` (keep the whole URL
  under ~2,000 chars; `mailto:` fallback). Gmail search for "Check replies" uses `from:{a@x.com b@y.com}` braces-OR.
- Copy: plain, specific, sentence case, active voice. Buttons say what happens ("Research these 3", "Open in Gmail").
  Empty states give one next action. Errors say what happened and what to do. No exclamation marks, no emoji, no hype.
- **Never stack layers:** no modal on top of a sheet. Expand inline or widen the sheet.

## Engineering rules

- Next.js 16 (see `node_modules/next/dist/docs/`). Route handlers: `RouteContext<"/path/[id]">`, `await ctx.params`.
  Call `await connection()` (from `next/server`) at the top of any **GET** handler that reads files. Pages are client
  components that read `useWorkspace()`; don't fetch workspace data in server components.
- React 19 + the strict React Compiler lint: no `Date.now()`/`Math.random()` during render, no setState directly in
  effects (derive state or set it in event handlers/async callbacks), no refs read during render.
- Validate every route body with zod; return `errorResponse(err)` from `src/lib/server/http.ts`.
- `npx tsc --noEmit` and `npx eslint <your files>` must pass for your files. Ignore errors in files you don't own.
- Do **not** start `next dev`/`next build` (other builders share this checkout). Don't install packages unless your
  brief allows it; if you must, use exact versions.
- Keep code idiomatic to the existing files: small components, comments only where they explain *why*.
