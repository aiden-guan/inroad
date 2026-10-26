# Consumer Monetization, Pricing, Unit Economics and DTC Channel Mix (early-stage, US-first; status as of Oct 26, 2026)

*How these notes were made:* The egress proxy blocked direct page fetches for almost every host (revenuecat.com, adapty.io, superwall.com, ftc.gov, sec.gov, a16z.com, lennysnewsletter.com, klaviyo.com, littledata.io, shopify.com, support.google.com, courts and legislatures). Only developer.apple.com could be fetched, so Apple's fee and guideline facts come from Apple's own live pages, read on Oct 26, 2026. Everything else comes from search-engine summaries of the cited pages, not from reading the full pages, and should be spot-checked against the originals before Inroad hard-codes it. The shared web-search budget (200 calls per turn) ran out partway through, so a few sub-topics are listed as Gaps. "Vendor" marks data from companies that sell monetization or marketing tools, measured on their own customers.

## 1. Subscription apps: paywalls, trials, conversion, plan mix, prices, refunds, retention, store fees, web checkout

### Takeaway
Vendor data (RevenueCat 2026, about 115k apps) shows hard paywalls convert about 5x better than freemium by Day 35 (10.7% vs 2.1%). Yet one-year retention is nearly identical (27% vs 28%), so most annual subscribers churn in year one, and LTV has to be modeled on roughly 25–30% annual renewal, not on folklore. On fees, small developers pay Apple 15% (SBP), and subscriptions pay 15% after a subscriber's first paid year. In the US storefront, apps can now link to web checkout with no Apple commission until a court sets one, and the Supreme Court is reviewing the contempt ruling (No. 25-1311). Google's Epic settlement cut Play subscription fees to 10%, with an optional 5% billing fee, from June 30, 2026 in the US, UK and EEA.

### Cited Findings

**Datasets and methodology (vendor)**
- RevenueCat *State of Subscription Apps 2026* (released Mar 10, 2026): about 115,000 apps, more than $16B in revenue, 1B+ transactions. Almost all iOS/Android consumer subscription apps on RevenueCat's platform (vendor; skews toward indie and SMB apps using its SDK) — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps); [SaaStr summary](https://saastr.com/the-top-10-learnings-from-revenuecats-state-of-subscription-apps-how-115000-mobile-apps-deliver-16b-in-revenue-whats-working-whats-quietly-killing-growth)
- Adapty *State of In-App Subscriptions 2026*: 16,000+ apps and about $3B in revenue processed through Adapty (2025 data). Adapty's paywall data covers 105,000 paywalls (vendor). Two non-Adapty vercel mirrors give $2.2B, but the official pages and press say $3B — [Adapty SOIAS 2026](https://adapty.io/state-of-in-app-subscriptions/); [PPC Land](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)

