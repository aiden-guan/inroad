# Competitive audit: prospecting, signals, enrichment, outbound and AI SDRs (November 2026)

Scope: what changed since 03 (landscape, Oct 2026) and 13 (GTM engineering and plays), tool by tool, checked against Inroad v0.2.22 in code. It doesn't repeat 03/13. Evidence labels follow 13:
- **[vendor]**: the company selling the thing.
- **[secondary]**: a review site or summary.
- **[competitor]**: published by a rival product.

Researched November 5, 2026. Every "Missing" for Inroad below was checked by grep against `src/`.

---

## 0. What changed in the market in 2026

Signals stopped being a product category of their own:
- **Platforms absorbed the standalone signal tools.**
  - Zoom agreed to buy Common Room (Jul 2).
  - HubSpot agreed to buy Warmly (Jun 30). Trigify's team joined HubSpot in September, and its product was retired on Oct 22.
  - Persana's team joined Rox, and Persana shut down on May 2. Koala was already gone in 2025.
  - Salesforce's outbound agent Hunter (in pilot, GA planned for November) ships with Apollo, ZoomInfo and Demandbase data built in.
- **The tools that survived rebuilt themselves around coding agents and chat:**
  - Unify relaunched on Jun 24 as "Claude for Outbound Sellers" and added a free plan for individual reps.
  - Clay shipped a CLI, an agent plugin, node-based Workflows (Aug 11) and its MCP server in OpenAI Codex.
  - Freckle now calls itself the Clay alternative for GTM engineers who work in coding agents.
  - Apollo says the number of teams using its MCP server grew more than 4x between March and August.
  - Anthropic's own business-development team runs inbound and outbound through Claude Cowork, with a human on every send.
- **Sequencers turned into agent platforms.**
  - Instantly added a Deliverability Agent, Copilot-built automations, task agents and a 555M-lead finder.
  - Smartlead added SmartAgents.
  - lemlist added an ICP-scoring agent and bought Claap.
- **Approval-first became the default pattern.**
  - Apollo's Slack agents only run after you click approve.
  - Amplemarket's Duo never sends without the rep seeing it.
- **Metering became the top complaint.**
  - Clay's March 11 split into Data Credits plus Actions means one workflow is charged twice.
  - In the State of GTM Engineering 2026 survey (n=228), Clay is used by 84% of respondents and draws the most heated complaints.
- **Free person-level website visitor ID is gone.** RB2B's free tier became company-level only on Jan 21.
- **Net effect for Inroad:**
  - Generic signals are now table stakes inside CRMs.
  - What a local-first tool can defend:
    - first-party and developer signals the user already owns;
    - custom signals and research questions that run on free public data;
    - an audit layer;
    - being the free data layer for the user's own coding agent.

---

## 1. Tool by tool

Format: **Standout** (what users love), **UX** (the interaction pattern that makes it feel good), **Complaint**, **Sources**.

### A. Enrichment, research and workflow

**Clay** (Claygent, Sculptor, Signals, Audiences, Workflows, Sequencer)
- **Standout:**
  - Claygent asks a research question of every row.
  - Since Oct 27, an auto mode picks the AI model per row to balance quality and cost.
  - Signals cover:
    - job changes, new hires, promotions, job posts;
    - news and fundraising;
    - topic intent per person and per company;
    - web intent;
    - custom signals, which can turn any data point into a signal.
  - LinkedIn social listening is limited to Pro and Enterprise plans.
  - Audiences holds records and signal events.
  - Workflows (open beta, Aug 11) run plays on a canvas. Each run is pinned to a snapshot, with each node's inputs and outputs, the Claygent's reasoning, and credits per step.
  - Other 2026 additions: redesigned lookalikes (Jun), CPJ-based TAM sourcing, Clay Ads for LinkedIn (Sep), credit budgets and spike alerts (Aug).
- **UX:**
  - Two ways in: chat with Sculptor to build a table or workflow, then refine it in a Sandbox mode that can't touch production; or watch the cells fill, each showing which provider supplied it.
  - Workflows can also be built from the CLI or by converting an existing table.
- **Complaint:**
  - Double metering: Actions to run plus Data Credits to buy the data. The cheapest self-serve tier is now about $185/mo.
  - Tables slow down past about 5K rows.
  - Credits get burned by bugs.
  - Job-change signals fire falsely when someone edits their LinkedIn title.
- **Sources:**
  - https://www.clay.com/changelog
  - https://www.clay.com/blog/introducing-workflows
  - https://university.clay.com/docs/sculptor
  - https://developers.clay.com/signals.md
  - https://www.clay.com/blog/signals
  - https://clay.com/blog/introducing-clays-new-pricing
  - https://gtmepulse-com.pages.dev/tools/frustrations/ [secondary, survey]
  - https://community.clay.com/x/general/6b83btz6849e/linkedin-role-updates-causing-false-job-change-sig

**Apollo** (AI Assistant, AI Research, Slack agents, ApolloNEXT)
- **Standout:**
  - AI Assistant (GA Mar 4): describe a goal and it builds and runs the workflow.
  - AI Research turns web findings into custom fields that work as live variables in sequences. A free trial gives 25 jobs.
  - Three Slack agents run on a schedule:
    - Lead Discovery explains why an audience is worth acting on;
    - Sequence Creation drafts sequences;
    - Sequence Optimization watches opens, replies, bounces and spam.
  - ApolloNEXT (Sep 30) announced:
    - Builder Studio (beta): natural language to pages, databases and automations;
    - an Intelligence Layer: a continuously updated profile of each contact and account;
    - Messaging OS (coming): who to contact, when, and on which channel.
  - Apollo is a flagship data partner for Salesforce Hunter.
