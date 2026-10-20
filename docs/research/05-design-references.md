# Visual design and motion references for "AI Head of GTM": teardowns, motion specs, the "Ink & Ember" direction and anti-patterns

**How this was gathered (2026-10-19/20).** I downloaded the homepage HTML and stylesheets for 21 reference sites and pulled the typefaces (`@font-face`), color variables, easings and keyframes straight from the CSS. I took screenshots of 14 sites in a browser. I read the source code of Motion, NumberFlow, Vaul and Sonner. Unless marked otherwise, hex values and typeface names below come from those live CSS files, not from blog posts. height.app returned nothing when fetched. The per-turn web-search limit ran out partway through. After that I could still fetch pages and source files directly, but I couldn't search, so some UI details are marked as unverified.

---

## 0. Summary of findings

- **The 2025–26 consensus has moved to warm neutrals, an editorial serif paired with a precise sans, and one accent color.** Cursor (`#f7f7f4`/`#14120b`), Anthropic (`#faf9f5`/`#141413`), Harvey (`#fafaf9`/`#0f0e0d`), Granola (`#fcfcf8`), Cognition (`#f7f6f5`) and Superhuman (`#fcfaf7`) are all warm off-white over warm ink. Linear's March 2026 refresh also moved "toward a warmer, less saturated gray" ([Linear](https://linear.app/blog/behind-the-latest-design-refresh)).
- **A serif for voice, a sans for UI, and a mono for machine output is now the standard type stack.** Examples: Attio (Inter + Tiempos + JetBrains Mono), Raycast (Inter + Instrument Serif + Geist Mono), Cognition (NB International + STK Bureau Serif + Geist Mono) and Linear (Inter Variable + Tiempos Headline + Berkeley Mono).
- **The best agent UIs show receipts, not theater.** Linear shows "Worked for 8 sec", context chips and typed activities. Cursor groups agent tasks into "In progress" and "Ready for review". Attio prints a mono tool-call tree. Granola colors your text black and the AI's text gray.
- **Motion in the best products is fast and plain.** Linear's own CSS uses 100–180ms with ease-out-quad for UI chrome. Drawers use `cubic-bezier(.32,.72,0,1)` at 500ms, the same in Vaul and Linear. High-frequency actions are not animated at all (Emil Kowalski, Rauno Freiberg, Apple's guidelines).
- **Recommendation: "Ink & Ember".** Warm paper and ink neutrals, Inter + Instrument Serif + Geist Mono, and a single ember accent reserved for the agent. The agent itself is a geometric "Ember" orb whose pulses map to real events, not decoration.

---

## 1. Reference teardowns

