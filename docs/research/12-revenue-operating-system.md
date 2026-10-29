# The revenue operating system a seed–Series C Head of GTM runs (2025–2026)

**Scope.** 01, 02 and 09 already cover founder-led discovery, the qualification card, the MAP, dinners, warm intros, LinkedIn, the founder's daily and weekly rituals, and small-n honesty for reply rates. This note covers the management layer a Head of GTM, GTM lead or GTM manager runs on top of the deals: planning from a number backward, forecasting and calling a number, inspecting pipeline for risk, the weekly business review (WBR) and the board pack, win/loss, capacity, and what makes a leader trust the numbers.

**Method note.**
- Primary sources were fetched where possible: Gong help docs and Labs posts, Bridge Group, Kellblog, Commoncog, Battery, Bessemer, Clozd, and the Ebsta H1 2024 deck (566 companies, 1.2M+ opportunities).
- Many benchmark numbers on the web come from vendor blogs that quote each other. Those are marked **[vendor]** or **(secondhand)**, and conflicts are stated.
- Cycle-length and win-rate definitions differ between sources (first touch vs. opportunity created; narrow vs. broad win rate). Compare like with like.

---

## 0. The system on one page

| Cadence | Ritual | The question it answers | Core numbers |
|---|---|---|---|
| Annual, re-planned quarterly | Plan (reverse waterfall + capacity) | What inputs and headcount does the number require? | Target → deals → qualified opps → meetings → touches, by motion; ramped rep equivalents (RREs) |
| Weekly (Mon) | Forecast call | What will we book this period, and how sure are we? | Floor (closed + commit), call, ceiling (+ best case); change since last week |
| Weekly (Tue–Wed) | Deal reviews | Which deals need help, and what help? | Risk flags, days in stage, pushes, threading, next step |
| Weekly (Wed) | GTM WBR | Are the controllable inputs on pace? | Pipeline created vs. pace, to-go and next-quarter coverage, conversion with n |
| Monthly | MBR + investor update | Is the machine working? | New ARR vs. plan, pipeline created, win rate (with n), cycle, capacity |
| Quarterly | Board GTM section, QBR, win/loss synthesis, re-plan | Where is it breaking and what are we doing? | Battery's 5 slides (§4.3), efficiency metrics, loss-reason shifts |

Five principles run through all the sources:
- **Plan from productivity, not quota** (Kellogg).
- **Inspect inputs, report outputs** (Amazon WBR).
- **Never invert a single win rate blindly** (Kellogg).
- **Treat a slipped close date as information**: Gong and Ebsta both show slipped deals win far less.
- **Show n.**

---

## 1. Revenue planning: the reverse waterfall

### 1.1 The math (per motion *k*, per period)

```
new_logo_target   = bookings_target × (1 − expansion_share)
deals_k           = new_logo_target × mix_k ÷ ACV_k
qualified_opps_k  = deals_k ÷ win_rate_k              (qualified → won)
first_meetings_k  = qualified_opps_k ÷ qual_rate_k    (meeting held → qualified)
top_of_funnel_k   = first_meetings_k ÷ tof_rate_k     (contact / lead / intro ask → meeting held)
pipeline_$_k      = qualified_opps_k × ACV_k          (= deals_k × ACV_k ÷ win_rate_k)
weekly_k          = each count ÷ weeks in the creation window
creation window   = [period_start − median_cycle_k − 13 wks, period_end − median_cycle_k]   (heuristic)
```