- **UX:** the agent DMs a recommendation; you press approve in the thread, it runs and reports back. Every agent needs approval for now.
- **Complaint:** thin API documentation for advanced use (GTMe survey). Silent endpoint deprecation was noted in 13. Credit consumption rose about 10x between March and August, by Apollo's own numbers.
- **Sources:**
  - https://www.apollo.io/newsroom/announcements/apollo-launches-ai-assistant-powering-end-to-end-agentic-workflows-in-the-first-ai-native-all-in-one-gtm-platform
  - https://www.apollo.io/magazine/apollo-launches-agents
  - https://www.apollo.io/newsroom/announcements/apollo-reveals-the-ai-gtm-system-bringing-data-intelligence-and-execution-into-a-single-engine-ushering-in-the-future-of-go-to-market
  - https://knowledge.apollo.io/hc/en-us/articles/43226752968077-Release-Notes-2026
  - https://www.apollo.io/newsroom/announcements/apollo-named-flagship-data-partner-for-hunter-salesforces-new-outbound-sales-agent

**Freckle**
- **Standout:** repositioned in 2026 as a CLI that runs GTM workflows from a coding agent. It has 40+ providers, waterfall enrichment and a research-agent step, with no action credits. The CLI beta shipped in June.
- **UX:** natural-language control from Claude Code or Cursor instead of a table.
- **Complaint:** no published deliverability or connect rates. Small review base.
- **Sources:**
  - https://www.freckle.io/
  - https://bloomberry.com/blog/5-clay-alternatives/ [secondary]
  - https://prospeo.io/s/freckle-pricing-reviews-pros-and-cons [competitor]

**Persana**
- Its team joined Rox on Mar 30. Billing stopped Apr 1, there was a 30-day export window, and it shut down May 2.
- The persana.ai banner keeps it in some 2026 roundups by mistake.
- Lesson: buyers of small signal and enrichment tools now price in shutdown risk. That argues for data and logic the user owns.
- **Source:** https://www.cleanlist.ai/blog/2026-08-02-b2b-data-tool-acquisitions-and-shutdowns-2026 [secondary]

### B. Signals and intent

**Common Room** (being acquired by Zoom)
- **Standout:**
  - Person-level signals: product usage, open-source activity, social engagement and website visitor ID. Common Room claims a waterfall match rate of up to 50% [vendor].
  - Its RoomieAI agents:
    - RoomieAI Capture hunts for custom account signals from a prompt;
    - RoomieAI Spark is a person-research agent that lives in Slack.
- **UX:** one person's whole timeline, resolved to an individual, delivered where reps already work.
- **Complaint:**
  - It shows signals but not what to do about them, and email needs a separate tool [competitor].
  - It costs about $2–4K/mo and only pays back with a big community [secondary].
  - Its roadmap now sits inside Zoom Revenue Accelerator.
- **Sources:**
  - https://investors.zoom.us/news-releases/news-release-details/zoom-acquire-common-room-bringing-buyer-intelligence-its-ai
  - https://www.commonroom.io/solutions/compete/demandbase [vendor]
  - https://marketbetter.ai/blog/common-room-review-2026/ [competitor]
  - https://gtm-stack.deepline.com/gtm-stack/providers/common-room [secondary]

**Unify**
- **Standout:**
  - Relaunched Jun 24 as "Claude for Outbound Sellers". Through prompts, reps build lists from 40+ sources, enrich from 1.1B+ contacts, and get 1:1 sequences written in their own voice.
  - A free plan for individual reps.
  - 2026 changelog:
    - Lists (Feb);
    - sequence rulesets for shared exclusions (Mar);
    - PostHog, Segment and Unify Intent product signals that trigger plays (Apr 2);
    - out-of-office replies detected, the sequence paused and resumed on the return date (Apr 17);
    - webhooks in Plays (May 26);
    - an API (May 21).
- **UX:** Plays (trigger → audience → action) on autopilot, now led by chat.
- **Complaint:** hitting credit limits early (03). There's no independent coverage of the relaunch yet.
- **Sources:**
  - https://www.unifygtm.com/changelog
  - https://www.unifygtm.com/blog/announcing-unifys-next-chapter
  - https://www.unifygtm.com/changelog/out-of-office-reply-management
  - https://pricingsaas.com/companies/unifygtm/diffs/2026W33 [secondary]

**Koala** — Cursor acqui-hired the team and the product shut down Sep 30, 2025. Its users were the first wave of "my signal tool disappeared."
- **Source:** https://getkoala.com/blog/a-new-chapter

**Warmly** — HubSpot agreed to buy it on Jun 30. Visitor ID and outreach agents will fold into HubSpot. Existing contracts are unchanged for now, and non-HubSpot customers are the ones at risk. Reported scale is about 250 customers and about $3M ARR [secondary].
- **Sources:**
  - https://www.cmswire.com/digital-experience/hubspot-acquires-warmly-to-boost-ai-sales-agents/
  - https://www.cxtoday.com/crm/hubspot-acquires-warmly-ai-crm/

**Default**
- **Standout:** rebuilt from inbound routing and scheduling into a real-time GTM data layer with an agent that plans multi-step work over the team's data and tools. It set aside $1.5M to buy customers out of legacy contracts. Total funding is $20M (8VC).
- **UX:** workflows that the agent builds, a human reviews and the team deploys.
- **Complaint:** nothing independent yet. Pricing isn't public.
- **Sources:**
  - https://default.com/post/agent-launch
  - https://www.contentgrip.com/default-agentic-gtm-platform/ [secondary]

**UserGems**
- **Standout:**
  - Now positioned as a command centre for outbound and ABM: 30+ native signals (job changes, contact-level intent, website visits, M&A, hiring), plus a research agent for custom signals.
  - Its agent, Gem-E, learns which signals preceded open and won deals and scores on that.
  - It also has an MCP server for Claude and ChatGPT.
- **UX:** signals and queued emails appear inside Salesforce, HubSpot, Outreach and Salesloft rather than in a new app. It offers a money-back guarantee on ROI [vendor].
- **Complaint:** enterprise pricing. Mixed G2 ratings (3.5–5).
- **Sources:**
  - https://www.usergems.com/
  - https://www.g2.com/products/usergems/

