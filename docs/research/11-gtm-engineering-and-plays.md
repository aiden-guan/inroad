# GTM engineering and plays: what GTM engineers build, which plays work, and how to score, test and route (researched October 2026)

Scope: the gaps left by 01 (§3 outbound, §4 signal catalog), 03 (landscape, love/hate) and 04 (automation map). Planning, forecasting, deal risk and win/loss are in 10. Where those notes already cover a point, this one points to them instead of repeating it. Evidence labels:
- **[vendor]**: published by a company selling the thing measured.
- **[secondary]**: someone summarising someone else's data.
- **[house]**: our default, to be calibrated on real outcomes.
- No label: primary data, or a practitioner describing their own work.

Inroad already has a play catalog in code (`src/lib/plays/catalog.ts`, 13 free plays), fit/why-now/tier functions (`src/lib/workflows/enrich.ts`), connection job-change diffs (`Connection.previous/history`) and segment bets judged after 25 touches. The implications section is written as deltas to those.

---

## 0. Summary

1. **A GTM engineer's real output is a loop, not a table.** Pick a bottleneck, write a one-page spec, build it, test 25–50 rows by hand, schedule it, measure one metric, then move to the next (Clay). Clay's internal team works in two-week sprints with release notes and version-controlled tables. GTM engineers are judged on meetings booked, hours saved and pipeline, and attribution is messy.
2. **Generic signals are weak; specific and person-level ones are strong.** Bloomberry studied 1M software purchases:
   - job-opening growth predicted only +7% more purchases;
   - funding +25%, a VP-level hire +28%, headcount growth +38%.
   
   At Unify, person-level signals drew about 2× the replies of company-level ones. A job post that names your pain beats "they're hiring."
3. **Plays need guardrails as much as triggers.** Unify's own stacked-signal play:
   - caps enrollment at 40 accounts a week;
   - skips accounts with an open opportunity or a touch in the last 30 days;
   - queues drafts for approval;
   - is measured as meetings per 100 accounts enrolled.
   
   Practitioners cap cold sends at 25 per mailbox per day and use a 30-day cooldown per person.
4. **Stacking signals works, but lists shrink fast.** Unify's illustrative four-signal funnel goes 1,240 → 410 → 168 → 34 accounts, which it calls "a week of proper work."
5. **Good scoring uses three numbers, not one** (Clay):
   - fit, which is mostly static;
   - engagement or timing, which decays;
   - potential, the 90th-percentile ARR of the 25 most similar won customers.
   
   Validate it: at least 70% of won deals in the top tier, at most 30% of fit-related losses there, and a top-tier meeting rate of at least 1.5× (target 2–3×). Stay rule-based until about 200–500 wins.
6. **Most cold-email "A/B tests" are noise.**
   - Detecting a reply-rate change from 3% to 6% needs about 750 sends per arm; positive replies from 1% to 2% need about 2,300 per arm.
   - Founders sending 25 first touches a week can't A/B test copy. They should test segments and offers against kill rules.
   - Clay's sequencer has no significance threshold at all, which leaves room for a tool that adds one.
7. **2025-send benchmarks:**
   - **Hunter (31M emails):** 4.5% average reply. Lists of 21–50 recipients got 6.2% vs 2.4% at 500+. Open tracking off got 7.4% vs 4.4%.
   - **Smartlead (850M emails):** the typical sender gets 0.74%, the top 10% get 2.63%, and 64% of replies arrive within an hour.
   - **A healthy campaign:** 1–2% positive replies and 4–10 meetings per 1,000 emails.
8. **For inbound, coverage beats speed.** Clay submitted 6,346 demo and contact forms: 68% got no email reply, and only 7% led to a salesperson starting a conversation. Chili Piper (2.93M forms):
   - 62% of qualified submissions book;
   - 76% book when shown the combined availability of all eligible reps, vs 18% with one rep's calendar;
   - 40% of bookings happen after hours.
9. **What makes them say "wow":**
   - watching your own list fill in, with the source of every cell (Clay);
   - plays that run themselves and report results (Unify);
   - one person's whole activity timeline (Common Room);
   - instant booking;
   - a CRM that updates itself, with a rep override loop (Clay internally);
   - reweighting a scoring model in plain English and testing it in one sitting (Claude Code).
