# Competitive landscape: AI GTM agents, AI SDRs and "AI executives" (October 2026)

## 0. Summary

- **The "autonomous AI SDR" story has worn out.** The best-known company in the category, 11x, was found to be listing customers it didn't have (TechCrunch, Mar 2025):
  - Employees said its ~$14M stated ARR included a lot of contracts still inside 3-month break clauses. Only about $3M had made it past the trial.
  - One employee said: "We were losing 70-80% of customers." 11x says retention is 79%.
  - ZoomInfo said Alice "performed significantly worse than our SDR employees."
  - The CEO stepped down in May 2025.
  - Sources: https://techcrunch.com/2025/03/24/a16z-and-benchmark-backed-11x-has-been-claiming-customers-it-doesnt-have and https://techcrunch.com/2025/05/05/11x-ceo-hasan-sukkar-steps-down/
- **The market is converging on the same message: "signal-based, human-approved, not spam."** Even fully autonomous vendors now say "refuses to spam" (AiSDR, https://aisdr.com). Saying "we're not spam" no longer sets a product apart.
- **Platforms are absorbing the category through acquisitions:**
  - Salesforce bought Bluebirds (closed Aug 13, 2025) and agreed to buy Qualified/Piper (announced Dec 17, 2025).
  - Zoom is buying Common Room (announced Jul 2, 2026).
  - Persana's homepage says it is "joining forces with Rox."
  - HubSpot, Apollo and Agentforce now bundle their own agents.
  - Sources: https://www.salesforce.com/news/stories/salesforce-signs-definitive-agreement-to-acquire-bluebirds/ · https://saastr.com/why-salesforce-acquiring-qualified-is-maybe-the-smartest-ai-gtm-deal-of-2025 · https://investors.zoom.us/news-releases/news-release-details/zoom-acquire-common-room-bringing-buyer-intelligence-its-ai · https://persana.ai
- **Most of the money is going to revenue platforms for teams, not to founders:**
  - Clay: $7.1B valuation (https://www.clay.com/blog/series-d).
  - Rox: $1.2B valuation on about $8M of 2025 ARR (https://dealroom.co/news/126775-ai-sales-startup-rox-hits-1-2b-valuation-and-8m-arr-with-new-round/).
  - Reevo: $80M (https://www.fenwick.com/insights/experience/fenwick-represents-reevo-in-80m-funding).
  - Actively: $45M Series B (https://fintech.global/2026/04/29/tcv-and-first-harmonic-back-activelys-45m-funding-round/).
- **The closest competitor to "AI Head of GTM for startups" is Monaco** (Sam Blond, ex-Brex CRO, $35M led by Founders Fund):
  - It targets seed and Series A startups.
  - It combines an AI-native CRM, a TAM database and outbound agents with a human "forward-deployed AE."
  - Pricing is $10K upfront.
  - It explicitly does not use an avatar: "Monaco does not have an agent pretending to be a sales rep."
  - Source: https://techcrunch.com/2026/02/11/former-founders-fund-vc-sam-blond-launches-ai-sales-startup-to-upend-salesforce/
- **"AI executive" persona products get attention but have little proven value.**
  - Icon raised a $9.2M seed and spent $12M on the icon.com domain to sell an "AI CMO." After user complaints it reportedly pivoted to human-filmed UGC ads (https://sacra.com/c/icon/).
  - In Aug 2025 the FTC sued Air AI. This is the first case alleging deception about agentic AI "replacing human employees" (https://www.dlapiper.com/insights/publications/2025/08/ftcs-latest-ai-washing-case).
- **Where the gap is:** nobody owns the strategy and warm-motion layer for pre-PMF technical founders. That means:
  - deciding who the first 20 customers should be and why;
  - warm intros, exec dinners and design-partner programs;
  - coaching the founder through sales calls;
  - a weekly operating rhythm.
  
  Every tool assumes the ICP is already known and the job is producing outreach volume.

---

## 1. Market map

Prices are third-party or vendor-reported unless marked otherwise. Treat them as directional.

### A. Autonomous AI SDRs ("digital workers")

| Company | What it automates | Core UX pattern | Price (2026) | Target | Notes |
|---|---|---|---|---|---|
| **11x** (Alice, Julian, Nina voice) | Alice: outbound email, social and multichannel sequences, nurture, reactivation. Julian: inbound voice and chat, speed-to-lead, upsell calls | Persona agents plus Playbooks, Knowledge Base, Sequence Builder, Smart Replies, analytics. Live voice-demo widget. The homepage now says "agents that drive revenue" / "Revenue agents"; the "digital worker" and "hire" wording is gone (https://www.11x.ai) | Growth plan $3,750/mo billed annually (about $45K/yr), up to 5 users and 2,000 new prospects/mo (https://coldreach.ai/blog/11x.ai-review). Vendr median $40,125/yr (https://prospeo.io/s/ai-sdr-pricing) | Mid-market and enterprise | Alice sends about 50K emails/day (https://ai.engineer/talks/KWmkMV0FNwQ-building-alices-brain-ai-sales-rep-that). One hands-on test of 200 leads produced 847 emails, 11 replies and 1 meeting (https://b2bsalesguru.medium.com/11x-ai-sdr-review-i-gave-it-200-leads-and-watched-what-happened-2026-45d14f2ca215, unverified) |
| **Artisan** (Ava) | End-to-end outbound: data, enrichment, writing, sending, replies, booking. Calls are queued for humans | "Hire Ava" and "AI employees." Ava is pitched as an autonomous BDR that replaces a stack of tools (https://www.artisan.co) | Not public. Estimates run about $2K–5K+/mo. Vendr median about $26K/yr | Startups, SMB, enterprise | "Stop Hiring Humans" billboards. LinkedIn banned the company on Dec 19, 2025 for about 2 weeks; the CEO said the reasons were using LinkedIn's name and data brokers that had scraped LinkedIn. He also said lead flow went *up* afterwards (https://techcrunch.com/2026/01/07/yes-linkedin-banned-ai-agent-startup-artisan-but-now-its-back) |
| **AiSDR** | Plain-English ICP → live web search lists → research → email, LinkedIn and phone sequences, objection handling, booking. An "AI Strategist" proposes campaigns | Strategist plus autopilot. Escalates complex cases to humans | $900/mo, or $1.5 per person pay-as-you-go, unlimited seats | Founders and small revenue teams | Claims "1–3 qualified meetings per 100 leads" and a first meeting in 1–2 weeks (https://aisdr.com) |
| **Topo** (YC W24) | Signal lists, enrichment from 15 providers, multichannel sequences, deliverability | Embedded agent with **"Copilot mode": approve every lead and message**. Includes human outbound experts at onboarding | About $875/mo (1,000 leads) to $3,000/mo (6,000 leads) (https://reply.io/blog/topo-ai-review/) | B2B startups | https://www.topo.io |
| **Regie.ai** (RegieOne) | AI agents plus human reps plus a parallel dialer | Enterprise sales engagement platform | $180/user/mo with a 10-seat minimum. Vendr median about $50K/yr (https://www.landbase.com/blog/regie-ai-pricing) | Enterprise | Results depend heavily on CRM data quality |
| **Valley** | LinkedIn-first signal "plays" → research → messages in your voice → unified inbox | 3 steps: paste your website (its "Scout" learns your offer) → choose a play → review and launch. **"Keep control of approvals."** MCP into Claude and ChatGPT | $149–199/seat/mo. "Studios" done-for-you tier is $1,499/mo (https://www.joinvalley.co) | Founders, sales teams, agencies | Claims 15–45% reply rates (vendor) |
| **Gojiberry** (YC 2026) | "GTM Brain" for small teams: signals → ranked leads → drafts → follows up until a meeting is booked | Self-serve | Not verified | Small sales teams | Claims $2.5M ARR in 10 months and 2,000+ customers (https://ycombinator.com/companies/gojiberry-ai) |

### B. Inbound AI SDRs (speed-to-lead)

| Company | What it automates | UX and persona | Price | Notes |
|---|---|---|---|---|
| **Qualified Piper** (being acquired by Salesforce) | Website chat, voice and video; email follow-up; meeting booking; "Agentic PLG" | **"Hire Piper."** Female persona with an avatar, greets visitors by name, gives a 60-second "Piper Presentation" (https://www.qualified.com/ai-sdr) | About $42K/yr+ estimated. Pitched as "a hire, not a seat" | Claims 500+ companies. Sinch: "does the work of 13 SDRs" (vendor) |
| **Agentforce SDR** | Greets visitors, works inbound leads inside guardrails, answers objections from CRM data, books meetings. Bluebirds adds a prospect shortlist | **Autonomous or "suggestive" mode.** Lead cards in Slack | Flex Credits at about $0.10 per action ($500 per 100K credits), or a $125/user/mo add-on. Implementation typically $25–75K mid-market (https://www.jitendrazaa.com/blog/salesforce/salesforce-agentforce-credits-cost-model-complete-guide-2026/) | Salesforce customers |
| **HubSpot Breeze** | Prospecting Agent and Customer Agent | Inside the HubSpot CRM | **Outcome pricing (Apr 2026):** billed per recommended lead; $0.10 per company research task; Customer Agent $0.50 per resolution; $10 per 1,000 credits (https://resolve247.ai/blog/hubspot-breeze-pricing-change) | Pro and Enterprise HubSpot customers |
| **Default** | Inbound routing, scheduling, enrichment, plus a revenue agent called "Dot" | Data layer plus workflows | Not public | $20M total (8VC). Set aside $1.5M to buy customers out of legacy contracts (https://www.contentgrip.com/default-agentic-gtm-platform/) |

### C. Signals, data and workflow ("GTM engineering")

| Company | What it automates | UX pattern | Price | Notes |
|---|---|---|---|---|
| **Clay** | Enrichment, research agents (Claygent), Audiences, Sequencer, Workflows, Account Agents, MCP | **Spreadsheet table plus a workflow builder.** Sculptor builds agents from natural language. Created the "GTM engineer" role | Growth plan $495/mo (6K data credits, 40K actions) | $115M Series D at $7.1B, revenue up 4x in 2025, 17K+ customers. 2–3 week learning curve, and credit burn is a common complaint (https://www.zeliq.com/blog/clay-pricing) |
| **Unify** | Lists from 40+ sources, signals, AI sequences, mailbox warmup | **Chat "Agent" with 50+ skills, plus "Plays" that run on autopilot.** CEO essay argues for human-in-the-loop by default (https://www.unifygtm.com/explore/ai-sdr-vs-ai-for-sdrs) | Growth plan about $1,740/mo billed annually. Credit model is the top complaint | Perplexity case study: $1.7M pipeline and 80+ enterprise meetings in 3 months with no BDR (vendor) |
| **Amplemarket Duo** | Finds contacts showing buying signals, researches them, drafts multichannel sequences | **Daily "Duo feed": edit, regenerate, send, or dismiss with a reason. Learns from dismissals.** "Never sends… without visibility" (https://www.amplemarket.com/duo) | Startup plan $600/mo billed annually (2 users) | The best example of a recommendation feed in this category |
| **Origami** | URL or plain-language ICP → accounts, decision-makers, verified contacts, email and LinkedIn sequences, LinkedIn posts | **Swipeable "play" cards → you approve → it runs, with results in tables** (https://origami.chat/) | Free to start. Starter $99/mo with 7,500 credits, no seat fees | YC. Claims 1,000+ customers |
| **Common Room** (→ Zoom) | Person-level buyer signals and RoomieAI research agents | Agents surface inside Salesforce, Slack and the browser | Essential tier about $2,500/mo | Being folded into Zoom Revenue Accelerator |
| **Apollo AI Assistant** | "Describe a goal" → it builds and runs prospecting, enrichment and outreach workflows | **Chat-to-workflow** ("Vibe GTM"). ChatGPT app via MCP (Apr 2026) | Free introductory offer on paid plans | GA Mar 4, 2026. About 20K weekly active users. Beta users booked 2.3x more meetings (self-reported) (https://www.apollo.io/newsroom/announcements/apollo-launches-ai-assistant-powering-end-to-end-agentic-workflows-in-the-first-ai-native-all-in-one-gtm-platform) |
| **Persana** | Signals, enrichment from 100+ sources, sequencer, Chrome extension | Workflows and sequence builder | Not public | Homepage says "joining forces with Rox" |

### D. AI-native CRMs and revenue "operating systems"

| Company | Pitch and UX | Price and target | Notes |
|---|---|---|---|
| **Monaco** | AI CRM, automatic TAM modelling, stack-ranked accounts that **show the reasoning behind each score**, outbound agents, meeting recorder, plus a **forward-deployed human AE**. Tagline: "Agents work. You close." (https://www.monaco.com) | **$10K upfront for 1M credits (1¢ each), then pay-as-you-go. No seat or platform fee. Unlimited users and agents** (https://www.monaco.com/pricing). Target: seed and Series A | Closest analog to our product. Blond: "combination of the technology, but also the service." No avatars |
| **Day.ai** (CRMx) | "Context graph" built from email, calendar, meetings and Slack, plus **named agents in an org chart, each reporting to a human**. Agents trigger on events (e.g. a recorded meeting), schedules (Friday stale-deal nudges) or requests. **Actions need human approval** (https://day.ai) | $20M Series A led by Sequoia (Feb 2026). Founded by HubSpot's former CPO | Copy idea: morning briefings and scheduled nudges |
| **Rox** | "The Revenue Agent for the Global 2000," "Revenue on Autopilot." The footer admits it needs human oversight (https://www.rox.com) | Enterprise | Valued at $1.2B on about $8M ARR, roughly 150x |
| **Actively** | **Per-Account Agents** and an **agent inbox of finished, prioritised work ready to act on** (https://www.actively.ai) | Enterprise (Samsara: 1,000+ person GTM team) | Positions itself against chatbots that wait for you to decide what to do |
| **Attio** | Ask Attio chat plus AI attributes and workflows, billed in credits | Plus $35–44/seat, Pro $79–99 (https://coworker.ai/blog/attio-pricing) | Popular CRM with startups |
| **Lightfield** (Tome founders) | CRM that keeps unstructured conversations instead of forcing them into fields | $47M Series A (a16z, Sep 2026). 5,000+ signups since Nov 2025 (https://unite.ai/lightfield-raises-47m-series-a-led-by-a16z-to-accelerate-growth/) | — |

### E. Horizontal agents (the "do-it-yourself" alternative)

- **Lindy:**
  - Pitches itself as an "AI teammate" that works in Slack, iMessage and email, with "Hire Lindy for…" pages by function.
  - Free tier includes $50 of credits. Team plan is $29.99/mo for 3K credits (https://www.lindy.ai).
- **Relevance AI:**
  - "The home of the AI Workforce," with an L1–L4 autonomy model (Assisted through Self-Driving).
  - Prebuilt agents include an Outbound Prospector.
  - Its pricing page now shows a single Enterprise plan, by quote (https://relevanceai.com).
- **Claude Cowork sales plugin** (Jan 30, 2026):
  - Open source. Covers prospect research, `/sales:call-prep`, pipeline review, drafting outreach and battlecards.
  - Connectors include HubSpot, Close, Clay, ZoomInfo and Fireflies (https://github.com/anthropics/knowledge-work-plugins).
- **ChatGPT Workspace Agents and MCP apps** from Apollo, Clay and Valley: GTM work is moving into general-purpose assistants.
- **Implication:** "an LLM researches and drafts emails" is now a commodity. A moat has to come from an opinionated GTM method, taste and workflow.

### F. Summary of core UX patterns

1. **Persona plus autopilot dashboard** (11x, Artisan, Piper). Highest hype, and highest churn and backlash.
2. **Table plus workflow builder** (Clay, Persana). Powerful, but needs a GTM engineer and the credit math is painful.
3. **Chat-to-workflow** (Apollo Assistant, Unify Agent, Clay Sculptor, Lindy in Slack).
4. **Feed or inbox of recommendations to approve** (Amplemarket Duo, the Actively inbox, Bluebirds' weekly shortlist, HubSpot per-lead billing, Topo Copilot mode). This is the best fit for a product built on trust.
5. **Swipeable play cards** (Origami): low-effort strategy selection.
6. **Org chart of named agents** (Day.ai, Marblism, Sintra, Motion).
7. **Software plus a human service layer** (Monaco's FDE AE, Valley Studios, Topo experts, Relevance's embedded team). Evidence that buyers want expertise, not just tooling.

---

## 2. "AI executive" products: how they present themselves

| Product | What it is | Persona and framing | Price | Reality check |
|---|---|---|---|---|
| **Okara "AI CMO"** | Enter your website URL → a team of agents runs SEO audits, content, AI-search brand monitoring, and Reddit/HN community engagement | "The AI CMO" | $20–99/mo (sources conflict) | Claims 13M video views. Publishes no performance data. Rated 6.6/10 in one review (https://aihola.com/article/okara-ai-cmo-launch, https://the-ai-marketing-newsletter.beehiiv.com/p/the-99-ai-cmo-that-replaces-your-marketing-team) |
| **Icon "AI CMO"** | AI ad maker. The founder said it "can fully replace" a CMO | $12M icon.com domain, $9.2M seed (Founders Fund) | — | **After complaints it pivoted to "100% real / not AI" human UGC ads at $399** and reportedly went quiet in early 2026 (https://sacra.com/c/icon/). A cautionary tale |
| **Sintra** | 12 named "helpers" for sales, marketing, SEO and support | "24/7 digital team without adding headcount" | Low monthly price | Reviewers: "guided automation and ideation, not an autonomous system"; the helpers are prompt personas on a base model (https://www.eesel.ai/blog/sintra-ai-review) |
| **Marblism** | 6–7 named "AI employees": Eva (executive assistant), Stan (lead gen), Penny (SEO), Sonny (social), Rachel (receptionist), Linda (legal) | Employee cards | About $24/mo; 50 "hours of AI work" per month | Eva drafts replies but can't send them (https://www.eesel.ai/blog/marblism-pricing) |
| **Motion AI Employees** | Alfred (executive assistant), Chip (sales), Suki (marketing), plus 4 more | Named employees | Tiers from $148 to $894/mo (https://costbench.com/software/ai-productivity/motion/) | — |
| **CofoundAI / AetherCEO** | 7–8 "AI executives" (CEO, CTO, CMO…) that debate your decisions | CofoundAI: "a founding team for $29/mo instead of $900K+/yr" | $29/mo | Almost no traction; AetherCEO had 0 upvotes on its listing (https://www.hunted.space/product/aetherceo-your-ai-executive-team) |
| **"AI chief of staff"** | Inbox and Slack triage, daily agendas | The term was popularised on *This Week in Startups* (Calacanis using an OpenClaw agent) | — | Concrete value is small; one exec reported saving about 30 min/day (https://www.thedeepview.com/articles/goodbye-virtual-assistant-hello-ai-chief-of-staff) |

**What the persona pattern does:**
- Human names and "hire" framing are cheap to produce and get attention. Artisan's billboards drew about 50M impressions.
- But they promise autonomy the product can't deliver. That leads to churn, backlash and regulatory exposure (the FTC's Air AI case).
- The most credible newer players are moving away from it:
  - 11x dropped "digital worker" from its homepage.
  - Monaco avoids avatars.
  - Day.ai keeps agents "reporting to" a human.
  - Lindy calls itself a "teammate."

---

## 3. What users love and hate

### What they hate (with evidence)

1. **Overpromised autonomy leads to churn after the first month.**
   - A VC doing diligence on 11x found customers were satisfied at first, "but after about a month the AI failed to generate effective leads." Staff said customers had to check and fix outputs by hand (TechCrunch, above).
   - A coding of Reddit threads found sentiment worsens as autonomy increases:

     | Approach | Positive | Mixed | Negative |
     |---|---|---|---|
     | Fully autonomous AI SDR | 23% | 36% | 41% |
     | Assistive tools | 41% | 44% | 15% |
     | Custom, controlled stacks | 61% | 31% | 8% |

     The author's summary: "The more autonomy claimed, the more polarised the sentiment" (https://revenuesystemslab.substack.com/p/ai-sdr-tools; small sample).
2. **Volume replaces relevance.**
   - Average cold-email reply rate in 2025 was about 3.43% (Instantly, via https://www.leadhaste.com/blog/outbound-sales-benchmarks-2026).
   - Boomerang cites Bridge Group figures showing cold-email reply rates falling from 3.5% (2018) to 1.4% (2025) (https://getboomerang.ai/post/ai-sdr-backlash).
3. **Deliverability damage.**
   - One vendor study of 100K emails found AI-written emails were flagged as spam about 8% of the time versus 3% for human-written ones, with reply rates of 4.1% vs 5.2% (https://www.digitalapplied.com/blog/ai-sdr-real-performance-100k-email-analysis-2026; vendor data).
   - Gmail and Yahoo cap spam complaints at 0.3%, with 0.1% as the practical target. Microsoft requires SPF/DKIM/DMARC for senders above 5K messages a day (https://egressif.io/resources/sender-requirements/provider-rule-tracker).
4. **Hallucinated personalisation and CRM damage.**
   - An agent congratulated a prospect on an "APAC expansion" that never happened (https://dev.to/abmdev/ai-sdr-hallucination-pk5).
   - Another wrote "I see you went to NYU!" to someone who hadn't.
   - One 11x user said Alice emailed existing customers and created hundreds of duplicate CRM records: "literal disaster" (https://prospeo.io/s/ai-sdrs).
   - 11x customers reported hallucinations and products that wouldn't load.
5. **Black box, and "set and forget" fails.** Jason Lemkin (SaaStr) on running these tools:
   - About 30 days of daily training per agent.
   - 30–45 minutes a day auditing output.
   - About 1 hour every morning managing the whole agent stack.
   - "Turn it on and walk away" produces the same poor results as before.
   - Sources: https://www.saastr.com/stop-learning-ai-start-doing-ai-the-20-agents-running-saastr, https://www.saastr.com/we-sent-4495-ai-sdr-emails-in-2-weeks-and-got-the-1-response-rate-heres-how-its-not-what-you-think
6. **Complex setup and confusing costs.**
   - Clay needs a dedicated owner. One user changed a dedupe setting, which re-ran the workbook and burned a month of credits.
   - Agentforce implementations cost $25–75K and up.
   - Annual contracts with break clauses.
   - Credit pools are the #1 complaint about Unify (https://salesmotion.io/blog/unify-gtm-pricing).
7. **Platform, legal and social risk.**
   - LinkedIn banned Artisan.
   - The FTC sued Air AI for overclaiming that its agents replace staff.
   - Recipients push back even on good outreach. A founder posted in an HN "What are you working on?" thread and got two AI-agent cold emails. Both were well targeted and disclosed they were AI, and he still found them unwelcome: the recipient bears the cost. His proposed rules:
     - disclose that it's an agent;
     - cite the public source;
     - send **one message only** unless the person replies;
     - no fake familiarity;
     - only contact people the owner would contact personally.
     
     Source: https://dbpro.app/blog/i-posted-on-hacker-news-two-ai-agents-emailed-me

### What they love

- **Speed-to-lead and inbound coverage.** At SaaStr, Qualified booked 7 meetings on its own in week one, and more than 50% of inbound conversations now happen overnight.
- **Time saved on research and prep.** Unify claims about 2 hours per rep per day, and Bluebirds claimed about 2 hours a day on list building.
- **Reactivating warm databases.** Lemkin calls these campaigns "money." Cold outbound did worst. His quality test is whether he would have written the email himself.
- **Approve-before-send copilots** (Duo, Unify, Valley, Topo) get the best sentiment.
- **Onboarding by pasting a URL** (Valley "under 5 minutes," Origami, Okara).

### What founders actually want

- **Customers and conversations, not activity.** HubSpot moving to per-lead and per-resolution pricing shows outcome orientation spreading.
- **To stay in control and see the reasoning** (Monaco shows its scoring logic; Duo lets you dismiss with a reason).
- **Expertise they can't hire.** One summary of Monaco's pitch: it "makes experienced salespeople available to companies too small to hire them directly."
- **Learning to sell themselves.** Early sales should be founder-led:
  - Founding Sales benchmark: about 50 demos at a 20%+ win rate before the first sales hire.
  - Email about 20 people you understand well rather than 200 from a list.
  - Sources: https://echai.ventures/startingup/founder-sales/when-do-i-know-it-s-time-to-hire-a-salesperson-instead-of-doing-it-myself, https://amplifypartners.com/blog-posts/the-best-way-to-find-your-first-customers-is-to-email-them
- **Low commitment.** Self-serve prices sit at $99–500/mo (Origami, Valley, Clay). AI SDR contracts sit at $20–50K/yr. A human SDR costs $103–165K fully loaded per Bridge Group via Glencoco (https://www.glencoco.com/2026-state-of-sales-development).

---

## 4. White space

**Positioning map.** Two axes:
- *Who it's for:* GTM teams with RevOps, versus a founder with no GTM experience.
- *What it does:* execution and volume, versus strategy and judgment.

Almost everyone sits in "teams × execution." Monaco is the only well-funded player in "founders × execution plus human service," and it is CRM-heavy with a $10K entry price. Okara covers founders but only on content and SEO. **The "founders × strategy and judgment" quadrant is empty.**

**Specific gaps:**
1. **Strategy before lists.** Pre-PMF founders don't know their ICP. Nobody generates ranked ICP hypotheses, a positioning wedge, the first 20–30 named design-partner targets *with reasons*, and experiments to test them.
2. **Warm-first motions are the real Head of GTM job.** AI SDRs only do cold outreach. Nobody handles:
   - mapping warm intros through investors and advisors, with blurbs they can forward;
   - planning exec dinners (guest list, invite, run of show, follow-ups);
   - events and communities, founder content, design-partner programs.
3. **Upgrading the founder instead of replacing them.** Call prep, discovery questions, objection handling, deal debriefs and pricing the first deals. Founders *must* sell, and current tools try to sell *as* them.
4. **Low volume, high craft.** About 20 excellent touches a week rather than 50K emails a day. Lemkin's "would I have written this?" test can be built in as the product's quality bar.
5. **No-integration safety.** Drafts open in the founder's own Gmail. No domains to warm, no LinkedIn automation, no ban risk, no sending risk. This is a structural advantage of our v1 constraints.
6. **Personalisation with citations.** No competitor makes "every fact links to its source and date" a visible UX feature.
7. **An operating rhythm.** A weekly plan, review and learning loop, like a real Head of GTM's Monday and Friday, instead of a dashboard of emails sent.
8. **Taste.** The category's interfaces are tables, credit meters and dashboards. Nobody is calm and opinionated in a Linear or Things style.

**Positioning to own:** "The Head of GTM for founder-led sales: it tells you who to talk to, why, what to say, and how to win the deal, and you do the selling." Anti-positioning, stated plainly on the site:
- No sending.
- No scraping.
- No 50K-email blasts.
- No fake human.
- No annual contract.

Candidate taglines:
- "Your first 10 customers, not 10,000 emails."
- "Fewer, better conversations."

---

## IMPLICATIONS FOR THE PRODUCT

1. **Frame it as a role that works *for* the founder, never *as* the founder.**
   - Name the role ("your Head of GTM"). Skip the fake human name, avatar and "Stop hiring humans" message.
   - The product never writes in a way that pretends a human researched something they didn't.
   - Evidence: Monaco has no avatars; 11x dropped "digital worker"; Icon pivoted to "100% real"; the FTC's Air AI case.
   - Copy from persona products: the *mental model of a senior hire* (a plan, judgment, a weekly rhythm). Not the costume.
2. **Lead with strategy and an early wow.**
   - Onboarding: paste a URL and answer at most 5 questions.
   - In about 3 minutes, produce a GTM Brief: ranked ICP hypotheses, positioning wedge, the 3 best motions for this company (warm intros, design partners, dinners, communities, cold), 25 named target accounts with visible "why them / why now" reasoning, and a 2-week plan.
   - Copy Valley and Origami's URL onboarding and Monaco's "show the reasoning behind each score."
3. **Make the core UX an approval inbox of "moves," with chat as a secondary surface.**
   - Each day or week, a short queue of 5–10 high-leverage actions. Each one shows who, why now, the evidence, and a draft.
   - Actions: Approve → Open in Gmail / Copy / Edit / Skip with reason. The plan learns from skips.
   - Copy Amplemarket's Duo feed, Actively's agent inbox and Topo's Copilot mode. "Ask your Head of GTM" chat sits on top.
   - Avoid table and workflow builders (Clay-style complexity) and credit meters.
4. **Make citations the anti-hallucination feature.**
   - Every personalised claim in a draft links to its source URL and date.
   - Facts without a source can't enter a draft; guesses are labelled as guesses; stale facts get flagged.
   - This directly addresses the category's most-cited failure (invented "congrats," wrong schools, emailing existing customers) and fits the Claude web search and web fetch stack.
5. **Hard quality and volume limits, presented as values.**
   - Cap first-touch drafts at about 25 per week by default.
   - One message, then stop unless there's a reply (the HN founder's rules).
   - A built-in "would you have written this yourself?" self-check.
   - Never sends, so there is no deliverability or LinkedIn-ban risk.
   - Say it on the site: "We will never send 50,000 emails for you."
6. **Cover the whole Head of GTM job, not only cold email. This is the white space.**
   - Warm-intro mapping with forwardable blurbs.
   - Exec dinner planner: guest list, invites, run of show, follow-ups.
   - Design-partner program kit.
   - Call prep and post-call debriefs.
   - Founder content (LinkedIn posts, launch posts).
   - Pipeline review.
   - Objection and pricing coaching.
   
   None of the AI SDRs do this, and it is exactly what founders hire business-school grads for.
7. **Run a weekly rhythm with a visible company brain.**
   - Monday plan → daily moves → Friday review.
   - Metrics are conversations, meetings, design partners and what was learned. Never "emails sent."
   - Logging an outcome takes one tap, and the hypotheses update.
   - A "What I know about your company" page (ICP, positioning, proof points, objections, voice) that the founder can edit, stored locally. This is a lightweight version of Day.ai's context graph and makes the black box transparent.
8. **Win trust through radical simplicity and honest economics.**
   - No integrations needed, no seats, no annual contract, no credit maths.
   - First value in under 5 minutes.
   - Honest claims: no "replaces your team," no unverified ROI statistics.
   - Anchor the price against tools ($99–500/mo), not against human salaries.
   - The moat against Claude Cowork's sales plugin, ChatGPT agents and Apollo's chat is an opinionated founder-led-sales method plus taste. LLM drafting is a commodity.

*Gaps:* The web-search budget ran out near the end of research, so these were not checked: Artisan's 2026 funding and ARR, the terms of the Persana–Rox deal, whether the Qualified acquisition has closed and at what price, and early-stage Head of GTM compensation. Several performance figures above come from vendors and are marked as such.