**Trigify**
- **Standout:** LinkedIn engagement lists (who liked or commented on a creator's or competitor's posts) and keyword listening. In 2026 it added Hacker News, Substack and Bluesky, plus an MCP server and API.
- **Status:** its team joined HubSpot on Sep 23, and the standalone product was retired on Oct 22. It was not migrated into HubSpot.
- **Complaint while it lived:** setup complexity and LinkedIn account-safety risk.
- **Lesson:** demand for "who engages with my category" is real, but scraping LinkedIn is not a durable foundation.
- **Sources:**
  - https://www.favikon.com/blog/trigify-alternative-2026-best-replacements-after-the-shutdown [competitor]
  - https://trigifyio.featurebase.app/en/changelog
  - https://www.trykondo.com/blog/trigify-ai-lead-engagement [competitor]

**RB2B** (context for visitor ID)
- Since Jan 21, the free plan identifies companies only (about 150 resolutions a month). LinkedIn URLs start at about $79/mo and emails at Pro.
- **Sources:**
  - https://support.rb2b.com/en/articles/10442291-changelog
  - https://support.rb2b.com/en/articles/13285979-updates-to-rb2b-billing-and-subscription-plans-january-2026

### C. Sequencers

**Instantly**
- **Standout:** cheap unlimited inboxes and warmup. 2026 changelog:
  - AI Reply Agent (2025; aims to reply in under 5 minutes, 24/7);
  - AI Deliverability Agent (Jun 17);
  - Copilot builds automations from a plain description (Jul 2);
  - Instantly Agents for partnerships, investment, recruiting, research and voice (Sep 22);
  - SuperSearch Lead Finder with 555M+ leads and AI enrichment (Oct 27).
- **UX:** Unibox puts every mailbox's replies in one inbox, with sentiment-sorted triage.
- **Complaint:**
  - Campaign management doesn't scale past many campaigns (GTMe survey).
  - AI replies are billed per credit.
  - Pricing was reshuffled into bundles [secondary].
- **Sources:**
  - https://feedback.instantly.ai/changelog
  - https://feedback.instantly.ai/changelog/meet-your-ai-reply-agent-robot

**Smartlead**
- **Standout:** SmartAgents (Feb 2026): describe a task in English and it builds the automation. Also SmartProspect, a ~300M-profile database; SmartDialer; and an MCP server. Strong with agencies.
- **UX:** high-volume mailbox rotation plus agent templates (for example, reply-rate alerts in Slack).
- **Complaint:**
  - Bugs and support.
  - Its AI stops at task automation.
  - Weak on intent and compliance.
  - Overkill for solo founders.
- **Sources:**
  - https://www.salesforge.ai/blog/smartlead-review [competitor]
  - https://brandid.app/reviews/smartlead/ [secondary]
  - https://www.miniloop.ai/blog/smart-lead [secondary]

**lemlist**
- **Standout:**
  - A 2026 agent scores leads against the ICP, browses the prospect's site for personalisation, and drafts a multichannel sequence in about 3 minutes.
  - "Agentic enrichment" pulls from the web, LinkedIn, calls and the CRM.
  - lemlist bought Claap (Oct 2025), so call recordings now feed outreach.
- **UX:** multichannel (email, LinkedIn, calls, WhatsApp) built from one brief.
- **Complaint:** new features cause temporary disruptions [secondary]. Pricing was restructured.
- **Sources:**
  - https://coldiq.com/blog/the-european-ai-agents-reshaping-gtm-in-2026 [secondary]
  - https://www.crowdfundinsider.com/2025/10/254930-lemlist-acquires-ai-platform-claap/
  - https://sparkle.io/blog/lemlist-review/ [secondary]

### D. AI SDRs and agent platforms

**Amplemarket (Duo)**
- **Standout:** a daily feed of *people*, not accounts. It draws on these signals:
  - job changes, including past champions and deal blockers;
  - closed-lost prospects showing new interest;
  - competitor reviews;
  - community and social activity;
  - website visits;
  - news and hiring;
  - custom CRM or API signals.
- **UX:**
  - Each card opens to its context and a ready sequence. You can edit, regenerate, send in one click, or dismiss with a reason.
  - Dismissals, edits and reasons retrain future recommendations across signals and personas, and repeated edits update messaging preferences.
  - It never sends without the rep seeing it.
- **Complaint:**
  - Data accuracy: 53 G2 mentions [competitor count].
  - About $600/mo on an annual contract.
  - Duo Inbox and Voice are only on custom-priced tiers.
- **Sources:**
  - https://www.amplemarket.com/duo
  - https://prospeo.io/s/amplemarket-reviews [competitor]

**11x** (Alice, Julian, Nina)
- **Standout:** the homepage now pitches revenue agents rather than digital workers. It runs outbound with Alice, inbound voice and chat speed-to-lead with Julian, and a voice agent called Nina. It adds SMS and WhatsApp, a human dialer and website visitor tracking. Customer figures are vendor-reported.
- **UX:** persona agents with playbooks and a knowledge base. Agents decide when to hand off to humans; there's no explicit approval step for messages.
- **Complaint:** the 2025 history of churn and listing logos that weren't customers (03) still defines it.
- **Sources:**
  - https://www.11x.ai/
  - https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have

**Artisan** (Ava)
- **Standout:** pitches Ava as an autonomous BDR that runs outbound end to end, replacing data, enrichment, deliverability, sequencing, dialing and intent tools. No 2026 round was found; the last was a $25M Series A in Apr 2025.
- **UX:** "hire an AI employee" with autopilot.
- **Complaint:** LinkedIn banned it for about 2 weeks in Dec 2025 (03), and autonomy backlash continues.
- **Sources:**
  - https://www.artisan.co/
  - https://techcrunch.com/2026/01/07/yes-linkedin-banned-ai-agent-startup-artisan-but-now-its-back