10. **What they hate:**
    - metered orchestration (Clay's March 11, 2026 split into Data Credits and Actions);
    - opaque intent scores with false positives;
    - silent failures, such as one regex scoring 80% of a candidate pool zero with no warning;
    - signal backlogs;
    - spam;
    - vendor churn.
11. **To beat a GTM engineer plus Clay, an AI Head of GTM needs five things:**
    - an audit layer over an agentic builder;
    - plays shipped as versioned definitions, with dry runs and backtests;
    - honest experiment statistics that can say "inconclusive";
    - free data first, with receipts for every cost;
    - the strategy layer Clay doesn't have: which segment, which offer, which angle.

---

## 1. What a GTM engineer builds and maintains

### 1.1 The role in numbers
- **Job posts and where they sit** (Kyle Poyar, Sep 2025, using Sumble data: https://www.growthunhinged.com/p/do-you-need-a-gtm-engineer):
  - 45 GTM engineer posts in the past month and 128 in three months, up from fewer than 10 a month in 2024.
  - From June to August 2025 there was one GTM engineering post for every 5 RevTech/MarTech posts, 14 RevOps posts, 35 SalesOps posts and **92 SDR posts**.
  - About 45% of people with the title work at agencies.
  - Best fit: lower-ACV, lower-touch motions that need programmatic, one-to-many plays. The role "often has incentives tied to results."
- **Tools and skills** (State of GTM Engineering 2026, OneGTM, n=228 across 32 countries, as summarised at https://gtmepulse-com.pages.dev/benchmarks/report-summary/) [secondary]:
  - 84% use Clay, 71% use AI coding tools and 92% use a CRM.
  - About 40% code daily or weekly and about 45% never code.
  - Median salary is $132K.
- **Clay's own internal function** (https://www.clay.com/blog/how-we-built-gtm-engineering-function). Clay has about $100M in revenue and is roughly half self-serve, half sales-led.
  - **Reporting line:** internal GTM engineering reports to the co-founder who heads ops.
  - **Process:** two-week sprints with ticketed intake, and releases twice a month with release notes. Clay tables and workflows are version-controlled and documented.
  - **Stack:** Clay, Snowflake, Salesforce and Gong.
  - **Hiring:** the first GTM hire should be a GTM engineer, before the first AE. Their first project is a "golden list" of target accounts with clear reasoning for each.
- **The "dinner test" for a golden list:** could you pull every qualified executive in one city for a founder dinner without manual research? (Everett Berry, via https://www.antoinebuteau.com/lessons-from-everett-berry/) [secondary]

### 1.2 The systems they own, and how each is judged

| System | What "good" looks like | Judged by | Typical failure |
|---|---|---|---|
| **TAM / golden list** | Every ICP account carries a segment label and a reason for inclusion. Contacts are mapped by persona. Refreshed quarterly. Scaled cold outbound needs a TAM of about 100K contacts and $10K+ LTV; re-contact each person about once every 3 months (Eric Nowoslawski, https://www.antoinebuteau.com/lessons-from-eric-nowoslawski/ [secondary]). | Share of TAM with ≥1 verified buyer contact; share of meetings that come from the list | One undifferentiated mega-list; going stale |
| **Enrichment waterfall** | Providers run in sequence, cheapest first, and stop at the first hit. Act only on "Valid" emails; catch-all and unknown go to a review lane (https://www.clay.com/guides/how-to-do-gtm-engineering). Vendors claim one provider finds 40–70% of emails and a 3–4-provider waterfall 80–90% (https://clay.com/waterfall-enrichment) [vendor]; I found no controlled test. Nowoslawski's order: LeadMagic → Prospeo → GetProspect → Icypeas → TryKitt. | Fill rate per field; bounce rate under 2%; cost per filled field | Paying twice for one field; trusting catch-alls; empty "200 OK" payloads |
| **Scoring and tiering** | Fit (third-party data) + engagement (first-party, 90 days) + potential (lookalike ARR), mapped to tiers and coverage rules (§3) | Tier separation on closed-won; meeting rate by tier; time-to-meeting by score | A black-box score that is never re-validated |
| **Signal monitoring** | Scheduled pulls (daily or weekly; hourly on Clay Enterprise), deduped and date-stamped, routed to the owner in Slack | Reply and meeting rate by signal type; signal-to-opportunity rate | Backlogs that let signals go stale; over-enrolling weak signals (§2.1) |
| **Inbound routing** | Webhook → enrich → research → score → route to a rep or self-serve → schedule. Clay rates inbound triage 9/9/8 on frequency, revenue impact and rule clarity, so it gets built first. Lovable reported +50% qualified meetings per rep after building it [vendor]. | Time to first touch; % of leads answered; qualified → booked; routing accuracy | Most inbound is never answered (§5) |
| **CRM hygiene** | Dedupe by domain, match leads to accounts, normalise titles to personas, and detect job changes on existing contacts (bounces, re-imports). Clay analyses calls and updates deal stages automatically: the rep gets a message to accept or override, and the update applies if the rep doesn't respond. Berry says the CRM is "the cleanest it has been" (https://saastock.com/blog/gtm-alpha-how-clay-is-building-gtm-for-the-ai-era). | Duplicate rate; % of contacts verified; % of accounts with an owner | Agents creating duplicate records (03 §3) |
| **Sequencer and deliverability** | Mailbox pools, ramp-up, warmup, per-mailbox caps and backup inboxes equal to sending capacity. Review reply rate per mailbox every 2 weeks. Pull inboxes with bounce rates over 3% (§4.4). | Inbox placement, bounce, complaints, reply rate per mailbox | Stripping booking links to "help deliverability," which cut meetings |
| **Research and briefs** | AI columns with a fixed output (`what_they_do`, `icp_fit` strong/partial/weak, `trigger`, `opener`). The prompt says to use only site content and write "unknown" rather than guess. Clay auto-builds kickoff and QBR decks from Snowflake, Gong and Salesforce. | Hours saved; usable-output rate (Clay's illustrative example: 690 → 960 of 1,000 rows after a 50-row test) | AI research shipped without a verification step |
| **Reporting** | Signal-to-outcome, pipeline by play and segment, and a weekly summary for leadership | Whether decisions change. Meetings booked is the KPI 92% of GTM engineers track, and a GTM engineer with $500K of pipeline they can't prove "earns less than one who generates $300K with clear attribution" (https://gtmepulse-com.pages.dev/careers/impact-measurement/) [secondary] | Dashboards nobody acts on |

### 1.3 The weekly cadence
- **Apollo's version** (https://www.apollo.io/insights/what-does-a-gtm-engineers-day-to-day-workflow-look-like-at-a-scaling-b2b-company) [vendor]:
  - Monday: triage the intake queue by revenue impact.
  - Tuesday and Wednesday: build workflows, enrichment, scoring changes and sequences.
  - Thursday: QA routing rules, enrichment fallbacks, bounce rates and domain health.
  - Friday: pull signal-to-outcome data, adjust scoring weights and write the leadership summary.
  - Monthly: tune scoring and review messaging.
  - Quarterly: refresh the TAM and prune signals that underperform.
  - Metrics reviewed: reply rate by signal tier, time to meeting by account score, and pipeline by segment.
- **Ride-alongs:** watch the manual tactics top reps use, then automate the best ones. Kill automations based on usage data. Don't judge an AI workflow by its first version; in Berry's experience the fourth sometimes works (via Buteau, above) [secondary].

### 1.4 Build rules worth encoding (from Clay's guide, https://www.clay.com/guides/how-to-do-gtm-engineering)
- **Choosing what to build:** score each candidate bottleneck on frequency × revenue impact × rule clarity. One-off creative work stays manual.
- **Before building:** write a one-page spec covering the trigger, the data added and where the record lands.
- **Four trigger types:** a webhook (form fill), a new CRM record, a list import, or a schedule.
- **Five stages:** source → enrich → research → verify → route.
- **Test before scheduling:** run 25–50 rows and check every output by hand. Set a spend limit, and send records that fail verification to a review lane.
- **Failure modes:**
  - automating a task that was never expensive;
  - skipping the small-batch test;
  - building a workflow but never scheduling it;
  - shipping AI research without verification.
- **"GTM alpha":** tactics decay once everyone uses them. The alma-mater opener stopped working once people recognised it as AI-generated. Rotate tactics and track each play's trailing performance (SaaStock interview, above).

---

## 2. Plays

### 2.1 The anatomy of a play, from operators who ran dozens
A play has six parts:
1. **Trigger:** a state change you can write as code.
2. **Audience filter:** fit, tier and exclusions.
3. **Research:** what to verify and what to cite.
4. **Action:** who to contact, through which channel, with what framing and how many touches.
5. **Guardrails:** caps, cooldowns and approval.
6. **Measurement:** a primary metric against a baseline, ideally with a holdout.

**Worked example: Unify's four-signal play** (https://unifygtm.com/use-cases/stack-four-signals-on-one-account; numbers are illustrative) [vendor]
- **Signal stack**, each step narrowing the list:
  1. RevOps roles posted in the last 45 days: 1,240 accounts.
  2. A competitor tool installed, excluding recent adoptions: 410.
  3. Funding in the last six months: 168.
  4. G2 category or comparison research in the last 30 days: 34.
- **Trigger:** every Monday, accounts that newly match at least 3 of the 4 signals. The fourth is checked before enrollment.
- **Action:** find the RevOps owner and one exec sponsor, verify their emails, and write a first touch that names the newest signal. Accounts are ranked by how recent their newest signal is.
- **Guardrails:** at most 40 accounts a week. Skip any account with an open opportunity or a touch in the last 30 days. Drafts wait for approval, and the first batch always waits.
- **Measurement:** reply rate against normal outbound, and meetings per 100 enrolled, reported weekly. Unify claims reply rates roughly double when four or more signals stack.

**Garrett Wolfe's lessons from running 40+ plays** (feeding 100+ sequences and $12M+ of pipeline over 13 months at Unify; https://garrettawolfe.substack.com/p/too-many-signals-and-all-our-intent)
- Person-level signals drew about **2×** the reply rate of company-level ones.
- **Rank mailboxes by intent tier:**
  1. Instant send: pricing or demo page visits, failed booking attempts.
  2. High intent: other high-value pages, LinkedIn engagement with your content.
  3. Medium intent: G2 or LinkedIn engagement, routine site visits.
  4. Cold.
- **Timing and suppression:** wait for consecutive actions so the strongest one drives the email, and suppress anyone who has already booked.
- **Capacity:** at 25 emails per mailbox per day, a 200-email backlog takes about 8 business days to clear, and the strong signals go stale. Use a **30-day cooldown** per person, and review reply rate per mailbox every two weeks.
- **Failure modes:**
  - enrolling people in weak-signal sequences blocks them from better ones during the cooldown;
  - running out of people to contact at a company;
  - opt-outs rise with weak signals;
  - removing booking links cut meetings;
  - without real-time dashboards, problems go unnoticed.

**Brendan Short's catalog** (co-written with Poyar) lists 25 automated plays across six families: signal, warm, personalisation, social, product-led and expansion. Short helped Apollo book about 1,800 meetings a quarter with a fully automated "AutoSDR" and no SDRs (https://www.growthunhinged.com/p/automated-gtm-plays). Plays from that list that aren't in 01:
- former bosses of recent job switchers;
- alumni of a new flagship customer;
- intros through mutual investors;
- closed-lost re-engagement about 9 months later, referencing the last call;
- a "roll-up" play for multiple accounts on one domain;
- outreach to non-users inside an account that already has users;
- outreach when usage nears plan limits.

### 2.2 What the evidence says about which signals matter
- **Bloomberry, about 1M software purchases** (March to September 2025, companies with 200–1,000 employees; group means with no significance tests; https://bloomberry.com/blog/i-analyzed-1m-software-purchases-to-find-the-strongest-buyer-intent-signals/) [vendor data]. Lift in later software purchases:

  | Signal | Lift |
  |---|---|
  | Enterprise AI tool purchase | +46% |
  | Headcount up 20%+ | +38% |
  | Bought software in the prior 3 months | +38% |
  | VP-level hire | +28% |
  | Funding round (next 6 months) | +25% |
  | New office | +11% |
  | Job openings up 20%+ | **+7%** |
  | Recent SOC compliance | ~0% |

  What this means: generic "hiring" is the weakest common trigger, a VP hire or a growth spurt is better, and funding sits in the middle. The test didn't cover category-specific signals (a job post that names your pain, a competitor in the stack), which is where an edge would come from.
- **G2, conversion to a website inquiry within 60 days, by the page a buyer viewed** (Factors.ai analysis, https://sell.g2.com/resources/success/how-to-use-competitors-buying-signals-protect-and-grow-revenue) [vendor]. G2 delivers this data once every 24 hours.

  | Page viewed | Conversion |
  |---|---|
  | Your product page | 5.5% |
  | Competitor features | 1.03% |
  | Alternatives | 0.73% |
  | Category | 0.65% |
  | Competitor pricing | 0.54% |
  | Competitor reviews | 0.53% |

- **Job changes have no independent study** (FL0 benchmark review, https://fl0.com/blog/job-change-signals-b2b-benchmark-report-2026).
  - UserGems' vendor figures are in 01 §4.2. Cobalt's "Former Champion" playbook reported 91 influenced opportunities and $1.7M of pipeline (https://www.usergems.com/customers/cobalt) [vendor].
  - One audit of a 12-person team found only a **3.1%** reply rate from champion alerts (https://dev.to/zackrag/the-48-hour-job-change-playbook-how-to-turn-buyer-alerts-into-booked-meetings-3hgj) [anecdote]. How the play is executed matters more than the alert.
- **Website visitor identification:** realistic match rates are 30–65% at the company level and 5–20% at the person level, US traffic only (https://www.syncgtm.com/blog/best-b2b-website-visitor-identification) [secondary]. Warmly's own figures are about 65% and 15% (https://www.warmly.ai/p/blog/visitor-identification-match-rates) [vendor].
- **Unify** says signal-driven outbound gets 73% more replies than cold (https://unifygtm.com/products/signals) [vendor].

### 2.3 Play catalog
Trigger fields refer to Inroad's model (`Signal{type,date,strength}`, `Deal{stage,stageHistory,lossReason}`, `Activity`). Plays marked ★ are missing from, or differ materially from, the current `catalog.ts`.

**A. Free public data or first-party data**

| # | Play | Trigger (codeable) | Contact | Angle | Window | Evidence | Data |
|---|---|---|---|---|---|---|---|
| 1 | Champion moved ★ (add a start day and person-level matching) | A person with a prior relationship starts at an account with fit ≥ 60. "Prior relationship": champion `tested`/`coach`, contact on a won/pilot deal, a positive replier, or a connection tagged customer/past user/design partner/ex-colleague. | That person | "You fixed X at your old company. Is X showing up here?" | Day 14–120, best by day 60 | UserGems [vendor] (01); 3.1% when worked badly | **Free**: re-imported connections diff (`Connection.previous`). Paid feeds at scale |
| 2 | Champion left a deal ★ | A contact on an open deal or customer bounces, gets `mayHaveLeft`, or has a job-change signal | Their successor plus the economic buyer | Handover: picking up where they left off | Within 7 days | Champion departures put deals at risk | First-party |
| 3 | New leader ★ (start day) | `new_leader` signal, title matches a buyer persona, fit ≥ 70, no open deal | The leader | First-quarter priorities; one observation, one question | Day 14–90, best 14–60 | VP hire +28% (Bloomberry); Unify's VP+ play runs ≤ 90 days | Free: press, team-page diff, 8-K Item 5.02 |
| 4 | Hiring for the role you augment ★ (drop generic `hiring`) | `first_hire`, or `hiring` for a role in `ICP.triggers`, posting still open | Hiring manager, not the recruiter | "Before the hire lands, teams usually…" | While open; best in the first 3 weeks | Generic job-opening growth +7% only | Free: ATS JSON |
| 5 | Job post names the pain | `jd_names_pain` at strength 3, with a verbatim quote | Team lead | Mirror their words | While open, ≤ 60 days | Most specific free signal (01) | Free |
| 6 | Funding with a stated use ★ (skip the first 7 days) | `funding` or Form D dated 7–60 days ago, fit ≥ 70. Strength 3 only if the stated use of funds names your area. | The leader who will scale | What the round makes harder | Day 7–60; spend continues about 6 months | +25% | Free: press, EDGAR |
| 7 | Stack change, confirmed ★ | Tech diff adds a complementary tool or removes a competitor, seen on 2 crawls ≥ 14 days apart | The tool's owner | Integration or migration | 0–60 days after confirmation | Removal suggests churn; one anecdote of 11.4% replies across 340 competitor accounts [secondary] | Partly free (site scripts, DNS SPF/MX/CNAME, job posts). Paid for install dates |
| 8 | Lookalike of won customers ★ (lift-weighted) | Similarity ≥ 0.7 on criteria that separate wins from losses; untouched for 90+ days | The persona who bought last time | Named peer proof (approved claim only) | Evergreen | Clay's potential-value method (§3.1) | Free |
| 9 | Closed-lost, by reason ★ | Wait varies by loss reason: timing 90 days, went dark 60, budget 120 (or new funding), price 180, competitor about 300 (before renewal), product gap when the fix ships. **Or** any loss except `not_icp`/`no_pain` plus a fresh `new_leader`, `funding` or `first_hire` signal. | The original champion or their successor | Reference the last call; say what changed on their side or yours | By reason | Conventions vary: 90 days (ZoomInfo template), ≥ 6 months without a signal (Unify), about 9 months (Short). No controlled data, so hold out 20% | First-party |
| 10 | Not now / nurture due | `nurtureUntil` reached, or a "not now" reply ≥ 75 days ago with no touch since | Same person | "You said to check back in {month}" | Due date ± 7 days | The buyer named the timing | First-party (exists as the `nurture` moves rule) |
| 11 | Public ask | `community_request` or `persona_post` ≤ 7 days old from someone matching a persona | The poster | Help in the thread; no pitch | 24 hours to 7 days | Above 20% within 24h (Common Room [vendor], 01) | Free: HN Algolia, GitHub |
| 12 | Data recipe ★ (see §2.4) | A user-defined detector over public data returns `{finding, magnitude, url}` | Owner of the problem | The finding itself is the value; no meeting ask | While the finding holds | Blueprint client: connect rate 5% → 15% [vendor] | Free |
| 13 | Event cohort ★ (before the event) | Speakers, sponsors or attendees of an event your ICP attends | Persona matches | The session or topic | Book 21 days before; follow up within 48h after | 02 §2.10 | Free: event pages |

**B. Paid data or a product integration** (none of these are in the catalog today)

| # | Play | Trigger | Contact | Angle | Window | Evidence | Data |
|---|---|---|---|---|---|---|---|
| 14 | High-intent web visit | `web_intent` on a pricing, demo, compare, security or integrations page; fit ≥ 60; ≤ 72h old | The identified visitor, or at most 2 personas | Never mention the visit; answer the question that page implies | Same day | Wolfe's tier 1; Unify says 95% of visitors never fill in a form [vendor] | Paid: visitor ID (RB2B, Warmly/HubSpot, Vector, Unify) |
| 15 | Form drop-off | A qualified form submission with no booking within 10 minutes | The submitter | Short note with times | Minutes | 38% of qualified submissions don't book (Chili Piper) | First-party webhook |
| 16 | Signup or team roll-up | A signup from an ICP domain; ≥ 3 users on one domain in 30 days; or an "aha" event | The signup (help first), then the exec at roll-up | Team adoption | ≤ 24h; roll-up ≤ 7 days | Product-qualified leads convert about 5× the overall rate (https://openviewpartners.com/productbenchmarks) | First-party product events |
| 17 | Social engagement | A persona likes or comments on the founder's or a competitor's post, ≤ 7 days ago | The engager, from whoever they engaged with | Continue the topic | ≤ 7 days | Person-level signals get about 2× the replies | Paid tools, or manual capture (no scraping, 04) |
| 18 | Category intent and competitor displacement | G2 category, compare or alternatives research ≤ 30 days old, optionally plus a competitor installed | Owner of that category | 1–2 defensible differentiators, no teardown | ≤ 30 days | G2 page-type conversions (§2.2) | Paid: G2 Buyer Intent, install dates |
| 19 | Alumni or former boss | A new customer is won, so its former employees now at ICP accounts; or the former bosses of recent job switchers | The alumni | "Your old team at X just started using…" (with permission) | ≤ 60 days after the win | Short's catalog; no numbers | Paid people data (Apollo) |

### 2.4 Data recipes: the GTM-engineer favourite that fits Inroad's free crawlers
- **Blueprint's method** (https://blueprintgtm.com):
  1. Extract why your best customers bought, in their own words.
  2. Find external data that would have flagged them before they knew they had the problem.
  3. Build a **pain-qualified segment**: prospects defined by a data-detectable problem they have now, not by firmographics.
  4. Send a **permissionless value proposition**: a message so specific that the data itself is the value.
  5. Ship, measure and iterate.
- **Data sources it uses:**
  - permit filings and municipal records;
  - PECOS, CMS, OSHA and HRSA records, FOIA requests, property sales;
  - DNS records, website signatures, feature flags, subdomains;
  - call recordings and conference app APIs.
- **Examples:**
  - Texada (cranes): idle equipment, spotted from missing DOT transit permits next to a nearby construction permit.
  - MedTrainer: providers with lapsed PECOS enrollment, with an estimate of denied-claim exposure.
  - GAF: contractor permit data showing volume going to a competitor.
  - Housecall Pro plus Shovels permit data: systems installed in 2004–2008 with no later permits, framed as replacement opportunities (https://www.joinpavilion.com/blog/the-man-who-mastered-ai-gtm-meet-jordan-crawford).
  - Reported result for one client, Skimmer [vendor]: contact accuracy 15% → 95%, BDR pipeline $30K → $160K a month.
- **Writing rules** (HG Insights' version of the framework, https://phoenix.hginsights.com/gtm/skills/phoenix-pvp-pqs-framework):
  - Every figure must trace to a tool call or a named public source; otherwise cut it.
  - Headline pattern: "The [specific situation or commitment] with [the missing piece]."
  - Close softly ("If [scenario], we'd want to know"), with no hard call to action.
- **Nowoslawski's best performer across clients** is the "creative ideas" campaign: AI proposes three specific uses of the product for each prospect, constrained to pre-approved value propositions. One example targeted businesses rated 3.5–4.5 stars, quoted their negative reviews and offered removal, with payment only after it worked. It produced 1 positive reply per 70 emails (https://thegtmengineer.substack.com/p/the-winning-cold-outbound-formula) [secondary].
- **Free detectors Inroad can run in code** [house]:
  - **DNS:** no DMARC, or `p=none`; SPF includes that reveal a competitor's email provider.
  - **Website:** "Enterprise" on the pricing page but no `/security` page; script tags of competing tools.
  - **Job posts:** 3+ open roles sharing the same pain phrase.
  - **GitHub:** issues that name the problem.
  - **Status page:** 3+ incidents in 30 days.
  - **EDGAR:** the stated use of Form D proceeds.

---

## 3. Account scoring and tiering

### 3.1 Use three or four numbers, not one
- **Clay scores all 250K accounts in its Salesforce three ways** (https://www.clay.com/blog/how-clay-identifies-tier-1-accounts):
  - **Fit** (third-party data): size, business model, GTM motion, number of sellers and ops headcount, tech stack, data warehouse, CRM, competing products, region, funding stage and revenue trajectory. Output: 0–100 plus a label from "Low Fit" to "Best Fit."
  - **Engagement** (first-party data, rolling 90 days): form fills, events, workspaces created, users added, site visits and LinkedIn activity. Output: a status from "Passive" to "Highly Engaged."
  - **Potential contract value:** the 90th-percentile ARR of the 25 closed-won customers most similar on headcount, ICP, industry, stage, region and stack.
- **Clay's tiers come from fit × engagement quadrants:**

  | Quadrant | Tier | What happens |
  |---|---|---|
  | High fit, high engagement | Tier 1 | Sales works the whole buying group; marketing runs mid- and bottom-funnel ads and events |
  | High fit, low engagement | Tier 2 | Marketing nurture |
  | Low fit, high engagement | Tier 2 | Opportunistic sales |
  | Low fit, low engagement | Tier 3 | Deprioritise |

- **HubSpot's combined score works the same way:** fit graded A/B/C and engagement graded 1/2/3, with A1 best. Engagement decays; fit doesn't (https://knowledge.hubspot.com/scoring/build-lead-scores).
- **Keep external intent separate from first-party engagement.** "Intent" means outside signals (G2, Bombora, news); "engagement" means first-party activity (replies, visits, product use). They have different decay and reliability, and person-level first-party data wins.

### 3.2 Setting weights
- **Start small:** 5–8 weighted criteria, since 12+ add noise. Use prior or equal weights for about 30 days, then drop any criterion that doesn't predict conversion (https://gtmepulse-com.pages.dev/insights/account-scoring-model-guide/) [secondary].
- **Keyplay's model builder** (https://docs.keyplay.io/en/articles/8712837-build-your-icp-scoring-model):
  - **Setup:** seed it with customer lookalikes and sort signals into positive and negative buckets.
  - **Weights:** 1× to 20×, at most 30 signals, and don't let one signal dominate.
  - **Testing:** run a customer list, a high-ACV list, a known bad-fit list and a control drawn from the serviceable market. Customers and high-ACV accounts should mostly score A or B.

### 3.3 Validating against closed-won
- **Backtest gates** [secondary, gtmepulse guide above]:
  - Of 50 closed-won deals, **at least 70%** should land in Tier A. Under 60% means the weights are wrong.
  - Of 50 closed-lost deals, **under 30%** should be Tier A. At 40% or more, add disqualifiers.
  - In production, Tier A should book **2–3×** the meeting rate of unscored outbound. Under 1.5×, recalibrate.
  - Expect 2–3 quarterly cycles before the model stabilises.
- **Look for blind spots** (https://madkudu.com/university-article/model-monitoring-on-the-lead-level): MadKudu reviews the most recent 200 closed-won deals split by score. Wins that scored low reveal blind spots; high-scoring wins show what a true positive looks like.
- **Measure whether human effort changes the outcome.** At Gusto, MadKudu compared called and uncalled cohorts: "good" leads converted 15% more when called (98% confidence), and "bad" leads showed no lift (https://www.casestudies.com/company/madkudu/case-study/madkudu-identifies-35-of-leads-gusto-sellers-do-not-impact) [vendor]. A score should send people where their work makes a difference.
- **Concentration is the KPI to show a buyer** [vendor]:
  - Instapage: the top 10% of scored leads drove 66% of revenue.
  - Pipedrive: the top 6% drove 56% of conversions of 20+ seats.
- **Rules vs machine learning:** stay rule-based until about 200–500 closed-won deals [secondary]. Seed to Series C companies rarely have that many.
- **Avoid leakage** [house]: score each account as it stood at first touch, not today. Otherwise won accounts look "engaged" simply because they became customers.

### 3.4 Re-scoring and decay
- **Fit:** re-score on any data change; rescore active pipeline every 30 days and the whole database every 90 [secondary].
- **Engagement and intent:** decay them; don't decay fit.
  - One common pattern adds points, then subtracts them after a fixed window: a page visit expires after 3 days, a demo request after 2 months (https://marketingprofs.com/short-articles/2568/why-lead-scores-should-have-expiration-dates).
  - HubSpot guides show percentage decay, for example −30% a month.
- **Signal refresh by tier** [house]: weekly for Tier 1 (job-board diff and news), every two weeks for Tier 2, monthly for Tier 3.
- **Contact decay:** median job tenure is 4.1 years, and 4.9 for management and professional jobs (BLS, January 2026, https://www.bls.gov/news.release/tenure.nr0.htm). So roughly 1 in 5 buyer contacts changes employer each year [house inference]. Recheck Tier 1 contacts every quarter.

### 3.5 Tier definitions and coverage

| Tier | Who qualifies | Accounts at a time | People mapped | Research | Touches and channels | Signal refresh |
|---|---|---|---|---|---|---|
| **1 (one-to-one)** | High fit plus hot signals, or a warm path | 5–12 per rep (https://abmatic.ai/blog/account-tier-glossary) or 8–15 (https://www.pedowitzgroup.com/whats-the-optimal-number-of-tier-1-accounts-per-rep) [vendor]; a founder works 10–15 [house] | 3–5: economic buyer, champion, technical approver | Full dossier no older than 14 days; a hand-written angle per person | Warm intro first. 6–10 touches over 4–6 weeks across email, LinkedIn, events and intros | Weekly |
| **2 (one-to-few)** | High fit but cold, or mid fit plus hot | 25–60 per rep, in clusters of 5–15 sharing a trigger or segment [vendor] | 2–3 | Segment brief plus one line about the account's signal | 4–5 touches over about 3 weeks | Every 2 weeks |
| **3 (one-to-many)** | Mid fit, cold | Hundreds or more | 1–2 | Template plus one variable line | 3 touches; contact a person at most once every 90 days | Monthly |

**Multithreading cold outreach:** Hunter found that emailing 1–2 people per company got a 5.1% reply rate, vs 3.5% for 3 or more. Start with 2 people per account and stagger the rest; multithread after the first reply.

---

## 4. Outbound experimentation

### 4.1 How strong teams test
- **Pull the big levers first:** the list and the offer, then the angle, then the copy.
  - Blueprint: "the message isn't the problem; the list is."
  - Nowoslawski treats email like an ad channel. He tests offers, problem statements, case studies and triggers as separate campaigns. If response is weak, he changes what the prospect receives, and he revisits the list filters after about 1,000 contacts (Buteau, above) [secondary].
- **Run tests with discipline** (https://www.unifygtm.com/explore/cold-email-ab-testing-statistical-rigor). Unify's worked example uses 400 contacts per arm.
  - **Hold everything else constant:** one causal variable per test, with identical mailboxes, send windows, offers and follow-ups.
  - **Declare the plan before sending:** the hypothesis, the primary outcome (a "qualified reply" defined in advance), the sample rule and the stop rule.
  - **Don't stop early** because one arm leads. Pause both arms if bounces spike.
  - **Read the result honestly:** if the arms tie, keep the control and redesign. If replies rise but meetings don't, check qualification and the offer.
- **Clay's sequencer leaves the decision to you** (https://university.clay.com/docs/ab-test-sequence-copy):
  - It splits enrollment 50/50, reports reply rate on delivered emails, and shows how many sends are at least 3 days old.
  - It says: "There's nothing to configure about statistical significance, and no threshold Clay is waiting to cross."
- **Judge on positive replies or meetings.** Opens are inflated by Apple's Mail Privacy Protection, and turning tracking off raised replies in Hunter's data. Total replies mix in no's and out-of-office messages.
- **Evaluation pays.** In a survey of 250 agencies, those that built evaluation before scaling AI agents reached 11× ROI; those that skipped workflow-level evaluation got 0.7× (cited by Instantly, https://instantly.ai/blog/ai-sales-agent-benchmarks-2026-the-complete-performance-report/) [secondary].

### 4.2 Sample sizes (computed: two-sided α = 0.05, 80% power, two-proportion z-test)

| Metric | Control → variant | Sends per arm |
|---|---|---|
| Reply | 3% → 6% | ~750 |
| Reply | 3.43% → 5.5% (average → top quartile) | ~1,560 |
| Reply | 3% → 3.75% (+25%) | ~9,100 |
| Reply | 5% → 10% | ~435 |
| Reply | 10% → 20% | ~200 |
| Positive reply | 2% → 4% | ~1,140 |
| Positive reply | 1% → 2% | ~2,300 |
| Meeting | 0.5% → 1% | ~4,700 |

- **A common vendor figure is wrong.** Several posts say 1,562 sends per variant detects "a 20% lift at 3.43%." That number actually detects 3.43% → 5.5%, a +60% lift. A true +20% lift needs about 12,000 sends per arm.
- **Founders can't A/B test copy.** At 25 first touches a week, test whole bets (segment × angle or offer) one after another, with kill rules. Even a team sending 10K emails a month can only resolve roughly 2× differences in positive replies within a month.
- **Rule of three:** if n sends produce zero positive replies, the true rate is below about 3/n with 95% confidence. That's under 10% after 30 sends, under 5% after 60 and under 3% after 100.

### 4.3 Benchmarks for 2025 sends (beyond 01 §3.1)

**Hunter, 31M emails** (https://hunter.io/the-state-of-cold-email)
- **Averages:** sequence reply rate 4.5% (sales outreach 3%), bounce rate 3.6%, unsubscribe rate 1.6%.
- **What moved reply rates:**

  | Factor | Higher | Lower |
  |---|---|---|
  | Recipients per sequence (average 449) | 21–50: 6.2% | 500+: 2.4% |
  | Custom attributes in the body | Two: 5.6% | None: 3.6% |
  | Editing | Manually edited: 5.2% | Fully automated: 4.4% |
  | Sequence length | Three messages: 6.8% | One: 3.3% (4+ lower) |
  | Open tracking | Off: 7.4% | On: 4.4% |
  | Sender domain | Custom: 5.2% | Freemail: 2.5% |
  | Email provider | Google Workspace: 5.9% | Microsoft 365: about 4% |
  | Recipients per company | 1–2: 5.1% | 3+: 3.5% |

- **Other findings:**
  - Accounts sending 20–49 emails a day averaged 5.7%.
  - "Quick question" subject lines got 2.5%.
  - Images, emojis and day of the week made no difference.
- **Decision-maker survey:**
  - 69% of US respondents are bothered if AI wrote an email.
  - 67% are more likely to reply to personalization that uses public information.
  - 50.5% prefer LinkedIn as a channel, vs 25% email.

**Smartlead, 850M+ emails** (https://www.smartlead.ai/benchmarks)
- **Reply rates:** the typical sender gets 0.74% (135 contacts per reply). The top 25% get 1.43%, the top 10% 2.63% and the top 5% 3.85%.
- **Bounces:** typical 1.54%, danger line 2%, worst quarter 3.21% or higher.
- **Volume:** about 14 sends per mailbox per day is typical; 50 is the stated safe limit.
- **Contacts needed per reply, by setup:**
  - fully authenticated senders 108, others 120;
  - Gmail 90, Outlook 120, custom mail servers 179.
- **By message:** the first email gets 1.18% and the seventh 0.33%. First emails under 50 words get 1.47%.
- **Reply timing:** 64% of replies arrive within an hour and 88.5% within a day.

**Instantly, 2025 data** (link above)
- **Tiers:** average 3.43%, top quartile 5.5%+ ("verified lists, consistent volume"), top 10% 10.7%+.
- **Sequence:** 58% of replies come from step 1; 4–7 steps; under 80 words.
- **Assumed reply-to-meeting conversion:** 15–20%, which gives about 5, 8 and 16 meetings per 1,000 sends at those three tiers.

**Belkins, 7.53M emails (strict: replies divided by sends, auto-replies excluded;** https://belkins.io/blog/cold-email-response-rates)
- Overall 0.45%: 0.50% in the first half of 2025 and 0.40% in the second.
- By seniority: founders and owners 0.57%, VPs 0.32%.
- By company size: 0–10 employees 0.72%, 10,000+ employees 0.22%.
- About 1,200 meetings in total, roughly 0.016% of sends.

**Funnel heuristics**
- A healthy campaign: 2–5% replies, 1–2% positive, and 4–10 meetings per 1,000 emails (https://moderninbound.com/blog/cold-email-conversion-rate-benchmarks) [secondary].
- An agency funnel: 10% reply → 2.2% positive → 1.2% meetings (https://smartreach.io/reports/state-of-cold-email/the-state-of-cold-email-2026.pdf) [vendor].

**Personalization ladder** [house synthesis of the above]

| Approach | Reply rate |
|---|---|
| Generic blast (500+ recipients, no custom fields, tracking on) | about 1–2.5% |
| Segmented list of 21–50 with two real custom fields | about 4–6% |
| Signal- or point-of-view-based, reviewed by a human | about 8–15% (vendor claims run higher; see 01) |
| Warm or past champion | 20–50% [vendor], but 3.1% when worked badly |

The spread between published averages (0.45% to 4.5%) mostly comes from denominators and list quality. Every lever above, from small lists and 1–2 people per account to real personalization, a human edit and no tracking, is something a tool can enforce.

### 4.4 Deliverability guardrails that still matter (additions to 01 §3.4)
- **Google's thresholds are unchanged** as of October 2026: spam rate below 0.3%, with a target below 0.10%. The only listed requirement update is TLS (December 2023), so claims that Gmail "cut the limit to 0.1% in July 2026" are unconfirmed (https://support.google.com/a/answer/81126).
- **Per mailbox:**
  - Send 25–30 cold emails a day (Wolfe uses 25; Instantly caps at 30). Ramp 5–10, then 15, then 30, after 4–6 weeks of warmup.
  - Bounces should stay under 2%. Instantly auto-pauses at 5% after 200 sends, and Nowoslawski pulls inboxes over 3%.
  - When complaints rise, halve the volume per inbox and spread it across more inboxes. Keep warmed backups equal to your sending capacity.
- **Defaults:** turn off open tracking; use a custom domain rather than freemail; send plain text; mail only "Valid" addresses (22.8% of B2B domains are catch-all, 04).
- **Don't remove booking links reflexively.** Wolfe saw meetings drop when they were removed. Keep 01's "no link in touch 1" for founder one-to-one emails, and allow a link after the prospect engages.

---

## 5. Speed-to-lead and inbound routing

**The evidence**
- **HBR, 2011** (2,241 US companies audited; about 1.25M leads at 42 companies; https://hbr.org/2011/03/the-short-life-of-online-sales-leads; paywalled, figures as widely summarised):
  - Responders averaged 42 hours, and 23% never responded.
  - Contacting a lead within an hour made qualifying it about 7× likelier than waiting longer, and more than 60× likelier than waiting 24 hours or more.
- **InsideSales and MIT, 2007** (about 15K leads and 100K call attempts) [secondary]: responding in 5 minutes rather than 30 made contact about 100× likelier and qualification about 21× likelier.
- **Clay, 2026** (6,346 demo and contact forms in 100 countries; https://www.clay.com/blog/claygent-experiment-speed-to-lead):
  - 68% never got an email reply. Of the replies, 64% were automated.
  - Only **7%** led to a salesperson starting a conversation, and about 96% of companies never called.
  - Human replies averaged 26–40 hours. 5% of replies arrived within 5 minutes.
  - Clay's conclusion: "Coverage is a bigger problem than speed."
- **Workato, 2026** (114 B2B companies, real demo requests; https://workato.com/the-connector/lead-response-time-study):
  - Only 1 company sent a personalized email within 5 minutes. Email replies averaged 11h54m.
  - 31% called, and none called within 5 minutes.
  - Companies with a routing tool averaged 3h32m, vs about 13 hours without.
- **Chili Piper, 2026** (2.93M mid-market form submissions, July 2025 to June 2026; https://www.chilipiper.com/reports/mid-market-conversion-benchmark) [vendor]:
  - 57% of submissions qualify, and **62% of qualified submissions book**.
  - Meetings per 100 forms: 26 (bottom quartile), 42 (typical), 58 (top quartile).
  - Booking rate by routing:

    | Booking page shows | Book |
    |---|---|
    | Combined availability of all eligible reps | 76% |
    | The account owner's calendar | about 50% |
    | One rep's calendar | 18% |

  - About half of meetings are set for the same or next day.
  - **40% are booked after hours** in the buyer's time zone.

**Rules to encode**
1. **Coverage:** every inbound lead gets an answer. Disqualified leads get a useful next step (self-serve, a resource), not silence.
2. **Speed:** a human touches Tier A and B leads within 5 minutes in business hours. Instant booking stays on around the clock. Call best-fit leads the same day, since most companies never call.
3. **Routing:** match the lead to its account first. If there's an owner or an open deal, route to the owner; otherwise use a shared-availability pool. Never show only one rep's calendar.
4. **Drop-offs:** if a qualified lead hasn't booked after 10 minutes, follow up within the hour.
5. **Treat outbound replies as inbound.** Answer positive replies within one business hour: 64% of replies arrive within an hour, so the buyer is still at the inbox. `Move.receivedAt` is already the timer.
6. **Measure:** % answered, median time to the first human touch, qualified → booked, and booked → held.

---

## 6. What makes GTM engineers and leads say "wow", and what they hate

### 6.1 Wow moments
- **Clay:** paste a list and watch the cells fill in. Each waterfall cell shows which provider found the data, and AI columns return structured fields. It's a spreadsheet, so anyone can read and audit it. Wolfe: "Clay is reliable and auditable."
- **Unify:** plays run on a schedule as trigger → audience → action. One G2 reviewer set up outbound based on traffic and intent in 5–10 minutes (https://www.g2.com/products/unify-unify/reviews).
- **Common Room:** a person's whole timeline (site, product, community, GitHub, social) resolved to one individual. Reviewers cite this as the reason they prefer it to account-level intent [secondary].
- **Chili Piper:** instant booking on the form (76% vs 18%).
- **Clay internally:** a Slack app to launch campaigns, see signals and pull research, and deal stages updated from call transcripts with an accept-or-override loop.
- **Monaco:** shows the reasoning behind every score (03).
- **Claude Code** (Wolfe, May 2026, https://garrettawolfe.substack.com/p/can-claude-code-replace-clay-whats):
  - An hour or two to build what took a week or two to harden across "4 Clay tables with 80+ columns."
  - Deterministic checks become code that runs for free afterwards.
  - Scoring models can be reweighted in plain English and tested in one sitting.
- **For GTM leads:** pipeline by play, a weekly "what worked" summary, and experiment velocity as a leading indicator.

### 6.2 Top complaints
- **Metered orchestration and unpredictable bills.**
  - On March 11, 2026, Clay split credits into Data Credits and Actions. Common enrichments got 50–90% cheaper (https://www.clay.com/blog/introducing-clays-new-pricing). Clay reportedly projected that 85% of customers would pay less, for about 10% lower net revenue (https://notation.beehiiv.com/p/clay-introduced-a-new-price-metric) [secondary]. Valley's critique: a waterfall now spends Actions and Data Credits at once (https://www.joinvalley.co/blog/clay-pricing-and-credits-explained-2026) [competitor].
  - Critics argue that metering Actions taxes experimentation and pushes builders toward Claude Code, Cargo or Bitscale (https://www.leadgenius.com/resources/clays-pricing-change-just-proved-the-bear-case) [opinion].
  - Unify reviewers say they hit credit limits sooner than expected.
  - See 03 for the case where a dedupe change re-ran a workbook and burned a month of Clay credits.
- **Black boxes.** 6sense reviewers cite intent false positives and say they can't see which signals drove a score (https://www.g2.com/products/6sense-sales/reviews; https://pipeline.zoominfo.com/sales/6sense-reviews) [reviews; competitor summary].
- **Bad data.** One roundup counts 131 G2 complaints about 6sense contact data vs 176 users praising its intent engine (https://prospeo.io/s/6sense-data) [competitor]. Apollo deprecated an endpoint with no notice, which caused silent 404s (Wolfe).
- **Silent failures.** Wolfe: "Silent failures are the default."
  - A regex that missed "Staff Software Engineer" scored about 6,996 candidates, roughly 80% of the pool, at zero with no warning.
  - A "200 OK" push sent a campaign with no senders attached, so 40 leads never went out.
  - Scheduled jobs on his Mac looked healthy but were blocked by permissions for four days.
  - A managed proxy cost twice the direct API, a leak of more than $1,400.
  - "Every single silent failure on that list was discovered by writing an explicit auditor."
- **Signal overload:** backlogs, over-enrollment and rising opt-outs (§2.1).
- **AI SDR spam and hallucinations:** see 03 §3.
- **Tool churn.**
  - HubSpot agreed to buy Warmly (announced June 30, 2026; https://www.cmswire.com/digital-experience/hubspot-acquires-warmly-to-boost-ai-sales-agents/), and Zoom is buying Common Room (03).
  - Koala's site says it was acquired by Cursor and is shutting down (https://getkoala.com/blog/docs-into-pipeline).
  - Builders increasingly want logic they own rather than logic locked in a vendor.

### 6.3 What an AI Head of GTM must do to beat a GTM engineer plus Clay
1. **Be the audit layer over an agentic builder.** Wolfe's conclusion: the winner will be "a spreadsheet-shaped audit layer on top of an agentic-teammate-shaped tool," one that "lets a second operator pick up where I left off." Every row shows its inputs, sources, the rule that fired, its cost and anything that failed.
2. **Ship plays as definitions, not prompts.** Each play gets trigger code, a dry-run count, a 90-day backtest, a run log of who was included or excluded and why, and versioning with release notes (Clay's internal practice).
3. **Close the loop.** Give each play a scoreboard (meetings per 100 enrolled vs baseline, with holdouts). Run pre-registered experiments that can return "inconclusive," and alert when a play's performance decays.
4. **Use free data first, with receipts.** Query public sources before paid providers, and show the cost per filled field and per meeting. Support bring-your-own keys and avoid opaque meters.
5. **Build auditors for silent failure.** Watch for fill-rate drops, segments where every score is zero, empty payloads, contacts enrolled but never sent, and schema drift.
6. **Bring the strategy Clay lacks.** Decide which segment, which offer and which angle; use data recipes; and enforce guardrails (caps, cooldowns, suppression, approval) by default.

---

## IMPLICATIONS FOR THE PRODUCT

### A. Data model deltas (small)
```ts
interface Signal { /* existing */ personId?: ID; level: "person" | "account"; detail?: Record<string, string> }
//   detail.page ("pricing"|"demo"|"compare"…), detail.direction ("added"|"removed"), detail.tool, detail.useOfFunds
type SignalType = /* existing */ | "web_intent" | "social_engagement" | "review_intent" | "product_signup" | "form_dropoff" | "event_cohort";
interface Activity { /* existing */ playId?: ID; experimentArm?: "A" | "B"; scoreAtTouch?: { fit: number; heat: number; tier: Account["tier"] } }
interface PlayDef { /* existing */ startDay?: number; bestByDay?: number; capPerWeek: number; cooldownDays: number; holdoutPct?: number;
  measure: { primary: "positive_reply" | "meeting" | "reopen"; per: 100 }; paidSource?: "visitor_id" | "intent" | "people_data" | "product" }
interface Experiment { id: ID; hypothesis: string; variable: "segment" | "angle" | "offer" | "copy" | "channel"; unit: "account";
  arms: { id: "A" | "B"; label: string }[]; primary: "positive_reply" | "reply" | "meeting"; minPerArm: number; maxPerArm: number;
  startedAt: ISODateTime; verdict?: "ship_b" | "keep_a" | "inconclusive" | "stopped_guardrail" }
```
`scoreAtTouch` makes backtests honest (§3.3). Store the play run log on the existing `RunSummary`/`RunReceipt` so every match carries `{included|excluded, reason, sourceUrl, costUsd}`.

### B. Codeable play definitions (zero tokens to match; LLM only drafts)
```ts
// helpers
const age = (d?: string) => (d ? daysBetween(d.slice(0, 10), today) : Infinity);
const live = (a: Account, t: SignalType[], maxDays: number, minStr = 1) =>
  a.signals.filter(s => t.includes(s.type) && s.usableInOutreach && s.strength >= minStr && age(s.date) <= maxDays);
const lostOn = (d: Deal) => [...d.stageHistory].reverse().find(h => h.stage === "lost")?.at;
const knowsUs = (p: Person) => p.champion === "tested" || p.champion === "coach"
  || deals.some(d => ["won", "pilot", "proposal"].includes(d.stage) && d.contacts.some(c => c.personId === p.id))
  || activities.some(x => x.personId === p.id && x.kind === "reply_received" && x.sentiment === "positive");
// GLOBAL GUARDRAILS (every play): suppression/doNotContact/unsubscribed/negative-ever; not disqualified; person cooldown 30d;
// ≤2 cold contacts in flight per account; weekly first-touch cap (founder 25) split by play priority; one active play per person;
// precedence: warm (champion, lost, nurture) > first-party intent > person signal > account signal > lookalike.

champion_moved:  s ∈ live(acc, ["champion_job_change"], 120) && age(s.date) >= 14 && knowsUs(person(s.personId))
                 && acc.fitScore >= 60 && acc.status !== "customer"
                 → personal note from founder (no template) · bestBy 60 · measure meetings/100
                 // free source: Connection.previous.changedOn ≤ 120d && tags ∩ {customer, past_user, design_partner, ex_colleague}
champion_left:   (deal ∈ OPEN_STAGES || acc.status === "customer") && c ∈ deal.contacts (role champion|economic_buyer)
                 && (person.mayHaveLeft || bounce(c) within 14d || champion_job_change on c)
                 → find successor, intro_ask/first_touch ≤ 7d; schedule champion_moved at new company for day 14
new_leader:      s ∈ live(acc, ["new_leader"], 90) && 14 <= age(s.date) && titleIn(s, personas.economic_buyer ∪ champion)
                 && acc.fitScore >= 70 && !openDeal(acc) && !touched(leader, 90) → first_touch + LinkedIn · bestBy 60
hiring_for_pain: (live(acc, ["jd_names_pain"], 60, 3).length || (live(acc, ["first_hire"], 45, 2).length && roleIn(icp.triggers)))
                 && postingOpen(s) && acc.fitScore >= 60 → hiring manager, quote ≤ 12 words of the JD · expire when posting closes
                 // stop triggering on generic `hiring` (+7% lift); keep it as a weak timing input only
funding:         s ∈ live(acc, ["funding", "filing"], 60) && age(s.date) >= 7 && acc.fitScore >= 70
                 strength = useOfFunds ~ valueTheme ? 3 : 1 → function leader; lint blocks a "congrats" first line
stack_change:    techDiff(acc).added ∩ complements || techDiff(acc).removed ∩ competitors, seen on 2 crawls ≥ 14d apart
                 → tool owner · window 60d after confirmation
lookalike:       sim(acc) = Σ w_i·[met_i] / Σ w_i over criteria with lift_i ≥ 1.2 (needs ≥ 3 wins); sim ≥ 0.7 && untouched 90d
                 → research, then write · rank fit × potential (P90 ARR of 25 nearest won; else median won ARR)
closed_lost:     t = age(lostOn(d)); due = {timing: 90, went_dark: 60, no_budget: 120, price: 180, competitor: 300}[d.lossReason]
                 ((due && t >= due && t <= 540) || (d.lossReason === "product_gap" && gapShipped(d))
                  || (!["not_icp", "no_pain"].includes(d.lossReason) && t >= 30
                      && live(acc, ["new_leader", "funding", "first_hire", "jd_names_pain"], 45, 2).length))
                 && !touchedAccountSince(acc, lostOn(d)) → follow_up naming the reason + what changed · holdout 20% · measure reopen rate
nurture_due:     (d.stage === "nurture" && today >= d.nurtureUntil) || (lastReply.intent === "not_now" && age(lastReply.at) >= 75 && !touchedSince)
public_ask:      s ∈ live(acc, ["community_request", "persona_post"], 7) && personaMatch(s) → reply in thread; DM only if asked
data_recipe:     detector(acc) → { finding, magnitude, url, quote } (DNS, site, ATS, GitHub, status page, EDGAR)
                 → first_touch, value-first frame: the finding, no meeting ask, offer the full report
web_intent:      s ∈ live(acc, ["web_intent"], 3) && s.detail.page ∈ {pricing, demo, compare, security, integrations} && fit >= 60
                 → same day to s.personId, else ≤ 2 personas; lint blocks "saw you visited" · paid
form_dropoff:    inbound qualified && !booked within 10 min → follow-up ≤ 5 min (business hours), call same day if tier A · first-party
signup_rollup:   product_signup on ICP domain (fit >= 60) → help note ≤ 1h; ≥ 3 users same domain in 30d → exec buyer note · first-party
```

### C. Scoring formula to ship (replaces step decay and the +0.5 bonus; keeps A/B/C)
```ts
// FIT 0–100: current weighted criteria, plus gates
fit = round(100 * Σ w_i·m_i / Σ w_i)                  // m: true 1 · unknown 0.5 · false 0; prior w: mustHave 3, nice 1
if (anyMustHaveFalse) fit = min(fit, 40); if (antiIcpHit) fit = min(fit, 20);
fitKnown = Σ w_i·[m_i !== "unknown"] / Σ w_i            // < 0.6 → badge "fit unverified"; blocks Tier A

// TIMING 0–100: exponential decay, noisy-OR across distinct types
v(s) = (s.strength / 3) * TYPE_W[s.type] * REL[s.confidence] * 0.5 ** (age(s.date) / HALF[s.type])   // 0 past WINDOW or !usable
timing = 100 * (1 - Π_types (1 - max_{s ∈ type} v(s)))    // two 0.5 signals → 75, three → 87.5

// ENGAGEMENT 0–100 (first-party, 90 days, same noisy-OR): positive reply .9 (hl 30d) · meeting held .9 (45d) · intro made .7 (30d)
//   event attended .5 (30d) · neutral reply .4 (21d) · signup .6 (14d) · ≥3 users .8 (30d) · pricing visit .5 (3d); unsubscribe/negative → 0
// WARMTH 0–100: past champion at account 80 · former customer 70 · ≥2 warm paths 60 · 1 path 40 · shared investor 30

heat     = 100 * (1 - (1 - timing/100) * (1 - engagement/100) * (1 - 0.6 * warmth/100))
priority = fit * (0.35 + 0.65 * heat/100)   // fit first; heat multiplies up to 2.9×. fit 90 cold → 32 · fit 90 heat 80 → 78 · fit 50 heat 100 → 50

A (1:1)   fit >= 70 && fitKnown >= 0.6 && (heat >= 50 || warmth >= 60); keep top N by priority (founder 15, per AE 25), rest → B
B (1:few) fit >= 70 otherwise, or 55 <= fit < 70 && heat >= 50
C (1:many) 55 <= fit < 70, or fit < 55 && heat >= 70 (opportunistic: signal angle only, no sequence)
watch     everything else          // heat 50 ≈ today's whyNow 2 (timing ≈ 25 × whyNow)
```

| Signal type | TYPE_W | Half-life (days) | Window (days) | Note |
|---|---|---|---|---|
| champion_job_change | 1.0 | 45 | 120 | Starts at day 14 (current window: 90) |
| web_intent (pricing, demo) | 1.0 | 2 | 7 | Paid |
| form_dropoff | 1.0 | 1 | 7 | First-party |
| jd_names_pain | 0.9 | 30 | 60, or while open | |
| first_hire | 0.85 | 30 | 45, or while open | |
| new_leader | 0.8 | 45 | 90–120 | Starts at day 14; VP hire +28% |
| community_request | 0.8 | 3 | 14 | |
| product_signup | 0.8 | 7 | 30 | First-party |
| persona_post, social_engagement | 0.6 | 5 | 21 | |
| funding | 0.6 | 30 | 120 | Starts at day 7; +25% |
| stack_change | 0.6 | 30 | 90 | Needs 2-crawl confirmation |
| review_intent | 0.6 | 10 | 30 | Paid |
| compliance_deadline | 0.6 | Rises as the deadline nears | 270 days before | v × (1 − daysToDeadline/270) |
| public_pain | 0.5 | 14 | 60 | |
| launch, filing | 0.4 | 20 / 45 | 60 / 90 | |
| hiring (generic) | 0.3 | 14 | 30 | Weakest (+7%) |

`REL` (source reliability): high 1.0 · medium 0.8 · low 0.5. `sensitive` signals stay at 0 and never enter copy.

**Calibration** (code only; run once there are ≥ 20 decided deals, then every 10 more decided deals or quarterly):
```ts
neg = lost deals with lossReason ∈ {not_icp, no_pain, no_budget}      // timing / went_dark / competitor / price say little about fit;
                                                                     // CRM reasons match the buyer's only ~15% of the time (10 §5.1): founder confirms
lift_i = ((won_i + 1) / (dec_i + 2)) / ((won_not_i + 1) / (dec_not_i + 2))   // Laplace-smoothed win-rate ratio, met vs not met
w_i    = clamp(w_prior_i * lift_i ** (n_i / (n_i + 20)), 0.5, 6)                  // shrink toward the prior when data is thin
TYPE_W[t] = clamp(TYPE_W[t] * (posRate_t / posRate_all) ** (n_t / (n_t + 30)), 0.2, 1.5)   // per signal type with ≥ 30 first touches
report card (warn, never block): ≥ 70% of wins Tier A/B at first touch · ≤ 30% of `neg` Tier A ·
  meetings per first touch Tier A ≥ 1.5× Tier C (target 2–3×) · "blind spots" = wins with fit < 50 → propose new criteria
```

### D. Experiment decision rules
```ts
// FOUNDER MODE (≤ 50 first touches/week): test segment × angle (or offer) bets, never copy. Extends SegmentBet.
after 25 first touches:  ≥ 2 positive → keep · 0 positive && ≤ 1 reply → switch · else continue
after 50 first touches:  ≥ 3 positive → keep · ≤ 1 positive → switch · 2 → change one thing, run 25 more
// binomial error rates: true 8% positive → "≤1 of 50" wrongly kills 8%; true 2% → "≥3 of 50" wrongly keeps 8%
zero-event bound: 0 positives in n touches → true rate < 3/n (95%); show it on the bet card

// TEAM MODE (≥ 1,000 delivered per arm per month): one variable, randomise by account, same mailboxes and send windows
primary = positive replies / delivered first touches (fallback to replies if expected positives per arm < 10)
minPerArm = §4.2 table for the smallest lift worth shipping (floor 300); maxPerArm = 3 × minPerArm
a contact counts once its sequence has ended or 14 days have passed since touch 1
posterior Beta(1 + s, 1 + n − s) per arm; P = P(B > A) from 20k Monte Carlo draws
ship B    n ≥ minPerArm && P ≥ 0.95 && lift ≥ 0.5 pp (positive) or ≥ 1 pp (reply) && meetings_B ≥ meetings_A
keep A    n ≥ minPerArm && P ≤ 0.05
inconclusive at maxPerArm → keep the simpler arm; the next test must change audience or offer, not copy
guardrail stop (either arm, after ≥ 100 sends): bounce > 3% · unsubscribe > 2% · spam complaints > 0.1% · negative replies > 2× control
alpha decay (per play): trailing-4-week positive rate < 50% of its first 4 weeks (n ≥ 100) → flag "this play is wearing out"
```

### E. Speed-to-lead defaults
- **Inbound** (form or webhook): a human touch within 5 minutes for Tier A and B in business hours. Instant booking is always on and shows shared availability. Follow up drop-offs within 10 minutes. Disqualified leads get a self-serve next step.
- **Positive replies to outbound:** a move appears with a 1-business-hour SLA timer (`Move.receivedAt`). Show the founder their median time to reply on the Friday review.
- **Track:** % answered, median time to the first human touch, qualified → booked, and booked → held.

### F. Which plays need paid data

| Need | Plays | Free substitute in Inroad | Paid source |
|---|---|---|---|
| Job changes at scale | champion_moved, champion_left, alumni | Re-imported connections diff, bounces, the founder's own knowledge | Apollo (already integrated), UserGems/Champify-type feeds |
| Visitor identification | web_intent | Only first-party identified users | RB2B, Warmly (HubSpot), Vector, Unify |
| Social engagement | social_engagement | Manual capture of who engages with the founder's posts | Engagement-tracking tools (no scraping, 04) |
| Category intent | review_intent, displacement | None | G2 Buyer Intent |
| Install and removal dates | stack_change, displacement | Site scripts, DNS diffs, job-post mentions | BuiltWith, HG Insights |
| Contacts and emails | All | Emails people published themselves; guessed patterns behind a confirmation interlock (04) | Apollo, waterfall providers |
| Product usage | signup_rollup | — | The customer's own product events via webhook |

### G. The three things that would most impress a GTM engineer
1. **"Backtest my plays and my score" in under two minutes, all in code.** Import HubSpot or Attio deals, then show:
   - a model report card: tier separation, lift per criterion and blind-spot wins;
   - for each play, how often it would have fired in the last 90 days and how many of those accounts became opportunities.
2. **A play run log that works as the audit layer.**
   - Every candidate shows whether it was included or excluded and why, the dated source fact, and the cost (tokens, searches, provider credits).
   - Play definitions are versioned, with release notes.
   - Built-in auditors catch silent failures: fill-rate drops, segments where every score is zero, empty payloads, contacts enrolled but never sent.
3. **An honest experiment engine.**
   - Experiments are pre-registered, with one variable and the sample size the lift needs.
   - Verdicts include "inconclusive."
   - Each play has a scoreboard (meetings per 100 enrolled vs baseline, with holdouts) and an alert when it wears out.

   This is the rigor Clay's sequencer explicitly leaves to the operator, and it's what a GTM lead needs to trust the pipeline numbers.