### 1.1 Linear: the benchmark for density, motion and agent interaction rules
- **Type (from CSS):**
  - `--font-regular: "Inter Variable"` with `font-feature-settings "cv01","ss03"` and `"opsz" auto`.
  - `--font-monospace: "Berkeley Mono"`; `--font-serif-display: "Tiempos Headline"`.
  - Variable weights: 400 / **510** / **590** / 680, which are deliberately in-between steps.
  - Sizes: micro 11–12px, small 13px, regular 15px, title3 20px, title2 24px, title1 36px.
  - Headings use Inter Display ([Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **Palette:**

  | Token | Dark | Light |
  |---|---|---|
  | bg level 0 | `#08090a` | `#fff` |
  | bg level 1 | `#0f1011` | `#f8f8f8` |
  | bg level 2 | `#141516` | — |
  | bg level 3 | `#191a1b` | — |
  | text primary | `#f7f8f8` | `#282a30` |
  | text secondary | `#d0d6e0` | `#3c4149` |
  | text tertiary | `#8a8f98` | `#6f6e77` |
  | text quaternary | `#62666d` | — |
  | border | `#23252a` / `#ffffff14` | `#e9e8ea` |

  Accent is `#7170ff`; brand is `#5e6ad2`. Diff colors are `#27A644` and `#F34E52`.
- **Theming:** the theme system is built in LCH from 3 inputs (base, accent, contrast), down from 98 variables.
- **Radius:** 4 / 6 / 8 / 12 / 16 / 24 / 32 and 9999.
- **Shadows:**
  - `--shadow-low: 0 1px 4px -1px #00000017`
  - `--shadow-medium: 0 3px 12px #00000017`
  - `--shadow-high: 0 7px 24px #0000000f` (dark mode: `0 7px 32px #00000059`)
  - `--shadow-stack-low` is a 5-layer stack: `0 8px 2px #0000, 0 5px 2px #00000003, 0 3px 2px #0000000a, 0 1px 1px #00000012, 0 0 1px #00000014`.
- **Motion (from CSS):**
  - Speed tokens: `--speed-quickTransition: .1s`, `--speed-regularTransition: .25s`, highlight fade-out .15s.
  - Hover background/color: `.16s var(--ease-out-quad)`.
  - Modal: `scaleIn` from `scale(.98)` to 1 with opacity, `.18s`.
  - Context menu: `scale(.9)` to 1, `.1s` ease-out-quad on enter and ease-in-quad on exit.
  - Tooltip: `scale(.9)` to 1, `.12s` ease-out-quad.
  - Mentions: `.1s`. Graph dots: `.42s` from `scale(.4)`.
  - Large transforms: `.5s`/`.7s cubic-bezier(.32,.72,0,1)`.
  - The full easing set (Penner curves) is defined in CSS, e.g. `--ease-out-quint: cubic-bezier(.23,1,.32,1)`, `--ease-out-quad: cubic-bezier(.25,.46,.45,.94)`, `--ease-in-out-quart: cubic-bezier(.77,0,.175,1)`.
- **How the agent is shown** ([Agent Interaction Guidelines](https://linear.app/developers/aig)):
  - Agents carry a badge so they can "never be mistaken for a person".
  - The rules: acknowledge instantly ("Silence leads to uncertainty"), show state (thinking, waiting, executing, done), let humans inspect reasoning and tool calls, disengage when asked, and keep a human accountable.
  - Delegating an issue keeps the human as owner.
- **How work in progress is shown** ([Agent Interaction API](https://linear.app/developers/agent-interaction)):
  - Typed activities: `thought`, `action` ("Searching" then "Searched" plus a result), `elicitation`, `response`, `error`.
  - `thought` and `action` can be **ephemeral**, meaning the next activity replaces them in place.
  - Session states: `pending`, `active`, `awaitingInput`, `error`, `complete`, `stale`.
  - Plans are checklists of `pending/inProgress/completed/canceled` steps.
  - An agent must respond within **10 seconds** or be flagged unresponsive.
  - The [Linear for Agents](https://linear.app/agents) mock shows a model label, "added to context" chips, a collapsed **"Worked for 8 sec"**, and a ranked result list with issue IDs.
- **What to borrow:** typed activity rows, ephemeral thoughts, "Worked for X" receipts, and delegation that keeps the human as owner.

### 1.2 Cursor: warm editorial palette and an agent task inbox
- **Type (from CSS):** `--font-sans: "CursorGothic"` (custom), `--font-serif: "EB Garamond"`, `--font-mono: "berkeleyMono"`, plus a separate `cursorMono`.
- **Palette:**
  - Background: `--color-theme-bg #f7f7f4` (light), `#14120b` (dark).
  - Ink: `#26251e`. Accent: `#f54e00` (also `#34785c`).
  - Cards step in warm shades: light `#f2f1ed`, `#f0efeb`, `#ebeae5`, `#e6e5e0`; dark `#1b1913`, `#1d1b15`, `#201e18`.
  - Borders are warm ink at low alpha: `#26251e06`, `#26251e0d`, `#26251e1a`, `#26251e33`.
- **Work in progress** (homepage product shot):
  - The left rail is grouped **"IN PROGRESS 2"** and **"READY FOR REVIEW 3"**.
  - In-progress rows show a dotted spinner plus the live step ("Reading docs", "Generating plan").
  - Ready rows show a check icon, age ("10m") and a diff stat ("+135 −21").
- **Approvals:** review before merge; nothing ships without the human.
- **What to borrow:** grouping tasks by status with the live step as subtitle, borders as alpha of the ink color, and a serif for content previews.

### 1.3 Attio: the CRM benchmark, with near-invisible shadows and a mono tool tree
- **Type:** `inter`, `interDisplay`, `tiemposText`, `JetBrains Mono`.
- **Palette:**
  - Blacks: `#101010` through `#a4adba` (`#1c1d1f`, `#2e3238`, `#505967`, …).
  - Whites: `#fff`, `#fafafb`, `#f3f4f6`, `#edeff3`, `#e4e7ec`.
  - Blue `#266df0`, green `#0fc27b`, red `#ff5b59`, yellow `#f5b900`. Focus ring `#266df04d`.
- **Shadows** are layered at 1–3% alpha: `0 1px 3px #00000003`, `0 2px 4px -1px #00000005`, `0 4px 8px -2px #00000008`.
- **Radius:** 2 / 4 / 6 / 8 / 12 / 16 / 20px.
- **Work in progress** (homepage): a terminal-style panel shows a "Ran 3 commands" tree with `search-call-recordings-by-metadata`, `get-call-recording` and `create-task` on mono branch lines, next to an "Ask anything…" composer.
- **What to borrow:** shadows you feel rather than see, and a mono tree for tool calls.

### 1.4 Granola: provenance through color, plus a paper feel
- **Type:** `--font-quadrant: "Quadrant Notepad"` (serif display), `melange`, `Jetbrains Mono`.
- **Palette** ("oats" scale):
  - Neutrals: `#fcfcf8`, `#f7f7f2`, `#eaebe5`, `#d5d5d2`, `#acada8`, `#72726e`, `#4e4d4b`, `#292929`.
  - Accent green `#94f27f`, with `#0d7916` for green text. The CTA is olive.
  - Off-black at alpha: `#56512e1f`.
- **How the agent is shown:** there is no bot avatar and no meeting bot; the AI is ambient. "Everything from you is in black, everything else is in gray" ([Granola launch post](https://www.granola.ai/blog/announcement)). A "Zoom in" control shows the exact quotes behind a note.
- **What to borrow:** two-tone text that shows who wrote what, and citations you can expand to the source quote.

### 1.5 Sierra: human outcomes first, with the agent as a quiet overlay
- **Type:** `gtAmerica` and `gtAmericaMono` only.
- **Palette:**
  - Greens: `#006838`, `#05351d`, `#00913c`.
  - Warm grays: `#f6f5f3`, `#e4e0dc`, `#898683`, `#302e2d`. Black is `#222`.
  - Blues: `#4584c6`, `#126ceb`.
- **How the agent is shown** (screenshot): full-bleed photography of real people (a parent and baby), with the agent appearing as small frosted-glass chat bubbles in the corner carrying the Sierra mark. There is no face and no orb hero. The product language is about outcomes: "Pay for a job well done".
- **Work in progress:** the "Observability" product promises to show "every agent action — from tool calls, knowledge lookups, latency" ([sierra.ai](https://sierra.ai)).
- **What to borrow:** the human's outcome is the hero, the agent stays small, and frosted glass is used only over photography.

### 1.6 Cognition (Devin): a blueprint grid and plan-first interaction
- **Type:** `nbInternational`, `stkBureauSerif`, `GeistMono`.
- **Palette:** background `#f7f6f5`, surface `#fff`, text `#000`, secondary text `#1919198f`, border `#0000000f`, button `#191919`, accent `#20f`, error `#fa5050`.
- **Layout:** hairline grid lines frame the page like an engineering drawing, with a left text nav.
- **Work in progress / approvals:** Devin 2.0 "responds in seconds with relevant files, findings, and a preliminary plan" that you edit before it starts executing. It runs parallel sessions, each with its own IDE ([Devin 2.0 post](https://cognition.ai/blog/devin-2)).
- **What to borrow:** show an editable plan before running anything long.

### 1.7 Anthropic / Claude: the warm-paper reference
- **Type:** `Anthropic Sans`, `Anthropic Serif`, `Anthropic Mono` (custom).
- **Palette** (the `--swatch--*` variables in the CSS):
  - Ivory `#faf9f5`, `#f0eee6`, `#e8e6dc`. Slate `#141413`, `#3d3d3a`, `#5e5d59`.
  - Clay `#d97757`; accent `#c6613f`.
  - Muted secondary swatches: olive `#788c5d`, sky `#6a9bcc`, heather `#cbcadb`, oat `#e3dacc`, kraft `#d4a27f`, cactus `#bcd1ca`, fig `#c46686`.
- **How the agent is shown:** an abstract spark mark, never a face.
- **What to borrow:** a muted secondary palette for categories (e.g. account types), and the brand voice carried by the serif.

### 1.8 Harvey: restraint for high-stakes work
- **Type:** Harvey Serif and Harvey Sans (custom).
- **Palette:** ink `#0f0e0d`, ivory `#fafaf9`; grays `#f2f1f0`, `#e5e5e3`, `#cccac6`, `#8f8b85`, `#524f49`, `#1f1d1a`; highlighter accent `#f6f202`; dark tints `#333f40`, `#593d3a`.
- **Imagery:** product UI ("Command Center") sits inside painterly, textured artwork.
- **What to borrow:** if you want to feel trustworthy, show less. The serif wordmark and black CTA carry the authority.

### 1.9 Raycast and Superhuman: speed brands
- **Raycast:**
  - Type: `Inter`, `Instrument Serif`, `GeistMono`, `jetBrainsMono`, `VT323`.
  - Palette: grays `#07080a`, `#0c0d0f`, `#111214`, `#1b1c1e`, `#2f3031`; foreground `#f4f4f6`, `#c2c7ca`, `#78787c`; brand red `#ff6363`; status colors `#59d499`, `#ffc533`, `#57c1ff` with 15% "transparent" tint versions.
  - Emil Kowalski cites Raycast as having **no animations**, which suits a tool used constantly ([Great animations](https://emilkowal.ski/ui/great-animations)).
- **Superhuman:**
  - Type: `Super Sans VF`, `Super Serif VF`, `Super Sans Mono VF` (custom variable fonts).
  - Palette: neutrals `#fcfaf7`, `#f7f5f2`, `#f2f0eb`, `#dedbd5`, `#8d8a86`, `#474543`, `#141413`; mulberry and gold accents.
  - Display sizes are fluid via `clamp()`, e.g. 48→88px.

### 1.10 GTM agent competitors and personified "workers"

| Product | Type (from CSS) | Palette | How the agent is shown | Approvals / human in the loop |
|---|---|---|---|---|
| [11x](https://11x.ai) | ES Allianz, Switzer | Beige `#f8f4f2`, black `#0f0f0f`, orange `#c64a2a` | Cinematic astronaut/space hero; mono HUD labels ("X: 60.34"); voice personality chips (Confident, Energetic, British…); named workers Alice and Julian | Not visible on the homepage |
| [Artisan](https://artisan.co) | Intrinseca, Playfair Display, Inter, Corinthia (script) | Light, purple CTA | "Ava" persona; live chat widget showing a **human face** ("Aaron") | **Copilot** mode (every email approved by a human) vs **Autopilot** ([help center](https://help.artisan.co/articles/6218358204-running-ava-on-copilot-vs-autopilot)) |
| [Decagon](https://decagon.ai) | Circular XX, PP Fragment, Libre Caslon, FK Grotesk Neue | Indigo `#5754ff`/`#7370ff`, platinum `#f4f4f5`→`#303036`, black `#0a0a0b` | Agent speaks in **first-person past-tense outcomes**: "I've applied your membership perks." | Natural-language AOPs (agent operating procedures) |
| [Rox](https://rox.com) | Geist, Geist Mono, Fragment Mono (Framer site) | Dark, cinematic customer video | "Agent Swarm", with each agent scoped to one rep × account pair ([docs](https://docs.rox.com/development/how-rox-works/agent-swarm)) | — |
| [Clay](https://clay.com) | Roobert, Canela | 3D claymation scenery | Agent as a table column | Run progress UI: column % bar, cell states Successful/Running/Failed, hover breakdown ([docs](https://clay.com/university/guide/run-progress-ui)) |
| [Lindy](https://lindy.ai) | Manrope, custom Inter | White, blue CTA, gold gradient headline text | "Hire Lindy" framing; works as a teammate in Slack-like channels | — |
| [Notion](https://www.notion.com/blog/introducing-notion-3-0) | NotionInter | — | Personal agent you can give "a name and some accessories" | — |
| Perplexity / Dia / v0 | FK Grotesk Neue + PPLX Sans/Serif; ABC Oracle + Exposure VAR + ABC Favorit Mono; Geist + Geist Mono | — | — | — |

### 1.11 Patterns that hold across the best references
1. **The agent is labeled as an AI and never shown with a human face.** Linear's guidelines require it, and Sierra, Claude, Linear and Granola all follow it. Human faces (Artisan, the old 11x) read as an SDR spam machine.
2. **Every finished run leaves a receipt:** duration, number of sources, and what changed (Linear's "Worked for 8 sec", Cursor's "+135 −21").
3. **The current step reads as a live present-tense verb** ("Reading docs") and flips to past tense when done ("Searched · 8 results").
4. **Plan before execution** (Devin), **approval before sending** (Artisan Copilot), and the **human stays accountable** (Linear).
5. **Provenance is visible** (Granola's gray vs black text) and **citations expand to quotes** (Granola's "Zoom in").

---

## 2. Motion specs from best-in-class sources

### 2.1 Rules
- **Only animate to explain cause and effect, or for deliberate delight** ([Vercel guidelines](https://vercel.com/design/guidelines), [Apple guidelines](https://developer.apple.com/design/human-interface-guidelines/motion)).
- **Don't animate keyboard-triggered or high-frequency actions.** Emil Kowalski says so directly. Rauno Freiberg notes that command menus and context menus "are often shown without motion" ([Rauno](https://rauno.me/craft/interaction-design)).
- **Keep UI animations under 300ms.** Emil's example: a select at 180ms feels better than at 400ms ([7 tips](https://emilkowal.ski/ui/7-practical-animation-tips)).
- **Choose easing by situation** ([easing blueprint](https://animations.dev/learn/animation-theory/the-easing-blueprint)):
  - **ease-out** for anything entering or leaving.
  - **ease-in-out** for things already on screen that move or morph.
  - **ease** for hover color changes.
  - Never ease-in. Linear easing only for constant motion or showing elapsed time.
- **Never `transition: all`.** Animate only `transform` and `opacity`, make animations interruptible, and set transform-origin to where the element comes from (Vercel; Emil).
- **Never start from `scale(0)`; start at 0.9 or higher.** Press feedback is `scale(0.97)`. A 2px `blur()` hides crossfade seams (Emil).
- **Loading indicators:** wait **150–300ms** before showing one, then keep it up for at least **300–500ms**. Skeletons must match the final layout exactly (Vercel).
- **Bounce:** 0 is the default. About 0.15 reads as slightly bouncy, about 0.3 as noticeably bouncy. Stay at or below 0.4 for UI ([WWDC23 "Animate with springs"](https://wwdcnotes.com/documentation/wwdc23-10158-animate-with-springs/)). SwiftUI's `.smooth`, `.snappy` and `.bouncy` presets all default to `duration: 0.5` ([Apple docs](https://developer.apple.com/documentation/swiftui/animation/snappy(duration:extrabounce:))).
- **Avoid sustained oscillation near 0.2 Hz** (a 5-second loop). Apple's guidelines say people are especially sensitive to it. That rules out slow "breathing" idle orbs.
- **Respect reduced motion.** Swap movement for opacity; Motion provides `useReducedMotion()` (Emil).

### 2.2 Ground truth from source code
- **Motion (framer-motion), `spring.ts`:**
  - Defaults: `stiffness 100, damping 10, mass 1`; `bounce 0.3`; `visualDuration 0.3`.
  - Conversion: `stiffness = (2π / (1.2·visualDuration))²`, `damping = 2·(1−bounce)·√stiffness`.
  - Defaults when you don't specify a transition (`default-transitions.ts`): x/y use a spring with `stiffness 500, damping 25`; scale uses a critically damped spring with `stiffness 550`; other values use a tween `[0.25,0.1,0.35,1]` at 0.3s ([source](https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/animation/generators/spring.ts)).
  - Note: the [Motion docs page](https://motion.dev/docs/react-transitions) lists different defaults. The source code is authoritative.
- **Vaul (drawer):** `DURATION 0.5`, `EASE [0.32, 0.72, 0, 1]`, `VELOCITY_THRESHOLD 0.4`, `CLOSE_THRESHOLD 0.25` ([source](https://github.com/emilkowalski/vaul/blob/main/src/constants.ts)). Linear's CSS uses the same curve.
- **Sonner (toasts) v2.0.3:**
  - `TOAST_LIFETIME 4000`, `GAP 14`, `VISIBLE_TOASTS_AMOUNT 3`, `SWIPE_THRESHOLD 45`, `TOAST_WIDTH 356`.
  - `transition: transform 400ms ease`.
  - Stacked toasts scale by 0.05 × index. Swipe dismisses when velocity exceeds 0.11 ([Emil's toast post](https://emilkowal.ski/ui/building-a-toast-component)).
- **NumberFlow (number tickers):** `transformTiming 900ms` with a spring-shaped `linear()` curve, `opacityTiming 450ms ease-out`, `respectMotionPreference: true` ([source](https://github.com/barvian/number-flow/blob/main/packages/number-flow/src/lite.ts)).
- **AI SDK `smoothStream`:** defaults to **10ms** delay per word chunk. Use `Intl.Segmenter` for CJK languages ([docs](https://ai-sdk.dev/docs/reference/ai-sdk-core/smooth-stream)).
- **Radix Tooltip:** `delayDuration 700`, `skipDelayDuration 300`. Transform origin is available as `--radix-tooltip-content-transform-origin` ([docs](https://www.radix-ui.com/primitives/docs/components/tooltip)).

### 2.3 Spec table

| Element | Enter | Exit | Notes |
|---|---|---|---|
| Hover (background/color) | 120–160ms `ease` or ease-out-quad | same | Linear uses `.16s` ease-out-quad |
| Press | `scale(.97)`, 100ms ease-out-quad | 150ms | Emil |
| Tooltip | 120ms, scale .97→1 + opacity, ease-out | 100ms | First tooltip waits 600–700ms; the next ones within 300ms appear instantly |
| Dropdown / popover | 150–180ms, scale .96→1 + opacity, ease-out-quint, origin-aware | 100–120ms ease-in-quad | Linear context menu: 100ms from .9 |
| Command palette (⌘K) | ≤150ms, opacity + scale .98→1, **or none** | none or 100ms fade | Highlight moves and filtering are instant |
| Modal | 180–200ms, scale .98→1 (+ y 8px), ease-out-quint; overlay fade 200ms | 150ms | Linear: 180ms from .98 |
| Sheet / drawer | 500ms `cubic-bezier(.32,.72,0,1)` | same, or follows the drag gesture | Vaul and Linear |
| List enter (stagger) | 250–300ms each, opacity + y 6→0; **30–50ms stagger, cap ~8 items** | 150ms | Total under 400ms; animate only the first page load |
| Page / route change | Content area crossfades 120–150ms; sidebar never animates | — | Linear has no page transitions |
| Streaming text | Smooth at 10–20ms per word; each new word goes opacity 0→1 + `blur(2px)`→0 over 180ms ease-out | — | Never translateY inside a text line (it jitters) |
| Skeleton / shimmer | Show after 150ms, keep at least 400ms; shimmer sweep 1.5s linear, infinite | Crossfade 150ms | Linear easing is fine here: it represents time |
| Number ticker | NumberFlow defaults (900ms / 450ms) | — | Delta badge appears 300ms later |
| Shared-element layout | Spring `{visualDuration:.35, bounce:0}` (≈ k 224, c 29.9) | — | Use `layoutId`; `layout="position"` for text |
| Toast | 400ms ease (Sonner) | 200ms | Lifetime 4s; pauses on hover |

### 2.4 Spring presets (Motion)

| Name | `visualDuration` / `bounce` | Equivalent stiffness / damping (mass 1) | Use |
|---|---|---|---|
| `snappy` | 0.25 / 0.15 | 439 / 35.6 | Toggles, chips, tab indicator |
| `smooth` | 0.30 / 0 | 305 / 34.9 | Popovers, accordions, height:auto |
| `layout` | 0.35 / 0 | 224 / 29.9 | Reorders, shared elements |
| `gentle` | 0.50 / 0.20 | 110 / 16.8 | **Signature moments only** |

---

## 3. Recommended direction: "Ink & Ember"

**The idea:** a calm, editorial "operator's desk". It is warm paper and ink: precise like Linear, warm like Granola and Claude, restrained like Harvey. There is exactly one hot color, **ember**, and it belongs to the agent. When ember appears on screen, it means the agent is doing something or needs you. Everything else is ink.

### 3.1 Typography
- **UI: Inter** (Google Fonts, variable, with `opsz`). Use weights 400 / 500 / 600 and `font-feature-settings: "cv11","ss01","tnum"` where numbers line up. Track headings −0.01 to −0.02em.
- **Voice: Instrument Serif** (Google Fonts, 400 + italic), used **only at 28px and up**: brief headlines, the offer letter, empty states. Raycast uses this exact Inter + Instrument Serif pairing (confirmed in its CSS).
- **Machine output: Geist Mono** (Google Fonts). Use it for tool calls, timestamps, durations, domains and keyboard shortcuts.
- **Alternative:** Geist + Newsreader (Newsreader's `opsz` axis also works for long serif reading).
- **Scale (px, size/line height):** 12/16 meta · 13/20 dense UI · **14/20 base UI** · 15/24 reading (briefs, email drafts) · 18/26 · 24/30 (Inter 600, −0.02em) · 32/36 serif · 48/52 serif (brief date). Reading measure is at most 68ch.
- **Spacing and density:** 4px grid. List rows 32px; buttons 32px (small 28px). Sidebar 240px. Reading column 720px max.

### 3.2 Color tokens
Contrast was checked by hand. Light mode: fg-2 on bg is 6.7:1; fg-3 is 3.3:1, so use it only for meta text and placeholders. Dark mode: fg-2 is 8.7:1, fg-3 is 4.8:1, and accent text is 6.6:1.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#FAF9F6` | `#121110` | App canvas |
| `bg-subtle` | `#F4F2EE` | `#171614` | Sidebar, table header |
| `surface` | `#FFFFFF` | `#1B1A18` | Cards |
| `surface-raised` | `#FFFFFF` | `#232220` | Popover, modal |
| `sunken` | `#F1EFEA` | `#0D0C0B` | Inputs, mono blocks |
| `border` | `#E7E4DE` | `#2A2825` | Hairlines |
| `border-strong` | `#D6D2CA` | `#3A3733` | Inputs, focus base |
| `fg` | `#1A1917` | `#F2F0EB` | Ink; human-authored text |
| `fg-2` | `#5C5852` | `#B5B0A7` | Secondary text; **agent draft text** |
| `fg-3` | `#8F8A82` | `#85807A` | Meta, placeholder |
| `fg-4` | `#B8B3AA` | `#5A5650` | Disabled |
| `primary` | `#1A1917` | `#F2F0EB` | Default CTA (ink button) |
| `primary-fg` | `#FAF9F6` | `#121110` | |
| `accent` (ember) | `#E5532D` | `#FF6A3D` | Agent presence, live states, orb (fills, not small text) |
| `accent-hover` | `#D2461F` | `#FF8259` | |
| `accent-text` | `#B93A17` | `#FF8A63` | Ember-colored text (AA) |
| `accent-subtle` | `#FCEBE4` | `#2A1710` | Draft wash, selection |
| `accent-fg` | `#FFFFFF` | `#170A05` | Text on ember |
| `success` / subtle | `#1F7A4D` / `#E5F3EA` | `#4CC38A` / `#11251A` | |
| `warning` / subtle | `#9A6200` / `#FBF0D9` | `#E8B04B` / `#2A2010` | |
| `danger` / subtle | `#C8322A` / `#FBE8E6` | `#FF6B5E` / `#2C1412` | |
| `info` / subtle | `#2563C9` / `#E6EEFB` | `#6AA7FF` / `#0F1D33` | |
| `ring` | `rgb(229 83 45 / .45)` | `rgb(255 106 61 / .5)` | 2px ring + 2px offset |

### 3.3 Tailwind CSS v4 implementation (`app/globals.css`)
```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

:root{
  --bg:#FAF9F6;--bg-subtle:#F4F2EE;--surface:#FFF;--surface-raised:#FFF;--sunken:#F1EFEA;
  --border:#E7E4DE;--border-strong:#D6D2CA;--fg:#1A1917;--fg-2:#5C5852;--fg-3:#8F8A82;--fg-4:#B8B3AA;
  --primary:#1A1917;--primary-fg:#FAF9F6;--accent:#E5532D;--accent-hover:#D2461F;--accent-text:#B93A17;
  --accent-subtle:#FCEBE4;--accent-fg:#FFF;--success:#1F7A4D;--warning:#9A6200;--danger:#C8322A;--info:#2563C9;
  --ring:rgb(229 83 45/.45);
  --sh-xs:0 1px 2px rgb(26 25 23/.05);
  --sh-sm:0 1px 2px rgb(26 25 23/.04),0 2px 6px -2px rgb(26 25 23/.06);
  --sh-md:0 0 0 1px rgb(26 25 23/.06),0 4px 8px -2px rgb(26 25 23/.06),0 12px 24px -8px rgb(26 25 23/.12);
  --sh-lg:0 0 0 1px rgb(26 25 23/.06),0 8px 16px -4px rgb(26 25 23/.08),0 24px 48px -12px rgb(26 25 23/.20);
  --sh-xl:0 0 0 1px rgb(26 25 23/.05),0 2px 4px rgb(26 25 23/.04),0 32px 64px -16px rgb(26 25 23/.25);
  --sh-btn:inset 0 1px 0 rgb(255 255 255/.10),inset 0 -1px 0 rgb(0 0 0/.20);
}
[data-theme=dark]{
  --bg:#121110;--bg-subtle:#171614;--surface:#1B1A18;--surface-raised:#232220;--sunken:#0D0C0B;
  --border:#2A2825;--border-strong:#3A3733;--fg:#F2F0EB;--fg-2:#B5B0A7;--fg-3:#85807A;--fg-4:#5A5650;
  --primary:#F2F0EB;--primary-fg:#121110;--accent:#FF6A3D;--accent-hover:#FF8259;--accent-text:#FF8A63;
  --accent-subtle:#2A1710;--accent-fg:#170A05;--success:#4CC38A;--warning:#E8B04B;--danger:#FF6B5E;--info:#6AA7FF;
  --ring:rgb(255 106 61/.5);
  --sh-xs:0 0 0 1px rgb(255 250 240/.05);
  --sh-sm:0 0 0 1px rgb(255 250 240/.06),inset 0 1px 0 rgb(255 255 255/.03);
  --sh-md:0 0 0 1px rgb(255 250 240/.07),inset 0 1px 0 rgb(255 255 255/.04),0 8px 24px -4px rgb(0 0 0/.5);
  --sh-lg:0 0 0 1px rgb(255 250 240/.08),inset 0 1px 0 rgb(255 255 255/.04),0 24px 56px -12px rgb(0 0 0/.65);
  --sh-xl:var(--sh-lg);
}
@theme inline{
  --color-bg:var(--bg);--color-bg-subtle:var(--bg-subtle);--color-surface:var(--surface);
  --color-surface-raised:var(--surface-raised);--color-sunken:var(--sunken);
  --color-border:var(--border);--color-border-strong:var(--border-strong);
  --color-fg:var(--fg);--color-fg-2:var(--fg-2);--color-fg-3:var(--fg-3);--color-fg-4:var(--fg-4);
  --color-primary:var(--primary);--color-primary-fg:var(--primary-fg);
  --color-accent:var(--accent);--color-accent-hover:var(--accent-hover);--color-accent-text:var(--accent-text);
  --color-accent-subtle:var(--accent-subtle);--color-accent-fg:var(--accent-fg);
  --color-success:var(--success);--color-warning:var(--warning);--color-danger:var(--danger);--color-info:var(--info);
  --font-sans:var(--font-inter),ui-sans-serif,system-ui,sans-serif;
  --font-serif:var(--font-instrument-serif),ui-serif,Georgia,serif;
  --font-mono:var(--font-geist-mono),ui-monospace,SFMono-Regular,Menlo,monospace;
  --radius-xs:4px;--radius-sm:6px;--radius-md:8px;--radius-lg:12px;--radius-xl:16px;--radius-2xl:24px;
  --shadow-xs:var(--sh-xs);--shadow-sm:var(--sh-sm);--shadow-md:var(--sh-md);--shadow-lg:var(--sh-lg);
  --shadow-xl:var(--sh-xl);--shadow-btn:var(--sh-btn);
  --ease-out:cubic-bezier(.23,1,.32,1);--ease-out-quad:cubic-bezier(.25,.46,.45,.94);
  --ease-in-quad:cubic-bezier(.55,.085,.68,.53);--ease-in-out:cubic-bezier(.77,0,.175,1);
  --ease-drawer:cubic-bezier(.32,.72,0,1);
  --animate-shimmer:shimmer 1.5s linear infinite;--animate-text-shimmer:text-shimmer 2s linear infinite;
  --animate-orb-spin:spin 1.2s linear infinite;
  @keyframes shimmer{from{background-position:-200% 0}to{background-position:200% 0}}
  @keyframes text-shimmer{from{background-position:100% 0}to{background-position:-100% 0}}
}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
```
- **Fonts:** load with `next/font/google` (`Inter({axes:['opsz']})`, `Instrument_Serif({weight:'400',style:['normal','italic']})`, `Geist_Mono`), exposing each as a CSS variable.
- **Radius usage:**
  - xs 4px: kbd and badges.
  - sm 6px: buttons, inputs, menu items. This matches Vercel's base level ([Geist materials](https://vercel.com/geist/materials)).
  - md 8px: small cards.
  - lg 12px: cards, menus, modals (Vercel's menu and modal level).
  - xl 16px: sheets and full-screen views.
  - 2xl 24px: the offer letter.
  - Full: pills and the orb.
  - Nested corners: inner radius = outer radius − padding.

### 3.4 Motion tokens (`lib/motion.ts`)
```ts
export const dur = { fast: .1, base: .15, mod: .2, slow: .3, drawer: .5 } as const;
export const ease = { out: [.23,1,.32,1], outQuad: [.25,.46,.45,.94], inQuad: [.55,.085,.68,.53],
  inOut: [.77,0,.175,1], drawer: [.32,.72,0,1] } as const;
export const spring = {
  snappy: { type: "spring", visualDuration: .25, bounce: .15 }, // k≈439 c≈35.6
  smooth: { type: "spring", visualDuration: .30, bounce: 0 },   // k≈305 c≈34.9
  layout: { type: "spring", visualDuration: .35, bounce: 0 },   // k≈224 c≈29.9
  gentle: { type: "spring", visualDuration: .50, bounce: .20 }, // k≈110 c≈16.8 (signature only)
} as const;
export const listItem = { hidden:{opacity:0,y:6}, show:(i:number)=>({opacity:1,y:0,
  transition:{duration:.28,ease:ease.out,delay:Math.min(i,8)*.04}}) };
// Wrap the app root in <MotionConfig reducedMotion="user">
```

### 3.5 The agent's identity: "the Ember"
- **What it is:** a named agent (the founder names it at hire, e.g. "Mercer") with a permanent `AI` badge next to the name, as Linear's guidelines require. Its visual is a geometric **orb**, never a face or a photo.
- **Construction:**
  - Core: a circle filled with `radial-gradient(circle at 35% 30%, #FF9A6B, var(--accent) 55%, #B93A17)`, plus a 1px inner highlight `inset 0 1px 0 rgb(255 255 255/.35)`.
  - Aura: a separate ring element so it can be animated with transforms only.
  - Sizes: 16px inline (timeline, mentions), 20px sidebar, 28px header, 96px during hiring.
- **Every animation maps to a real state; it is never decorative:**

  | State | Visual | Motion |
  |---|---|---|
  | Idle | Core only | **Static.** No breathing loop, because of Apple's 0.2 Hz warning. |
  | Thinking | Conic ring (`conic-gradient(var(--accent), transparent 70%)`, masked to 2px) | Ring rotates once per 1.2s, linear |
  | Working | Ring keeps rotating | **One "tick" per completed tool call:** core scales 1→1.12→1 with the `snappy` spring. The pulse rate is the actual activity rate. |
  | Needs you | Ring stops; static 2px ember ring plus a count badge | One ping when the state starts (scale 1→1.8, opacity .4→0, 1s ease-out), then still |
  | Done | Ring fades out over 200ms | Settles back to idle |
  | Error | Core turns `fg-3` gray | No shaking; the cause is written in text |

  With reduced motion on, every rotation and scale becomes an opacity change only.
- **Voice:** first person and outcome-first, like Decagon ("I drafted 4 follow-ups for accounts that raised this week"), followed by a receipt.
- **Provenance:** agent-drafted text renders in `fg-2` on an `accent-subtle` wash with a 2px ember left border labeled "Draft". When a human edits or approves it, it turns `fg` ink. This is Granola's black-vs-gray rule adapted to drafts.

### 3.6 Signature moments
1. **The hiring moment (onboarding, about 60–90s)**
   - **Prompt.** An empty ivory canvas with Instrument Serif at 40px: *"Let's hire your Head of GTM."* There is one input: your company URL.
   - **Interview.** The orb (96px, thinking) sits on the left. On the right, a reading ledger lists each page it fetches: favicon, title and domain in mono. Rows stagger in at 40ms, and the active verb has the text shimmer.
   - **What it learned.** Below the ledger, "What I learned" chips stream in (ICP, competitors, pricing, motion). Each chip can be edited in place; this is the founder's first chance to correct it.
   - **Offer letter.** A 24px-radius surface card with `shadow-xl` and a serif heading "Offer: Head of Go-to-Market, {Company}". It lists a 30-day plan in 3 lines, the agent's name field and the founder's signature line.
   - **Hold to hire.** The button fills left to right with linear easing over 900ms. Linear is allowed here because it shows time passing. Releasing early retracts the fill in 200ms ease-out.
   - **Arrival.** On completion the letter scales to 0.96 and fades (300ms). The orb flies to its sidebar slot via shared `layoutId` with the `gentle` spring, lands with a 1→1.08→1 pop, and the first brief starts generating.
2. **Showing the agent's thinking: the work log**
   - **Header:** orb, live title ("Researching 12 target accounts"), elapsed time in tabular-figure mono, and a Stop button (Esc). The agent acknowledges within 1s, well under Linear's 10s rule.
   - **Plan card** (Devin and Linear plans): a checklist with pending, in-progress, done and canceled states. It is editable before Run and becomes read-only after.
   - **Step rows (28px):**
     - 16px status slot: a spinner ring that morphs into a check.
     - Label: present-tense verb with shimmer, flipping to past tense ("Searched · 8 results").
     - Right side: up to 3 stacked favicons plus "+5", and the duration ("4.2s", mono).
   - **Ephemeral thoughts** (Linear's concept) appear in `fg-3` and are replaced in place by a 150ms crossfade with a 2px blur.
   - **Collapse.** When finished, the log collapses with the `smooth` spring into a receipt chip: **"Worked for 2m 14s · 23 sources · 3 drafts"**. Clicking it expands the log again.
3. **The daily brief reveal (first open of the day only; instant on every later view)**
   - The date headline in serif at 48px fades and unblurs: opacity 0→1, blur 4px→0, 400ms ease-out-quint.
   - The agent's one-line greeting streams in.
   - Sections enter with a 60ms stagger: "3 things that matter today", Pipeline (NumberFlow tickers plus delta badges), "Waiting on you (5)", "Signals" (funding and hiring news, each with favicon citations that expand to the source quote).
   - A "Copy as text" action sits at the bottom.
4. **The desk (approval queue)**
   - One card per drafted email or action.
   - Keyboard: `J`/`K` to move, `A` to approve (copies and offers "Open in Gmail"), `E` to edit, `X` to dismiss with a reason. The dismissal reason feeds the agent's memory.
   - A visible "Learned" counter ticks up as reasons accumulate.

### 3.7 Fifteen micro-interactions to implement
1. **Press:** `active:scale-[.97]` with `transition-transform duration-100 ease-out-quad` (Emil).
2. **Hover:** `transition-[background-color,color] duration-150 ease-out-quad`. Never `transition: all`.
3. **Ink button depth:** `shadow-btn` (inner highlight). On hover, background moves +4% toward white over 120ms.
4. **Focus:** a 2px ring in `--ring` with a 2px offset in the bg color, only on `:focus-visible`, appearing instantly.
5. **Tooltip:** Radix with 600ms delay and `skipDelay` 300ms; enter is 120ms, scale .97→1, transform-origin from the Radix variable.
6. **Menus and popovers:** enter 160ms, scale .96→1 + opacity, ease-out, origin-aware. Exit 100ms ease-in-quad.
7. **⌘K palette:** opens in 150ms (opacity + scale .98→1). No exit animation. Highlight moves and filtering are instant.
8. **Modal:** overlay 200ms fade; panel 200ms, scale .98→1 + y 8→0, ease-out. Exit 150ms. **Side sheet** (account detail): 500ms with `ease-drawer`.
9. **Step status morph:** the spinner fades out in 100ms, then the check draws via `pathLength` 0→1 over 250ms ease-out, and the label shifts from `fg-2` to `fg-3`.
10. **Text shimmer on the active verb:** `bg-clip-text` with a 200% gradient (`fg-3` → `fg` → `fg-3`) sweeping every 2s, linear. It stops the moment the step finishes.
11. **Streaming:** `smoothStream({ chunking: 'word', delayInMs: 15 })`. Each new word enters at opacity 0 with `blur(2px)` and settles in 180ms. A 2px ember caret blinks with `steps(2)` at 1s, only while streaming.
12. **Approve (`A`):**
    - The card flashes `accent-subtle` for 120ms, then exits to x +24px with opacity 0 over 200ms ease-in-quad.
    - Siblings close the gap using the `layout` spring.
    - A Sonner toast appears: "Copied · Open in Gmail · Undo", 5s lifetime.
13. **Copy button:** the icon swaps from copy to check with a 150ms crossfade and scale .8→1; it reverts after 1.5s.
14. **Editing an assumption chip:**
    - The chip turns into an input via a 200ms `layout` animation, and Enter saves.
    - An ember underline sweeps left to right over 400ms with the label "Learned".
    - The memory count ticks up through NumberFlow.
15. **Loading:** skeletons appear only after 150ms, stay at least 400ms, and match the final layout. Shimmer is 1.5s linear, and the swap to real content is a 150ms crossfade. Pipeline numbers use NumberFlow defaults (900ms transform, 450ms opacity), with the delta badge fading in 300ms later.

---

## 4. Anti-patterns to avoid
- **Purple-to-blue gradients** (Tailwind `#6366F1` → `#8B5CF6`), gradient text, animated "AI glow" borders, and the ✨ sparkle as the universal AI icon. If something needs to say "this is AI", use the Ember and the word "Draft".
- **Glassmorphism everywhere.** Blur is expensive to render and muddy to read. Sierra limits frosted glass to chat bubbles over photography; do the same or skip it.
- **Human faces or photo avatars for the agent** (Artisan's "Aaron", 11x's personified workers). They break the "never mistaken for a person" rule and look like an AI SDR spam machine.
- **Vanity metrics** ("10,482 emails sent!"). Show outcomes: replies, meetings, and next actions owed by the human.
- **Fake thinking:** spinners that say nothing, artificially slow typing, and decorative pulses. Every animation should map to a real event, and every run should end with a receipt.
- **Animating high-frequency or keyboard-driven actions**, such as palette navigation, list keyboard movement or tab switching on every keypress (Emil, Rauno, Apple). UI animations over 300ms, `scale(0)` entrances, ease-in curves, bounce above 0.4, and long-loop idle oscillations (Apple's 0.2 Hz warning).
- **`transition: all`**, animating width, height, top or left, and Motion animations that run on the main thread during heavy rendering. Emil reports Vercel moved its tab animation to CSS after it dropped frames; prefer CSS or WAAPI for anything that runs while data is loading.
- **Emoji as icons; an icon on every row; colored team-icon backgrounds; too many borders.** Linear's 2026 refresh removed exactly these.
- **Chat-only home screens** (an empty prompt box as the dashboard). The best agents use structured surfaces: the brief, the desk, the work log.
- **Walls of agent text with no provenance**, and citations that don't expand to the source quote.
- **Pure `#000` / `#FFF` contrast, neon dark mode, gradient bento grids, 3D claymation (Clay already owns that look), heavy Lottie animations,** and mono uppercase HUD labels on everything (one or two per screen at most).
- **Loading flicker:** spinners that show for under 150ms, and skeletons that don't match the final layout (Vercel).

If this direction goes to anyone else on the team, I can publish it as a shareable page.