**Actively**
- **Standout:** one persistent agent per account, working 24/7, and an Agent Inbox of finished work: prioritised, prepared, ready to act on. It raised a $45M Series B (Apr 28, TCV and First Harmonic, about $250M post-money). Customers include Ramp and Samsara [vendor].
- **UX:** you start from completed work, not a blank chat.
- **Complaint:** a $20K+ price floor and multi-week onboarding mean it only pays back with clean data [secondary].
- **Sources:**
  - https://www.actively.ai/
  - https://fintech.global/2026/04/29/tcv-and-first-harmonic-back-activelys-45m-funding-round/
  - https://thegtmdirectory.com/tools/actively-ai/md [secondary]

**Origami** (origami.chat / Origami Agents)
- **Standout:**
  - Enter a website URL (or describe the business) and it infers your offer, ICP and pitch.
  - Ready-made plays include New offices, Pricing page visitors and Growing teams. Each play shows its send and reply counts.
  - Signals include: website visits; conversations where people ask for what you sell; your network; new markets described in plain language; moves, hires, funding, reviews and podcasts.
  - $99/mo with no seat fees.
  - Claims [vendor]: about 10 minutes from URL to live campaigns, and about 8 days to the first positive reply.
- **UX:**
  - Prospects are listed with a "Why now" column.
  - "Good moments to reach out" appear as timestamped cards.
  - An approval mode holds every message for review (optional).
- **Complaint:** few independent reviews. Email only.
- **Sources:**
  - https://origami.chat/
  - https://makerstack.co/reviews/origami-review/ [secondary]
  - https://diymarketers.com/origami-lead-generation-tool-review/ [secondary]

**Regie.ai** (RegieOne)
- **Standout:** an AI-native sales engagement platform: AutoPilot prospecting agents, a parallel dialer and a 220M-contact database, now pitched as a "Force Multiplier Rep" operating model.
- **UX:** agents plus human reps in one platform.
- **Complaint:** a 10-seat minimum at about $180/user, and results depend on CRM data quality.
- **Sources:**
  - https://reply.io/blog/regie-ai-review/ [competitor]
  - https://marketbetter.ai/blog/regie-ai-pricing-breakdown-2026/ [competitor]

**Lavender**
- **Standout:** an email coach that scores drafts as you write, inside the inbox, trained on your own history. It added Ora, an AI agent that writes emails, in its words, like a top seller.
- **UX:** a live score in a side panel beside the draft (a Chrome extension).
- **Complaint:** a narrow wedge now that every sequencer writes copy. Pricing differs across sources ($29–69/user).
- **Sources:**
  - https://www.lavender.ai/
  - https://www.knowlee.ai/blog/lavender-alternatives-2026 [competitor]

### E. Newer tools winning mindshare in 2026

- **Gojiberry** (YC Spring 2026):
  - Agents watch LinkedIn likes, comments, job changes and funding every day and hand over warm leads. $99/mo.
  - The company reports $1.4M ARR in 9 months [vendor].
  - Solo founders love it; it's limited for offline audiences.
  - https://ycombinator.com/companies/gojiberry-ai · https://www.g2.com/products/gojiberryai/reviews
- **Reo.dev:**
  - Developer intent from GitHub activity, CLI runs, package installs, docs usage and Docker pulls.
  - It argues that opening an issue shows more intent than starring a repo.
  - It now also captures evaluations done by AI agents on an engineer's behalf.
  - https://reodotdev.substack.com/p/decoding-purchase-intent-for-developer · https://www.globenewswire.com/de/news-release/2025/10/08/3163398/0/en/Reo-Dev-Debuts-AI-Native-GTM-Platform-for-DevTool-Companies-with-4M-Seed-Funding.html
- **Octave:** a messaging library (ICP, personas, value propositions) plus testable playbooks plus agents that Clay calls at runtime, with version control and an MCP server for Claude Code. It's the "positioning as data" idea Inroad's Playbook already embodies. https://www.octavehq.com/post/how-to-use-clay-with-octave-a-guide-for-gtm-engineers · https://thegtmdirectory.com/tools/octave
- **Exa Websets:** the fastest path from a prompt to a structured company or people list. It's often used as the seed list for Clay. https://www.autotouch.ai/post/exa-vs-clay [competitor] · https://www.g2.com/products/exa-websets/reviews
- **Valley:** LinkedIn-first signal plays; it added email in Aug 2026. Seats start at $149. https://pipeline.zoominfo.com/sales/valley-ai-review [competitor]
- **Salesforce Hunter:**
  - An outbound agent on a new runtime that keeps working a prospect for weeks.
  - It's in pilot, with GA planned for November 2026.
  - Commentators doubt its pipeline quality and worry about domain-reputation risk.
  - https://ppc.land/salesforce-agents-gain-a-runtime-that-pursues-goals-over-weeks-not-chats/ · https://www.salesforge.ai/blog/hunter-by-sales-cloud-review [competitor]
- **Anthropic's BD team on Claude Cowork** (Aug 7):
  - Every night, Claude researches about 100 accounts per rep against ICP criteria, and each morning the rep gets a brief, a score and a play for every account.
  - An hourly skill drafts inbox replies in the rep's own voice.
  - CRM stage changes are proposed with evidence. When a rep rejects one, the reason is recorded.
  - "Keep a person on every send."
  - This is essentially Inroad's design, built by hand from skills and connectors.
  - https://claude.com/blog/how-anthropics-business-development-team-uses-claude-to-run-inbound-and-outbound-at-scale

---

## 2. Inroad baseline (verified in code, v0.2.22)