**Paywall placement: hard paywall vs freemium**
- RevenueCat 2026: median Day-35 conversion is 10.7% for hard-paywall apps vs 2.1% for freemium apps. Hard-paywall conversion fell from 12.1% in the 2025 edition. Secondary write-ups variously call this "trial-to-paid" and "download-to-paid". The D35 framing suggests install-to-paid within 35 days, so confirm the definition in the report — [RevenueCat 2026 blog summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026); [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- RevenueCat 2026: after one year, freemium apps keep 28% of yearly subscribers and hard-paywall apps keep 27%. The report calls the gap statistically negligible — [RevenueCat 2026 blog summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- Hard-paywall apps earn about 8x the revenue per install of freemium apps ($3.09 vs $0.38 at Day 60). This is a third-party summary; which edition it comes from is unclear — [RocketShip HQ summary](https://www.rocketshiphq.com/revenuecat-state-of-subscription-apps-2025-summary/)
- Adapty *State of Paywalls 2026* (vendor): onboarding paywalls convert 0.85% of views to paid vs 0.23% for paywalls shown later. 93% of first purchases happen on install day, yet later (non-onboarding) paywalls still produce 38% of subscription revenue — [Adapty State of Paywalls](https://adapty.io/state-of-paywalls/)
- Adapty (vendor): the median US app converts 2.75% paywall-to-paid within 30 days. Onboarding paywalls with a trial convert 1.35% vs 0.89% for in-app paywalls — [Adapty blog](https://adapty.io/blog/high-performing-paywall-2026/)
- Superwall (vendor; Feb–May 2026, 40M+ onboarding paywall opens): multi-page onboarding paywalls converted 12.41% vs 9.07% for single-page, a 37% relative lift. Multi-page flows were only 24% of opens — [Superwall](https://superwall.com/blog/new-postmulti-page-onboarding-paywalls-convert-37-better-than-single-page-heres-why)
- RevenueCat (2025 podcast/launch material): 80% of trial starts happen on day one (install day) — [RevenueCat Sub Club 2025](https://www.revenuecat.com/blog/growth/sosa-2025-launch-sub-club)

**Free-trial length**
- RevenueCat 2026: trials of 17–32 days had a median trial-to-paid rate of 42.5% vs 25.5% for trials under 4 days, about 70% higher. Even so, about 46% of apps (per the summary's wording) are moving to trials of 4 days or fewer — [RevenueCat 2026 blog summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- RevenueCat 2026: more than half of trial cancellations happen on Day 0. For 3-day trials, 55% of cancellations happen on Day 0 — [RevenueCat 2026 blog summary](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026); [ARPU Brothers](https://arpubrothers.com/blog/revenuecat-subscription-app-report-2026/)
- Adapty 2026 (vendor): subscribers who came through a trial retain at 59.2% at the first renewal (R1) vs 37% for direct buyers. By R5 the trial cohort's retention is 70% higher — [PPC Land on Adapty](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)
- RevenueCat has also published a contrarian post questioning free trials for some UA strategies (not read in full) — [RevenueCat blog](https://www.revenuecat.com/blog/growth/free-trials-dont-make-sense-anymore)

**Plan mix, price points and retention by plan**
- RevenueCat 2025 launch post: "cheap annual plans retain up to 36% of users after a year, while high-priced monthly plans retain just 6.7%" — [RevenueCat 2025 launch](https://www.revenuecat.com/blog/company/the-state-of-subscription-apps-2025-launch)
- About 72% of annual subscriptions churn in year one, i.e. about 28% renew (third-party summary of RevenueCat 2025) — [RocketShip HQ](https://www.rocketshiphq.com/revenuecat-state-of-subscription-apps-2025-summary/)
- Adapty 2026 (vendor): monthly subscribers retain at 2x the rate of weekly subscribers after 12 months — [PPC Land on Adapty](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)
- RevenueCat 2025: 35% of apps mix subscriptions with consumables or lifetime purchases (hybrid monetization) — [RevenueCat 2025 launch](https://www.revenuecat.com/blog/company/the-state-of-subscription-apps-2025-launch)
- RevenueCat 2026: Health & Fitness has the highest realized LTV per payer, with a median of $24.23 at 1 month and $35.64 at 1 year — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- Adapty 2026 (vendor): install LTV is highest in Health & Fitness ($1.20), followed by Utilities ($1.10). Annual Health & Fitness pricing varies 4.4x by country (Germany vs Turkey) — [PPC Land on Adapty](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)
- Unverified price bands from a third party with no attribution: weekly $4.99–6.99, monthly $7.99–9.99, annual $29.99–39.99. **Folklore-grade, do not encode** — [Consumoteca](https://consumoteca.com.co/articles/en/revenuecat-recurring-subscriptions-explained-platform-pricing-and-2026-benchmarks)
- RevenueCat publishes renewal rates by category (11 categories) and plan length (weekly, monthly, annual). The table itself was not retrieved — [RevenueCat renewal rates](https://www.revenuecat.com/blog/growth/average-subscription-renewal-rates-by-app-category)
- Apple launched "monthly subscriptions with a 12-month commitment" on Apr 27, 2026 (users pay monthly, are committed for 12 months, and Apple sends renewal reminders). **Not available in the US or Singapore** — [Apple Developer News](https://developer.apple.com/news/); [Apple subscriptions page](https://developer.apple.com/app-store/subscriptions/)

**Experiments**
- Adapty 2026 (vendor): locale tests (translation and currency) delivered the highest LTV uplift (62.3%). Price-change tests ranked last on both metrics (45.5% LTV uplift, 28.3% conversion uplift). The metric definition, such as average uplift among winning tests, was not visible in the summary — [PPC Land on Adapty](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)

**Refunds**
- RevenueCat 2026 defines refund rate as the share of paid subscriptions refunded in their first billing period. Productivity has the highest median (4.7%) and Travel the lowest (2.5%). Most categories fall at 3–4%, with outliers at 9–18%. By region, IN/SEA has a median of 7.7% and North America 3.4% — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps)
- RevenueCat 2025: roughly 2–5% of payers claim a refund, with higher rates in Health & Fitness and Education. The median is 5.8% for hard-paywall apps vs 3.4% for freemium — [RevenueCat SOSA 2025](https://www.revenuecat.com/state-of-subscription-apps-2025)
- Case (vendor): Dipsea's refund rate fell from about 3% to 1.9% within 15 days after it automated responses to Apple refund-consumption requests — [RevenueCat blog](https://www.revenuecat.com/blog/company/handle-apple-refund-requests-automatically)

**Outcome distribution (base rates for founders)**
- RevenueCat 2026: the top 25% of apps grew 80% YoY while the bottom 25% shrank 33%. Median MRR growth was 5.3%. Only 17.3% of new apps reach $1K MRR within two years, and 4.6% reach $10K MRR. Monthly subscription-app launches rose from about 2,000 (Jan 2022) to 14,700 (Jan 2026). Apps launched in 2025 or later earn about 3% of subscription revenue, and pre-2020 apps earn 69% — [RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps); [DEV summary](https://dev.to/axrisi/app-economy-2026-why-new-apps-get-3-of-subscription-revenue-3cj8)
- Adapty 2026 (vendor): 95% of subscription revenue goes to the top 10% of apps. Among new apps, 57.7% earn under $1K in total, 22.4% earn $1K–10K, 12% earn $10K–100K, and 7.9% earn more than $100K — [PPC Land on Adapty](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)
- RevenueCat 2026, AI apps: 41% more revenue per payer, but they churn 30% faster. A secondary write-up puts annual retention at about 21% for AI apps vs about 31% for non-AI apps — [DEV summary](https://dev.to/klukyanov/ai-apps-earn-more-but-lose-subscribers-faster-3d6l); [AIbase](https://www.aibase.com/news/26101)
- Unreconciled secondary figures: median app monthly revenue of about $72 one year after launch, and median year-one realized LTV per payer of $23 — [DEV summary](https://dev.to/axrisi/app-economy-2026-why-new-apps-get-3-of-subscription-revenue-3cj8); [ARPU Brothers](https://arpubrothers.com/blog/revenuecat-subscription-app-report-2026/)

**Apple fees (primary; Apple pages read Oct 26, 2026)**
- App Store Small Business Program: a 15% commission on paid apps and IAP for developers with up to $1M in proceeds in the prior calendar year (and new developers). Crossing $1M in the current year moves future sales to the standard rate. A developer can re-qualify the year after dropping back below $1M. Associated developer accounts must be declared — [Apple SBP](https://developer.apple.com/app-store/small-business-program/)
- Auto-renewable subscriptions: the developer receives 70% during a subscriber's first year of paid service and 85% after one year of paid service. Free trials and renewal extensions do not count as paid days. Paid days resume if the subscriber renews within 60 days. SBP members receive 85% from day one — [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/)
- Guideline 3.1.2(a): subscription periods must be at least 7 days. Guideline 3.1.1(a) / 3.1.3 (Guidelines last updated Oct 16, 2026): "These entitlements are not required for developers to include buttons, external links, or other calls to action in their United States storefront apps." The anti-steering prohibition applies "in all other storefronts, except for the United States storefront" — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- EU: Apple's new single EU business terms took effect Oct 1, 2026 (announced Aug 18, 2026). The Core Technology Fee is replaced by a 5% "Core Technology Commission" on digital transactions in apps distributed outside the App Store. The Initial Acquisition Fee and Store Services Fee are eliminated, and apps may offer alternative payments alongside IAP — [Apple Developer News](https://developer.apple.com/news/)

**US web checkout / Epic v. Apple status**
- On Dec 11, 2025 the Ninth Circuit affirmed the April 2025 civil-contempt finding and largely upheld the remedies. It vacated the complete ban on commissions for linked-out purchases and remanded: Apple may charge some fee, but it must be limited and tied to Apple's costs or services — [Cravath](https://www.cravath.com/news-insights/epic-games-ninth-circuit-win-affirming-civil-contempt-finding.html); [Digital Policy Alert](https://digitalpolicyalert.org/event/39719-us-court-of-appeals-for-the-ninth-circuit-affirmed-contempt-finding-and-remanded-on-commission-rate-in-epic-games-v-apple)
- Rehearing en banc was denied Mar 30, 2026. Apple filed its cert petition May 21, 2026, and the Supreme Court granted cert on Jun 30, 2026 (No. 25-1311, on whether the "spirit" of an injunction can be enforced through contempt). Apple filed its merits brief Sep 14, 2026 — [Apple 10-Q (Jun 27, 2026)](https://www.sec.gov/Archives/edgar/data/0000320193/000032019326000020/aapl-20260627.htm); [IPWatchdog](https://ipwatchdog.com/2026/06/30/high-court-grants-cert-in-apples-challenge-to-ninth-circuit-contempt-ruling-in-app-store-dispute/); [Apple merits brief](https://www.supremecourt.gov/DocketPDF/25/25-1311/424150/20260914154510009_2026-09-14%20No.%2025-1311%20Apple-Epic%20Merits%20Opening%20Brief.pdf); [Oyez](https://www.oyez.org/cases/2026/25-1311)
- Secondary sources: the US link-out fee stays at 0% until the district court sets one on remand. Apple has reportedly proposed up to 15%, with 10% for some categories and 5% for small businesses, and Epic objects to any rate above zero. A Supreme Court ruling is expected around mid-2027 — [AppCoding](https://appcoding.com/apples-us-link-out-fee-is-zero-until-a-judge-sets-it-and-apple-is-asking-for-up-to-15/); [AppleInsider, Aug 13, 2026](https://appleinsider.com/articles/26/08/13/apples-latest-commission-rates-for-external-app-store-purchases-havent-satisfied-epic); [Courthouse News](https://www.courthousenews.com/apples-fight-over-commissions-for-linked-out-app-store-purchases-continues-in-federal-court/)
- Secondary/vendor sources on operating rules: IAP must remain available alongside the link. Existing Apple-billed subscribers cannot be migrated to web billing unless they cancel and resubscribe — [Paddle](https://www.paddle.com/blog/apple-vs-epic-app-store-changes); [RevenueCat](https://www.revenuecat.com/blog/growth/apple-anti-steering-ruling-monetization-strategy)
- Superwall's early app-to-web test (vendor, mid-2025): initial conversions fell about 11.9% on web checkout, while net proceeds rose about 19.85% — [Superwall](https://superwall.com/blog/initial-data-is-in-app-to-web-conversion-rates-after-the-app-store-ruling)
- Break-even analysis: with Stripe-style 2.9% + $0.30 processing, web checkout needs about 90% of the in-app conversion rate to break even vs a 15% Apple fee — [Built by Foundry](https://www.builtbyfoundry.io/blog/app-link-out-checkout-6-rates-2026)

**Google Play fees**
- On Mar 4, 2026, Google settled with Epic. The standard in-app purchase service fee drops to 20%, subscriptions drop to 10%, and use of Google Play Billing carries a separate optional 5% fee. The rollout starts Jun 30, 2026 in the US, UK and EEA and completes globally by Sep 30, 2027. Reports differ on first-$1M tiers and program-specific 15% rates, and court approval status should be checked — [TechCrunch](https://techcrunch.com/2026/03/04/google-settles-with-epic-games-drops-its-play-store-commissions-to-20); [AlternativeTo](https://alternativeto.net/news/2026/3/google-and-epic-settlement-ends-30-play-store-fees-and-eases-third-party-app-store-rules); [iClarified](https://www.iclarified.com/101291/google-opens-play-store-to-alternative-payments-under-epic-settlement); [PricePush](https://pricepush.app/blog/google-play-subscription-fees-2026-real-math)
- Google's Play Console help page (possibly stale snapshot): 15% on the first $1M in annual earnings, and 15% on auto-renewing subscriptions "regardless of revenue earned" — [Play Console Help](https://support.google.com/googleplay/android-developer/answer/112622?hl=en)

### Inferences
- **Encodable LTV model for app subscriptions.** Net price = list price × (1 − store fee − tax). The store fee is 15% for SBP and Play subscriptions; for non-SBP Apple developers it is 30% in year 1 and 15% after. Gross margin = net price − variable cost (meaningful for AI apps with inference cost). For annual plans, LTV ≈ net annual price × Σ rⁱ with r ≈ 0.27–0.36 (RevenueCat). That gives about 1.4x the first-year net price, not "multi-year" LTV. Default to realized cohort LTV (cumulative net revenue per payer at D30/D365) over formula LTV pre-Series A.
- **Paywall rule.** For new apps, start with an onboarding paywall: 93% of first purchases happen on install day (Adapty), and hard paywalls show about 5x D35 conversion with equal one-year retention (RevenueCat). Keep a secondary in-app paywall too, since later paywalls still drive 38% of revenue (Adapty).
- **Trial-length rule.** Don't default to 3-day trials because they're popular. 2026 data shows 17–32 day trials convert about 70% better at trial-to-paid, and Day-0 cancellation is heavy on short trials. Recommend an A/B test of trial length, measuring revenue per install at D35/D60 rather than trial-to-paid alone, because longer trials delay cash and lower trial-start rates.
- **Plan-mix rule.** Push back on weekly-plan-heavy and high-priced-monthly-heavy mixes for products meant to build LTV. Monthly plans retain 2x weekly (Adapty), and high-priced monthly plans retain about 6.7% at one year (RevenueCat 2025).
- **Web checkout rule (US).** The current fee on link-outs is 0% pending remand. Web checkout pays off if web conversion is at least about 90% of IAP conversion vs a 15% fee, or at least about 74% vs a 30% fee (derived: $8.50/$9.41 and $7.00/$9.41 on a $10 sale). Flag the regulatory risk: a court-set commission (Apple has reportedly asked for up to 15%) and the Supreme Court case could change this in 2027.
- **Base-rate realism.** Only 17.3% of new subscription apps reach $1K MRR within two years (RevenueCat). Inroad should treat "paid UA before proving organic conversion" as high-risk.

### Gaps
- Exact metric definition for RevenueCat's 10.7%/2.1% (download-to-paid vs trial-to-paid) and the full category tables: median price by plan length and category, annual vs monthly share of revenue, install-to-paid by category and region. The primary page could not be fetched.
- iOS vs Android refund split, not found.
- Current court-approval status of the Google settlement and the exact first-$1M tier rules. Google's own pages were blocked.
- The district court's remand decision on Apple's US link-out commission. No ruling setting a rate was found as of the research date. Supreme Court argument date not found.
- No independent (non-vendor) dataset on web-checkout conversion after the injunction.

## 2. Freemium consumer software: free-to-paid conversion, reverse trials, usage limits

### Takeaway
The "2–5% freemium" folklore traces mostly to B2B SaaS benchmarks: Lenny Rachitsky/Kyle Poyar 2023 (3–5% good, 6–8% great for self-serve freemium) and ChartMogul/Poyar. For consumer apps, the relevant numbers are RevenueCat's freemium D35 median of 2.1% and Duolingo's best-in-class ~9% paid subscribers / MAU (Q2 2026). Reverse-trial data is thin and B2B-centric.

### Cited Findings
- Lenny Rachitsky with Kyle Poyar (2023; 1,000+ products, mostly B2B/prosumer SaaS). The metric is the share of new accounts paying within 6 months, measured by cohort. Freemium self-serve: 3–5% good, 6–8% great. Freemium with sales assist: 5–7% good, 10–15% great. Free trial: 8–12% good, 15–25% great — [Lenny's Newsletter](https://www.lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion)
- ChartMogul conversion report (Poyar): reverse trials are "good" at 4–6% and "great" at 8–12%. The sample is small and the difference vs other models is not statistically significant. Credit-card-required trials convert about 30%, more than 5x opt-in trials. The summary lists freemium "great" as 8–12%, which conflicts with Lenny's 6–8% — [ChartMogul](https://chartmogul.com/reports/saas-conversion-report/); [Userpilot](https://userpilot.com/blog/freemium-to-premium/)
- Signup funnel trade-off (Poyar, 2026, via Userpilot): per 1,000 website visitors, freemium products generate 90 signups vs 45 for free-trial products. A later analysis of 200 B2B products reportedly gives a median of 8% (secondary, unverified) — [Userpilot](https://userpilot.com/blog/freemium-to-premium/)
- Poyar's early argument for "reverse trials" (full features for a limited time, then a downgrade to free) — [TechCrunch, Nov 2022](https://techcrunch.com/2022/11/12/freemium-or-free-trials-why-not-both/)
- Opt-out (card-required) trial conversion of 30–40% good and 50%+ great appears in a secondary table, **not verified** against Lenny's post — [Lenny's Newsletter (search summary)](https://www.lennysnewsletter.com/p/what-is-a-good-free-to-paid-conversion)
- Consumer mobile freemium: RevenueCat 2026 median D35 conversion for freemium apps is 2.1% (vendor) — [RevenueCat 2026 blog](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- Duolingo (public company, primary): Q2 2026 paid subscribers of 12.7M (+17% YoY) on 140.6M MAU, about 9.0% (my calculation). Q1 2026: 12.5M / 137.8M ≈ 9.1%. Q2 2025: 10.9M / 128.3M ≈ 8.5%. Q1 2025: 10.3M / 130.2M ≈ 7.9%. Paid subscribers exclude free-trial users. MAU is a quarterly average and subscribers are counted at period end, so the ratios are approximate — [Duolingo Q2 2026 letter](https://investors.duolingo.com/static-files/3c8277ee-bc94-4f5d-9b77-0db3e46f88b8); [Duolingo Q1 2026 letter](https://investors.duolingo.com/static-files/aab30d54-eb91-422e-b365-c03859fea85c); [SEC 8-K Q2 2026](https://www.sec.gov/Archives/edgar/data/0001562088/000162828026053299/q2fy26duolingo6-30x26share.htm)

### Inferences
- **Encodable benchmark ladder for consumer freemium (free → paid).** Paying users / MAU: under 2% is weak, 2–5% is typical, and about 8–9% is best-in-class at scale (Duolingo). Install-to-paid by D35 for freemium apps has a median of about 2% (RevenueCat). Label B2B 3–5% / 6–8% figures as "SaaS reference, not consumer".
- Inroad should insist the founder state which denominator they mean (installs, signups, MAU or trial starts) and the window (D35, 6 months), because benchmarks differ by about 10x across definitions.
- Usage-limit freemium (caps on core actions) is effectively a soft paywall. Where the metered unit has real marginal cost, as with AI apps, the 2026 data on AI apps' higher revenue per payer and faster churn suggests pairing limits with annual plans.

### Gaps
- No consumer-specific reverse-trial dataset found. Kyle Poyar's Growth Unhinged and Elena Verna's reverse-trial data were not retrieved (blocked host, then search budget exhausted).
- No primary data on usage-limit designs (message caps, export limits) and their conversion effects for consumer apps.
- Spotify and other consumer freemium paid-ratio comparables were not gathered.

## 3. Consumer unit economics: CAC, blended vs paid CAC, LTV formulas, LTV:CAC and payback thresholds

### Takeaway
The 3:1 LTV:CAC and under-12-month payback rules trace to David Skok (SaaS Metrics, ~2010) and B2B SaaS benchmarks (Bessemer, Benchmarkit). I found no sourced, consumer-investor-specific payback threshold in this pass. Inroad should therefore make the payback threshold a founder-set parameter (default 12 months, stricter for DTC and annual-plan apps) and compute payback on contribution margin, not revenue.

### Cited Findings
- The 3:1 LTV:CAC rule is credited to David Skok's "SaaS Metrics 2.0" (Matrix Partners, ~2010). It was a guideline from mature SaaS companies, "a rule of thumb, not an empirical dataset", not meant for pre-PMF companies (secondary descriptions; the original was not retrieved) — [Foundry CRO](https://foundrycro.com/blog/ltv-cac-ratio-benchmarks-2026/); [Zulu Method](https://www.thezulumethod.com/saas-ltv-cac-ratio-benchmarks)
- Skok's guidance is commonly cited as recovering CAC in under 12 months. Bessemer's portfolio targets: under 12 months for SMB, under 18 for mid-market, under 24 for enterprise. Benchmarkit's median was 16 months on 2025 data (all B2B SaaS) — [Marqeable](https://www.marqeable.com/blog/cac-payback-period-benchmarks); [SaaS Hero](https://www.saashero.net/strategy/good-cac-payback-period/)
- The 12-month payback and 3:1 LTV:CAC rules only agree when customers stay about 36 months (secondary argument) — [Scalehackerlab](https://www.scalehackerlab.com/blog/cac-payback-ltv-smb-guide)
- An agency argument that "12 months fails consumer tech", with a subscription-hardware model at 1.2–2.2% monthly churn implying a 15–28 month payback ceiling (single-agency illustration, not an investor standard) — [Darkroom](https://www.darkroomagency.com/observatory/cac-payback-period)
- Point Nine Capital's method piece on computing CAC payback (VC source; not read in full) — [Point Nine](https://medium.com/point-nine-news/the-art-and-science-of-figuring-out-your-cac-payback-time-c7d20808d51b)
- Blog claim (low reliability): pre-seed/seed LTV:CAC of 1.5–2:1 with payback "not yet critical"; bootstrapped companies need 4:1+ — [Foundry CRO](https://foundrycro.com/blog/ltv-cac-ratio-benchmarks-2026/)
- App-subscription retention inputs: about 27–28% one-year retention of annual subscribers (RevenueCat 2026), and AI apps about 21% vs non-AI about 31% (secondary) — [RevenueCat 2026 blog](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026); [AIbase](https://www.aibase.com/news/26101)

### Inferences
- **Formulas to encode** (standard definitions; the inputs are founder-supplied):
  - Paid CAC = paid media spend / customers attributed to paid. Blended CAC = total sales and marketing spend (including creators, seeding, agency, tools) / all new customers. Always show both, and show the gap (organic subsidy).
  - Subscription LTV (steady-state) = ARPU_net × GM% / monthly churn, where ARPU_net is after store fees, tax and refunds. Pre-Series A, prefer cohort realized LTV at 12 months (sum of net contribution per payer), because churn isn't stable.
  - DTC LTV = AOV × orders per customer over horizon H × CM2%. Prefer cumulative contribution per cohort at 90/180/365 days, using the repeat curves in section 4.
  - CAC payback (months) = CAC / (monthly ARPU_net × GM%). For annual prepaid plans, also compute cash payback = first-charge net proceeds − CAC (it can be immediate).
  - DTC first-order profitability = AOV × CM2% − CAC. Negative is allowed only if the 90- or 180-day cohort contribution recovers CAC within the founder's threshold.
- **Push-back rules.** (a) Block "scale paid" advice when modeled contribution payback exceeds the founder's stated threshold (default 12 months), or when LTV uses a horizon longer than observed cohort data. (b) Flag LTV:CAC computed on revenue rather than margin. (c) Flag a 3:1 target applied with less than 6–12 months of cohort data. (d) For annual app plans, flag any LTV that assumes renewal above about 35% without the app's own data.

### Gaps
- No primary statements from named consumer investors (a16z consumer, Andrew Chen, Forerunner, Lerer Hippeau and others) on payback thresholds were retrieved. Do not attribute "consumer VCs require X-month payback" to anyone until sourced.
- Skok's original post and any a16z consumer metrics essay (for example "16 metrics" or consumer-specific essays) were not read.

## 4. DTC / e-commerce economics: contribution margin layers, conversion, AOV, repeat, email/SMS, attribution, channel shifts, MER

### Takeaway
Encode DTC health as CM2 (after COGS, fulfillment and payment fees) and CM3 (after marketing). Use MER (total revenue / total marketing spend) as the blended steering metric, with break-even MER = 1 / CM2%. The benchmarks Inroad can cite are mostly vendor data: Shopify session conversion about 1.4% average (Littledata, 2023 data); 90-day repeat rate about 11–12% and 365-day about 19–20%; email about 27% of revenue on Klaviyo (vendor-attributed).

### Cited Findings

**Contribution margin layers**
- Common definitions: CM1 = net revenue − COGS. CM2 = CM1 − shipping, pick/pack, fulfillment and payment fees ("what most ecommerce operators mean by contribution margin"). CM3 = CM2 − marketing/ad spend. The labels are **not standardized**; some brands put shipping in CM1 or advertising in CM2 — [Polar Analytics](https://www.polaranalytics.com/post/contribution-margin-formula-for-ecommerce-how-to-calculate-it); [Hawk Digital](https://hawkdigital.au/insights/ecommerce-unit-economics-cm1-cm2-cm3); [Nouz](https://nouz.co/blog/cm1-cm2-cm3-explained)
- An agency blog attributes to Common Thread Collective a "healthy" CM3 of 20–35% of net sales for most DTC brands, with under 15% a danger zone. This is a secondhand attribution not confirmed on CTC's own site, and the search summary did not pin which page — [Hawk Digital](https://hawkdigital.au/insights/ecommerce-unit-economics-cm1-cm2-cm3); [Eightx](https://eightx.co/blog/calculate-contribution-margin-ecommerce)

**MER**
- MER = total revenue / total marketing spend across all channels in the same period. It is attribution-independent; a 4.0 MER means $4 of revenue per $1 of marketing. Daasity and Shopify treat MER as equivalent to "blended ROAS" — [Daasity](https://www.daasity.com/post/marketing-efficiency-ratio-mer); [Shopify](https://www.shopify.com/blog/marketing-efficiency-ratio)
- Convention conflict: Triple Whale defines MER as ad spend ÷ revenue (the inverse). MHI Growth Engine defines "blended ROAS" as attributed revenue ÷ ad spend, which makes it attribution-dependent and different from MER — [Triple Whale](https://www.triplewhale.com/blog/marketing-efficiency-ratio); [MHI Growth Engine](https://mhigrowthengine.com/blog/dtc-mer-guide/)
- Ranges cited by blogs: most DTC brands run 3.0–5.0x MER, and mature or subscription-led brands often exceed 6x. Worked example: a brand with 58% CM2 targets about 3–3.5x MER — [Eightx MER](https://eightx.co/blog/what-is-mer-marketing-efficiency-ratio); [MHI Growth Engine](https://mhigrowthengine.com/blog/dtc-mer-guide/); [Keends](https://keends.com/blog/marketing-efficiency-ratio/)

**Conversion rate (Shopify)**
- Littledata (vendor; 2023 data; about 2,800 Shopify stores with GA4 connected, each with ≥1,000 sessions and ≥90 purchases in a 90-day window). Outliers excluded: conversion outside 0.05–20%, checkout completion over 100%, AOV outside $5–5,000. Conversion is orders / sessions. Average 1.4%; top 20% above 3.2%; top 10% above 4.7%; mobile 1.2% vs desktop 1.9%; checkout completion 45% average (top 20% above 59%); food & beverage about 1.5%. The figure was still on Littledata's live page as of Sep 2026 (no newer dataset) — [Littledata](https://www.littledata.io/ecommerce-conversion-rate); [StorePilot](https://www.usestorepilot.com/blog/shopify-conversion-rate-benchmarks-2026/); [Fracto Solutions](https://fractosolutions.com/blog/ecommerce-conversion-rate-benchmarks-by-industry-2026/)

**Repeat purchase and time to second purchase**
- Adtribute panel of DTC brands (vendor, 2026): median 90-day repeat purchase rate 12.03%, down from 12.21% a year earlier — [Adtribute](https://www.adtribute.io/data/benchmarks/repeat-purchase-rate)
- By the Numbers (1,299 Shopify stores): median second-order rate 6.6% within 30 days, 11.4% within 90 days, 19.5% within 365 days — [By the Numbers](https://www.bythenumbersapp.com/blog/second-order-curve-follow-up)
- B&Co. (156,110 customers across multiple DTC brands in consumables, fashion and durables): 18.8% 365-day repeat rate. About half of repeat purchases happen within 30 days and three-quarters within 90 days — [B&Co.](https://bsandco.us/blog-post/repeat-purchase-rate-benchmarks)
- Eightx (agency): median time to second purchase is 15–35 days across verticals (apparel 15–27, supplements 27–68, durables 30+). The mean is 50–100+ days because of a long tail — [Eightx](https://eightx.co/blog/average-ecommerce-time-to-second-purchase-by-vertical-2026)
- Vendor guidance runs higher: Klaviyo cites a "good" repeat rate of about 20–30%, and Shopify says most stores show a returning-customer rate of 20–40%. Definitions differ: returning-customer share of orders is not the same as cohort repeat rate — [Adtribute (citing Klaviyo/Shopify)](https://www.adtribute.io/data/benchmarks/repeat-purchase-rate)

**Email/SMS (Klaviyo, vendor-attributed)**
- Klaviyo: email-attributed purchases made up about 27% of total store revenue on average (Q4 benchmark page; repeated as the "2025 benchmark" figure by secondary sources). This is Klaviyo's own attribution — [Klaviyo ecommerce benchmarks](https://www.klaviyo.com/marketing-resources/ecommerce-benchmarks); [SciGrowth](https://scigrowth.com/blogs/crm-marketing/email-revenue-share-benchmarks-dtc-2026)
- Klaviyo's 2026 email benchmarks cover 183,000+ Klaviyo customers (the revenue-share figure was not visible) — [Klaviyo 2026 benchmarks](https://www.klaviyo.com/products/email-marketing/benchmarks)
- SMS (2026 benchmarks via secondary sources): flows were 7.6% of SMS sends but 45.2% of SMS revenue — [TxtCart](https://txtcart.ai/blog/text-marketing-statistics/)
- Blog claims that well-run programs drive 30–50% of revenue are **not Klaviyo-published; folklore-grade** — [SciGrowth](https://scigrowth.com/blogs/crm-marketing/email-revenue-share-benchmarks-dtc-2026)

**Post-purchase surveys (HDYHAU)**
- Fairing (vendor): at least 60% of customers respond to post-purchase surveys for the average Fairing client — [Fairing](https://fairing.co/blog/the-post-purchase-survey-a-vital-marketing-attribution-tool)
- Placement: order-confirmation pages see about 40–75% response vs 5–15% for post-purchase email surveys (blog). Respondents skew toward engaged fans, which biases channel attribution — [CustomerLuv](https://customerluv.app/blog/how-did-you-hear-about-us-survey); [Adtribute KnoCommerce listing](https://www.adtribute.io/directory/knocommerce)

**Channel shift: TikTok Shop / Amazon / retail (2024–2026)**
- US TikTok Shop GMV in 2025: about $15.1B (+68% YoY) per one tracker, about $15.82B per another, with an eMarketer projection of about $23.4B for 2026. These are third-party estimates (Charm, FastMoss, Kalodata) — [Ringly](https://www.ringly.io/blog/tiktok-shop-statistics-2026); [Resourcera](https://resourcera.com/data/social/tiktok-shop-statistics/)
- Beauty & personal care is TikTok Shop's top US category (about $2.49B in 2025, ~22%). NielsenIQ data reportedly ranks TikTok Shop as the #4 US health & beauty retailer ($4.4B annual category sales) — [Novadata](https://novadata.io/resources/news/tiktok-shop-health-beauty-no4-retailer-april-2026); [Eightx](https://eightx.co/blog/average-ecommerce-tiktok-shop-revenue-share-by-vertical-2026)
- 97% of US TikTok shoppers also shopped on Amazon in the past year (survey cited secondhand) — [Ringly](https://www.ringly.io/blog/tiktok-shop-statistics-2026)
- Agency estimate: TikTok Shop is 5–15% of revenue for mid-market DTC brands, and beauty or supplements can exceed 20% (beauty ~22%, fashion ~24%, food ~7% revenue share by vertical) — [Eightx](https://eightx.co/blog/average-ecommerce-tiktok-shop-revenue-share-by-vertical-2026)

### Inferences
- **Encodable DTC gates:**
  - Break-even MER = 1 / CM2% (at MER = 1/CM2%, marketing spend equals CM2 dollars).
  - Target MER for a target CM3 of t: MER_target = 1 / (CM2% − t). Example: CM2 58%, target CM3 25% → MER ≈ 3.0x, consistent with the MHI worked example and the CTC 20–35% CM3 range.
  - Flag CM3 below 15% as the "danger zone" (secondhand CTC).
- **Attribution hierarchy for Inroad.** Treat MER and cohort contribution as ground truth, use post-purchase surveys for directional channel mix, and treat platform ROAS and Klaviyo-attributed revenue as vendor-attributed signals that overlap and over-count.
- **Repeat-rate sanity check.** If a founder claims 40%+ 90-day repeat for a non-subscription product, ask for the definition, since panel medians are about 11–12%. Time follow-up flows to the category's median time to second purchase (often 15–35 days).
- **Conversion-rate sanity check.** Session conversion above 3.2% puts a store in the top 20% of Littledata's 2023 sample. Projections assuming 4–5% sitewide from paid social traffic should be challenged.
- **Channel shift.** TikTok Shop is now a meaningful marketplace channel in beauty and supplements. Heavy Amazon overlap means demand created on TikTok and Meta can leak to Amazon, so blended MER across DTC plus marketplaces is the correct denominator once a brand sells on Amazon.

### Gaps
- DTC gross margin targets (for example "60–70%+ gross margin for DTC viability"), AOV benchmarks by category, and the IRP Commerce benchmarks were not retrieved because the search budget ran out. Do not encode numeric GM/AOV targets until sourced.
- CTC's own definitions (CM1/CM2/CM3, aMER, nCAC) were not verified from CTC primary material.
- 2PM (Web Smith) and Modern Retail reporting on DTC brands shifting to wholesale or Amazon in 2024–2026 was not retrieved, and no quantified DTC-to-wholesale shift dataset was found.
- Klaviyo's 2026 total-revenue share for email and SMS was not confirmed. The 27% figure may be from an earlier period.

## 5. DTC channel mix and launch sequence, with case studies

### Takeaway
The traceable cases follow a common sequence: an owned audience or community first (Glossier's Into the Gloss, MrBeast's channel for Feastables), a breakout first-week DTC launch without paid ads (Graza, about $100K), then rapid retail expansion as the main scale engine (Graza ~13K doors by mid-2024; Olipop 50–65K doors; Feastables 30K+). Most figures are company-reported or secondhand, so label them "reported".

### Cited Findings
- **Graza** (olive oil): the website went live Jan 2022 and sold out within a day. About $100K in first-week sales with no paid advertising (Klaviyo customer story, vendor). Over $4M in year-one sales, over $19M by the end of 2023, and a 2024 projection or estimate of about $48.4M (company-reported via CNBC) — [CNBC Make It, Jun 2024](https://www.cnbc.com/make-it/2024/06/07/how-graza-olive-oil-co-founder-andrew-benin-built-the-business.html); [Klaviyo](https://www.klaviyo.com/blog/guerrilla-marketing-for-ecommerce); [Inside Retail](https://insideretail.us/how-graza-became-a-48-million-olive-oil-brand-stocked-by-whole-foods-and-target/)
- Graza had about 13,300 retail distribution points by mid-2024, with a plan to reach 18,500 by year-end (New Hope). A late-2025 piece says door count passed 11,000, so the metrics may differ (distribution points vs doors), plus a reported $240M valuation. Commentary frames retail as the value driver and DTC as the brand builder (opinion) — [New Hope](https://www.newhope.com/brands/graza-bold-single-source-olive-oil-started-spanish-kitchen); [The Food Billionaire](https://thefoodbillionaire.substack.com/p/graza-usd-285m-raised-usd-240m-valuation); [The Food Stack](https://thefoodstack.substack.com/p/from-squeeze-bottle-to-240m-valuation)
- **Olipop**: a $50M Series C at about a $1.85B valuation in Feb 2025, up from about $200M at its 2022 Series B ($30M). Reported 2024 revenue is about $400M (secondary). It is sold in roughly 50,000–65,000 retail locations (sources differ). One case study says it has been profitable since early 2024 (unverified) — [Food Business News](https://www.foodbusinessnews.net/articles/27693-olipop-valued-at-185-billion-following-latest-funding-round); [Inc.](https://www.inc.com/divya-bhardwaj/olipop-valued-at-1-85-billion-valuation-after-50-million-fundraise/91147679); [BevIndustry](https://www.bevindustry.com/articles/97277-olipop-valuation-reaches-185-billion-following-series-c-funding); [Wikipedia](https://en.wikipedia.org/wiki/Olipop); [FemFounded](https://femfounded.org/case-studies/olipop/)
- **Feastables** (MrBeast): about $250M in 2024 revenue and about $20M in profit, per investor documents reported by Bloomberg (via secondary sources; other figures of $215M and $225M exist). 2025 revenue was projected at $520M. Over 30,000 retail locations by Oct 2025 (Walmart, Target, 7-Eleven; US, Canada and Mexico). The media business reportedly earned $246M in revenue and lost about $80M — [FemFounded](https://femfounded.org/case-studies/feastables/); [What's Trending](https://whatstrending.com/mrbeasts-feastables-outperforms-youtube-in-profit-achieving-251-million-in-sales/)
- **Glossier**: Into the Gloss had more than 1M monthly visitors and 184K Instagram followers before launch. Glossier launched in Oct 2014 with four products, announced through a first-person blog post to the community. Weiss estimated 90% of revenue came from fans and word of mouth, with 600% growth in 2016 (2017-era profile). Funding: a $2M seed (Forerunner), $10.4M cumulative seed plus Series A. These are secondary profiles, and attribution of individual numbers among them was not pinned — [Inc. "The Glow Up" via Magzter](https://www.magzter.com/ja/stories/business/Inc/THE-GLOW-UP); [Business of Fashion](https://www.businessoffashion.com/community/people/emily-weiss); [Just One Good Idea](https://justonegoodidea.substack.com/p/from-blog-to-billion-dollar-beauty)
- Retention-channel support: Klaviyo vendor data (email about 27% of revenue; SMS flows 45.2% of SMS revenue) and the repeat curves in section 4 — [Klaviyo](https://www.klaviyo.com/marketing-resources/ecommerce-benchmarks); [TxtCart](https://txtcart.ai/blog/text-marketing-statistics/)

### Inferences
- **Launch sequence Inroad can coach** (derived from the cases above plus section 4):
  1. Build an owned audience (waitlist, email, community or creator audience) before launch. Glossier and Feastables show audience-first launches.
  2. Launch DTC to validate demand and margin, aiming for a sell-out or strong first-week cohort without paid spend (Graza).
  3. Use creator seeding and founder story, then start Meta/TikTok paid with creative testing only after CM2 and the repeat curve are known.
  4. Retention flows (welcome, post-purchase, replenishment) timed to time-to-second-purchase.
  5. Add subscriptions or replenishment for consumables.
  6. Add Amazon/TikTok Shop and retail once velocity data supports retail buyer conversations. For CPG beverage and food, retail becomes the primary scale channel (Olipop, Feastables, Graza).
- **Anti-pattern.** Using these brands as proof that "DTC paid social scales profitably". In these traceable cases, scale came from retail distribution and owned or celebrity audiences, not paid acquisition.

### Gaps
- **Liquid Death** and **Athletic Brewing**: no figures retrieved (search budget exhausted). Do not cite numbers for them until sourced.
- No verified pre-launch waitlist sizes or email-list conversion figures for any case.
- No audited channel split (DTC vs retail vs Amazon) for any of these brands.

## 6. Consumer marketplaces: take rates, GMV vs net revenue, a16z "13 metrics"

### Takeaway
Net revenue = GMV × take rate. Never let a founder present GMV as revenue. Reported take rates vary with what's counted (commissions vs ads and services): Etsy is about 24% all-in vs a 6.5% transaction fee, eBay ~14%, Airbnb ~13–17%, Uber ~25–27%. The a16z 13 metrics (Jordan, Jin, Coolican, Chen, 2020) are the standard diligence checklist.

### Cited Findings
- a16z "13 Metrics for Marketplace Companies" by Jeff Jordan, Li Jin, D'Arcy Coolican and Andrew Chen (dated Feb or May 2020 depending on the listing). The metrics are grouped into matching efficiency, structure, economics, competitive position and retention: match rate, market depth, time to match, supply and demand concentration, take rate, unit economics, multi-tenanting, switching costs, user retention cohorts, core-action retention cohorts, dollar retention cohorts, retention by geography/category, and power-user curves (from secondary summaries and a16z's LinkedIn post; the essay itself was blocked) — [a16z LinkedIn](https://www.linkedin.com/posts/a16z_13-metrics-for-marketplace-companies-activity-6636672962021994496-d9wo); [Marketplace Library](https://www.marketplacelibrary.com/article/jeff-jordan-li-jin-darcy-coolican-andrew-chen-13-metrics-for-marketplace-companies)
- a16z's Marketplace Glossary defines take rate as the share of GMV the marketplace captures. GMV × take rate = net revenue — [a16z Marketplace Glossary](https://a16z.com/the-marketplace-glossary/); [Rework](https://resources.rework.com/libraries/marketplace-growth/marketplace-metrics)
- Etsy FY2025 (third-party reading of the 10-K): gross merchandise sales fell 5.3% while revenue rose 2.7%, because the take rate rose from 22.3% to 24.2%, driven by ads and services. The transaction fee itself is 6.5% — [Sujit Karki analysis](https://www.sujitkarki.com.np/posts/platform-take-rate-trend-2026); [Flexprice](https://flexprice.io/questions/typical-digital-marketplace-take-rates)
- Third-party computed take rates (not company-reported metrics): eBay ~13.9% (net revenue ÷ GMV); Airbnb ~13.4%, or 14–17% host plus guest by another estimate; Uber ~25–26.9% (revenue ÷ gross bookings). Category ranges: physical goods 5–20%, services/ride-hail ~20–30%, rentals 3–15% — [Flexprice](https://flexprice.io/questions/typical-digital-marketplace-take-rates); [Sujit Karki analysis](https://www.sujitkarki.com.np/posts/platform-take-rate-trend-2026); [Twosided](https://twosided.io/blog/marketplace-take-rate)
- a16z Marketplace 100 (2021 PDF) exists as a ranking of consumer marketplaces by GMV. Take-rate tables were not retrieved — [a16z Marketplace 100 2021](https://info.a16z.com/rs/382-JZB-798/images/marketplace-100-2021.pdf)

### Inferences
- **Encodable rules.** (a) Revenue = GMV × take rate. Contribution = net revenue − payment processing, trust & safety, incentives/subsidies and support. CAC must be computed per side (supply and demand). (b) Flag pitches that report GMV growth as "revenue". (c) An early take rate well above category norms (for example over 20% in physical goods) needs a justification such as payments, fulfillment or ads value. Otherwise expect leakage or disintermediation.
- Use a16z's 13 metrics as the diagnostic checklist in Inroad's marketplace mode, prioritizing match rate / time to match, retention cohorts and concentration at pre-seed to Series A.

### Gaps
- Take-rate benchmarks for early-stage consumer marketplaces (vs public-company figures) were not found. Bill Gurley's "A Rake Too Far" and a16z's own take-rate data were not retrieved.
- Original a16z essay text (exact definitions and thresholds) was blocked.

## 7. Pricing research methods and compliance constraints (FTC, ROSCA, state ARLs, EU/UK)

### Takeaway
There is no federal click-to-cancel rule in force. The FTC's 2024 amendments were vacated by the Eighth Circuit (Jul 8, 2025) and formally withdrawn (Feb 12, 2026), and the FTC restarted with an ANPRM (Mar 2026). ROSCA enforcement continues (Amazon: $2.5B, Sep 2025), and California's amended ARL (AB 2863, effective Jul 1, 2025) sets the de facto US standard: separate express consent, cancellation through the same medium, consent records and reminders. The UK DMCC subscription regime is not yet in force (expected 2027), and the EU Digital Fairness Act is still at the proposal stage. Adapty's experiment data suggests price tests are the lowest-yield test type for apps, so test localization and paywall design first.

### Cited Findings

**Pricing research / testing (limited evidence retrieved)**
- Adapty 2026 (vendor): locale tests (translation and currency) delivered the highest LTV uplift (62.3%), and price-change tests ranked last (45.5% LTV, 28.3% conversion uplift) — [PPC Land on Adapty](https://ppc.land/95-of-app-subscription-revenue-goes-to-top-10-adaptys-2026-benchmark-report/)
- Apple supports introductory offers, promotional offers (up to 10 per subscription), offer codes and win-back offers configurable per territory. These are usable as price-test levers inside IAP — [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/)

**FTC Negative Option / click-to-cancel**
- The FTC's amended Negative Option Rule ("click-to-cancel") was published Nov 15, 2024 — [Federal Register 2024-25534](https://www.federalregister.gov/documents/2024/11/15/2024-25534/negative-option-rule)
- The Eighth Circuit vacated it on Jul 8, 2025, before it took effect, on procedural grounds (FTC Act §22 rulemaking requirements), not on the merits — [Gibson Dunn](https://www.gibsondunn.com/ftc-restarts-negative-option-rulemaking-after-eighth-circuit-vacatur-enforcement-under-rosca-continues/); [GivePayments](https://www.givepayments.com/resources/click-to-cancel-2026-status/)
- On Feb 12, 2026, an FTC Federal Register notice withdrew the vacated amendments (91 FR 6507). Sources describe 16 CFR 425 reverting to its pre-amendment text. The FTC announced a new ANPRM on Mar 11, 2026 (published Mar 13, 2026, 91 FR 12318), asking about amendments, alternatives, provisions of the vacated rule and exemptions. Comments were due Apr 13, 2026. No proposed rule (NPRM) had been found as of the latest sources — [Cooley, Mar 19, 2026](https://www.cooley.com/news/insight/2026/2026-03-19-ftc-issues-new-advance-notice-of-proposed-rulemaking-on-negative-option-marketing); [Wiley](https://www.wiley.law/alert-FTC-Seeks-Comment-on-Updates-to-Negative-Option-Marketing-Rule); [Jones Day, May 2026](https://www.jonesday.com/en/insights/2026/05/ftc-revives-clicktocancel-rule-new-risks-for-subscription-businesses); [Subjolt](https://www.subjolt.com/guides/subscription-cancellation-law/)
- ROSCA enforcement: on Sep 25, 2025, Amazon settled FTC claims over Prime enrollment and cancellation for $2.5B ($1B civil penalty plus $1.5B in consumer refunds). It must simplify cancellation and provide a clear decline option. The court had held that ROSCA covered Prime — [Keller & Heckman](https://www.khlaw.com/insights/amazon-pay-record-25-billion-settle-ftc-claims-deceptive-prime-membership-signup-and); [Consumer Finance Insights](https://www.consumerfinanceinsights.com/2025/09/29/ftc-settles-with-amazon-over-enrollment-and-cancellation-processes-for-prime-memberships/); [FTC order PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/Amazon-ROSCA-Order-Filed_0.pdf)
- About 30 states have automatic-renewal laws, some stricter than the vacated federal rule (secondary count). A federal "Unsubscribe Act" was reportedly reintroduced in 2026 (status unverified) — [GivePayments](https://www.givepayments.com/resources/click-to-cancel-2026-status/)

**California ARL (AB 2863, effective Jul 1, 2025)**
- Applies to contracts entered into, amended or extended on or after Jul 1, 2025. Requirements:
  - Express affirmative consent to the auto-renewal terms, separate from general contract acceptance (no bundling into terms of service, no pre-checked boxes).
  - Consent records kept for 3 years, or 1 year after termination, whichever is longer.
  - Cancellation available through the same medium used to enroll, or the medium the consumer normally uses, without obstruction.
  - An annual reminder of terms and cancellation. Sources differ on the trigger; one ties it to terms of a year or more.
  - Notice of price changes; the timing window is unverified.
  - Law-firm summaries; statute text not retrieved — [Cooley, Jun 2025](https://www.cooley.com/news/insight/2025/2025-06-04-california-automatic-renewal-law-amendments-take-effect-on-july-1-2025); [Barnes & Thornburg](https://btlaw.com/en/insights/alerts/2025/california-expands-automatic-renewal-law-new-requirements-now-in-effect); [CalMatters bill page](https://calmatters.digitaldemocracy.org/bills/ca_202320240ab2863)

**UK and EU**
- UK DMCC Act subscription-contracts regime: not in force. Taylor Wessing (Apr 2026) reports a delay to spring 2027, after an earlier autumn 2026 target. Later trackers report draft "Consumer Subscription Contracts (Cancellation and Information) Regulations 2026" applying to contracts from Jan 1, 2027, which conflicts with Taylor Wessing. Content includes a 14-day "renewal cooling-off" period after a free or discounted trial ends and after a 12-month-plus contract auto-renews, plus reminder notices and an easy online exit — [Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2026/04/subscription-contracts); [Wiggin tracker](https://www.wiggin.co.uk/insight/digital-markets-competition-and-consumer-act-tracker/); [Legal500](https://www.legal500.com/intelligence/united-kingdom/consumer-protection/the-dmcca-subscription-contracts-the-timeline-just-got-shorter); [Osborne Clarke](https://www.osborneclarke.com/insights/uk-digital-markets-competition-and-consumers-act-subscription-contracts-regime-take-shape)
- EU: Directive (EU) 2023/2673 adds a mandatory online "withdrawal function" (button) for distance contracts, applicable from Jun 19, 2026. It covers the 14-day withdrawal right, not general subscription cancellation — [Churnkey guide](https://churnkey.co/guides/eu-consumer-rights-directive)
- EU Digital Fairness Act: still a proposal. One source expects a draft around Nov 11, 2026 and no entry into force before end-2028. Possible measures: easy cancellation, renewal reminders, and express consent before a free trial converts to paid — [CMS](https://cms.law/en/int/legal-updates/inside-the-eu-s-planned-digital-fairness-act-digital-design-subscription-traps-and-influencer-marketing); [Inside Privacy (Covington)](https://www.insideprivacy.com/consumer-protection/digital-fairness-act-series-topic-4-digital-subscriptions/)
- Apple requires free-trial purchase flows to state the trial length and the price billed after the trial — [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/)

### Inferences
- **Compliance rules to encode (US-first).**
  - Separate, unbundled consent checkbox or step for auto-renewal.
  - Clear disclosure of trial length, renewal price and cadence before purchase.
  - Cancellation through the same medium as sign-up (web sign-up means web cancellation; no "call to cancel" for online sign-ups).
  - Consent records retained for at least 3 years.
  - Annual renewal reminders, and pre-charge reminders for annual plans.
  - Notice before price increases.
  - Push back on "save" flows that obstruct cancellation; Amazon's $2.5B settlement shows ROSCA exposure even without a federal click-to-cancel rule.
  - For UK users, plan for the 2027 renewal cooling-off period, which will raise post-trial refunds.
- **Pricing-test guidance.** For apps, test locale and currency and paywall format (for example multi-page onboarding) before raw price points (Adapty). Run price tests as new-user cohort splits, measured on revenue per install at D35/D60 including refunds.

### Gaps
- Van Westendorp Price Sensitivity Meter (four questions: too cheap, a bargain, getting expensive, too expensive) and willingness-to-pay interview methods (for example Madhavan's *Monetizing Innovation*): no sources retrieved. The search budget was exhausted before this sub-topic.
- Eighth Circuit case caption and the ANPRM text were not verified from primary sources (ftc.gov and federalregister.gov blocked).
- California statute text (Bus. & Prof. Code §§17600–17606) not retrieved, including the exact reminder trigger and price-change notice window.
- Germany's "Kündigungsbutton" (BGB §312k) and other EU member-state rules were not researched.
- Whether a Supreme Court stay of the Apple remand proceedings was granted or denied: conflicting secondary reports.
