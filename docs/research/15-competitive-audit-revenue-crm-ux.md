# 15 · Competitive audit: AI-native CRMs, revenue tools and the productivity UX GTM people love (November 2026)

**How this was gathered (2026-11-05).** Web searches and page reads of vendor launch posts, changelogs, help docs and reviews. InRoad's own column was checked against `src/` at v0.2.22. This builds on 03 (AI GTM landscape), 05 (design references), 12 (revenue OS) and 13 (GTM engineering) and does not repeat them. Tags: **[vendor]** is the company's own claim. **[competitor]** is a review written by a rival (Coffee, folk, Lightfield, Sybill, Claap and tl;dv all publish these). **[secondary]** is an aggregator or recap. Independent user reviews of the 2026 AI CRMs are thin. Where something comes from a single source, the text says so.

---

## 0. What changed in 2026

In 2026 the CRM stopped being somewhere you type and became a context layer that agents read from and suggest changes to. Three shifts stand out.

1. **Records update themselves, and a human approves the change.**
   - HubSpot's Smart Deal Progression (Apr 14) turns call transcripts into suggested field updates. The rep accepts or rejects each one, or uses "Approve all", and can hover "Source" to see the moment in the transcript ([HubSpot](https://www.hubspot.com/company-news/spring-2026-spotlight), [KB](https://knowledge.hubspot.com/records/move-deals-forward-with-deal-progression)).
   - At UNBOUND (Sep 16–18), HubSpot made the whole Smart CRM self-maintaining. It also added "Context Home", which scores how complete your data is ([recap, partner](https://integrateiq.com/blogs/whats-new-hubspot-unbound-2026/)).
   - Outreach's Deal Agent posts suggested field updates to Slack, where the rep accepts, rejects or edits them ([Outreach](https://www.outreach.ai/resources/blog/outreach-april-2026-product-release)).
   - Lightfield, Day.ai and Clarify build accounts, contacts and deals straight from the inbox, calendar and calls.
2. **Agents now run on triggers and long horizons, not only in chat.**
   - Attio Workflows can be described in a sentence (Jun 9).
   - Gong's Agent Builder fires on events (Sep 30).
   - Salesforce's long-horizon agents pursue multi-week goals such as "re-engage my at-risk deals" and check in for approval.
   - Every vendor shipped an ask-anything assistant that cites sources: Ask Attio, Gong Deep Mode, Agentforce Coworker, Outreach Omni, Fathom Ask.
3. **The stack consolidated and opened up to horizontal assistants.**
   - Clari merged into Salesloft. The deal closed Dec 3 2025, and the dual brand was retired Sep 2 2026.
   - Salesforce bought Momentum, Apollo bought Pocus, and People.ai became Backstory.
   - Salesforce (Claudeforce), HubSpot, Salesloft, Outreach, Gong, Granola and Fathom all expose CRM or call data to Claude and ChatGPT over MCP or connectors.

Two other changes matter.

- **Meeting capture went bot-free.** Fathom 3.0 records system audio from a desktop app, and Granola is now valued at $1.5B. Consent litigation arrived at the same time: a class action against Granola was filed Jul 30 2026.
- **Pricing moved to credits and outcomes.** Examples: $1 per HubSpot-recommended lead, Attio's token pricing, Lightfield Pro at $899/month with a credit pool, and Gong platform fees of $5–50K. A local, bring-your-own-key product stays structurally cheaper and more private.

**The gap for InRoad:** every serious competitor now sees the user's calendar, inbox and calls automatically. InRoad still learns most of this from pastes.

---

## 1. Tool by tool

### 1.1 AI-native CRMs

- **HubSpot (Smart CRM, Breeze → Agent Hub).**
  - **Standout:** Smart Deal Progression turns transcripts and deal history into suggested CRM updates, a follow-up draft and next steps. The Prospecting Agent watches funding, hiring and tech signals, drafts outreach, and sends nothing without rep approval. It costs $1 per recommended lead after a 28-day trial. UNBOUND 2026 added:
    - a self-updating CRM;
    - Context Home;
    - Agent Hub, one view of every agent;
    - Agent Builder, with one-click migration of old workflows;
    - HubSpot Work, in private beta;
    - Claude/ChatGPT connectors.
  - **Signature UX:** the per-field ✓/✗ review, "Approve all", hover-for-source, and an admin "Automated" toggle per property.
  - **Complaint:** it needs full transcripts. A community answer says summary-only integrations such as Granola don't work ([AMA](https://community.hubspot.com/t/closed-smart-deal-progression-ama-ask-us-anything-may-18-22/148426)). Pricing has fragmented into credits and per-outcome fees.
  - **Sources:** [Spring Spotlight](https://www.hubspot.com/company-news/spring-2026-spotlight) · [BusinessWire](https://www.businesswire.com/news/home/20260414056889/en/HubSpot-Puts-Growth-Context-to-Work-with-New-HubSpot-AEO-AI-Agents-Smart-Deal-Progression-and-100-Updates) · [UNBOUND review](https://www.softwarereviews.com/vendor-technology-notes/hubspot-unbound-2026-repositions-its-crm-for-the-agentic-era)
- **Salesforce Agentforce (Sales).**
  - **Standout:** Dreamforce 2026 shipped:
    - Agentforce Coworker (GA): it asks across CRM and Slack, and builds and runs a plan that orchestrates other agents;
    - long-horizon agents (pilot, GA Nov '26), which check in for approval within the guardrails you set;
    - Piper, the inbound SDR (GA), and Hunter, for outbound (GA Nov);
    - Claudeforce (beta) and Slackforce;
    - Field Voice, for spoken pre-visit briefs and dictated notes.
    
    Salesforce also bought Momentum.
  - **Signature UX:** plan, then approve, then adjust the plan conversationally. Reusable "AI Skills" can be built in chat.
  - **Complaint:** consumption pricing is hard to predict, and data quality makes or breaks a rollout. Salesforce's own CRMArena-Pro benchmark put an out-of-the-box agent at about 35% on multi-turn tasks [competitor summary].
  - **Sources:** [Salesforce](https://www.salesforce.com/blog/dreamforce-2026-announcements/) · [Oliv review analysis](https://oliv.ai/blog/salesforce-agentforce-reviews-analyzed) · [Salesforce Ben](https://www.salesforceben.com/where-are-we-really-at-with-agentforce-adoption/)
- **Attio.**
  - **Standout:**
    - Ask Attio (Feb 4) queries and updates the CRM in natural language, gained actions in April, and works in Slack.
    - The new Workflows (Jun 9): "describe the workflow and Attio builds it", with agents, triggers and actions. There are prebuilt blocks for scoring, routing, briefing, follow-up and win/loss [secondary], plus MCP and an App SDK.
  - **Signature UX:** spreadsheet-grade table and kanban views over any object, ⌘K, and a mono tool-call tree in the AI panel (05 §1.3).
  - **Complaint:** reports are limited. Users also cite workflow setup friction, mobile parity and a move to token-based AI pricing.
  - **Sources:** [changelog](https://attio.com/changelog/2026/the-new-workflows) · [G2](https://www.g2.com/products/Attio/reviews) · [Ask Attio launch, secondary](https://tbpn-digest.vercel.app/story/2026-02-04/attio-launches-ask-attio-a-conversational-ai-interface-that-makes-sense-of-your-entire-crm-data)
- **folk.**
  - **Standout:** folk Assistants (Jan 15, 2026). The Follow-up Assistant scans email and WhatsApp for unresolved next steps, flags threads that have gone quiet and drafts replies in your tone. There are also Recap and Research assistants and an MCP server.
  - **Signature UX:** lightweight, contact-centric pipelines and a LinkedIn capture extension.
  - **Complaint:** webhooks are basic, there is no Stripe sync, and custom objects confuse non-technical users ([Hackceleration](https://www.hackceleration.com/folk-crm-review)).
  - **Sources:** [folk, vendor](https://www.folk.app/articles/crm-with-ai-follow-up-assistant) · [Product Hunt](https://www.producthunt.com/products/folk-2/launches)
- **Day.ai (CRMx).**
  - **Standout:** GA plus a $20M Series A led by Sequoia (Feb 2026). A "context graph" built from email, transcripts, Slack and Stripe, and named agents that each report to a human. Includes a Morning Briefing.
  - **Signature UX:** an org chart of agents, and charts generated in chat from real data.
  - **Complaint:** integrations are thin, and reviewers call it strong at call documentation but not yet a full CRM [competitor]. Independent reviews are scarce.
  - **Sources:** [Pulse 2.0](https://pulse2.com/day-ai-20-million-series-a/) · [Coffee, competitor](https://coffee.ai/articles/day-ai-crm-reviews-comparisons)
- **Rox.**
  - **Standout:** "one prebuilt agent per customer relationship" (Mar 31, 2026), plus an agent swarm running on the customer's data warehouse. Now pitched to teams of all sizes. Valued at $1.2B.
  - **Signature UX:** per-account agents that do the work and surface finished output.
  - **Complaint:** few verified reviews. One directory gives an editorial "Hold" verdict. The design is enterprise and warehouse-centric.
  - **Sources:** [rox.com/teams](https://www.rox.com/teams) · [launch](https://launch.rox.com/) · [ToolDirectory](https://tooldirectory.ai/tools/rox)
- **Clarify.**
  - **Standout:** creates deals automatically from email, calendar and call data, with human-in-the-loop approval. There is a free tier with 2,500 credits a month.
  - **Signature UX:** an "AI rep" that works as an advisor.
  - **Complaint:** upkeep is still manual (one reviewer reports about 45 minutes a day), reporting is basic and there is no pipeline history [competitor]. G2 rates it 4.9, but on only 28 reviews.
  - **Sources:** [G2](https://g2.com/products/clarify-crm/reviews) · [Salesdorado](https://salesdorado.com/en/crm/crm-software/review-clarify-ai/)
- **Lightfield** (the most direct overlap with InRoad's buyer).
  - **Standout:**
    - Connecting Gmail or Outlook plus Google Calendar creates accounts, contacts and opportunities automatically, and records update after every meeting and email.
    - A built-in recorder and meeting prep.
    - Ask "with citations": for example, "accounts gone quiet" or "recurring objections".
    - An agent that runs code in a sandbox to build dashboards.
    - Plain-English bulk operations.
    - A natural-language agent builder (Pro).
    
    It raised a $47M Series A led by a16z (Sep 2026).
  - **Signature UX:** a zero-setup CRM that fills itself.
  - **Complaint:** almost no independent reviews. Pro costs $899/month per workspace with credits and overage. Its TechCrunch coverage was placed by its PR partner.
  - **Positioning:** technical founders, seed to Series A, fewer than 5 AEs.
  - **Sources:** [llms.txt, vendor](https://lightfield.com/llms.txt) · [Series A](https://lightfield.app/blog/our-series-a) · [PR note](https://authoritytech.io/results/lightfield-techcrunch-agentic-crm-updates-itself)

### 1.2 Revenue intelligence, engagement and forecasting

- **Gong.**
  - **Standout:** three 2026 releases.
    - Mission Andromeda (Feb): Gong Enable, plus Assistant Q&A over calls.
    - Mission Big Dipper (Jun): the "Revenue Harness" and Custom Agents.
    - Celebrate '26 / Mission Callisto (Sep 30): Gong Enrich, **Deep Mode** in Gong Assistant (an investigative, sourced report), expanded dashboards, and Custom Agents that trigger automatically (later in 2026).
  - **Signature UX:** deal boards with activity timelines, and answers that cite call clips.
  - **Complaint:** price. There is a platform fee of $5–50K plus seats, and Reddit reports $12K for 3 seats. Pricing is opaque, reps feel surveilled, and the AI feels "underwhelming for the price" [competitor roundups].
  - **Sources:** [Gong press](https://www.gong.io/press/new-revenue-ai-innovation-celebrate-26) · [SiliconANGLE](https://siliconangle.com/2026/09/30/gong-adds-auto-enrichment-and-event-driven-agents-to-its-revenue-intelligence-platform/) · [Andromeda](https://www.gong.io/platform/mission-andromeda) · [Sybill, competitor](https://sybill.ai/blogs/gong-pricing)
- **Clari (now part of Salesloft).**
  - **Standout:** Clari Forecast is still the reference for roll-up forecasting, with regional roll-ups, waterfall and pacing views.
    - The merger closed Dec 3 2025.
    - The dual brand was retired Sep 2 2026; only "Clari Forecast" keeps the name, and clari.com now redirects to Salesloft.
    - An MCP server launched in April and gained forecast data and write-back on Jul 9.
  - **Signature UX:** a forecast grid with roll-ups, overrides and pacing.
  - **Complaint:** a median contract of about $76K/yr with 5–8% escalators (Vendr, n=291), separate logins after the merger, and roadmap doubts.
  - **Sources:** [Claap, competitor](https://www.claap.io/blog/clari-competitors) · [DestinationCRM](https://www.destinationcrm.com/Articles/Editorial/Magazine-Features/Clari---Salesloft-Merger-Creates-a-Revenue-Intelligence-Leader-The-2026-CRM-Conversation-Starters-176335.aspx) · [Salesloft FAQ](https://community.salesloft.com/announcements-3/salesloft-clari-merger-customer-faq-506)
- **Salesloft (Rhythm).**
  - **Standout:** Rhythm (2023) uses Conductor AI to turn buyer signals into one ranked "do this next" queue that re-prioritizes in real time. It is now framed as a "Prioritizer" agent within a suite of 10+ agents (Deal Summary, Conversation Summary, AI Scorecard) [secondary].
  - **Signature UX:** a single prioritized action list per seller, filterable by Cadence or Closing actions.
  - **Complaint:** the post-merger product overlaps with Clari (Conversations vs. Copilot), and I found no dated 2026 Rhythm release.
  - **Sources:** [BusinessWire 2023](https://www.businesswire.com/news/home/20230621612183/en/Salesloft-Announces-Rhythm-Powered-by-Conductor-AI-Becomes-First-Global-Revenue-Workflow-Platform-for-Full-Cycle-Sellers) · [Rhythm](https://salesloft.com/platform/rhythm)
- **Outreach (Kaia, agents).**
  - **Standout:**
    - Feb 2026: Meeting Prep, Deal and Research agents, and MCP access to Kaia call data.
    - Apr 2026: **Omni**, a conversational agent in Slack and mobile, and **Agent Studio**, a visual canvas with prebuilt workflows for inbound engagement, closed-lost reactivation and deal alerts.
    - Deal Agent posts suggested field updates to Slack to accept, reject or edit.
    - An Outcomes Report that correlates deal attributes with win rate.
    
    It reports 12x growth in AI usage (Sep 2026).
  - **Signature UX:** approving CRM changes inside Slack without opening the CRM.
  - **Complaint (assessment):** agents are configured by RevOps in Agent Studio, so there is nothing a solo founder can use. Independent 2026 reviews are thin.
  - **Sources:** [Outreach](https://www.outreach.ai/resources/blog/outreach-april-2026-product-release) · [newsroom](https://www.outreach.ai/company/newsroom/outreach-reports-12x-ai-usage-growth-as-revenue-teams-move-beyond-insight-to-ai-driven-execution)
- **Momentum.io → Salesforce.**
  - **Standout:** post-call automation (CRM fields, deal signals in Slack), a beta of bot-free Google Meet recording, and a Deep Research engine. Acquired by Salesforce (closed about Mar 2 2026) and folded into Agentforce 360 and Slackbot.
  - **Signature UX:** Slack-first deal signals and auto-filled fields.
  - **Complaint:** it is now tied to Salesforce, and I found no substantive user reviews.
  - **Sources:** [BusinessWire](https://www.businesswire.com/news/home/20260127999573/en/Momentum.io-Newest-2026-Voice-of-the-Market-Report-Finds-Most-AI-Adoption-Stops-Short-of-Revenue-Execution) · [acquisition, secondary](https://www.pulse.bot/saas/news/salesforce-acquires-momentum-what-it-means-e9faae55-2cb7-4d8c-83a2-26cbb31af48e/)
- **People.ai → Backstory.**
  - **Standout:** activity capture feeding its SalesAI platform, MCP access (Feb 18, 2026), and a reported rebrand to Backstory (Apr 2026) focused on answering questions about deals.
  - **Complaint:** enterprise-only, and the rebrand is reported only by secondary sources.
  - **Sources:** [BusinessWire](https://www.businesswire.com/news/home/20260218140075/en/) · [rebrand, secondary](https://www.pulse.bot/sales/news/peopleai-becomes-backstory-redefining-how-revenue-teams-get-answers-about-their-deals-a26665a8-f55c-4fa9-9842-59dfd8759c66/)
- **Pocus → Apollo.**
  - **Standout:** a signal layer that ranks accounts by likelihood to buy, using product-usage and CRM data. Acquired by Apollo (Mar 2026), which is approaching $200M ARR; its AI Assistant lifted AI adoption from 35% to 75% [vendor].
  - **Complaint:** the standalone product's future is unclear.
  - **Sources:** [Built In](https://builtin.com/articles/apollo-pocus-acquisition-20260320) · [ClearlyAcquired](https://www.clearlyacquired.com/blog/apollo-io-acquires-pocus-to-extend-ai-revenue-intelligence)
- **BoostUp.**
  - **Standout:** a "RevBI" product combining forecasting, pipeline, deal, account and call data for mid-market and enterprise.
  - **Complaint:** I found no 2026 news. The category is consolidating around Clari/Salesloft and Gong.
  - **Sources:** [Capterra](https://www.capterra.com/p/209160/BoostUp/)

### 1.3 Meeting tools

- **Fathom.**
  - **Standout:** 3.0 (Apr 15, 2026) records **bot-free** from a desktop app that captures system audio, so no "Notetaker has joined" message appears and it works where IT bans bots. Also:
    - Ask across all your meetings, with cited answers;
    - CRM sync to HubSpot and Salesforce;
    - ChatGPT and Claude integration;
    - a public API with webhooks for new meetings and transcripts (60 requests/min), plus community MCP servers.
  - **Signature UX:** capture that disappears, and a summary seconds after the call.
  - **Complaint:** confusing tier pricing, and the API is read-only.
  - **Sources:** [Product Hunt](https://www.producthunt.com/products/fathom/launches) · [TechIntelPro](https://techintelpro.com/news/ai/enterprise-ai/fathom-unveils-major-platform-update-with-bot-free-capture-account-wide-meeting-insights-and-expanded-llm-integrations) · [MCP](https://lobehub.com/mcp/lukas-bekr-fathom-mcp) · [Truto, vendor](https://truto.one/blog/best-mcp-server-for-fathom-in-2026.md)
- **Granola.**
  - **Standout:** a $125M Series C at $1.5B (Mar 25, 2026). Adds Spaces (team workspaces), a personal API and an enterprise API, and MCP (Feb 2026). Agent features are planned.
  - **Signature UX:** notepad-first. You jot sparse notes and the AI enhances them. "Your text black, AI gray", and you can zoom into the quote behind any note (05 §1.4).
  - **Complaint:**
    - no audio is kept, so quotes can't be verified;
    - generic speaker labels on large calls;
    - consent is left to the user;
    - a proposed class action (N.D. Cal., Jul 30 2026).
  - **Sources:** [TNW](https://thenextweb.com/news/granola-series-c-meeting-ai-enterprise-context) · [Reworked](https://www.reworked.co/digital-workplace/granola-raises-125m-launches-enterprise-context-tools/) · [PPC Land](https://ppc.land/granola-sued-for-recording-meetings-without-consent-to-train-ai-models/) · [Voibe, competitor](https://www.getvoibe.com/resources/is-granola-safe/)
- **Avoma.**
  - **Standout:** an all-in-one tool covering scheduling, notes, coaching, a methodology tracker, AI deal risks and win/loss, plus a forecasting add-on, from about $19–49 a seat.
  - **Complaint:** it "feels dense before it feels helpful", support is limited (about 60 staff), and forecasting is shallower than Gong or Clari.
  - **Sources:** [ZoomInfo review](https://pipeline.zoominfo.com/sales/avoma-review) · [AI Agent Index](https://theaiagentindex.com/agents/avoma)

### 1.4 Productivity UX benchmarks

- **Linear.**
  - **Standout:**
    - Linear Agent (Mar 24, 2026) can trigger automatically when issues enter Triage. Select text anywhere and press **J** to send it to the agent as context (Apr).
    - Coding sessions (Jun) resolve about 30% of Linear's own incoming bugs [vendor].
    - Triage keys: `1` accept, `2` decline, `3`/`MM` duplicate, `H` snooze. Snooze lasts until a set time *or new activity*, whichever comes first.
  - **Signature UX:** Triage Intelligence shows suggested properties. Hover to see *why*, and accept or decline. Each property type can be set to **appear, hidden or auto-applied** per team. It feels instant thanks to local-first reads plus optimistic writes.
  - **Complaint:** Triage Intelligence is limited to the Business tier.
  - **Sources:** [Triage](https://linear.app/docs/triage) · [Triage Intelligence](https://linear.app/docs/triage-intelligence) · [changelog](https://linear.app/changelog) · [Agent guidelines](https://linear.app/developers/aig) · [speed, secondary](https://performance.dev/what-makes-linear-feel-instant)
- **Superhuman (formerly Grammarly).**
  - **Standout:** Superhuman Go sorts incoming mail and pre-drafts replies in your voice. Custom agents run while you write, on a schedule, or when an email or Slack message arrives. Mail adds auto drafts, auto labels and MCP.
  - **Signature UX:** keyboard-only triage to zero, split inbox, `H` remind-me (the thread comes back if there's no reply), and Undo Send.
  - **Complaint:** a learning curve, no Gmail plugins, and confusing packaging.
  - **Sources:** [Go](https://superhuman.com/go) · [speed post](https://blog.superhuman.com/the-fastest-email-experience-ever-made/) · [rebrand](https://www.testingcatalog.com/grammarly-rebrands-and-launches-ai-powered-superhuman-go) · [G2](https://www.g2.com/sellers/superhuman-888da3d1-51f7-4603-8d73-08989f8a7db1)
- **Raycast.**
  - **Standout:**
    - v2.0 GA (Aug 2026).
    - v2.2 brings your own model (OpenAI-compatible, Ollama, OpenRouter).
    - v2.3 (Sep 11): AI Chat plans a task, uses extensions, writes and runs code, and keeps going until it's finished. You can connect your Claude or ChatGPT account.
    - v2.6 uses about 50% less memory.
  - **Signature UX:** everything is a command with its own hotkey, and there is no decorative motion.
  - **Complaint:** AI and dictation moved behind Pro.
  - **Sources:** [changelog](https://www.raycast.com/changelog/macos) · [2.3](https://www.raycast.com/changelog/macos/2-3)
- **Arc → Dia (Atlassian).**
  - **Standout:** chat with your open tabs, **Skills** (saved prompt shortcuts), Memory, and Arc's sidebar and vertical tabs coming over. Atlassian bought The Browser Company for $610M.
  - **Complaint:** Mac-only and still flaky, and Memory is flagged as a data-aggregation risk.
  - **Sources:** [Wikipedia](https://en.wikipedia.org/wiki/Dia_(web_browser)) · [iGeeksBlog](https://www.igeeksblog.com/dia-ai-browser-mac-launch/) · [MakerStack](https://makerstack.co/reviews/dia-review/)
- **Attio's UI** (as a UX benchmark): spreadsheet-speed tables, kanban on any object, ⌘K, views with filters and sorts, near-invisible shadows, and a mono tool-call tree for AI work (05 §1.3).

---

## 2. Feature matrix

InRoad cells were verified in code at v0.2.22. Competitor cells come from the sources in §1. **?** means not verified in this pass.

| Capability | InRoad | InRoad evidence | HubSpot | Attio | Lightfield | Day.ai | Gong | Salesloft (+Clari) |
|---|---|---|---|---|---|---|---|---|
| Pipeline views / kanban | **Has** | Board/table with drag between stages and exit-criteria check (`components/companies/list/talking.tsx`) | Has | Has | Has | Has | Partial (deal boards; not the record system) | Has |
| Forecasting | **Has** | Commit, best case and pipeline called from evidence; floor/call/ceiling; P(hit); reverse waterfall (`lib/revenue/forecast.ts`). No rep roll-ups or overrides | Has | Partial (reports only) | Partial (dashboards) | ? | Has | Has (Clari Forecast, the benchmark) |
| Deal inspection / risk | **Has** | Risks with one-click fixes (`lib/revenue/risk.ts`, `components/revenue/risk-list.tsx`) | Partial | Partial (agent blocks) | Partial ("gone quiet" via Ask) | Partial (stale-deal nudges) | Has | Has |
| Meeting prep & notes | **Partial** | Dossiers plus a "Meeting today" move (`lib/workflows/prep.ts`, `lib/moves/rules.ts`), but only for meetings it knows about (Cal.com/Calendly/manual) | Has | Has | Has | Has | Has (AI Briefer) | ? |
| Call recording / summaries | **Partial** | No capture. Debrief runs on a *pasted* transcript or notes, with verbatim quote checks (`sheet/meetings.tsx` LogCall, `lib/workflows/debrief.ts`) | Has | Has | Has | Has | Has | Has |
| Email / calendar sync | **Partial** | No mailbox or calendar. Booking pollers (`lib/connectors/calcom.ts`, `calendly.ts`), sequencer replies (Instantly/Smartlead/Lemlist), pasted replies (`shell/paste-reply.tsx`) | Has | Has | Has | Has | Has | Has |
| AI ask-anything over CRM | **Has** | ⌘K Ask with workspace and connected-tool tools, evidence chips, Apply-able proposals, Deep toggle (`lib/workflows/ask.ts`, `components/ask/proposals.ts`) | Has | Has | Has (with citations) | Has | Has (Deep Mode) | Partial (via MCP to Claude/ChatGPT) |
| Workflows / automations | **Partial** | 13 coded plays, monitors, n8n/Zapier/REST/MCP. No user-built trigger→action (`lib/plays/catalog.ts`, `lib/automation/monitors.ts`) | Has (Agent Builder) | Has (natural-language Workflows) | Has (Pro) | Has | Has (auto-triggered agents) | Has |
| Saved views & filters | **Partial** | Multi-select filters, view state in the URL; no named views (`list/filter-menu.tsx`, `list/companies-view.tsx`) | Has | Has | ? | ? | Has | Has |
| Bulk actions | **Partial** | Bulk bar on Prospects only (`list/prospects.tsx`) | Has | Has | Has (plain English) | ? | Partial | Has |
| Reporting / dashboards | **Partial** | Opinionated Revenue, Growth and weekly update pages; no builder (`components/revenue/*`) | Has | Partial ("limited") | Partial (basic; agent-built on Pro) | Partial (charts in chat) | Has | Has |
| Mobile | **Partial** | Responsive phone shell (`shell/app-shell.tsx` MobileNav/MobileHeader). Reaching it off the computer needs the Cloudflare tunnel (`integrations/named-tunnel.tsx`); no native app | Has | Partial | ? | ? | Has | Has |
| Keyboard UX | **Has** | ⌘K, G+letter, J/K, A/X/S, E/[/] on drafts, R/N/B/U in replies, `?` sheet (`shell/shortcut-groups.ts`) | Partial | Has | ? | ? | Partial | Partial |
| Citations on AI output | **Has** | Source chips, verbatim-checked quotes, unconfirmed bets labeled | Partial (hover Source) | ? | Has | ? | Has (Deep Mode) | ? |
| Local data + your own AI key | **Has** | Atomic FileDB on the user's machine, 13+ providers | Missing | Missing | Missing | Missing | Missing | Missing |
| Entry price | Free (MIT) plus AI usage | — | Seats + credits ($1 per recommended lead) | ~$35–99/seat (03) | $89/seat; Pro $899/mo | ? | $5–50K platform fee + seats | ~$76K/yr median (Clari) |

**Reading:** InRoad already beats the field on the *judgment* rows: evidence-based forecasting, risk with its fix, citations, keyboard and local data. It loses on the *capture* rows: calendar, email, calls. It is weaker on the *list-power* rows: saved views, bulk actions, inline edits. In the 2026 market, capture is no longer a feature, it's the entry ticket. Capture is also what keeps InRoad's evidence-based forecast true without pasting.

---

## 3. Top 12 opportunities for InRoad (ranked)

Ranked by impact for a founder or Head of GTM × feasibility in a local-first app. The constraints: no proprietary data APIs, use the user's AI key, and use tools the user has already connected. Scores are my judgment on a 1–5 scale.

### 1. Calendar autopilot: every external meeting arrives prepped (impact 5 × feasibility 5)
- **Problem:** InRoad knows only about meetings booked through Cal.com/Calendly or typed in by hand. Most founder calls are booked by email, so they never get a prep card or a debrief prompt, and the evidence behind the forecast goes stale.
- **UI:** Integrations → **Calendar** → "Paste your calendar's private address". Options:
  - Google: Settings → Integrate calendar → *Secret address in iCal format* ([Google](https://support.google.com/calendar/answer/37648)).
  - Outlook: a published ICS link.
  - Later: the Mac app reads Calendar directly.

  Within seconds Today gains a **This week** strip. Each external meeting shows the company favicon and a status: *Brief ready · Researching · New company: Track (T) / Ignore (X)*. Clicking opens the dossier. Fifteen minutes after a meeting ends, it becomes the existing "Meeting ended with no notes" move.
- **Data:** a read-only ICS feed, polled through the same dedupe path as the booking pollers. Attendee email domains are matched to accounts and people. Feeds include past events, so the last 90 days can be backfilled.
- **Proof:** Lightfield creates records from Gmail or Outlook plus Calendar. Day.ai builds its context graph the same way. Outreach's Meeting Prep Agent is GA. Gong has AI Briefer.
- **Caveat:** Google Workspace admins can disable secret addresses. The fallbacks are the Mac app's calendar access, or Google OAuth later.

### 2. Auto-debrief from the notetaker you already use (5 × 4)
- **Problem:** a debrief needs a pasted transcript (LogCall). Founders skip it. Forecast categories such as "economic buyer engaged", "paper process known" and "buyer-agreed step" only update through debriefs.
- **UI:** Integrations → **Meeting notes** → Fathom (API key), Granola (personal API/MCP), Fireflies, or *Watch a folder* (for .vtt, .txt and .md exports from Zoom or Meet). After each call, Today shows **"Debrief ready · Acme · 3 changes · 1 follow-up"**, which opens the existing DebriefReview with verbatim-checked quotes. Summary-only sources are labeled "notes, not transcript: quotes can't be verified".
- **Data:** notetaker APIs or webhooks, or local files, matched to meetings by time and attendee domains (and to #1's calendar).
- **Proof:** HubSpot Smart Deal Progression (which *cannot* use summary-only Granola), Momentum's post-call automation (Salesforce bought it), Outreach's Deal Agent, and Fathom's webhook API.

### 3. One "Review changes" queue for everything the agent infers (4 × 5)
- **Problem:** InRoad rightly never changes a deal by itself, and each debrief already has "Apply N changes" (`sheet/debrief-review.tsx`). But suggestions are scattered across debriefs, replies, bookings and Ask proposals. They can't be triaged from the keyboard, and facts the buyer said out loud still need a click each.
- **UI:** a **Changes (7)** lane on Today. Each row reads like `Acme · Close date  Mar 31 → Apr 15` followed by a source chip; hovering shows the quote and timestamp.
  - Keys: `A` apply, `X` reject with a reason, `E` edit, `⇧A` apply everything backed by a verbatim quote.
  - Settings → **Autonomy**, per field: *Ask me / Auto-apply with undo / Off*. Amount, close date and stage are always *Ask me* by default.
- **Data:** one `Suggestion {field, from, to, evidence, risk}` type that normalizes existing proposals.
- **Proof:** HubSpot (✓/✗, Approve all, hover Source, per-property Automated), Linear Triage Intelligence (appear, hidden or auto-applied, plus hover-for-why), and Outreach's Deal Agent in Slack.

### 4. Reply radar: know who answered without a CRM (5 × 3)
- **Problem:** founders send InRoad drafts from their own Gmail, but InRoad sees replies only through sequencer webhooks or the manual Check replies (R/N/B/U). Its blind spot is exactly the warm, high-value threads.
- **UI:** Integrations → **Mail (read-only)**: either IMAP with an app password, or a Gmail/Outlook MCP the user already runs, mapped through InRoad's existing MCP connection mapper.
  - Check replies arrives pre-filled: *"Maya Chen replied 2h ago · positive · asks for pricing"*, with the reply already pasted into the thread.
  - Every "Mark as sent" offers **Remind me in 3 days if no reply**.
  - Only threads with tracked people are read. Bodies stay on the machine, except the one reply being classified.
- **Data:** message headers (From/To/In-Reply-To) filtered to known addresses, plus the reply text, classified with the user's key.
- **Proof:** folk's Follow-up Assistant (scans email and WhatsApp, flags quiet threads, drafts replies), Superhuman remind-me, and Lightfield/Day.ai's automatic capture.
- **Caveat:** Gmail IMAP needs 2-step verification and an app password, and Microsoft 365 needs OAuth. The MCP route reuses `lib/automation/connections.ts`.

### 5. A 60-second "pipeline X-ray" on first run (5 × 4, built on #1)
- **Problem:** onboarding produces strategy (URL → Playbook) but not the founder's *own* pipeline. Competitors' magic moment is a CRM that fills itself.
- **UI:** Welcome → **"Show me my last 90 days"** → paste a calendar address, or import HubSpot, Attio, CSV or LinkedIn Connections.csv.
  - A streaming screen fills in: *23 companies you met · 9 had one meeting and no follow-up · 4 deals have no next step · 2 champions changed jobs.*
  - Then **Make these my first 5 moves** opens Today with real cards.
  - Below it, a completeness line: *"Forecast confidence is low: 7 open deals have no economic buyer"*, with a fix link on each.
- **Data:** ICS history, imported records, the locally screened LinkedIn CSV, and the existing risk rules.
- **Proof:** Lightfield, Day.ai and Clarify ("builds itself"), and HubSpot Context Home (scores data completeness for AI).

### 6. A "Since yesterday" brief, delivered where the day starts (4 × 5)
- **Problem:** Today is excellent once it's open, but nothing pulls the founder in, and nothing summarizes overnight change.
- **UI:**
  - A line at the top of Today: *Since yesterday · 3 replies · 1 meeting booked · Acme slipped to May · call −$40K*, where each item is a link.
  - `⌘↵` **Start my day** walks the items with J/K.
  - Optional delivery at 8:30 as a Mac desktop notification, or a Slack DM through the existing webhook connector.
  - A Friday 4pm "shutdown" covering what moved and what's due Monday.
- **Data:** the local event ledger, forecast snapshots and the move queue.
- **Proof:** Day.ai Morning Briefing, Superhuman Go's proactive sorting and pre-drafts, Salesforce Field Voice briefs, and Outreach's Slack notifications.

### 7. Voice debrief: talk for 60 seconds after a call (4 × 5)
- **Problem:** in-person meetings, dinners and phone calls have no transcript, and typing notes is the step that gets skipped.
- **UI:** a **hold-to-talk** mic on the "Meeting ended" card and in the company sheet, plus a global `⌥Space` in the Mac app. A live waveform runs while recording. On release, it transcribes with the user's provider and runs the existing debrief as `founder_notes`.
- **Data:** MediaRecorder and the user's speech-to-text key (OpenAI, Groq or local).
- **Proof:** Salesforce Field Voice (dictated notes after visits) and Raycast Dictation.
- **Why it ranks high:** it needs no consent from third parties, because the founder records only themselves.

### 8. Saved views, a bulk command bar and inline edits (3.5 × 5)
- **Problem:** Heads of GTM live in lists such as "stalled over 14 days", "A-tier with no meeting" and "champion moved". InRoad has URL filters and a bulk bar on Prospects only, with no named views and no inline edits.
- **UI:**
  - View tabs above the table (*All · A-tier untouched · Stalled · Commit*), and a **Save view** pill when filters change.
  - A display menu for density, columns and group by.
  - `X` selects rows. A floating bar then offers *Move stage · Set next step · Track · Research · Draft follow-ups · Export*.
  - `Enter` on a cell edits stage, next step, close date or amount in place, with an undo toast.
- **Data:** the workspace, with views persisted in FileDB.
- **Proof:** Attio views, HubSpot's redesigned index and board views (UNBOUND), Lightfield's plain-English bulk operations, and Linear's display options.

### 9. Saved questions ("Skills") that run themselves (4 × 4)
- **Problem:** Ask, including Deep, answers once. The best questions are weekly ones ("Which deals went quiet?", "What objections came up?") and get retyped.
- **UI:** every Ask answer gets **Save as skill**: a name, a slash command (`/quiet`), an optional schedule (Mon 8:00) and a destination (Today card, Slack, or a weekly-update section). Skills appear in ⌘K. Each scheduled run leaves a receipt with time, sources and cost on the user's key.
- **Data:** the existing Ask tools (`get_deal`, `pipeline_summary`, `workspace_search`, `connected_read`) plus the monitor scheduler.
- **Proof:** Ask Attio's prompt library, Agentforce AI Skills, Dia Skills, and Gong Deep Mode's sourced reports.

### 10. Voice-of-buyer board (4 × 4, grows with #2 and #7)
- **Problem:** verbatim quotes from debriefs die inside deal sheets, while the Head of GTM needs "what buyers say" to fix messaging, pricing and ICP.
- **UI:** Playbook → **What buyers say**.
  - Clusters for Objections, Competitors, Pains and Why we won/lost, each with n by segment and a trend sparkline.
  - Every cluster expands to quotes that link back to the call.
  - **Use in Studio** pre-fills copy with buyer words, and **Add to battlecard** saves it.
- **Data:** debrief quotes, loss reasons and replies. Sample size is always shown.
- **Proof:** Lightfield's "recurring objections" with citations, Outreach's Outcomes Report, Attio's Win/Loss block, and Gong themes.

### 11. Plays from a sentence, compiled to a definition with a dry run (4 × 3)
- **Problem:** the 13 coded plays are strong defaults, but GTM engineers want their own. Doc 13 says plays must be *definitions, not prompts*.
- **UI:** Plays → **New play** → a text box. Example: "when a proposal-stage deal goes 10 days silent and the champion posted on LinkedIn, draft a check-in."
  - InRoad shows the compiled card: *Trigger · Audience · Action · Cap · Cooldown*, each an editable chip.
  - **Dry run:** *7 matches today, 3 skipped (why)*. **Backtest:** *would have fired on 4 won / 9 lost.*
  - Then Enable. Plays are versioned with change notes.
- **Data:** an LLM compiles the sentence into the `lib/plays/catalog.ts` schema, and code validates it.
- **Proof:** Attio Workflows ("describe it"), HubSpot Agent Builder, Outreach Agent Studio, Gong's auto-triggered agents, and Salesforce's long-horizon agents.

### 12. Bot-free local call capture in the Mac app, with consent built in (5 × 2)
- **Problem:** the best evidence is the call itself. Many buyers' IT departments ban bots, and cloud notetakers carry privacy and consent risk.
- **UI:**
  - When a calendar meeting with an external attendee starts, a small pill appears: **Record on this Mac · Consent line copied**, with a menubar recording dot.
  - Afterwards the audio and transcript stay in the data folder.
  - The debrief shows clickable timestamps that play the clip, so quotes can actually be verified. That fixes Granola's gap.
- **Data:** system audio and mic captured through Electron/ScreenCaptureKit (the Mac app is Electron 44), transcribed with the user's key or a local whisper.
- **Proof:** Fathom 3.0's desktop capture, Granola, and Momentum's bot-free Meet recording. Granola's class action is why consent has to be part of the UX.
- **Sequencing:** ship it after #2 and #7.

---

## 4. UX patterns to adopt

InRoad already has several of these patterns; keep them and extend them:
- ⌘K;
- G+letter navigation;
- J/K plus A/X/S on Today;
- skip with a reason;
- the `?` shortcut sheet;
- Sonner undo toasts;
- optimistic workspace writes;
- source chips;
- the work log and reasoning stream.

The ten below are what's missing or only partly present.

1. **Suggestion chips with "why" on hover, plus per-field autonomy** (Linear Triage Intelligence, HubSpot SDP).
   - Render `<Suggestion field from to evidence>` as a dashed-ring chip.
   - A Radix HoverCard shows the quote and its link. ✓/✗ buttons carry `A`/`X` hints.
   - `autonomy[field]: 'ask' | 'auto' | 'off'` lives in settings. Auto-applied changes fire a toast: "Applied · Undo".
2. **Number-key triage with snooze until a date or until activity** (Linear `1/2/3/H`, Superhuman `H`).
   - Hotkeys are scoped to the focused list.
   - `H` opens a popover: *Tomorrow 8am · Monday · 1 week · When they reply*.
   - Store `{until, wakeOnActivity: true}` and filter on it. `Space` peeks the item in the side sheet without changing focus.
3. **Remind-if-no-reply by default on every send** (Superhuman).
   - After `A` "Mark as sent", the toast shows a pre-checked "Remind me in 3 days if no reply".
   - That creates a dated follow-up move, which is cancelled when a reply lands.
4. **Saved views as tabs, with dirty state and display options** (Attio, Linear, HubSpot index views).
   - `View {name, filters, sort, group, columns, density}` is stored in FileDB and selected by `?view=`.
   - When filters diverge from the saved view, a pill offers "Save · Save as new" (`⌘S`).
   - Density is a `data-density` attribute that switches a `--row-h` CSS variable between 36px and 28px.
5. **Multi-select with a floating bulk command bar** (Linear, Attio).
   - `X` toggles a row, `⇧J/⇧K` extends the selection and `⌘A` selects all.
   - A `fixed bottom-4 inset-x-0 mx-auto w-fit` bar lists actions with key hints.
   - `⌘K` while rows are selected scopes the palette to the selection.
6. **Inline edit in place, optimistic, with undo** (Attio cells, Linear properties).
   - `Enter` or a double-click swaps the cell to an input or combobox with identical box metrics, so nothing shifts.
   - `Enter` commits through the workspace dispatch optimistically, `Esc` reverts, and an undo toast shows for 5s.
7. **Contextual ⌘K with an "Ask…" fallback, and select-text-then-J** (Raycast, Linear Agent).
   - The palette receives `context={kind:'deal', id}`. The first group is "Actions for Acme", then navigation, and the last row is `Ask: "<typed text>"`.
   - A global selection handler sends highlighted text to Ask as a quote chip when the user presses `J`.
8. **An editable plan before long runs, and receipts after** (Salesforce long-horizon agents, Devin, Linear's agent guidelines).
   - The agent first emits `plan: Step[]`, rendered as an editable checklist with **Run ⌘↵**.
   - Each step label flips from present tense to past tense as it completes.
   - The collapsed receipt reads "Worked 41s · 9 sources · $0.03 on your key".
9. **Two-tone provenance with expand-to-quote** (Granola, HubSpot "hover Source").
   - Spans the model wrote get `text-fg-3`, and spans the founder typed or edited get `text-fg`. Editing a span flips its color, so it's visible what has been checked.
   - Each `[ev_…]` chip expands to the verbatim quote and its timestamp.
10. **Empty states that do the first job, and first-run value in under 60 seconds** (Lightfield and Day.ai "builds itself", Linear's empty states).
    - Every empty page has exactly one primary action that produces real data, such as "Paste your calendar address", next to a ghosted preview of the filled page.
    - Rows stream in over SSE with a 150ms fade, and the teaching copy disappears once the first real row arrives.

---

## 5. What not to copy

- **Auto-applying judgment fields** such as amount, close date and stage. Even HubSpot defaults these to manual review. Auto-apply only facts backed by a verbatim quote, and always offer undo.
- **Meters and credits on core flows** (Gong, Clari, HubSpot outcome pricing, Attio tokens, Lightfield overage). Show cost on the user's own key as a receipt, never as a gate.
- **Cloud recording without consent UX.** Granola's lawsuit is the warning. Keep audio local and make the consent line one click.
- **Agent canvases that only RevOps can configure** (Outreach Agent Studio, Agentforce). Compile plays from a sentence into definitions the founder can read, dry-run and undo (#11).