| Area | What exists | Where |
|---|---|---|
| Free signal radar | Website crawl (including vendor scripts), ATS job boards, GDELT news, Hacker News, DNS (MX/SPF/DMARC, SaaS records), EDGAR Form D, GitHub orgs, HN Who's Hiring, YC directory, podcasts, public records | `src/lib/signals/*` |
| Community | Hacker News questions only (Reddit's API needs an account, so it's not used) | `src/lib/signals/community.ts` |
| Discovery | Web search providers (Firecrawl, Tavily, Exa, Brave…), YC directory, lookalikes of your users, competitors' customer pages, playbook qualification | `src/lib/workflows/discovery.ts`, `companies/list/header-actions.tsx`, `docs/RESEARCH.md` |
| People | Free Apollo search by buyer titles. Paid adds through Firecrawl Alexandria (Apollo/FullEnrich, 30 + 20 credits). Pattern-guessed emails need the founder's confirmation | `components/people/find-people.tsx`, `lib/connectors/catalog.ts`, `lib/people/directory.ts` |
| Imports | LinkedIn connections CSV (job-change diffs); GitHub stargazers of *your* repo; known users | `components/import/*`, `lib/network/stargazers.ts` |
| Plays | 13 coded plays, marked free or paid, with backtests and skip reasons | `lib/plays/catalog.ts`, `components/plays/plays-page.tsx` |
| Today | Up to 5 moves, skip with one of 6 reasons (counted in the weekly review only), voice learned from edits | `components/today/move-card.tsx`, `lib/moves/review-data.ts`, `lib/quality/voice.ts` |
| Outbound | 3-step email sequence plus a LinkedIn invite, pushed to Instantly/Smartlead/lemlist as template variables. Inroad never sends | `lib/quality/sequence.ts`, `lib/connectors/catalog.ts` |
| Replies | Check replies (Gmail search, R/N/B/U keys), pasted replies, sequencer polling and webhooks with vendor sentiment labels, a reply classifier with an eval gate, reply drafts | `today/check-replies.tsx`, `lib/hub/poll.ts`, `lib/hub/inbound.ts`, `lib/quality/reply-set.ts`, `lib/workflows/compose.ts` |
| CRM, booking, Slack | HubSpot and Attio sync; Calendly and Cal.com; Slack daily brief and hot-reply posts | `lib/connectors/*`, `lib/hub/slack-messages.ts` |
| Monitors | Topic and page monitors | `lib/automation/monitors.ts` |
| Agents | 21 MCP tools (ICP, playbook, scoring, next actions, drafts, warm paths, forecast…). No research or signal tools | `lib/api-keys/tools.ts` |
| PostHog | Metrics only: not used for signals, plays or moves | `lib/metrics/providers.ts` (grep) |
| Not present | Per-row custom AI columns; user-defined plays or signals; website visitor ID; product-usage signal types (`SignalType` has none) | grep; `lib/domain/types.ts:140` |

---

## 3. Feature matrix

Inroad: **Has / Partial / Missing**, checked in code. Competitors: **Yes / Part / No**, from the §1 sources or notes 03 and 13; **?** means not confirmed in this research.