- **Plan expansion separately.** In Ebsta x Pavilion 2025, expansion wins **45%** vs. **18%** for new logos, closes in **52 vs. 91 days**, and involves **5 vs. 8** decision-makers. In 2024, **52%** of new revenue came from existing clients (Ebsta's sample is mostly larger companies; https://www.ebsta.com/?p=20103). At seed–A, set `expansion_share` from the installed base, typically 0–25% (heuristic).
- **The motion mix is a choice, and cost per deal differs by motion.** Ebsta's channel efficiency index, computed as (win rate × ACV) ÷ cycle: partner referrals **1.3x**, organic inbound **1.2x**, outbound **1.05x**, events **0.78x**, paid **0.68x** (same source).
- **Sales velocity** (standard formula, e.g. https://www.salesforce.com/blog/sales/sales-velocity):
  - `V = (# qualified open opps × win rate × ACV) ÷ cycle days`, in $/day.
  - Example: 40 opps × 25% × $40K ÷ 90 days = **$4,444/day ≈ $404K/quarter**.
  - Doubling win rate or opp count has the same effect as halving cycle length.
  - Report the week-over-week change in each of the four levers, since V itself has no external benchmark.

### 1.2 Priors by stage and ACV band (use until your own data replaces them)

**Win rate and coverage, by company stage**

| | Seed ($0–1M ARR, founder-led) | Series A ($1–5M, first AEs) | Series B–C ($5–50M, teams) |
|---|---|---|---|
| New-logo win rate (qualified → won) | 25–40% (warm-heavy; 01 §6.2: 20–40%, ~30%) | 20–30% | **15–25%**. Ebsta 2025 median new logo **18–19%** (655K opps). Gong enterprise customers **~25%** opp → closed. Lemkin sees **15–20%** "as start-ups scale" (https://www.saastr.com/gong-100k-deals-take-about-days-to-close). |
| Start-of-period coverage | Count deals, not $; aim for 1/win rate | 3–4x | 3–5x. ICONIQ 2025: **3.7–3.8x** (https://www.saastr.com/the-age-of-ai-the-top-10-gtm-learnings-from-iconiqs-2025-b2b-saas-report). Stage 2 Capital: only **40%** of 150+ early-stage startups had ≥4x in Q1 2025; its rule of thumb is 3–5x (https://gtm.stage2.capital/p/what-early-gtm-benchmarks-are-telling). |
| Forecast basis | Priors, monthly call | Blended priors + observed | Observed, with ≥4 quarters of snapshots |

**Cycle length and stakeholders, by ACV band**

| ACV band | Typical cycle | Stakeholders | Coverage notes |
|---|---|---|---|
| < $15K | 14–30 days (Lemkin: < $5K) | 1–3 | Use **monthly** coverage and create-and-close (§2.6) |
| $15–50K | 2–3 months (Lemkin: $20–50K) | 3–5 | Quarterly coverage works |
| $50–150K | ~70 days opp→close for $100K deals (Gong 2025) up to 6–12 months from first touch (Lemkin $100K+) | 5–8. Ebsta: new business averages **8**, up from 5 in H1 2024 (https://ebsta.com/wp-content/uploads/2024/07/H1-Update-2024-B2B-Sales-Benchmarks.pdf) | Multi-quarter pipeline view |
| > $500K | 12–24 months (Lemkin) | 8+ | Plan deal by deal |

- Lemkin's cycle bands are at https://www.saastr.com/dear-saastr-how-long-should-a-sales-funnel-take-from-start-to-close.
- **Cycles moved.** ICONIQ 2025: 20 weeks for high-AI-adopter companies vs. 25 for others; fintech cycles went from 21 to 33 weeks; SQL → closed-won fell **5–6 points YoY**. Ebsta: cycles +16% in 2023, −9% in 2024.
- **Quota attainment is low everywhere**, so plans that assume 100% attainment fail. Bridge Group 2026 (158 companies): **48%** of reps at quota (https://www.bridgegroupinc.com/research/2026-ae-models-motions-metrics). Ebsta: **78%** of sellers missed quota in 2024. ICONIQ: **56–61%** of *ramped* AEs hit quota.

### 1.3 Priors by motion (conversion steps)

| Motion | Top of funnel → meeting held | Meeting → qualified opp | Qualified → won | Source quality |
|---|---|---|---|---|
| Warm intro / referral / investor | intro ask → meeting **~50%** | ~60% | 30–40% | Prior; [vendor] referral win 32–48% |
| Inbound (demo request) | lead → meeting **~60%** | 40–50% | 25–35% | [vendor]: inbound meeting→opp 20–40%; inbound wins 2–3x outbound |
| Outbound (SDR or founder) | contact → meeting 1–3% at scale; 3–5% founder-targeted (01 §6.2) | **25–35%** ([vendor] range 10–30%) | **10–20%** | [vendor]; Bridge Group SDR quota is **10 meetings held/month** (median) |
| Events / partners | conversation → meeting 10–20% | 30–40% | 15–25%; partner-sourced 30–50% [vendor] | Prior; Ebsta efficiency index above |
| Expansion | — | — | **45%** | Ebsta 2025 |

The Bridge Group SDR figures come from the 2025 report (351 companies), via https://www.cience.com/programmable-revenue/issue-15/sdr-metrics-quota-ramp-tenure/.

### 1.4 Worked example (Series A, illustrative priors)

**Inputs:** a $3.0M new ARR target over the next 12 months; 20% from expansion, so $2.4M new logo; ACV $40K, so **60 deals**; mix 30% warm, 30% inbound, 30% outbound, 10% events; 48 creation weeks.

| Motion | Deals | Qualified opps | Meetings held | Top of funnel | Per week | Pipeline $ |
|---|---|---|---|---|---|---|
| Warm (35% / 60% / 50%) | 18 | 51 | 86 | 171 intro asks | **4 asks**, 1.8 meetings | $2.06M |
| Inbound (25% / 45% / 60%) | 18 | 72 | 160 | 267 leads | 6 leads, 3.3 meetings | $2.88M |
| Outbound (15% / 30% / 2.5%) | 18 | 120 | 400 | 16,000 contacts | **333 contacts**, 8.3 meetings | $4.80M |
| Events (20% / 35% / 15%) | 6 | 30 | 86 | 571 conversations | 12 conversations | $1.20M |
| **Total** | 60 | **273** | **731** | | **15 meetings/wk, 5.7 opps/wk** | **$10.9M (4.6x; blended win 21.9%)** |

What the example shows:
- Outbound produces 30% of the deals but needs 55% of the meetings. 400 meetings is ~**3.3 SDR-years** at Bridge's 10 held per month, which is the hiring implication.
- Moving 10 points of mix from outbound to warm removes ~130 meetings a year.
- The warm row's 4 asks/week matches InRoad's existing `INTRO_ASKS_PER_WEEK = 4`.

### 1.5 Planning with little history: priors → blended → observed

- **Small samples are wide.** Wilson 95% intervals at a true 25% win rate:

  | Decided deals | 95% interval | 80% interval |
  |---|---|---|
  | 2/8 | 7–59% | 11–48% |
  | 5/20 | 11–47% | 15–39% |
  | 10/40 | 14–40% | 17–35% |
  | 25/100 | 18–34% | 20–31% |

  A seed company's "win rate" is a guess with a range of ±20–30 points, and coverage computed as 1/win rate swings between ~2x and ~9x on the same evidence.
- **Shrink toward the prior** (empirical Bayes / beta-binomial; Robinson's batting-average walkthrough: http://varianceexplained.org/r/empirical_bayes_baseball/).
  - Formula: `blended = (wins + p0 × k) ÷ (decided + k)`.
  - With p0 = 25% and k = 10 pseudo-deals: 3/5 raw 60% becomes **37%**; 1/6 raw 17% becomes **22%**; 12/40 raw 30% becomes **29%**.
  - The prior fades as evidence grows: extraordinary early results need extraordinary evidence.
- **When to switch.** Use observed rates when either (a) `decided ≥ 30` for that motion or segment, or (b) the 80% interval of the observed rate excludes the prior, meaning the data clearly disagrees. Until then, show prior, observed and blended side by side.
- **History requirements are real.**
  - Gong's deal likelihood model trains on **2 years** of closed deals. Its help center cites minimums of 50 closed-won or 150 closed-lost, and the two pages conflict (https://help.gong.io/docs/explainer-under-the-hood-of-deal-likelihood-scores).
  - Kellogg calibrates stage probabilities by regression over the "last 8 quarters", and conversion over trailing 7–9 quarters.
  - Most seed–A teams have neither. Use transparent rules and priors, not a black-box score.
- **Re-plan without moving the goalposts.** In Kellogg's "Joe is a hero, not a zero" example, a VP delivered 59–75% of plan but 101–109% of *capacity* once the plan was re-run with actual hiring. Judge leaders against the plan re-run with actual inputs (https://www.kellblog.com/how-to-make-and-use-a-proper-sales-bookings-productivity-and-quota-capacity-model/).
- **Coverage is not 1/win rate** (Kellogg, https://www.kellblog.com/target-pipeline-coverage-is-not-the-inverse-of-win-rate/). Four reasons:
  - Win rates are ambiguous. *Narrow* is wins ÷ (wins + losses); *broad* also counts no-decision "derails".
  - Slips are excluded: "you win a third, you lose a third, and you slip a third."
  - Win rates date from when opportunities die, while coverage is measured at quarter start.
  - Use the **week-3 pipeline conversion rate** instead: new ARR closed ÷ week-3 starting pipeline. His trailing 9-quarter example is **34% → ~2.9x**. Ask "what coverage do we need to hit plan 90% of the time?"

---

## 2. Forecasting

### 2.1 Categories (rep- or leader-set) vs. stage (process-set)

| Category | Meaning | Evidence typically required | Expected in-period close |
|---|---|---|---|
| **Closed** | Won (or lost) this period | Signed | 100% |
| **Commit** | The number you stake credibility on; the floor | (1) The champion/contact can make the decision. (2) Start timeline confirmed. (3) MAP started. (4) Customer understands the purchase process. (5) Compelling reason to buy now (Clari's guide, now on Salesloft: https://www.salesloft.com/resources/blog/defining-sales-forecast-categories-to-drive-reliable-revenue) | **≥90%** (Salesloft; Lemkin "think 90% or more": https://www.saastr.com/dear-saastr-what-are-the-different-types-of-commits-each-sales-rep-should-make/) |
| **Best case** | Could close this period if named things happen; the ceiling | Fully qualified, contract and closing plan exist, work remains | 30–60% [vendor medians ~38%]; Kellogg's example weight 0.7 for "forecast", 0.3 for "upside" |
| **Pipeline** | Qualified, unlikely this period | Qualification captured | 10–25% |
| **Omitted** | Not forecastable | Unqualified or dropped | 0% |

- **Roll-up math:** Best case is usually reported *inclusive*: best case + commit + closed.
- **The call:** Sourcegraph's reps submit **Call, Best case, Commit** weekly. Commit is the floor, Best case the ceiling, and the Call is the most likely number in between (https://handbook.sourcegraph.com/departments/sales/forecasting).
- **Lemkin's simpler three:** Commit (90%+), Most likely (50–90%, includes commit, "your baseline expectation"), Best case (10–20% upside, never relied on to hit the target).
- **Accountability loop:** investigate every Commit that didn't close and every slip out of Most likely. Compare each rep's categories to outcomes after the fact.

### 2.2 Weighted vs. categorical: triangulate rather than choose

Kellogg's four bearings (https://www.kellblog.com/use-triangulation-forecasts-for-better-conversations-about-the-forecast/):

1. **Rep roll-up**: the sum of rep forecasts. It "tends to be optimistic."
2. **Manager roll-up**: "tends to be the most accurate." A CRO whose call is consistently worse than the manager roll-up is a "mathematical negative value-add."
3. **Stage-weighted EV**: Σ stage probability × amount. Ten $100K deals at stage 2 ≠ ten at stage 5.
4. **Category-weighted EV**: Σ category probability × amount. His example weights are upside 0.3, forecast 0.7, commit 0.9.

Plus a fifth bearing:

5. **Historical conversion**: week-3 pipeline × trailing week-3 conversion, split new vs. expansion (https://www.kellblog.com/using-pipeline-conversion-rates-as-triangulation-forecasts/).

How to read and calibrate them:
- **Divergence is the signal.** If stage-weighted EV is far below the calls, there's enough volume but deals aren't advanced: a velocity problem. If the leader's call is far above managers', they're counting on a pull-forward or protecting budget.
- **Calibrate rather than discard.** "Methods with consistent errors are good predictors that are just miscalibrated." Regress the probabilities or apply a correction factor. In his example, stage-weighted EV needed a ~20% upward correction ($2.5M EV vs. $3.0M actual).
- **Present a range.** His worked call is $2.8–3.2M, presented as an **80% confidence interval** against a $3.9M plan.
- **Default stage probabilities are placeholders.** HubSpot's defaults (Appointment 20%, Qualified 40%, Presentation 60%, Decision-maker bought-in 80%, Contract sent 90%) are guesses (https://www.sybill.ai/blogs/hubspot-deal-stages). Replace them with your own stage-to-won rates.

### 2.3 How good leaders call a number

- **Start from what changed.** Lead with the Δ since last week: new commits, removed commits, pushes, amount changes. Then walk commit deals one by one, then the best-case deals you're betting on. Weekly commit calls typically "start every weekly commit with what changed over the last seven days" [vendor].
- **Floor and ceiling are mechanical.** The call is judgment, and it gets compared with the stage- and category-weighted bearings. Give the CEO/CFO three numbers plus a confidence statement.
- **Calls show up in deal evidence.**
  - Gong's model says its AI is **21% more precise than reps** at predicting won deals as early as **week 4** of the quarter.
  - Gong's survey of 928 professionals (2022) found that teams using customer-interaction data were **2x as likely** (22% vs. 11%) to land within 5% of their monthly forecast (https://www.gong.io/press/as-economic-headwinds-grow-stronger-only-24-of-sales-leaders-are-confident-in-their-teams-revenue-forecast).
- **Trust is low.** In that survey, **24%** of leaders trust their reps' commits and **58%** trust their own; **52%** regularly miss by >10%; leaders spend **4.9 h/week** on forecasting.
- **Gartner (2020):** only **45%** of sales leaders and sellers have high confidence in their organization's forecast accuracy (https://www.gartner.com/en/newsroom/press-releases/2020-02-12-gartner-says-less-than-50--of-sales-leaders-and-selle).

### 2.4 Accuracy targets and how to measure them

- **Formula:** `accuracy = 1 − |call − actual| ÷ actual`. Over- and under-calls count equally.
- **Snapshot the call** at weeks 1, 3, 6 and 9, and score each against the actual.
- **Targets:**
  - Within **±10%** by mid-quarter (week 6) is the common bar.
  - **±5%** is top-tier [vendor; SiriusDecisions-derived grades, secondhand].
  - Forrester (cited by Salesloft): **>50%** of companies regularly miss *monthly* forecasts by >10%, and **85%** miss by >5%.
- **Slice accuracy by week of quarter** [vendor]. Early-quarter error usually means a pipeline-visibility problem; late-quarter error usually means an execution or slippage problem.
- **Seed:** a monthly call is enough (02 §5.2). From the first AE onward, run it weekly.

### 2.5 Weekly forecast cadence (Series A–C)

| When | What | Who |
|---|---|---|
| Fri → Mon AM | Reps update close date, amount, next step and category. Category changes require a reason. | AEs |
| Mon (30–45 min) | Forecast call: Δ since last week → commit deals → best-case bets → floor/call/ceiling to CEO/CFO by EOD | GTM lead + managers |
| Weeks 2, 5, 8 | **Formal pipeline scrub.** Kellogg: scrubbing continuously means "never scrubbing." | Managers |
| Weeks 3, 6, 9 | **Snapshot** the pipeline and the call. Flat pipeline across snapshots suggests the scrub didn't happen (dirty data). | RevOps / tool |
| Monthly | Forecast-accuracy review by method and by person | GTM lead + finance |

Snapshot and scrub weeks are from https://www.kellblog.com/using-to-go-coverage-to-better-understand-pipeline-and-improve-forecasting/.

### 2.6 Pipeline creation targets; in-quarter vs. next-quarter coverage

**Pipeline creation pace**
- **Weekly target ($)** = next-period new-logo target ÷ expected conversion of created pipeline ÷ weeks in the creation window. Kellogg's cohort "close rate" example: **27%** of 1Q22-created opportunities closed within six quarters. In the §1.4 example, that's **~$228K/week** of qualified pipeline, or 5.7 opps.
- Sam Blond's diagnostic question is "how many new opportunities were created *this week*?" He finds companies usually misdiagnose a demand problem as a conversion problem (https://www.saastr.com/9-easy-sales-concepts-so-many-get-wrong-with-sam-blond/).

**Coverage through the quarter**
- **To-go coverage** = open in-period qualified pipeline ÷ (plan − closed QTD). Kellogg wants **3.0x at all times** and to "start the quarter with 3.0x". His example falls from **3.2x to 2.2x** over 9 weeks, which means pipeline is being lost faster than closed.
- **This / next / all-quarters table**, read weekly (https://kellblog.com/2021/04/30/using-this-next-all-quarter-analysis-to-understand-your-pipeline/):
  - **Slip:** this-Q ↓, next-Q ↑, all-Q ≈ flat. His week-3 example: −$3,275K / +$2,000K / −$500K.
  - **Loss:** this-Q ↓, next-Q flat, all-Q ↓.
  - **Win:** add QTD bookings. Bookings ↑ while this-Q ↓.
  - Also count opportunities: "15 to 20 all-quarters oppties is the maximum any salesrep can possibly juggle."
- **Next-quarter coverage** is the leading indicator. Kellogg wants marketing to forecast **day-1 next-quarter coverage** habitually, and treats marketing as the pipeline "quarterback".
- **Sandbag and create-and-close check.** In Kellogg's example, **30 of 56** deals closed in the quarter weren't in the week-3 pipeline: 5 were created after week 3, and **25 were pulled in** from later quarters (close dates "sandbagged"). Battery says to track **create-and-close** (opened and closed in-quarter) for SMB or <90-day cycles (https://battery.com/blog/the-five-must-have-board-slides).
- **Short cycles (~30 days):** quarterly starting coverage converges to ~1.0x and stops meaning anything. Switch to **monthly** coverage (starting monthly pipeline ÷ monthly target) and a layered forecast. Kellogg's example: existing opps 51%, existing high funnel 36%, planned demand gen 13% (https://engineered.at/articles/what-do-pipeline-coverage-and-forecast-mean-when-your-sales-cycle-is-30-days, summary of Kellblog).

---

## 3. Pipeline inspection and deal risk

### 3.1 Codeable risk signals (with the defaults vendors ship)

| Signal | Definition | Default threshold | Evidence |
|---|---|---|---|
| **No activity** | No logged email or call by either side | **7 days** if cycle <45 days. If ≥45 days: **14 days** early-stage, **7 days** late-stage | Gong's typical settings (https://help.gong.io/docs/customize-your-deal-warning-settings) |
| **Ghosted** | No *buyer-side* activity; OOO auto-replies don't count | **4 days** short cycle; **7 days** long early-stage; **4 days** long late-stage | Gong, same page |
| **Overdue** | Close date in the past | Any | Gong |
| **Close date pushed** | Cumulative push or count | Push ≥ **3 weeks** is "not a hiccup, it's a hold up". Pushes into the next month or quarter are worse. | Gong, 13,439 opps (https://www.gong.io/resources/labs/your-crm-close-date-isnt-giving-you-the-full-picture-heres-what-youre-missing/) |
| | Slipped vs. not | **Win rates decline 83% when deals slip.** 44% of deals slipped in 2024 → 36% in 2025; >2 months is worst. | Ebsta H1 2024 deck; https://www.ebsta.com/exclusive/why-deal-slippage-growth-killer |
| **Stalled in stage** | No stage change for X days | Configured per stage | Gong. Ebsta's CEO, on one dataset: past **22 days** in stage 3 the odds shrink; past **32 days** they're "just so low". One customer's deals older than **120 days** won <2% (https://www.buzzsprout.com/1452916/16876179/transcript) |
| **Not enough contacts** | ≤ N active buyer contacts for X days | N = 1–5, configurable | Gong. Ebsta: **3** active stakeholders win **12%**; **6**, with a C-level and finance by stage 2, win **42%** (Rubin, same transcript) |
| **No power** | No active Director/VP/C-level, closing within X days | Seniority and days configurable; ≥75% of mapped titles below the level | Gong. Ebsta H1 2024: engaging the CXO early in a stage → **9.2x** velocity |
| **Pricing not mentioned** | No pricing discussion, closing within X days | Days configurable | Gong |
| **Red flag** | Buyer email flagged as risk; clears on reply or call | X days | Gong |
| **Slow response** | Buyer email unanswered >24h | 24h | Gong Labs: replying within 24h → **14% higher win rates, 11% shorter cycles**. A third of deals missed it (https://prnewswire.com/news-releases/gong-launches-new-ai-powered-system-to-boost-deal-win-rates-and-seller-productivity-301678251.html) |
| **Amount changed** | Amount ↓, or ↑ late without EB | — | One of Gong's "deal progression" inputs, alongside deal age and proximity to close |
| **Next step missing or past** | No dated, buyer-agreed next step | 0 days | 01 §6.2, 02 §5.2 |
| **ICP mismatch** | Low fit score | — | Ebsta H1 2024: win rates **3.1x** higher when opportunities match ICP |
| **Late objections** | Objections unresolved by mid-stage | — | Ebsta H1 2024: satisfying objections by mid-stage → **3.4x** velocity |

All Gong warnings: https://help.gong.io/docs/using-deal-warnings.

### 3.2 How the vendors score deal health

- **Gong deal likelihood** is a **percentile rank** vs. other open deals, *not* a probability: 80 means healthier than 80% of open deals (https://help.gong.io/docs/explainer-about-deal-likelihood-scores).
  - It uses **300+ signals**. **50%** of the weight comes from conversations (legal or pricing mentions, competitors, warnings, interaction stats).
  - The rest comes from activity (next meeting scheduled, gone quiet, days since last touch), contacts (count and decision power), progression (velocity, amount changes, close-date changes vs. won deals, age) and history (time in stage; rep, stage and category win rates).
  - Bands: Low 0–35, Fair 36–74, High 75–100. Rescored daily on 2 years of data.
- **Clari** (per its community; https://community.clari.com/product-q-a-6/crm-score-vs-activity-score-1192):
  - **CRM Score** is ML on your own history: 89 ≈ 89% chance to win. Red 0–59, yellow 60–79, green 80–100.
  - **Activity Score** counts emails sent and received, past meetings, and future meetings up to 30 days out. It's plotted against CRM Score to reprioritize deals.
- **Ebsta** scores relationship strength across stakeholders (multi-threading) and benchmarks stage timing. It found **44%** of sales contacts missing from CRMs, a quarter of them senior. Its CEO says ~**80%** of seller interactions never reach the system of record.
- **Takeaway:** every vendor blends recency, buyer-side engagement, breadth and seniority of contacts, stage velocity vs. history, and close-date movement. Without years of history, a transparent additive rule set built on the same signals is the honest substitute (Implications §D).

### 3.3 Multi-threading and engagement benchmarks (beyond 02 §1)

- Won deals have **67% more contacts** (Gong; already in 02).
- Ebsta: new business involves **8 stakeholders** vs. **5** for expansion (up from 5 → 8 in H1 2024). Going from 3 to 6 stakeholders lifts win rate from **12% → 42%** when C-level and finance are in by stage 2.
- Top performers are "nearly 3x more likely to self-source" opportunities (Ebsta).
- Revenue concentrates in a few reps: "14% of sellers are responsible for 80% of revenue" (Ebsta). Clari's 2025 enterprise data has **10%** of sellers producing **65%** of revenue. Averages hide this.
- Brex's Sam Blond: in-person meetings produced a **3x** likelihood of closing.
- All multi-threading and engagement numbers here are **correlational**: healthy deals attract more contacts. Use them as risk flags, not as causal targets.

### 3.4 Deal review: which deals, which questions

- **Selection:** 3–5 deals chosen by `amount × risk points`, plus one upside deal. Not round-robin (02 §5.2).
- **Gong's three standing questions** (https://help.gong.io/v1/docs/best-practices-assessing-deal-health): "When was the last prospect activity?" · "What's your next step?" · "Who besides the main contact is actively engaged?"
- **John McMahon's three whys**, from *The Qualified Sales Leader*: Why do they have to buy? Why from us? Why now? If the buyer can't say why now, it won't happen now.
- **Field-driven questions** (ask only the ones a missing field or risk flag triggers):
  - **Economic buyer:** "Who signs, have we met them, and what did they say?"
  - **Paper process:** "What happens between verbal yes and signature? How long did their last purchase take?"
  - **Champion test:** "What did the champion *do* for us last week?" (an action, not a sentiment)
  - **Close-date push:** "Why did the date move, and who moved it: us or them?"
  - **Pricing:** "Has price been discussed? What was the reaction?" (Gong flags no pricing talk near close)
  - **Competition:** "What happens if they do nothing?" (no-decision is the main competitor, §5.1)
  - **Commit test:** "What has to be true to close by the date? What's the earliest it could slip?"
- **Output rule:** every deal discussed leaves with an owner, a date, and either a category change or an explicit "no change" (02 §5.2).

---

## 4. The weekly business review and the board/investor GTM section

### 4.1 WBR mechanics worth stealing from Amazon

Source: Commoncog on Colin Bryar, https://commoncog.com/the-amazon-weekly-business-review/.

- **Timebox and format:** **60 minutes**, a static deck rather than live dashboards, and handoffs under 2 seconds. Finance facilitates and opens with last week's open items.
- **6-12 chart:** trailing **6 weeks** on the left and trailing **12 months** on the right (six weeks because a four-week view misleads at month boundaries). Each chart adds last year's line (faded), a target marker, and the same row of box scores as every other chart.
- **Exceptions only.** Every metric is shown; routine variation gets "nothing to see here" and about a second on the chart.
- **Owners pre-investigate exceptions.** If the cause is unknown, the owner says so and a follow-up is logged; nobody invents an explanation. No strategy debates in the room.
- **Inputs first, outputs last.** Discuss only **controllable inputs**. Add a metric when it proves to drive an output, and drop it when it stops showing an effect. After any blow-up, ask what metric would have warned you.
- **Three recurring questions per metric:** Is it worth discussing? Is it the right input, given that proxies exist? How exactly is it measured?
- **Anecdotes go on a separate "voice of the customer" slide.** When metrics and anecdotes disagree, stay skeptical.
- **Health check:** skip a week, then ask what happened to last week's exception and its proposed action.

Kyle Norton (Owner.com CRO) runs a weekly written "Maple" update covering key metrics, work accomplished, critical advances, and emergencies/blockers. Around it he runs a monthly business review, "control tower" executive dashboards and team scoreboards. His advice: start with the **6 most critical metrics for your stage**, and "only measure what you'll actually manage" (https://www.saastr.com/the-revops-playbook-how-owner-coms-cro-scaled-from-0-to-1b-arr).

### 4.2 A GTM WBR for seed–Series C (30 minutes, one page plus charts)

1. **Headline (2 min):** QTD bookings vs. plan; the floor/call/ceiling and its Δ vs. last week; to-go coverage.
2. **Controllable inputs (10 min), each as a 6-week trend vs. pace:** meetings held by source; qualified opps created (# and $) vs. the weekly creation target (§2.6); intro asks; speed to lead.
3. **Pipeline movement (5 min):** the this/next/all-quarter Δ with slip/loss/win attribution; next-quarter coverage; opps per AE vs. the 15–20 ceiling.
4. **Conversion (5 min):** stage-to-stage over the trailing 90 days with **n**, and win rate with an interval.
5. **Top risks (5 min):** the 3–5 largest `amount × risk` deals and the action on each.
6. **Decisions and asks (3 min):** owners and dates. Last week's open items are closed first.

### 4.3 The board deck GTM section

**Battery's five slides** (https://battery.com/blog/the-five-must-have-board-slides):

1. **Headline reel:** bookings vs. plan, NRR and churn side by side, and cash, each with a green/yellow/red status.
2. **Five-quarter view** (same quarter last year plus the last three): ARR split new / cross-sell / upsell; gross new logos and total count; ASP and average sales cycle; deals > $100K and terms > 12 months.
3. **Segments, geographies or verticals:** bookings vs. plan, deal count, ASP and cycle, with new and expansion split.
4. **Pipeline:** conversion rates for the just-closed quarter vs. the prior quarter; **create-and-close** for SMB or <90-day cycles; current-quarter pipeline health; an optional top-deals list to ask the board for intros.
5. **Team health:**
   - attainment for the current plus ≥2 prior quarters ("when your team is greater than 50% of quota, then the culture is winning");
   - hired vs. planned headcount, with extra credit for ramped vs. planned;
   - warning sign: the team beats quota while hiring lags, which means a capacity shortfall.

**Leave out of the sales slides:** CAC, magic number, LTV and Rule of 40, which belong in the finance section. Cut "until it hurts the narrative". Keep the deck mostly forward-looking and put detail in the appendix.

**Efficiency metrics the finance section will carry:**
- **Burn multiple** = net burn ÷ net new ARR (https://sacks.substack.com/p/the-burn-multiple-51a7e43cb200). Around **3** is plausible at seed and it should fall to about **2** after Series A, then keep falling. A worsening trend is a red flag.
- **CAC payback** targets: SMB **<12 months**, mid-market **<18**, enterprise **<24** (https://www.bvp.com/atlas/scaling-to-100-million). Stage 2 Capital: 50% of startups below $5M ARR have <12 months payback, vs. 30% at $5–10M and 0% at $10–50M.
- **NRR** median by stage: 125% ($1–10M ARR), then 117–120% (Bessemer).

**Timing:** sales-driven companies hold the board meeting a couple of weeks after quarter close (Sacks SaaS Board Deck, https://craftventures.relayto.com/e/the-sacks-saas-board-deck-0ayrxwr4qml7u).

**Show the forecast as a range with its method** (Kellogg's 80% interval). Operator directors want commit numbers and confidence. Non-operator directors drift to logos and pipeline visuals (Lemkin on Kyle Norton's podcast, recapped by Pavilion: https://www.joinpavilion.com/blog/trlp-recap-1).

### 4.4 Monthly investor update: the GTM block

- **Content:** 1–3 KPIs with % change (new ARR, ARR, qualified pipeline created); cash, net burn and runway; 2–3 highlights and 1–3 lowlights; **specific asks**, ideally named target accounts for intros.
- **Format:** 500–800 words in the same format every month, a YC-style structure (secondhand: https://visible.vc/blog/tips-from-yc-using-asks-metrics-and-a-recap-to-power-your-investor-updates/). At pre-seed/seed, skip cohort charts and LTV/CAC.

### 4.5 What to leave out (WBR and board)

| Leave out | Use instead |
|---|---|
| Activity counts (calls, emails sent) | Meetings held and opps created. Activity stays a diagnostic. |
| Total pipeline including unqualified | Qualified only. RevOps Co-op: without clear criteria, teams "can manipulate numbers to appear stronger than they are" (https://www.revopscoop.com/event/vanity-value-revops-pipeline-metrics) |
| Win rate computed only from late-stage deals | All qualified opps, which RevOps Co-op says avoids inflating it |
| Rates without n | Counts, or rates with intervals |
| Uniformly green reporting | At least one honest yellow or red item with a mitigation |

---

## 5. Win/loss analysis

### 5.1 Why CRM loss reasons mislead

Clozd figures are from https://www.clozd.com/blog/product-marketing-win-loss-playbook.

- Buyer-stated and CRM loss reasons align only **~15%** of the time, competitor tagging is wrong **~65%** of the time, and **price** becomes the rep's default explanation for losses.
- **40–60%** of deals are lost to the customer doing nothing (Dixon, *The JOLT Effect*, 2.5M recorded conversations; https://customerthink.com/the-problem-of-customer-indecision-and-how-to-get-over-it-interview-with-matt-dixon/).
  - Status-quo preference is **less than half** of those no-decision losses. The larger share is **indecision**, meaning fear of making a mistake.
  - The fixes differ: indecision calls for a recommendation, limited options and risk reversal; status quo calls for a stronger case for change.
- Ebsta: **76%** of deals lack a compelling event.

### 5.2 Reason-code taxonomy

- **Outcome** on every closed opportunity: Won · Lost to competitor · Lost to status quo/no decision · Disqualified (not ICP) · Churned in pilot. Keep "no decision" separate from "lost"; some taxonomies reserve *lost* for a competitor win (cyberedgegroup, secondhand).
- **Primary reason:** a required picklist of **8–12** codes, since long lists make reps pick "close enough" [vendor].
  - Suggested codes: no compelling event, value not proven, champion lacked power or left, EB never engaged, price/budget, product gap (with the named gap), competitor (named), security/legal, timing (with a re-engage date), indecision.
- **Secondary reason** is optional, because deals rarely fail for one reason. Add one sentence of free text and a buyer quote if available.
- **Record win reasons too:** what tipped it, and which alternative they rejected.

### 5.3 Interviews: timing, n, format

Clozd, same source:
- **Timing:** 2–6 weeks after the decision. Earlier gives fresher memory; later gives more no-shows. Recall fades after ~6 weeks.
- **Format:** a 30-minute semi-structured interview by someone *other than the rep*, which gives more candid answers. Use a small honorarium, one-click scheduling, and up to 3 follow-ups.
- **Coverage:** drivers, alternatives (including doing nothing), pricing, messaging resonance, gaps, risk blockers, and what would have changed the outcome.
- **Sample:** pick 30–60 recent decisions stratified by segment and ACV; directionally that's **15–25 per segment per quarter**.
  - At seed, every decided deal is worth a 20-minute call. Treat the result as qualitative until about **15–20 interviews**; practitioner guides suggest clustering tags at that point (heuristic, not Clozd).
- **Reporting:** a monthly one-page "Voice of the Buyer" with the top 5 drivers and blockers, each with quotes, an owner, a due date and the expected metric movement. Battlecards refresh quarterly.
- **Payoff:** in Clozd's survey, **63%** of companies report win-rate increases from win/loss, rising to **84%** for programs running 2+ years.

### 5.4 From patterns to ICP and messaging changes

| Pattern | Change | Sample-size gate |
|---|---|---|
| A segment's shrunk win rate < ½ of overall | Propose it as an anti-ICP, or a separate play (Ebsta: ICP-matched opps win **3.1x**) | n ≥ 8 decided in that segment |
| One loss reason ≥ 30% of losses in a quarter | One targeted change: a qualification question, a proof asset, the pricing package, or a product ask | ≥ 5 losses |
| "No decision" ≥ 40% of losses | Qualify on the critical event earlier, offer a recommendation plus risk reversal, cut options (JOLT) | ≥ 5 |
| Won deals share a trigger, persona or source | Re-weight targeting and channel mix (Ebsta efficiency index by source) | ≥ 5 wins |
| Buyer language in wins ≠ your messaging | Rewrite the messaging tree in their words (Clozd); feeds 01 §2.5 | Qualitative |

---

## 6. Capacity and hiring math

### 6.1 Benchmarks that matter for planning

- **AEs (Bridge Group 2026, 158 companies):** median OTE **$200K**; quota **$960K** ($875K for SaaS); **4.6x** quota:OTE, up from 4.2x; ramp **6.2 months**, the longest in the study's history; **48%** at quota; 38% of AEs now own renewal or expansion.
- **Attainment varies widely.**
  - Everstage (200+ companies, 25K quota records): "fewer than 1 in 4 AEs hit quota". Attainment rises with quota size: **73.4%** at a $3.3M median quota vs. **51.9%** at $126K (https://www.everstage.com/benchmarking/gitlab).
  - Blond wants **70%+** of the team over quota; otherwise OTE is fiction (https://www.antoinebuteau.com/lessons-from-sam-blond/). Battery's bar is **>50%**.
- **SDRs (Bridge Group 2025, 351 companies, secondhand):** ramp **3.0 months**; quota **10 meetings held/month**; OTE **$80K** (68:32 base:variable); **60%** at quota; attrition **40%**/yr; **$3.78M** raw pipeline per SDR per year.
- **Hiring lead time.**
  - SHRM's 2025 median time-to-fill is **44 days** (via https://www.talentmsh.com/insights/time-to-fill-benchmarks). Employ's average is **63.5 days**, and **83.5** at small companies (https://www.hrdive.com/news/hiring-benchmarks-report-employ-2025-more-applicants/809604/). No AE-specific benchmark found.
  - Add ~6 months of ramp, so **a hire made today is fully productive in ~8–9 months.** You can't hire your way to this year's Q3 number in Q2.

### 6.2 Productivity-first capacity model (Kellogg)

Sources: https://www.kellblog.com/the-use-of-ramped-rep-equivalents-rres-in-sales-analytics-and-modeling/ and https://www.kellblog.com/measuring-ramped-and-steady-state-sales-productivity-the-rep-ramp-chart/.

```
RRE_t          = Σ_reps ramp[tenure_quarters]          ramp = [0, .25, .50, .75, 1.0]   (alt: [0, .25, .50, 1.0])
capacity_t     = RRE_t × steady_state_productivity_per_quarter   (+ judgment row)
quota_capacity = capacity × (1 + over_assignment)       over_assignment 15–25% (example 20%)
```

- **Productivity** is what you expect them to sell; **quota** is what you ask. Watch the percentage math: "lopping 20% off quota is not 20% over-assignment, it's actually 25%."
- **Example:** 25 nominal reps = **17.5 RREs**. That's 70% effective, and 30% of capacity is lost to ramp.
- **Steady-state benchmark** (enterprise): ~$1.2M new ARR/rep/year. His cohort data ramped at 10% / 38% / 76% / 85% / 98% over the first five quarters. Build your own **rep ramp chart**: every rep ever hired, by tenure quarter, departed reps included.
- **Model turnover explicitly** rather than shading productivity down. Build separate models per rep type (inside vs. field, etc.).

### 6.3 Worked example

- **Setup:** 2 ramped AEs; hire 2 at the start of Q1 and 2 at the start of Q2. Steady state is $600K/yr, roughly Bridge's $960K median quota × ~63% average attainment (Everstage's industry benchmark), used as a planning prior.
- **Result:** RREs by quarter are **2.0 / 2.5 / 3.5 / 4.5**, giving capacity of **$300K / $375K / $525K / $675K**, or **$1.875M** for the year. Quota to assign at a 20% uplift is $2.25M.
- **Against a $3M target:**
  - The gap is **$1.1M**, and Q3 hires can't close it because ramp alone puts them past year-end.
  - The levers are hiring earlier, founder or leader selling, expansion, or a lower target.
  - Check that the §1.4 pipeline (~$228K/week) exists to feed these reps before adding more.

### 6.4 Hiring triggers and the pipeline-vs-capacity diagnosis

- **Pipeline problem or capacity problem?** Norton: "80% of the time, companies don't have a rep capacity problem; they have a pipeline problem" (https://www.antoinebuteau.com/lessons-from-kyle-norton-cro-at-owner-com/). Blond: don't add reps to a demand-poor environment, because extra reps spread demand thinner.
- **Opportunity load per rep:** Kellogg says 15–20 open opportunities is the most a rep can juggle. Gong's enterprise reps carry ~54, a count that likely includes early stages, so define "active" before comparing.
- **Hiring sequence (Blond):**
  - For the first hire, **hire two**; both failing points to systemic causes.
  - No SDRs before outbound works with AEs.
  - Add the first sales leader in parallel with more ICs once two reps succeed.
- **Founder-stage triggers** (≈10 founder-closed deals, documented playbook) are covered in 01 §6.2 and 02 §0.
- **Judge new reps on early objective milestones** (30/60 days), not revenue, when cycles are long (Blond).

---

## 7. What leaders look at weekly, and what makes them trust numbers

### 7.1 Looked at vs. ignored

- **Weekly:** floor/call/ceiling and its Δ; commit changes and slipped deals; to-go and next-quarter coverage; pipeline created vs. pace, by source; meetings held; top risks; open next steps.
- **Monthly:** stage conversion and win rate with n; median cycle length; ASP; capacity (RREs vs. plan); attainment distribution; forecast accuracy by method.
- **Usually ignored:** activity dashboards; total unqualified pipeline; MQL counts without downstream conversion; influenced-pipeline attribution; 40-chart dashboards nobody owns.

Norton's test applies: a metric no one will manage is noise.

### 7.2 Trust breakers and trust builders

**Trust breakers**
- **The owner grades their own work.** RevOps Co-op: "If I had been able to grade my own physics papers…" Have someone else define the metric.
- **Definitions drift.** Marketing, sales and finance often mean different things by "SQL" or "pipeline".
- **Missing data.**
  - Pete Kazanjy: teams often run at ~**60%** of the activity leadership believes (https://www.antoinebuteau.com/lessons-from-pete-kazanjy/).
  - Ebsta: 44% of contacts are missing from CRMs, and ~80% of interactions are never logged.
  - Clari Labs (May 2025 release headline): **78%** of enterprises stalled their AI adoption because they don't trust their revenue data (https://www.businesswire.com/news/home/20250519941062/en/78-of-Enterprises-Stalled-With-AI-Adoption-Because-They-Dont-Trust-Their-Revenue-Data-Clari-Labs-Research).
- **Close dates that move silently,** and flat pipeline across snapshots (Kellogg).

**Trust builders**
- **One written definition per metric**, with its formula, source and owner.
- **Counts before rates;** a rate only with n and an interval.
- **Snapshots** on fixed weeks, so changes are explained rather than discovered.
- **Every number clickable** to the deals behind it.
- **Methods scored against outcomes**, so the leader learns which bearing to trust.
- **One honest red item** each period.

---

## IMPLICATIONS FOR THE PRODUCT

InRoad becomes a Head of GTM's revenue operating system by computing these in code, deterministically, from the deal ledger. Every number links to its deals and shows its n and whether it came from a **prior** or from **observed** data. The model writes only the narrative around numbers that code produced, which matches the existing rule "Counts in code, never by the model" in `src/lib/moves/scoreboard.ts`.

### A. Data model additions (needed before most rules work)

- `Deal.closeDateHistory: {at, from, to, by}[]` and `Deal.amountHistory: {at, from, to}[]`. Append on every edit. The push signals need these.
- `Deal.forecastCategory` (derived) plus `categoryOverride?: {value, reason, at}`. Overrides are scored later.
- `Deal.stageHistory` exists. Derive `daysInStage`, `stageEnteredAt` and `decidedAt` (won/lost/no-decision).
- `Activity.side: "buyer" | "seller"` drives *ghosted*; `reply_received` and `meeting_held` already imply buyer activity. `Person.seniority: "ic" | "manager" | "director" | "vp" | "c_level"` drives *no power*.
- `Deal.outcome` (won · lost_competitor · no_decision · disqualified · pilot_churn), `lossReasonSecondary`, `competitor`, `buyerQuote`. Extend `LossReason` with `no_compelling_event`, `value_not_proven`, `champion_left`, `eb_not_engaged`, `security_legal`, `indecision`.
- `PipelineSnapshot {weekOf, dealId, stage, amount, closeDate, category, call}`, written weekly and at weeks 3/6/9. Without snapshots there is no slip/loss/win attribution, accuracy score or week-3 conversion.
- `Plan {period, bookingsTarget, expansionShare, mix{motion: share}, acv{motion}, priors{motion: {tof, qual, win, cycleDays}}}` and `Rep {start, type, rampVector}`.

### B. Planning rules (defaults ship as priors)

| # | Rule / formula | Default | Data |
|---|---|---|---|
| B1 | Reverse waterfall per motion (§1.1). Output weekly targets for intro asks, leads, contacts, meetings and qualified opps, plus pipeline $ to create | Priors from §1.3. Warm: tof .50 / qual .60 / win .35. Inbound: .60 / .45 / .25. Outbound: .025 / .30 / .15. Events: .15 / .35 / .20 | Prior until replaced (B3) |
| B2 | When the user sets no target, compute the target **as an output** of their capacity (09 §3.1) | — | — |
| B3 | Blend `rate = (k_obs + p0·10) ÷ (n_obs + 10)` per motion and stage. Show prior, observed and blended | k = 10 pseudo-deals | Switch to observed at `n_decided ≥ 30`, or when the 80% Wilson interval excludes p0 |
| B4 | Sales velocity `V = opps × win × ACV ÷ medianCycleDays`. Show the weekly Δ per lever | — | Observed, using blended win until n ≥ 30 |
| B5 | Channel efficiency per source `win × ACV ÷ cycle`, indexed to the company average | Ebsta prior index: partner 1.3, inbound 1.2, outbound 1.05, events .78, paid .68 | Needs ≥10 decided per source |
| B6 | Required start coverage `= 1 ÷ week-3 conversion`. Fall back to 1/blended win rate (labeled as such) until ≥2 quarters of snapshots | 3.0x | Snapshots |
| B7 | Expansion planned separately | Prior win .45, cycle 0.57× new-logo cycle | Observed once ≥5 expansion deals |

### C. Forecast rules

- **C1 Category derivation** (the user can override, with a reason):

  | Category | Rule |
  |---|---|
  | Omitted | Stage `talking`, no close date, or `nurture` |
  | Pipeline | Qualified, but close date outside the period or ≥2 commit criteria missing |
  | Best case | Close date in period, champion ≥ untested, **and** ≤1 commit criterion missing |
  | Commit | Stage ≥ `proposal` (or `pilot` with signed conversion terms) + EB engaged + MAP with signature date ≤ period end + decision/paper process captured + buyer-agreed next step ≤14 days + no ghosted flag + no close-date push in the last 30 days |

- **C2 Floor, call and ceiling:** floor = closed + commit; ceiling = floor + best case; call = closed + Σ p_cat × amount. Default p is commit **.90**, best case **.50**, pipeline **.15** (in-period), omitted 0. Calibrate after 2 quarters of snapshots.
- **C3 Triangulation panel:** the user's call vs. stage-weighted EV vs. category-weighted EV vs. week-3 conversion × week-3 pipeline (the last once ≥4 quarters exist). Highlight any bearing >15% from the call. Default stage priors: talking .08, qualified .25, pilot .60, proposal .65. Never HubSpot's 20/40/60/80/90.
- **C4 P(hit plan):** Monte Carlo (10,000 draws) of independent Bernoulli deals using calibrated probabilities. Show P10/P50/P90 and P(≥ plan), labeled "assumes deals are independent".
- **C5 Accuracy:** store the call at weeks 1/3/6/9, and compute `accuracy = 1 − |call − actual| ÷ actual` per method and for overrides. Badge within ±10% at week 6 as good and ±5% as excellent. After 2 quarters, tell the user which bearing has been most accurate for them.
- **C6 The Monday forecast move** opens with the Δ since last week (new or removed commits, pushes, amount changes), then the commit deals, then a one-paragraph narrative the model drafts from code-computed facts.

### D. Deal risk rules (additive, explainable; replaces a black-box score)

| Flag | Trigger (defaults) | Points |
|---|---|---|
| Overdue | `closeDate < today` | 3 |
| Ghosted | No buyer-side activity > **4 days** (cycle <45d or late stage) / **7 days** (long cycle, early stage) | 3 |
| No activity | No activity either side > **7 / 14 days** (same split) | 2 |
| Next step | Missing, past, or not buyer-agreed | 2 (1 if not buyer-agreed) |
| Pushed | ≥2 pushes, or cumulative push ≥ **21 days**, or pushed across a period boundary | 2 (also forces Commit → Best case for 30 days) |
| Stalled | `daysInStage > 2 × median won-deal days for that stage` (1 point at >1.5×). Prior median = medianCycle × stage share (qualified .30, pilot .30, proposal .20, talking→qualified .20) | 2 / 1 |
| Thin threading | <2 active buyer contacts at qualified; <3 at pilot/proposal | 2 |
| No power | No Director+ buyer contact active in the last 30 days and close ≤ 30 days away | 2 |
| No EB by proposal | `card.economicBuyer.engaged !== true` at stage ≥ proposal | 2 |
| Pricing silent | Close ≤ 30 days and no `priceQuotes` entry | 1 |
| Slow reply | Buyer reply unanswered > **24h** | 1 |
| Scope cut | Amount ↓ ≥ 20% | 1 |

- **Bands:** 0–2 healthy, 3–4 watch, ≥5 at risk. Always show which flags fired and the one-line fix.
- **Review agenda:** rank by `amount × points`, pick the top 3–5 plus 1 upside deal, and attach only the §3.4 questions their flags trigger.
- **Data:** thresholds are priors from Gong and Ebsta. Medians switch to observed after ≥8 won deals per stage.
- **Weights need data:** after ≥30 decided deals, fit a logistic regression and show whether each flag actually predicted losses for *this* company. Retire flags that don't.

### E. Pipeline, WBR and board generators

- **E1 Pipeline creation pace:** weekly target $ = next-period new-logo target ÷ blended conversion ÷ weeks. Flag when trailing 4-week creation is < **80%** of pace, and show it by source.
- **E2 Coverage panel:**
  - to-go coverage (target 3.0x prior);
  - next-quarter coverage, tracked weekly, flagged at < 2.0x by week 9 (InRoad heuristic; calibrate);
  - the this/next/all-quarter table with automatic slip/loss/win attribution;
  - if median cycle is < 45 days, switch to monthly coverage and show the create-and-close share.
- **E3 Sandbag and hygiene check:**
  - if more than 40% of quarter bookings weren't in the week-3 snapshot → "close dates aren't predictive";
  - "flat pipeline across snapshots" → "scrub didn't happen";
  - the % of open deals with a future close date, amount, dated next step and ≥2 contacts, shown as a **data-trust score**.
- **E4 WBR doc** (Wednesday, 30 min, §4.2 structure): 6-week trend + trailing quarters for ≤ **6 input metrics** (Norton). The model writes "nothing to see here" or an exception line per metric from code-computed deltas. Last week's open items come first.
- **E5 Board GTM section** (quarterly, Battery's 5 slides, drafted ~2 weeks after quarter close): the forecast as a range with its method and one honest yellow or red item. Activity metrics and n < 10 rates are excluded.
- **E6 Investor update GTM block** (monthly): 3 KPIs with % change, pipeline created, highlights and lowlights, and 1–3 asks naming the specific target accounts that need intros.

### F. Win/loss rules

- **F1 Closing a deal** requires an outcome and a primary reason. Secondary reason, competitor and buyer quote are optional. "No decision" is an outcome, never a reason.
- **F2 Interview move:** schedule it **14–42 days** after `decidedAt`. Draft the ask (from someone other than the rep where possible) and generate the 30-minute guide from the deal's card gaps.
- **F3 Monthly Voice of the Buyer:** once ≥5 decided deals exist, list the top drivers and blockers with quotes, each with an owner and a due date.
- **F4 Pattern alerts** use the §5.4 gates: a segment's shrunk win rate < ½ overall with n ≥ 8; one reason ≥ 30% of ≥5 losses; no-decision ≥ 40% of losses. Each alert proposes one ICP, qualification, asset or messaging change, logged to the Playbook journal.
- **F5 Reason-vs-interview disagreement:** show how often the interview contradicted the CRM reason. Clozd's prior is that only ~15% match.

### G. Capacity rules

- **G1 RRE model:** ramp vector default `[0, .25, .5, .75, 1]` per quarter; steady-state productivity prior is the user's own closed history, else **0.63 × median quota** (Everstage average attainment); over-assignment **20%**; turnover modeled explicitly.
- **G2 Hire-by date** = need date − **(60 days recruiting + ramp)**. Warn when a plan relies on hires starting less than 2 quarters before the revenue is needed.
- **G3 Pipeline vs. capacity diagnosis:** fewer than 10 active qualified opps per AE with coverage below target → "pipeline problem; don't hire". More than 20 per AE with coverage at or above target → "capacity problem; hire".
- **G4 SDR math:** outbound meetings needed ÷ **10 held/month** = SDR-months. Recommend SDRs only after outbound converts for AEs (Blond).
- **G5 Rep ramp chart:** quarters of tenure × productivity for every rep, including departed reps, once ≥2 reps exist.

### H. Trust and small-n rules (extending `sampleLabel` in `src/lib/moves/scoreboard.ts`)

- **H1 Deal-level rates** (win and stage conversion): always show counts ("3 of 9 decided"). Show a % only at `n_decided ≥ 10`, with an 80% interval, labeled "directional" at 10–29 and "solid" at ≥30. Reply-rate thresholds (20/100) stay as they are.
- **H2 Provenance badge** on every number: Prior (with its source), Blended (k=10), or Observed (n).
- **H3 Definitions drawer:** one versioned definition per metric (formula, inclusion rules, owner). Changing a definition puts a "definition changed on {date}" marker on its charts.
- **H4 Click-through:** every metric opens the exact deals behind it.
- **H5 Honest red:** the WBR and board drafts must include the worst-moving metric, even when everything else is green.

### I. Which defaults ship as priors vs. need real data

| Needs nothing (ships day 1) | Prior, replaced by the user's data | Needs history; hidden until present |
|---|---|---|
| Overdue, next-step, ghosted / no-activity (Gong thresholds), pushes ≥21d, slow reply, pricing silent, thin threading, no EB | Motion conversion rates (B1/B3), stage probabilities (C3), category weights (C2), stage-duration medians (D), steady-state productivity (G1), ramp vector, coverage target 3.0x | Week-3 conversion (≥2 quarters of snapshots), forecast accuracy by method (≥2 quarters), flag-weight regression (≥30 decided), segment win/loss patterns (≥8 per segment), rep ramp chart (≥2 reps, ≥4 quarters) |

### J. What would most impress a Head of GTM

1. **A forecast they can defend in the board room.** Floor, call and ceiling come from evidence-based categories, with four bearings side by side plus P(hit plan), and their own accuracy tracked by method and by override. This answers the "24% trust reps' commits" problem with evidence.
2. **A five-minute Monday brief that does the RevOps work.** Slip/loss/win attribution and to-go and next-quarter coverage are computed from snapshots. Pushed, ghosted and stalled flags use Gong-grade thresholds. The brief names the 3–5 deals to review, each with only the questions its gaps trigger.
3. **An honest plan that becomes their own.** The reverse waterfall by motion starts on labeled priors and visibly converts to their observed rates, with n and intervals. The RRE capacity model says months ahead whether the gap is pipeline or headcount: "hire by March or this $1.1M doesn't land."