| Capability | Inroad | Clay | Apollo | Unify | Amplemarket Duo | Common Room | Origami |
|---|---|---|---|---|---|---|---|
| Hiring and job-post signals | **Has** (ATS boards, HN hiring, a job description that names the pain) | Yes | ? | Yes | Yes | ? | Yes |
| Funding, news, filings | **Has** (GDELT, HN, SEC Form D) | Yes | ? | ? | Yes | ? | Yes |
| Tech stack and site changes | **Has** (site scripts, DNS records, page monitors) | Yes | Yes | Yes | ? | ? | Part |
| Job changes and past champions | **Partial** (LinkedIn CSV re-import diffs; Apollo "moved on") | Yes | ? | ? | Yes | ? | Yes |
| Website visitor ID | **Missing** (on purpose: paid data) | Yes | ? | Yes | Yes | Yes | Yes |
| Product-usage signals | **Missing** (PostHog feeds metrics only) | Yes | ? | Yes (PostHog, Apr 2026) | Part (CRM/API) | Yes | ? |
| Social and community listening | **Partial** (HN questions; your own repo's stargazers) | Yes (Pro+) | ? | ? | Yes | Yes | Yes |
| Custom signal from a prompt | **Partial** (topic and page monitors; nothing typed or account-linked) | Yes | Part | ? | Part | Yes (Capture) | Part |
| Account list building | **Has** (YC, Form D, GitHub, search providers, lookalikes, competitors' customer pages) | Yes | Yes | Yes | Yes | ? | Yes |
| Contacts and emails | **Partial** (Apollo search free; paid adds in credits; guesses need confirmation) | Yes (waterfall) | Yes | Yes | Yes | ? | Yes |
| Per-row AI research and custom fields | **Missing** (per-account dossiers only) | Yes | Yes | Yes | Part | Yes | Yes |
| Scoring with visible reasons | **Has** (fit, why-now, tier, with sources and backtests) | Part (build it yourself) | ? | ? | Part | Part | Part |
| Plays and workflows | **Partial** (13 coded plays: dry run, backtest, skip log; you can't add your own) | Yes | Yes | Yes | Part | Part | Yes |
| Natural-language builder | **Partial** (Ask reads, proposes and starts workflows) | Yes (Sculptor) | Yes | Yes | ? | Part | Part |
| Sequencing and sending | **Partial** (drafts and pushes to a sequencer; never sends, by design) | Yes | Yes | Yes | Yes | No | Yes |
| Approval feed | **Has** (Today, up to 5 moves, skip with a reason) | Part | Yes (Slack) | Part | Yes | Part | Part (optional) |
| Learns from edits and dismissals | **Partial** (voice learns from edits; skip reasons are only reported) | ? | ? | ? | Yes | ? | ? |
| Reply handling | **Partial** (classifier, drafts, sequencer polling; no single inbox) | Part | ? | Yes (OOO) | Yes (Inbox tier) | No | ? |
| CRM sync | **Has** (HubSpot, Attio; Salesforce/Pipedrive via CSV) | Yes | Yes | Yes | Yes | Yes | Yes |
| Slack | **Partial** (brief and hot-reply alerts; approval happens in the app) | Yes (alerts) | Yes (approve in thread) | ? | ? | Yes (Spark) | ? |
| MCP and coding-agent access | **Has** (21 tools, but none for research or signals) | Yes (MCP, CLI) | Yes | Part | ? | Part | ? |
| Every claim cited to a source | **Has** | Part (cell provenance) | ? | ? | ? | ? | ? |
| Warm paths and intros | **Has** | No | No | No | No | ? | Part |
| Entry price | Free with your own AI key | ~$185/mo plus credits | Free tier, then per seat | Free rep plan | ~$600/mo, annual | ~$2–4K/mo [secondary] | $99/mo |

How to read it:
- Inroad already leads on the audit and trust layer: sourced claims, backtests, warm paths and approval.
- It trails on four things competitors have turned into everyday features:
  - per-row research columns;
  - product and first-party intent;
  - custom signals;
  - plays you can define yourself.
- All four are buildable on free data and the user's own AI key.

---

## 4. Top 12 opportunities (ranked)

Ranking = (impact for a founder or Head of GTM) × (feasibility locally, with no paid data APIs). Ties go to whatever gives a strong first impression in the first 5 minutes.

### 1. Research columns: "Ask every company" (a local Claygent on the Companies table)
- **Problem:**
  - A GTM engineer's most frequent job is one custom question across a list: does each company use Snowflake, have a security page, sell to enterprise, run Ashby?
  - Inroad answers deep questions one account at a time (dossiers) but can't ask one question of 200 accounts. That's when users export to Clay.
- **UI:**
  1. Companies → table layout (`?layout=table`) → **+ Column**.
  2. Type a question. Inroad proposes an answer type (yes/no/unknown, pick one, number, short text, URL) and the cheapest method:
     - **From pages I already have**: free, from the cached crawl, jobs, DNS and news;
     - **Read up to 2 more pages**;
     - **Web search**: counts against the daily limit.
  3. It shows estimated tokens and searches before anything runs.
  4. **Try on 5 rows** (copied from Clay's sandbox), then **Run on 212**.
  5. Cells fill in live. Each shows the answer, a source favicon and a date; click for the quote and URL. "Unknown" is a real value; nothing is guessed.
  6. The column menu offers:
     - **Use as fit criterion**: adds an ICP criterion and re-tiers accounts;
     - **Use as a filter in plays**;
     - **Use in drafts**: the citation travels with the fact.
- **Data:** the `crawlSite` and jobs/DNS/news caches, the configured search and page providers, the user's AI key on the cheap tier, and the existing quality gates.
- **Proof of demand:**
  - Clay Claygent (auto model per row since Oct 27), Apollo AI Research (custom fields as sequence variables), Freckle, lemlist's agentic enrichment, Origami (50+ sources).
  - In note 13, GTM engineers' #1 "wow" was watching their list fill in with the source of every cell.
- **First 5 minutes:** after onboarding, the founder's target accounts open as a table with 3 ICP-specific columns already running.

### 2. Product-intent signals from the PostHog connection Inroad already has
- **Problem:** the warmest prospects are already signed up. Inroad connects PostHog for Revenue/Growth numbers and ignores who those users are.
- **UI:**
  - On connecting (and on Revenue/Growth), a card: "14 companies that match your ICP are already in your product. 3 have 3+ people. 2 hit a limit this week" → **Review**.
  - Today gets "In your product" moves, for example: "Dana (Head of Data, Globex, fit 82) invited 2 teammates yesterday." Each comes with a help-first draft; the lint already blocks surveillance-sounding copy.
  - The company sheet timeline shows first seen, invites, key events and last active.
  - New plays:
    - signup at an ICP company;
    - team forming (3+ users in 30 days);
    - hit a limit or opened pricing while signed in;
    - went quiet 14 days after activation.
- **Data:** identified PostHog persons and events, read through the existing read-only connection. Reuse the HogQL query path the metrics sync already uses (`src/lib/metrics/providers.ts`). Email domain → account, using the existing resolver with the free-mail filter; Stripe/Polar customers to exclude, or to flag for expansion.
- **Proof of demand:** Unify's PostHog product signals (Apr 2, 2026), Clay's product signup and usage signals, Common Room, Reo.dev, Default's real-time data layer.
- **First 5 minutes:** the "already using you" list appears within a minute of connecting.
- **Limit:** only users the app identifies count. Inroad already says so for metrics.

### 3. Developer radar: who engages with competitor and ecosystem repos
- **Problem:** for developer-tool founders, Inroad's core audience, the GitHub import reads stargazers only, and the UI frames it around *your* repository. The bigger qualified pool is engineers starring, forking or filing issues on competitor and adjacent repos, and issue text often names the pain.
- **UI:**
  1. Import → **Developer radar**: paste up to 5 repos (yours, competitors', libraries in your ecosystem).
  2. Result line, for example: "312 engaged in 30 days → 41 people at 28 companies I could place → 19 match your ICP (6 Tier A)."
  3. Tabs: Stargazers · Forkers · Issue authors. Issue authors show a quote of at most 12 words and a link.
  4. **Track weekly** turns the repos into a monitor; new engagements become dated signals.
  5. Draft rules:
     - open with the problem the issue describes and cite the public issue;
     - the lint blocks "I saw you starred."
- **Data:** the GitHub REST API (stargazers with timestamps, forks, issue and discussion search). The existing `stargazers.ts`/`github.ts` resolver (@org, work email, site, YC match). An optional GitHub token raises the limit from 60 to 5,000 requests an hour.
- **Proof of demand:**
  - Reo.dev (a developer-intent platform; ranks an issue above a star).
  - Common Room's open-source signals.
  - Trigify's competitor-engagement lists (gone since Oct 22, leaving a gap).
  - Clay's social listening.
- **First 5 minutes:** paste a competitor repo and see named ICP companies in about 2 minutes.

### 4. "Tell me when…": custom signals compiled from a sentence
- **Problem:** each company's best trigger is specific to it: adds a status page, a job post that mentions dbt, launches in the EU, edits its pricing page, publishes SOC 2. Inroad has fixed signal types, and monitors that produce observations, not account-linked signals.
- **UI:**
  1. Plays → **New signal**: "Tell me when a target account ___."
  2. Inroad restates the detector in plain words. Example: "Weekly, read /pricing and /security on 212 accounts; fire when the text adds 'SOC 2'."
  3. A method badge says how it runs: *Free, deterministic* / *Free, AI judges changed text only* / *Uses web search*.
  4. **Dry run**: "Would fire on 7 accounts today", with evidence. Edit, then **Save**.
  5. Matches become dated, sourced signals with a decay window, and they feed Today and plays.
- **Data:** page and topic monitors, the crawl cache, ATS boards, DNS and news. The AI is used only to compile the sentence and to judge diffs.
- **Proof of demand:** Clay custom signals, Common Room RoomieAI Capture, UserGems' research agent, Apollo Lead Discovery.
- **First 5 minutes:** a founder-specific trigger with live matches in under a minute.

### 5. Champion and past-user job-change watch (no LinkedIn scraping)
- **Problem:** people who already like you and change jobs are the best-converting signal. Inroad only notices when the founder re-imports LinkedIn connections, or when Apollo says "moved on" during a people search.
- **UI:**
  - Companies → Customers, plus contacts on won and lost deals → **Watch these 37 people**.
  - A weekly check produces moves such as: "Dana Lee (champion, Globex, won Mar) → VP Engineering at Initech (fit 78, no open deal)."
    - **Personal note** draft: no template; cites your shared history.
    - **Find successor at Globex**: covers the champion-left case.
  - A monthly nudge: "Re-export LinkedIn connections (2 min)", with the diff from the last import.
- **Data:**
  - Apollo people search, which costs nothing per lookup on the user's own key and is already integrated;
  - GitHub profile company changes;
  - bounces from polled sequencers;
  - team pages in the crawl cache;
  - LinkedIn CSV diffs.
  - To avoid false positives from title edits (a known Clay issue), require 2 sources or a 14-day hold.
- **Proof of demand:** UserGems (its core product; Gem-E learns from closed-won deals), Clay job-change signal, Amplemarket Duo (past champions and deal blockers), Common Room.
- **First 5 minutes:** with an Apollo key, "3 of your past users now work at ICP companies."

### 6. Describe-a-play builder with dry run, backtest and versions
- **Problem:** the 13 coded plays are good defaults, but Heads of GTM run their own. Example: "Series A fintechs hiring a first RevOps lead → VP Sales within 14 days, skip if touched in the last 90 days, at most 20 a week."
- **UI:**
  1. Plays → **New play**, one sentence.
  2. Inroad returns an editable card:
     - **Trigger**: an existing signal type, or one from #4;
     - **Audience**: minimum fit, tier, segment, persona;
     - **Guardrails**: weekly cap, cooldown, skip open deals, one play per person;
     - **Action**: kind of move and angle;
     - **Measure**: meetings per 100 enrolled, plus a holdout.
  3. **Dry run**: who's included and excluded, and why, using the existing skip log.
  4. **Backtest on your deals**: the existing `backtestPlay`.
  5. **Start**.
  6. Each new version shows a diff from the last, a release note and its own results.
- **Data:** the existing play engine and backtests. The AI only compiles the sentence into a validated play definition; running it costs zero tokens.
- **Proof of demand:** Clay Workflows and Sculptor (Aug 11; runs pinned to snapshots), Apollo Builder Studio (Sep 30), Unify Plays, Instantly Copilot automations (Jul 2), Smartlead SmartAgents (Feb).
- **Why:** Inroad already has the audit layer Clay just shipped. Letting users write plays turns "13 plays" into "your plays."

### 7. A replies inbox: every reply classified and drafted, with an SLA timer
- **Problem:**
  - Inroad already classifies and drafts replies, but they arrive by three routes (sequencer polling and webhooks, pasted mail, Gmail search links).
  - There's no single queue and no timer, and out-of-office replies and referrals are handled by hand.
  - 64% of replies arrive within an hour (Smartlead data in 13).
- **UI:**
  - Today → **Replies** lane. One row per thread, each with:
    - an intent chip: Yes / Question / Referral / Not now / OOO / Stop;
    - an age timer: "41 min · reply within 1 business hour";
    - a draft grounded in the Playbook's objections, proof and pricing, with the booking link.
  - Keys: J/K to move, E edit, C copy, O open the thread in Gmail or the sequencer.
  - Handled in code, at zero tokens:
    - OOO: read the return date and move steps 2 and 3;
    - referral: create the person and draft the intro ask;
    - not now: set a dated nurture;
    - stop: suppress the address (already exists).
  - The Friday review shows median time to first response. Inroad still never sends.
- **Data:** the existing polling, vendor labels, classifier and reply drafts.
- **Proof of demand:** Instantly AI Reply Agent and Unibox, Amplemarket Duo Inbox, Unify OOO handling (Apr 17), Anthropic BD's hourly inbox skill.

### 8. "Asking for it": buyers asking for what you sell, in public
- **Problem:** the highest-intent public signal is a buyer asking for a recommendation. Inroad only searches Hacker News.
- **UI:**
  - Research → **Conversations**. Cards like "Asked 3h ago in r/dataengineering…" show the persona match and highlight the buyer's own words. One click saves those words to Messaging's customer words.
  - **Draft a helpful reply** follows the public-ask rules: reply in the thread; DM only if they ask.
  - A weekly Today card: "5 people asked for what you sell."
- **Data:**
  - HN Algolia (already used);
  - Reddit through the configured search provider with a site filter;
  - the Stack Exchange API;
  - GitHub Discussions search;
  - Bluesky's public API.
- **Proof of demand:** Origami's "conversations where people ask for what you sell", Clay social listening, Common Room, Gojiberry, and Trigify before it closed.

### 9. Skips and edits that change targeting, visibly
- **Problem:** Inroad stores 6 skip reasons and learns voice from edits, but skips don't change *who* it recommends. A founder who keeps skipping "wrong person" sees the same persona again tomorrow.
- **UI:**
  - After a skip, a chip: "Got it — fewer Heads of Data at companies under 50 people. Undo."
  - Playbook → **What I've learned** lists each rule with its evidence count, removable.
  - The weekly review lists what changed.
- **Data:** `Move.skipReason`, persona and signal weights in scoring, the voice card. Pure code.
- **Proof of demand:**
  - Amplemarket Duo: dismissals and edits retrain recommendations across signals and personas.
  - Anthropic BD records the reason for every rejection.
  - Apollo's Sequence Optimization agent.

### 10. Approve from Slack (Socket Mode, so no public URL)
- **Problem:** Heads of GTM live in Slack. Inroad posts a brief and hot-reply alerts there, but every approval needs the app.
- **UI:**
  - An 8:00 DM with the day's moves. Each block shows who, why now with a link, and a draft preview, plus buttons:
    - **Approve**: returns the Gmail compose link, or pushes to the sequencer as today;
    - **Skip** with a reason;
    - **Edit**: deep-links to the move.
  - Hot replies get a **Draft reply** button, and the draft comes back in the thread.
- **Data:** a Slack app the user creates with Socket Mode. It's a WebSocket from the local app, so no tunnel is needed. Existing move actions.
- **Proof of demand:** Apollo agents (DM → approve in thread), Common Room Spark, Clay's bundled Slack signal messages, Anthropic BD's morning brief.
- **Limits:** setup friction, and it only works while the computer is on. Say so in the UI.

### 11. Make Inroad the free data layer for coding agents (MCP research and signal tools)
- **Problem:** GTM engineers now prospect from Claude Code, Codex and Cowork. Inroad's MCP server exposes its playbook, scores and drafts, but not its best asset: the zero-cost signal radar and discovery.
- **UI:**
  - Integrations → AI agents → a new **Research** tool group, read scope, off by default:
    - `gather_signals(domain)`
    - `discover_accounts(brief, limit)`
    - `research_column(question, domains)` (#1)
    - `dry_run_play(definition)` (#6)
  - Every call lands in the run log with its cost.
- **Data:** the existing signal fetchers, discovery workflow and run receipts.
- **Proof of demand:** Clay's CLI, agent plugin and MCP in Codex (Jun 2); Freckle's CLI pivot; Apollo's MCP growth (4x, Mar–Aug); Unify's relaunch as "Claude for Outbound Sellers"; Octave's MCP; Anthropic BD on Cowork.

### 12. Account universe and coverage (free TAM from public data)
- **Problem:** Heads of GTM plan by coverage (how much of the market is touched, how much is in its buying window), not by lists. Inroad discovers accounts but doesn't size the reachable universe.
- **UI:**
  - Companies → **Universe**. A funnel: "ICP in free public data ≈ 1,240 → live signal 410 → fit 70+ 168 → Tier A this week 34."
  - Rows per segment: count, % touched, % in window, meetings, win rate.
  - **Add next 25** button.
  - A coverage note, for example "EDGAR is US-only; non-US companies are undercounted."
- **Data:** YC directory, EDGAR Form D, ATS board discovery, GitHub orgs, HN hiring, the search providers, lookalikes, existing scoring.
- **Proof of demand:** Monaco's TAM modelling (03), Clay CPJ-based TAM sourcing and redesigned lookalikes (Jun), Apollo Intelligence Layer, Exa Websets, Unify's Ocean.io lookalikes.

**Considered but not in the top 12:**
- *Deliverability guard:* read mailbox health from Instantly or Smartlead and block pushes when bounces go over 3% (Instantly shipped a Deliverability Agent on Jun 17).
- *Google Maps lists for SMB targets:* Clay's rectangle search, Origami.

### What not to build
- **Person-level website visitor ID:**
  - It needs paid identity graphs.
  - RB2B pulled person-level data from its free tier, and Warmly went into HubSpot.
  - A pixel served from a laptop misses visits whenever the machine sleeps.
  - Do #2 instead: identified first-party users only.
- **LinkedIn engagement scraping or automation:** Artisan's LinkedIn ban and Trigify's shutdown are enough evidence. Keep manual capture only.
- **Autonomous sending or an AI-employee persona:** the evidence in 03 still holds, and Anthropic's own team keeps a person on every send.
- **Credit meters:** keep "free first, with receipts and a cost preview before running." That is now the clearest difference from Clay.

---

## 5. UX patterns most worth copying

1. **Cells fill in live with receipts, after a 5-row preview and a cost estimate** (Clay's table, Sandbox mode, credit budgets).
2. **A daily feed where dismiss-with-reason visibly retrains the next day** (Amplemarket Duo).
3. **A dry run before you commit, a per-record trace after** (Clay Workflows' snapshot-pinned runs). Inroad's play skip log is the seed.
4. **Approve where you already are** (Apollo's Slack DM → approve in the thread; UserGems inside the CRM).
5. **"Why now" as the main column or card, with a timestamp, grouped into plays that show send and reply counts** (Origami), and an inbox of finished work rather than a blank chat (Actively).

---

## Gaps

- No hands-on trials. Competitor cells marked "?" weren't confirmed.
- Several figures are vendor-reported or come from competitor blogs, labelled as such.
- The State of GTM Engineering 2026 survey was read through a secondary summary.
- Not confirmed:
  - whether Zoom's purchase of Common Room or HubSpot's purchase of Warmly has closed;
  - Unify's paid pricing after the relaunch;
  - Apollo's website-visitor and job-change features;
  - the date of Apollo's Slack agents launch.
