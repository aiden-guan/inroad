# Virality, Referrals, Waitlists, Network Effects and Marketplace Cold Start (Consumer GTM fact base for Inroad)

*Research-method note for the report writer (as of 2026-10-26).* The shared web-search budget ran out partway through, and WebFetch could not resolve most hosts (nfx.com, reforge.com, andrewchen.com, lennysnewsletter.com, a16z.com, sec.gov, ftc.gov, wikipedia.org were all blocked). The only page fetched in full was Apple's App Store Review Guidelines. Every other finding comes from search-engine result summaries of the cited pages, which point to the right URL but may paraphrase. Items tagged **[RECALLED – not verified this session]** come from prior knowledge of the named source. They are included because they are canonical and widely cited, but they must be checked before being published or encoded as hard rules. Figures dated before 2023 are labelled with their year.

---

## 1. Viral mechanics: K-factor, cycle time, realistic K values, types of virality

### Takeaway
Viral growth is K = (invites or exposures per user) × (conversion rate of those invites), compounded once per viral cycle. Cycle time often matters more than K: halving it can multiply users by roughly 1,000x over the same calendar window. Sustained K > 1 is rare and usually temporary. Most good consumer products run K well below 1, where virality multiplies the yield of other channels by 1/(1−K) instead of driving growth by itself.

### Cited Findings
- **Formula.** David Skok (Matrix Partners, forentrepreneurs.com, "Lessons Learnt – Viral Marketing", c. 2009) defines the viral coefficient as K = invites sent per user × conversion % of those invites. He argues that cycle time (how fast the loop repeats) matters more than the coefficient itself. — [eChai summary of Skok](https://echai.ventures/startingup/retention-referral/what-s-a-viral-coefficient-and-is-chasing-a-k-factor-above-1-realistic-for-my-kind-of-product); [P2P Foundation wiki](https://wiki.p2pfoundation.net/Virality_Coefficient)
- **Cycle time definition.** Viral cycle time (ct) is the "average time it takes from the moment that one of your users performs a viral action to the moment that a new user signs up because of this very action". Skok "devised a formula to calculate the amount of users you will get after a period of time based on the Virality Coefficient (K) and the Cycle Time (ct)." — [P2P Foundation wiki](https://wiki.p2pfoundation.net/Virality_Coefficient)
- **Skok's growth formula and worked example [RECALLED – not verified this session].** Customers(t) = c(0) × (K^(t/ct + 1) − 1) / (K − 1). Skok's example: "After 20 days with a cycle time of 2 days, you will have 20,470 users, but if you halve that cycle time to 1 day, you would have over 20 million users." The arithmetic checks out with c(0)=10 and K=2: 10×(2^11−1)=20,470 and 10×(2^21−1)=20,971,510, which supports the recall. — [Skok, forentrepreneurs.com (fetch blocked)](https://www.forentrepreneurs.com/lessons-learnt-viral-marketing/)
- **Realistic K values.** Secondary sources put realistic consumer-product K at about 0.15–0.25 and say K > 1 is rare. One skill/aggregator page claims most "viral" products sit at K ≈ 0.1–0.6. Neither figure could be traced to a primary dataset, and the common attribution of the 0.15–0.25 range to Andrew Chen is **unverified**. — [eChai](https://echai.ventures/startingup/retention-referral/what-s-a-viral-coefficient-and-is-chasing-a-k-factor-above-1-realistic-for-my-kind-of-product); [clawhub k-factor page](https://clawhub.ai/deciqai/skills/k-factor-viral)
- **Sustained K > 1 is rare and usually temporary.** — [eChai](https://echai.ventures/startingup/retention-referral/what-s-a-viral-coefficient-and-is-chasing-a-k-factor-above-1-realistic-for-my-kind-of-product)
- **Origin of the K-factor term.** Usually traced to Steve Jurvetson (DFJ) describing Hotmail in 1996, then formalized by Andrew Chen, David Skok and the early Facebook/LinkedIn growth teams. The source is secondary. — [FourWeekMBA](https://fourweekmba.com/viral-coefficients-k-factor-the-mathematics-of-exponential-growth/)
- **Inherent / transactional virality (Cash App).** Block's FY2023 10-K says peer-to-peer transactions are Cash App's primary acquisition channel: "every time a customer sends or requests money, Cash App can potentially acquire a new customer or re-engage an existing customer." — [Block FY2023 10-K (SEC)](https://www.sec.gov/Archives/edgar/data/1512673/000162828024006354/sq-20231231.htm)
- **Collaborative / content-sharing virality (Dropbox).** The Dropbox S-1 (2018) says it acquires users "efficiently and at relatively low cost through word-of-mouth referrals, direct in-product referrals, and content sharing", and that users often share and collaborate with non-registered users, which pulls in signups. — [Dropbox S-1, Feb 2018 (SEC)](https://www.sec.gov/Archives/edgar/data/0001467623/000119312518055809/d451946ds1.htm)
- **Viral channel mix (Dropbox, c. 2010).** The referral program took Dropbox from 100K to 4M users in 15 months. 35% of daily signups came from referrals and 20% from viral features such as shared folders. This is Goodwater Capital's analysis, not the S-1, and the period is 2008–2010. — [Goodwater Capital, "Understanding Dropbox"](https://www.goodwatercap.com/perspectives/understanding-dropbox)
- **Embedded / communication virality (Hotmail, 1996).** Investor Tim Draper proposed appending a promotional tagline with a signup link to every outgoing email ("PS: I love you. Get your free email at Hotmail"). Sources disagree on whether the "I love you" part shipped. Hotmail reportedly had 1M users by the end of 1996 and 9.5M subscribers at the Microsoft acquisition, which analysts valued at $300–400M in stock. The widely repeated "12 million users in 18 months" has **no primary source** (it comes from a forum thread quoting a Freelancer.com executive). — [TechCrunch excerpt of *Viral Loop*, 2009](https://techcrunch.com/2009/10/18/ps-i-love-you-get-your-free-email-at-hotmail); [Buttondown](https://buttondown.com/blog/email-signatures-history); [t2online](https://t2online.in/tech/deep-dive/30-years-of-hotmail--how-two-engineers-rewired-the-inbox/2006203); [Warrior Forum (weak source)](https://www.warriorforum.com/growth-hacking/941481-hotmail-growth-hack.html)
- **Incentivized virality (PayPal, c. 1999–2000).** PayPal paid both sides $20, then cut to $10 each, and later to $5. One account says $20 total ($10+$10) was PayPal's lowest-CAC channel and that a $5 test showed no substantial impact on growth. Eric Jackson's book (*The PayPal Wars*) records that "we were paying out over $100,000 per day in bonuses." The commonly quoted "7–10% daily growth" is **unsourced** (ReferralCandy blog). — [ReferralCandy](https://www.referralcandy.com/blog/paypal); [PayPal Wars quotes](https://jcnews.substack.com/p/the-paypal-wars-book-quotes); [Flyy](https://www.theflyy.com/blog/paypal-referral-program-case-study-of-internets-first-viral-growth-using-referrals)

### Inferences
- **Encodable formulas.**
  - K = i × c, where i = invites (or exposures) per active user per cycle and c = invite→activated-user conversion.
  - Users(t) = c0 × (K^(t/ct+1) − 1)/(K − 1).
  - When K < 1, the total users eventually generated from a seed cohort N0 is N0 / (1 − K). So K = 0.2 gives 1.25x, K = 0.5 gives 2x, and K = 0.8 gives 5x (derived from the geometric series).
  - Inroad should report this "amplification factor" alongside raw K, because it tells founders how much virality multiplies their paid and organic channels.
- **Rule: shorten the cycle before raising K.** Cut the time from signup to first share (put the share moment at or right after the aha moment), and cut the time from invite to invitee activation (deep links, no app-install wall where possible).
- **Classify each product's dominant viral type**, because each type implies different levers:
  1. Inherent/transactional (P2P payments, video calls): the product cannot be used without exposing a non-user.
  2. Collaborative (shared folders, docs, design files): the product is better with others.
  3. Embedded/communication (Hotmail signature, "Sent with X", watermarks).
  4. Incentivized (Dropbox, PayPal, Robinhood rewards).
  5. Organic word of mouth.
- **Rule for Inroad recommendations.** Treat K > 1 as a temporary state, not a plan. Model growth as retention × (paid + organic + viral amplification), and flag any plan that relies on K > 1 for more than a launch window.

### Gaps
- Skok's original essay, Andrew Chen's K-factor essays ("What's your viral loop?" and others), and the Reforge "types of virality" taxonomy could not be fetched. The formula and taxonomy above are recalled or secondary.
- No primary, cross-company benchmark dataset of measured K values for consumer apps was found. The 0.15–0.25 and 0.1–0.6 ranges are unverified.
- Chamath Palihapitiya's widely repeated Facebook "7 friends in 10 days" activation rule could not be checked against a primary source this session, so treat it as **unverified**.

---

## 2. Growth loops vs. funnels (Reforge / Balfour / Winters / Kwok / Chen)

### Takeaway
Loops are closed systems where the output of one cycle (new users, content, revenue) becomes the input of the next. The fastest-growing products are described by one or two dominant loops, not by the AARRR funnel. Inroad should identify a product's primary loop and its rate-limiting step, then optimize that step instead of top-of-funnel volume.

### Cited Findings
- The Reforge essay ("Growth Loops are the New Funnels") is the third of a four-post series co-written by Brian Balfour, Casey Winters, Kevin Kwok and Andrew Chen. Quote: "The AARRR funnel framework has been the dominant guiding framework to metrics, goal setting, and strategic growth conversations. Funnels were a good starting point but do not accurately represent how the fastest growing products grow. It is time to move past the funnel framework and focus on growth loops." — [Reforge blog](https://www.reforge.com/blog/growth-loops) (via search summary; the page itself was blocked)
- Loops are closed systems whose outputs are reinvested as inputs. In a funnel, converted customers are "the end of the story", while a loop treats them as the start of the next cycle. — [Amplitude explainer](https://amplitude.com/explore/product/growth-loops)
- Balfour discussed the funnel-to-loop shift in a 2019 "Scale or Die" podcast interview (the AARRR model was then about a decade old). — [Everyone Hates Marketers podcast](https://podcast.everyonehatesmarketers.com/episodes/growth-loops-the-end-of-traditional-funnels)
- **Loop types [RECALLED – not verified this session].** The Reforge series groups loops as:
  - viral loops (word of mouth, incentivized, collaborative)
  - content loops (user-generated content indexed by SEO, e.g., Pinterest/Quora/Yelp; company-generated content)
  - paid loops (revenue reinvested into ads, gated by LTV > CAC and payback)
  - sales loops

  Casey Winters (ex-Pinterest, ex-Grubhub) is the usual reference for Pinterest's UGC→SEO loop, and Kevin Kwok's "Why Figma Wins" (kwokchain.com, 2020) for collaboration-driven growth, where designers pull PMs, engineers and stakeholders into the file. — [Reforge](https://www.reforge.com/blog/growth-loops)
- **Real-world loop mix: Dropbox S-1.** Word-of-mouth referrals, in-product referrals and content sharing drove acquisition. Sales & marketing was only 28% of revenue in 2017, and more than 90% of revenue came through self-serve channels. 500M registered users, 11M paying users, $111.91 ARPU (2017). — [Motley Fool summary of the S-1, 2018](https://www.fool.com/investing/2018/02/28/dropbox-ipo-3-important-takeaways.aspx); [Dropbox S-1](https://www.sec.gov/Archives/edgar/data/0001467623/000119312518055809/d451946ds1.htm)
- **Real-world loop mix: Cash App.** The P2P transaction loop is the primary acquisition channel (FY2023 10-K). Cost of acquisition was under $5 per new transacting active in 2020 and "$10 or less" in 2022, rising as Block added paid marketing. Block defines it as paid marketing, including referral fees and brand spend, divided by net-new transacting actives. — [Block 8-K FY2023](https://www.sec.gov/Archives/edgar/data/1512673/000119312523046618/d460989dex991.htm); [Square Q4 2020 8-K](https://www.sec.gov/Archives/edgar/data/1512673/000119312521052320/d128971dex991.htm); [Payments Dive](https://www.paymentsdive.com/news/block-defends-higher-marketing-spending/619452/)
- **Early-stage channel concentration.** Lenny Rachitsky's research on how the biggest consumer apps got their first 1,000 users (2020; founder outreach, interviews, Twitter) found that seven strategies account for every case. Most startups leaned on one, and none succeeded with more than three. The tactics for the first 1,000 users differ from those for the next 10,000. — [Lenny's Newsletter](https://www.lennysnewsletter.com/p/how-the-biggest-consumer-apps-got); [TNW syndication, Jun 2020](https://thenextweb.com/news/the-7-strategies-that-got-the-biggest-consumer-apps-their-first-1000-users-syndication)
  - A secondary list of the seven: promote where the target meets offline; promote where they gather online; invite friends; FOMO; influencers; press; private communities. This list is **unverified against the original**. — [Gigazine](https://gigazine.net/gsc_news/en/20200526-app-first-1000-user)

### Inferences
- **Primary-loop identification procedure for Inroad:**
  1. List every way new users arrive (self-reported plus attribution).
  2. For each, ask whether the arrival was produced by an existing user or by output of the product. If yes, it is a loop; if no, it is a linear channel.
  3. The loop with the largest share of new activated users, or the highest growth rate of that share, is primary.
  4. Find its slowest or leakiest step (e.g., share rate after the aha moment, invitee landing conversion, content indexation rate) and make that the weekly focus metric.
- **Sequencing rule.** Pre-PMF and pre-seed teams should run one or two founder-led "do things that don't scale" channels (Lenny: rarely more than three). Engineer a loop only once retention is flat, because loops amplify retention and cannot substitute for it.
- **Loop-to-business match.**
  - Communication or transaction products → inherent viral loop.
  - Collaborative tools → collaboration loop.
  - Products whose usage creates public, indexable artifacts (reviews, recipes, Q&A, listings) → UGC/SEO loop.
  - High-LTV subscriptions → paid loop.

### Gaps
- The Reforge, Casey Winters and Kevin Kwok primary texts could not be fetched. Specific loop diagrams, quotes and Pinterest/Grubhub numbers are not verified here.
- No quantitative benchmark was found for loop step conversion rates (e.g., typical UGC page→signup rates).

---

## 3. Referral programs: design, cases, share of new users, fraud controls

### Takeaway
Referral programs amplify existing word of mouth; they do not create it. Good programs drive roughly 15–50% of new users. They pay in the product's own currency when possible (storage, stock, credit), are usually double-sided, and gate rewards on a qualifying action with annual caps. Robinhood's S-1 (over 80% of new funded accounts from organic plus referral) and Dropbox (35% of daily signups from referrals in 2010) are the best-documented cases.

### Cited Findings
- **Benchmarks (Lenny Rachitsky, "Building a referrals program", exact date unconfirmed, c. 2020–2023):**
  - "At companies where referrals work best, anywhere from 15% to 50% of their new user growth comes from referrals."
  - Expect fewer than 10% of users to make a successful referral.
  - An extra $10 "likely won't cut it" as a motivating reward, and beyond some point bigger rewards stop motivating people even when ROI is positive.
  - A summary of the same guidance says "referral programs add fuel to existing word-of-mouth; they can't create it" and that motivating the referrer is "~90% of the problem."
  - Methodology: practitioner experience and interviews, not a dataset.
  — [Lenny's Newsletter](https://www.lennysnewsletter.com/p/this-week-16-building-a-referrals); [eChai summary](https://echai.ventures/startingup/from/lenny-s-newsletter)
- **Dropbox (2008–2010).**
  - Drew Houston's "Startup Lessons Learned" (2010) deck says that after paid search failed, a two-sided referral incentive "permanently increased signups by 60%".
  - Users sent 2.8M direct referral invites in the trailing 30 days (April 2010). Some sources mis-state this as cumulative over 18 months.
  - The program was modeled on PayPal's but paid in storage instead of cash.
  - Reward sizes conflict across sources: 250MB each at launch vs. 500MB/1GB tiers later.
  — [Houston deck on SlideShare](https://www.slideshare.net/vishaltx/dropbox-startup-lessons-learned-16991502); [ReferralCandy](https://referralcandy.com/blog/dropbox-referral-program/); [Viral Loops](https://viral-loops.com/blog/dropbox-grew-3900-simple-referral-program/)
- **Robinhood (S-1, July 2021).**
  - More than 80% of new funded accounts in 2020 and in Q1 2021 came organically or through the referral program. The S-1 does not separate referral from organic.
  - Net cumulative funded accounts grew 143% to 12.5M in 2020 and reached 18.0M by March 31, 2021.
  - Referral rewards are a free stock worth $2.50–$225, with about 98% of users receiving $2.50–$10. Rewards are capped at $500 per user per year.
  — [Robinhood S-1 (SEC)](https://www.sec.gov/Archives/edgar/data/1783879/000162828021013318/robinhoods-1.htm); [PYMNTS](https://www.pymnts.com/news/ipo/2021/robinhood-filing-shows-continued-surge-in-retail-investing/)
  - **Design insight:** the reward is a lottery-like variable prize (small expected value with a visible chance of a big win), paid in the product's own asset.
- **PayPal (1999–2003).** Double-sided cash: $20 then $10 then $5, paying out more than $100K per day at peak. The program reportedly ended in 2003. Elon Musk's explanation: "the value of the network itself exceeded any sort of carrot that we could offer." The quote is secondary. — [ReferralCandy](https://www.referralcandy.com/blog/paypal); [PayPal Wars quotes](https://jcnews.substack.com/p/the-paypal-wars-book-quotes)
- **Cash App.** Referral fees count inside the reported acquisition cost: under $5 per new transacting active in 2020 and ≤$10 in 2022. Payments Dive reports that incentive costs such as bitcoin giveaways also count. — [Block 8-K](https://www.sec.gov/Archives/edgar/data/1512673/000119312523046618/d460989dex991.htm); [Payments Dive](https://www.paymentsdive.com/news/block-defends-higher-marketing-spending/619452/)
- **Supply-side referral (Faire Direct).** Brands that bring their own retailers onto Faire through custom links pay no commission on those orders. This rewards the supply side for recruiting demand. — [Sacra on Faire](https://sacra.com/research/faire)
- **Gmail (2004).** Invite scarcity as a referral mechanic: covered in section 4.

### Inferences
- **Encodable design rules (synthesized from the cases above):**
  1. **Double-sided by default.** Dropbox's 60% lift came from a two-sided incentive, and PayPal's was two-sided.
  2. **Pay in product currency when it has real value to an active user** (storage, stock, ride or delivery credit, subscription months). This attracts users likely to retain and costs less than face value. Use cash only where the product is money (PayPal, Cash App).
  3. **Size the reward to LTV, not to "what feels generous".** Pay at most a fraction of CAC saved and payback-constrained LTV. Lenny: small rewards (about $10) rarely motivate on their own, but returns diminish above a threshold, so A/B test 2–3 reward levels. PayPal: halving from $10 to $5 each "had no substantial impact" on growth.
  4. **Gate the reward on a qualifying action** (funded account, first purchase, X days active), not on signup, and set **annual caps** (Robinhood $500/year).
  5. **Ask after the aha or first success moment**, and make the share artifact carry value to the recipient. Note: no primary source with an A/B-tested timing benchmark was found. This rule is an inference from loop logic and Dropbox's in-product placement.
  6. **Expect fewer than 10% of users to ever refer successfully.** Design for power referrers (leaderboards, tiers) instead of assuming a uniform rate.
- **Target band for Inroad:** referrals at 15–50% of new users means the program is working. Below about 10% after optimization usually means weak underlying word of mouth, and the fix is product or activation, not reward size.
- **Fraud and abuse controls.** These are standard practice. No primary benchmark on fraud rates was found.
  - Pay on qualifying action, not signup.
  - Hold payouts until after any refund or chargeback window.
  - Cap rewards per user per year.
  - Deduplicate by device, payment instrument, phone and KYC identity.
  - Block self-referral (same device, IP, card).
  - Velocity limits.
  - Clawback terms.
  - For marketplaces, limit "first order" perks to one per buyer-seller pair (Faire's free returns apply only to a retailer's first order with each brand — [Faire help](https://www.faire.com/support/retailers)).

### Gaps
- **Monzo, Revolut, Uber and Superhuman referral numbers:** searches were exhausted before primary sources were found. No verified figures are included. Leads: Monzo annual reports on word-of-mouth share, Monzo's 2016–17 "golden ticket" waitlist skip, Revolut annual reports, Uber's 2019 S-1 on referral and organic rider acquisition. All are unverified.
- No sourced data was found on reward size as a percentage of price or LTV across companies, or on referral fraud rates.
- Houston's exact reward tiers by year are inconsistent across secondary sources.

---

## 4. Waitlists and launch mechanics: queue-jumping, invite-only scarcity, backfires

### Takeaway
Referral-ranked waitlists (Robinhood) and invite-only scarcity (Gmail, Clubhouse) can produce big pre-launch demand. Scarcity is a launch tactic, not a growth engine, and it backfires when supply opens or competitors copy during the gated window. Gmail invite prices collapsed from about $150 to $2–5 once supply rose. Clubhouse downloads fell about 90% within two months of peak. Waitlists work best as a segmentation and onboarding-quality filter (Superhuman).

### Cited Findings
- **Robinhood (2013–2015 pre-launch).** Secondary sources consistently report a waitlist of nearly 1M before launch. The landing page showed your queue position, and each referral moved you up. Reported early figures: about 10K signups on day one and about 50K in the first week. **No primary Robinhood source** for the 1M, 10K or 50K figures was found, and the queue formula is undocumented. — [Viral Loops](https://viral-loops.com/blog/how-robinhood-got-1-million-users/); [The Growth Playbook](https://thegrowthplaybook.substack.com/p/how-robinhood-turned-a-landing-page)
- **Gmail (2004).**
  - Trials began March 21, 2004 with about 1,000 "opinion leaders" who could invite friends and family. Gmail was unveiled April 1, 2004.
  - Invites sold on eBay for up to US$150 (PC World via Wikipedia). Some reports say $250+, which is less well sourced.
  - Prices fell to $2–5 after a new invite round in early June 2004, and Google banned selling accounts on June 28, 2004.
  - Gmail opened to all in a public beta, reportedly in February 2007.
  — [Wikipedia, History of Gmail](https://en.wikipedia.org/wiki/History_of_Gmail); [TechSpot](https://www.techspot.com/trivia/12-gmail-debuted-2004-invitation-only-beta-offering-how/); [Search Engine Land](https://searchengineland.com/?p=10459)
- **Clubhouse (2020–2021).**
  - Invite-only from its March 2020 launch.
  - Global downloads peaked at 9.6M in February 2021, fell to about 2.7M in March and to about 0.9M in April, down 90.6% from peak (Sensor Tower estimates). Sensor Tower said retention among existing users still looked strong.
  - The Android launch in May 2021 produced a final spike of 7.8M downloads in June 2021 (Appfigures estimate). Invites and the waitlist were dropped on July 21, 2021 amid competition from Twitter Spaces and others.
  - Downloads were about 1M in December 2021 and about 274K in December 2022 (Appfigures).
  — [WARC](https://www.warc.com/content/feed/clubhouse-hype-dissipates-as-downloads-and-ranking-recede/en-GB/2008); [Cult of Mac](https://www.cultofmac.com/news/social-audio-app-clubhouse-growth-appears-to-be-stalling); [TNW, Jul 2021](https://thenextweb.com/news/clubhouse-opens-to-everyone-ends-invite-only-policy); [Appfigures, Sep 2023](https://appfigures.com/resources/insights/20230915/2-downloads-are-down-99-8-percent-since-peak-for-this-app-and-its-not-threads)
- **Superhuman (2017–2019).**
  - Used a gated waitlist with a pre-signup survey as a fit filter. Prospects who needed features Superhuman lacked (e.g., Android, Outlook) were not let in.
  - Measured product-market fit with Sean Ellis's test (the share of users who would be "very disappointed" without the product; companies under 40% almost always struggled to grow). It surveyed users who had used the product at least twice in the last two weeks.
  - The score rose from 22% to 32% from re-segmenting the market alone (focusing on founders, CEOs, VCs and BD, with no product changes), then to 46%, 56% and 58% over later quarters.
  - The often-cited "180K waitlist" figure was **not verified**.
  — [First Round Review](https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit/); [Superhuman blog](https://blog.superhuman.com/how-superhuman-built-an-engine-to-find-product-market-fit/); [pshimanshu summary](https://pshimanshu.substack.com/p/heres-what-i-learned-about-product)
- **Benchmark for comparison:** in Hiten Shah's 2015 survey of Slack users, 51% would be "very disappointed" without Slack. — [pshimanshu summary](https://pshimanshu.substack.com/p/heres-what-i-learned-about-product)
- **BeReal (2022)** combined exclusivity and buzz with paid campus ambassadors (section 8). Its daily users fell to about 6M by late spring 2023. — [Wikipedia, BeReal](https://en.wikipedia.org/wiki/BeReal)
- **Gas / tbh launch-day mechanic.** The team built anticipation by not accepting follow requests on the app's social account before launch, then "accepted all the requests at the same time on launch day". Secondary LinkedIn post. — [Raymond Chai, LinkedIn](https://www.linkedin.com/posts/raymondchai_nikita-bier-pulled-off-one-crazy-viral-launch-activity-7114171678456233984-FrvO)

### Inferences
- **Waitlist design rules:**
  1. Show the queue position and how many people are behind you, and let referrals move users up (Robinhood pattern). Reward with earlier access instead of cash, which costs nothing and avoids the incentive-disclosure rules in section 9.
  2. Use the signup form to collect segmentation data (Superhuman), and admit cohorts in order of fit, not in signup order.
  3. Set a time-boxed gate (weeks to a few months). Scarcity value collapses as supply rises (Gmail invite prices dropped roughly 30–75x within about two months).
  4. Open before competitors can copy or before platform gaps such as no Android version cap the market (Clubhouse).
  5. Measure waitlist→activated conversion per admitted cohort, and slow admissions if activation or retention of new cohorts drops.
- **Backfire signals Inroad should watch for:**
  - Hype metrics (waitlist size, downloads) rising while week-1 and week-4 retention of admitted cohorts falls.
  - Secondary-market resale of invites. This signals demand but pulls in low-intent users.
  - Paid-ambassador or bribe-driven installs without engagement (BeReal critique, section 8).

### Gaps
- No verified benchmark for waitlist→signup→activation conversion rates.
- Robinhood's waitlist numbers and mechanics rely on secondary sources. A primary Robinhood blog post or founder interview was not retrieved.
- BeReal's own exclusivity mechanics (one notification per day) are not documented here with sources.

---

## 5. Measuring word of mouth: NPS critiques, "how did you hear about us", organic share, cohort k-factor

### Takeaway
Measure word of mouth with behavioural and self-reported attribution: the share of new activated users who are organic or direct, "how did you hear about us" (HDYHAU) answers, and referral-attributed signups per cohort. Do not rely on NPS, whose link to growth is contested in the academic literature. Use the Sean Ellis "very disappointed" ≥40% test as the PMF gate before investing in referral mechanics.

### Cited Findings
- **Sean Ellis PMF test.** Companies that struggled to find growth "almost always" had fewer than 40% of users saying "very disappointed". Superhuman used it as a leading indicator and tracked it per segment. Methodology: survey of engaged users (at least two uses in the past two weeks). — [First Round Review](https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit/)
- **Organic plus referral share as a reported KPI.** Robinhood disclosed that more than 80% of new funded accounts came from organic or referral channels (2020–Q1 2021). Dropbox's S-1 (2018) credits word of mouth, in-product referrals and content sharing for low acquisition cost. Its S&M spend was 28% of revenue (2017). — [Robinhood S-1](https://www.sec.gov/Archives/edgar/data/1783879/000162828021013318/robinhoods-1.htm); [Motley Fool](https://www.fool.com/investing/2018/02/28/dropbox-ipo-3-important-takeaways.aspx)
- **Blended CAC as a word-of-mouth proxy.** Block reports cost per new transacting active (paid marketing including referral fees and brand spend, divided by net-new transacting actives). It credits peer-to-peer network effects for CAC under $5 (2020). — [Square Q4 2020 8-K](https://www.sec.gov/Archives/edgar/data/1512673/000119312521052320/d128971dex991.htm); [Block 10-K FY2023](https://www.sec.gov/Archives/edgar/data/1512673/000162828024006354/sq-20231231.htm)
- **NPS critiques [RECALLED – not verified this session]:**
  - Keiningham, Cooil, Andreassen and Aksoy, "A Longitudinal Examination of Net Promoter and Firm Revenue Growth", *Journal of Marketing* 71(3), July 2007. Using Norwegian multi-industry data, they could not replicate Reichheld's claim that NPS is a superior predictor of growth versus other satisfaction metrics (e.g., ACSI).
  - The *Wall Street Journal* (May 2019, "The Dubious Management Fad Sweeping Corporate America") reported widespread gaming and weak validity of NPS in corporate use.
  - No URL was verified for either, so they are listed in Gaps.

### Inferences
- **Inroad word-of-mouth measurement stack**, in order of trust:
  1. **Referral-attributed activations**, tracked through invite codes, deep links and UTM parameters. This is the only direct measure of incentivized and inherent virality.
  2. **HDYHAU survey at signup.** Use a required single-select question plus an optional free-text field ("friend/family", "saw someone using it", "social post by someone I know", "creator/influencer", "search", "ad", "press", "app store", "other"). The friend, saw-someone and personal-social answers form the word-of-mouth bucket. Expect it to be noisier than tracked attribution.
  3. **Organic/direct share** of new activated users: total activated minus paid-attributed minus tracked-referral. Watch the trend, not the level.
  4. **Cohort k-factor estimate:** for signup cohort C (week w), K_C = (activated users attributed to C's invites or links, plus a WOM-attributed share from HDYHAU, within N weeks) ÷ |C|. Track K_C by cohort week. Rising cohort K with flat paid spend indicates genuine word of mouth.
  5. **Sean Ellis survey** of engaged users. Gate: run referral-program experiments only when "very disappointed" is ≥40% in the target segment.
- **NPS:** compute it if customers expect it, but do not use it as Inroad's growth or word-of-mouth target metric.

### Gaps
- The Keiningham et al. (2007) paper and the WSJ 2019 article were not retrieved, and URLs were not verified. Sourcing them should be a priority for the report.
- No sourced benchmark for HDYHAU accuracy versus tracked attribution, or for "dark social" share in consumer apps.
- No sourced published methodology for cohort-based k-factor estimation. The method above is an inference.

---

## 6. Network effects: NFX taxonomy; direct vs. indirect vs. data; Andrew Chen's *The Cold Start Problem*

### Takeaway
NFX counts 16 network-effect types, from strongest (physical and protocol direct effects) down through two-sided marketplaces and platforms, data effects, and weaker "social" effects (belief, bandwagon). It attributes 70% of tech value creation since 1994 to network effects, based on its own study. Andrew Chen's framework says you start with the smallest self-sustaining "atomic network", win the "hard side" (the roughly 1% who create most value), then replicate the network until tipping point and escape velocity. Atomic networks can be tiny: Zoom's is 2–3 people and Slack's is 5–10.

### Cited Findings
- **NFX taxonomy.** NFX says it "has identified 16 types of network effects, each with their own playbook". Earlier editions counted 13. NFX states that "different types of nfx are stronger or weaker than others, and they each work differently." — [NFX Network Effects Manual](https://nfx.com/post/network-effects-manual); [NFX masterclass: mapping the 16 network effects](https://nfx.com/masterclass/network-effects/mapping-the-16-network-effects); [Medium, NFX Network Effects Bible](https://medium.com/@nfx/the-network-effects-bible-c6a06b8ae75b)
- **NFX value claim.** Network effects are "responsible for 70% of the value created by tech companies since the Internet became a thing in 1994". Methodology: NFX's own three-year study, self-reported. — [NFX](https://nfx.com/post/network-effects-manual); [Cornell course summary](https://coursematerials.johnson.cornell.edu/details/9e525518)
- **NFX categories [RECALLED – not verified this session].**
  - **Direct** (same-side): physical (landlines, utilities), protocol (Ethernet, Bitcoin), personal utility (iMessage, WhatsApp), personal (Facebook), market network.
  - **Two-sided** (indirect): marketplace (eBay, Airbnb), platform (iOS, Windows), asymptotic marketplace (Uber, where value plateaus once ETAs are short).
  - **Data:** data network effects and tech-performance effects.
  - **Social:** language, belief, bandwagon (the strongest "real" effects are direct).
  - NFX and a16z both argue that **data network effects are weaker and rarer than founders claim**, because data value is often asymptotic or a scale effect (a16z: "The Empty Promise of Data Moats", Casado & Lauten, 2019).
  — [NFX](https://nfx.com/post/network-effects-manual)
- ***The Cold Start Problem*** (Andrew Chen, a16z general partner; Harper Business, 2021) draws on more than 100 interviews with founders of Slack, Uber, Airbnb, Tinder, Zoom, Dropbox, LinkedIn and others. Its central unit is the **atomic network**: "the minimum viable network of users needed for a stable, usable product to scale." — [Penguin](https://www.penguin.com.au/books/the-cold-start-problem-9781529190083); [Frog Capital review](https://frogcapital.com/think-frog/the-cold-start-problem-by-andrew-chen/)
- **Atomic network sizes (Chen, interview January 2022):** Zoom's is about 2–3 people (one call). Slack's is 5–10 people using it at once. A summary also cites Slack's "2,000-message" team threshold as a case study in the book. — [Food On Demand interview](https://foodondemand.com/01062022/andrew-chen-examines-the-cold-start-problem-for-platforms-like-uber-snackpass/); [YouExec summary](https://youexec.com/book-summaries/the-cold-start-problem-by-andrew-chen)
- **Slack threshold [RECALLED – not verified this session].** Stewart Butterfield reportedly said teams that had exchanged 2,000 messages had "really tried" Slack, and about 93% of them were still using it (First Round Review, c. 2015). Treat as **unverified** until sourced.
- **Hard side.** Chen stresses winning the "hard side" of the network (drivers, sellers, content creators — "the ~1% who do most of the work") by solving a hard problem for them. — [YouExec summary](https://youexec.com/book-summaries/the-cold-start-problem-by-andrew-chen)
- **Book stages [RECALLED – not verified this session].**
  1. The Cold Start Problem: build the atomic network.
  2. Tipping Point: replicate atomic networks network by network until the market tips (e.g., Tinder seeding parties and Greek life at USC; Uber launching city by city).
  3. Escape Velocity: three forces (engagement, acquisition and economic network effects).
  4. Hitting the Ceiling: saturation, spam, overcrowding, "the Law of Shitty Clickthroughs".
  5. The Moat: competing network vs. network.
  — [Frog Capital review](https://frogcapital.com/think-frog/the-cold-start-problem-by-andrew-chen/)

### Inferences
- **Encodable definitions for Inroad:**
  - *Direct (same-side) network effect:* each additional user raises value for other users of the same type (messaging, social).
  - *Indirect (cross-side) network effect:* more of side A raises value for side B (marketplaces, platforms).
  - *Data network effect:* usage data improves the product for all users. Inroad should challenge founders to show the product quality curve has not flattened.
  - *Asymptotic:* value plateaus after density hits a threshold (ride-hailing ETAs), so the moat is local and contestable.
- **Atomic-network sizing rule.** Before any launch, Inroad should require the founder to define the atomic network as (minimum number of users) × (the unit they must share: team, school, dorm, city block, category) × (activity threshold per week). Examples: Zoom = 2 people on one call; Slack = 5–10 coworkers active at once.
- **Hard-side-first rule.** Identify which side is harder to acquire and retain. It is usually supply or creators, at about 1% of users. Spend founder time there first, often with tools or subsidies that work before the network exists (see section 7).
- **Ceiling warning signals** (from the Chen framework; recalled): invite-conversion decay as the market saturates, declining click-through on growth channels, and new-user experience degraded by spam or overcrowding.

### Gaps
- The full NFX list of 16 types, with order and examples, could not be fetched. The category list above is recalled.
- The Cold Start stage definitions and specific numbers (Uber's tipping-point density, Tinder's USC launch details, Wikipedia's editor share) were not verified this session.
- The a16z "Empty Promise of Data Moats" essay (2019) was not retrieved, so the citation is recalled.

---

## 7. Marketplace cold start: supply vs. demand first, constraining, seeding, liquidity metrics

### Takeaway
Most marketplaces are supply-constrained and start by growing supply (14 of 17 in Lenny Rachitsky's research). Nearly all constrain the market by geography or category first. They seed supply manually with unscalable tactics (DoorDash PDF menus with founders delivering, Airbnb's founders photographing listings, Craigslist cross-posting, Poshmark's community events) or with single-player tools and generous terms (Faire's net 60 and free first-order returns). Liquidity should be tracked as fill or match rate with a category-specific time window. There is **no universally verified threshold**, and the often-cited "60% search-to-fill" is unverified.

### Cited Findings
- **Lenny's marketplace research.** Four steps: (1) constrain the marketplace by geography or category, (2) decide supply vs. demand focus, (3) grow supply, (4) grow demand.
  - 14 of 17 marketplaces tackled supply first. Only 3 of 17 were demand-constrained, e.g., Rover: "the scarce resource was demand… Supply was easy."
  - A secondary summary says Thumbtack was the only one that did not constrain.
  - In a 2019 Greylock podcast he put the supply-first share at about 80%.
  - Methodology: interviews with founders and early employees of marketplaces including Airbnb, Etsy, Instacart and Uber.
  — [Lenny's Newsletter](https://www.lennysnewsletter.com/p/how-to-kickstart-and-scale-a-marketplace); [Lenny, supply vs. demand step](https://www.lennysnewsletter.com/i/159750/step-decide-which-side-of-the-marketplace-to-concentrate-on); [Greylock podcast](https://greylock.com/blog/lessons-learned-growing-successful-marketplaces-2/); [Sharetribe podcast takeaways](https://sharetribe.com/twosided/ep12-five-takeaways-season-1-marketplace-podcast)
- **Lenny's core marketplace metrics (March 2022):** fill rate, bookings growth, supply growth, GMV growth, based on conversations with about a dozen marketplace founders. He calls "liquidity" an ambiguous term and quotes Alex Taussig: the prime directive of a marketplace is "to generate liquidity where none existed before." — [Lenny's Newsletter](https://www.lennysnewsletter.com/p/the-most-important-marketplace-metrics?open=false)
- **a16z "13 Metrics for Marketplace Companies"** (Jeff Jordan, Li Jin, D'Arcy Coolican, Andrew Chen; February 21, 2020).
  - **Match rate** (also "utilization rate" or "success rate"): "the rate at which buyers can find sellers, and vice versa. How to define this metric depends on the unique business." Examples: ride-hailing driver utilization (share of time with a passenger) and jobs marketplaces (roles filled, seekers placed).
  - **"Zeros"**: unsuccessful matches, such as users who open a rideshare app but never request a ride, driven by long waits or surge pricing.
  - Prescription: diagnose why matches fail and grow the constrained side.
  — [a16z](https://a16z.com/13-metrics-for-marketplace-companies/)
- **Liquidity definitions.** Buyer liquidity is "the likelihood that a request or a search leads to a transaction", e.g., the percentage of monthly search sessions ending in a purchase (search-to-fill). Supply-side sell-through is the share of listings that sell within a window (worked example: 75 of 100 listings sold within 30 days gives a 75% 30-day match rate). Measure the window in minutes for Uber-type marketplaces and in days or weeks for high-friction B2B. — [Point Nine, "WTF is Marketplace Liquidity?"](https://writing.pointnine.com/p/wtf-is-marketplace-liquidity); [Sharetribe glossary](https://www.sharetribe.com/marketplace-glossary/liquidity/)
- **"60% search-to-fill" claim.** "Marketplaces that achieve at least 60% search-to-fill rates typically experience exponential rather than linear growth", attributed to Marketplace Pulse. **Unverified**: not traced to Marketplace Pulse. — [FourWeekMBA](https://fourweekmba.com/marketplace-liquidity-the-physics-of-supply-and-demand-matching/)
- **DoorDash (2013).**
  - Stanford students built PaloAltoDelivery.com in about an afternoon: roughly eight PDF menus from local restaurants and a Google Voice number forwarding to their phones.
  - The co-founders were the only Dashers, using their own cars and Find My Friends. They charged a flat $6 fee with no minimum order.
  - First delivery: January 12, 2013.
  — [Vator, 2019](https://vator.tv/2019-01-04-when-doordash-was-young-the-early-years/); [Built In NYC](https://www.builtinnyc.com/articles/new-york-tech-companies-founding-stories); [Alexander Jarvis](https://www.alexanderjarvis.com/doordash-doing-things-that-dont-scale)
  - **Pattern:** demand test before supply contracts; list restaurants without permission; founders act as supply.
- **Airbnb (2009–2010).**
  - In 2009 the founders rented a $5,000 camera and photographed NYC listings door to door. They reportedly saw 2–3x bookings on those listings and NYC revenue doubling by month-end (widely repeated; **no primary Airbnb source found**). This led to a professional photography program in summer 2010.
  - In 2010 Airbnb reverse-engineered Craigslist posting, with no API, to cross-post listings with links back to Airbnb. Booking impact is undocumented.
  — [Snappr (vendor blog)](https://www.snappr.co/enterprise-blog/photography-that-launched-an-empire-how-airbnb-transformed-their-business-with-professional-photography); [Airtribe](https://airtribe.substack.com/p/growth-hacks-from-airbnb); [Young Urban Project](https://www.youngurbanproject.com/airbnb-case-study/)
- **Poshmark (community seeding).**
  - Modern Retail's coverage of the S-1 (December 2020): about four "Posh Parties" (virtual themed shopping events) per day, with active users about 17% above normal during them.
  - In-person "Posh 'N Sip" meetups run by local hosts grew from 162 events (2018) to 546 projected (2019). The company reported higher retention and "30–80% growth" among sellers who attended.
  - Q2 2022 earnings call: more than 80% of purchases are preceded by a social interaction (like, comment, offer).
  — [Modern Retail on S-1, Dec 2020](https://www.modernretail.co/startups/poshmarks-s-1-highlights-cutting-marketing-expenses-led-to-profitability/); [Modern Retail, Nov 2019](https://www.modernretail.co/retailers/how-poshmark-uses-small-local-events-to-drive-engagement-and-retention/); [Q2 2022 call transcript](https://www.fool.com/earnings/call-transcripts/2022/08/12/poshmark-inc-posh-q2-2022-earnings-call-transcript/); [Poshmark S-1](https://www.sec.gov/Archives/edgar/data/1825480/000119312520320132/d66583ds1.htm)
- **Faire (B2B2C wholesale; demand-side risk reversal).**
  - Retailers get net-60 payment terms and free returns on the first order with each brand.
  - Brands that bring retailers through Faire Direct links pay no commission on those orders. This is a supply-side "bring your own demand" incentive.
  — [Faire retailer support](https://www.faire.com/support/retailers); [Sacra](https://sacra.com/research/faire); [BusinessWire UK launch, 2021](https://businesswire.com/news/home/20210323005078/en/Wholesale-Marketplace-Faire-Launches-in-the-UK-to-Power-the-Growth-of-Independent-Retailers)

### Inferences
- **Encodable sequencing rules:**
  1. Constrain by geography and/or category until local liquidity is high. Expand only when the fill rate in the current atomic market is stable.
  2. Default to the supply side first (about 80% of cases), unless supply is abundant and easy to list (Rover), in which case focus on demand.
  3. Seed supply manually: scrape or aggregate existing listings with care for terms of service, have founders act as supply, do concierge onboarding, and photograph or create listings for suppliers.
  4. Give the hard side a single-player reason to join: tools, guaranteed demand, subsidies, or risk reversal such as Faire's terms.
  5. Add community events for supply retention (Poshmark).
- **Liquidity KPI for Inroad.** Fill rate = transactions ÷ requests (or searches), within a category-appropriate window. Track "zeros" (sessions with intent and no match) as a daily alert.
  - Inroad should not hard-code a universal threshold. Set a baseline in week 1, require week-over-week improvement in the constrained market, and gate geographic or category expansion on stable fill rate plus repeat rate.
  - Treat the 60% search-to-fill figure as unverified.
- **Seeding hygiene.** Craigslist-style cross-posting and listing restaurants without permission are historical tactics with ToS and legal risk today. Inroad should flag them as risky rather than recommend them as defaults.

### Gaps
- Etsy (recruiting sellers from craft forums and fairs) and Thumbtack seeding tactics were not researched before the search budget ran out.
- No verified liquidity benchmarks by category.
- Primary Airbnb sources for the NYC photography numbers were not found.
- The "come for the tool, stay for the network" phrase (attributed to Chris Dixon, 2015) was not verified this session, though OpenTable and Faire Direct fit the pattern.

---

## 8. Social and community products: density, tight-community seeding, campus ambassadors

### Takeaway
Social products tip when density inside a bounded community is high, so launch one campus or one school at a time. Facebook reached about half or more of Harvard undergraduates within a month (2004). tbh reportedly reached 40% of its first Georgia high school on day one (2017). Fizz claims 95% of Stanford undergraduates (founder-supplied). Paid ambassadors and per-install bounties (BeReal) can manufacture early installs, but growth bought this way fades: BeReal's daily users fell to about 6M by spring 2023. Bounties for app reviews also violate platform rules.

### Cited Findings
- **Facebook (Harvard, 2004).**
  - Launched February 4, 2004. Dustin Moskovitz recalls 1,200–1,500 registrants within 24 hours.
  - The Wikipedia-derived claim says more than half of Harvard undergraduates registered within the first month. A Lehigh course page says about three-quarters by the end of February 2004, citing the Crimson's February 9 story. These figures conflict, and the original Crimson article was not retrieved.
  — [History Hit](https://www.historyhit.com/2004-facebook-founded-mark-zuckerberg/); [Lehigh course page](https://www.lehigh.edu/~jl0d/J198-06/Facebook%2006.htm)
- **tbh / Gas (Nikita Bier).**
  - tbh (2017) launched at a single Georgia high school. Secondary accounts say 40% of students downloaded it within the first day or two, three more schools followed the next day, then about 300.
  - Rollouts targeted one new school at a time, every few weeks.
  - Gas (launched August 2022, largely based on tbh, and launched at the same high school) overtook TikTok and BeReal as the most-downloaded US App Store app by October 2022. The Wall Street Journal called it the hottest app.
  - Bier sold tbh to Meta (reportedly around $100M) and sold Gas to Discord after it passed 1M DAU.
  - The 40% figure is **unverified for Gas** specifically, and most sources are social posts.
  — [Alexander Jarvis on tbh](https://www.alexanderjarvis.com/tbh-doing-things-that-dont-scale/); [Luke Sophinos on X](https://twitter.com/lukesophinos/status/1628767928379379713?lang=en); [Intro on X](https://x.com/useintro/status/1747373532936634784); [SF Standard, Jul 2025](https://sfstandard.com/2025/07/02/nikita-bier-leads-product-x/); [Wikipedia, Gas (app)](https://en.wikipedia.org/wiki/Gas_(app))
- **Fizz (Stanford, 2021–2023).**
  - Launched at Stanford in summer 2021, originally as "Buzz".
  - January 2022: 5,100 Stanford users with about 80% weekly active (founder figures, Stanford Daily).
  - TechCrunch, citing the founder: 95% of about 7,600 undergraduates downloaded it, possibly inflated by free donuts for downloads. 50–60% of users on a campus open the app daily.
  - Fizz flyers claim 95% at Stanford, Dartmouth and Pepperdine.
  — [Stanford Daily, Jan 2022](https://stanforddaily.com/2022/01/23/from-buzz-to-fizz-anonymous-social-platform-takes-off-at-stanford/); [TechCrunch](https://techcrunch.com/?p=2408331); [Caltech tech blog, Mar 2023](https://tech.caltech.edu/2023/03/fizz-comes-to-campus/)
- **BeReal (2022).**
  - Spread on college campuses partly through a paid ambassador program. The Brown student paper, as reported by TechCrunch, described pay of $30 per referral and $50 for an app download plus a review. Business of Apps reported $6–8 per download, which conflicts.
  - DAU estimates conflict: over 10M (late August 2022), about 15M or 20M (October 2022). Daily users fell to about 6M by late spring 2023.
  - TechCrunch argued that at least some of the growth was "manufactured".
  — [TechCrunch, Apr 2022](https://techcrunch.com/2022/04/22/bereal-hype-or-hit-what-to-know-about-the-gen-z-photo-sharing-app-climbing-the-charts/amp); [Wikipedia, BeReal](https://en.wikipedia.org/wiki/BeReal); [Business of Apps](https://www.businessofapps.com/news/bereal-secures-60-million-in-series-b-funding-round); [Sacra](https://sacra.com/q/how-did-bereal-get-so-popular/)
- **Tinder (USC).** The *Cold Start Problem* case of seeding through parties and Greek life at USC is in the book. Details were not verified this session. — [Frog Capital review](https://frogcapital.com/think-frog/the-cold-start-problem-by-andrew-chen/)

### Inferences
- **Density-first launch rules for social and community products:**
  1. Choose one bounded community (school, dorm, team, club, neighbourhood) small enough to saturate in days.
  2. Pre-seed anticipation, for example by not accepting follows before launch and then opening all at once (tbh/Gas).
  3. Launch on a single day at a single time, so the community arrives together and the atomic network forms immediately.
  4. Target ≥40% of the community in the first 48 hours as an aspirational, anecdotal benchmark from tbh; it is not a verified norm.
  5. Expand to adjacent communities (neighbouring schools) only after the first shows strong day-7 retention.
- **Ambassador programs.** Pay for qualified, retained activity (week-2 active users), not installs or reviews. Paying for a "download + review" (as reported for BeReal) conflicts with Apple's rules on incentivized feedback and with FTC review rules (section 9). Inroad should flag this as non-compliant.
- **Anonymous or local social apps** (Yik Yak, Fizz) have high density potential but high moderation and safety risk at high school age.

### Gaps
- **Yik Yak [RECALLED – not verified this session]:**
  - Founded 2013 at Furman University and spread through about 1.5-mile geofenced local feeds.
  - Geofenced off high schools after bullying incidents, and shut down in 2017.
  - Relaunched in 2021 and later acquired by Sidechat (2023).
  - None of this was verified this session.
- The original Harvard Crimson figures for Facebook's adoption were not retrieved, and secondary figures conflict.
- No sourced data on campus ambassador program economics beyond BeReal.

---

## 9. Anti-patterns: spammy invites, contact uploads, incentive rules (Apple, Google, FTC, FCC/TCPA, courts)

### Takeaway
The hard rules for app-based invite and referral loops:
- Invites must be user-initiated and individualized. Apple bans "Select All" or default-select-all contacts, and Google requires the user to confirm content and recipients.
- The app must preview the message.
- Contact data must not be harvested into a database.
- Users must not be forced to rate, review or download other apps to get functionality.
- Referral manipulation is "discovery fraud".
- In the US, auto-sent app invites can make the app the legal "maker" of texts (FCC 2015). Unconsented reminder emails led to a $13M LinkedIn settlement. Incentivized forwards make the company the CAN-SPAM sender. Paying for sentiment-conditioned reviews is banned under the FTC's 2024 rule.

### Cited Findings
- **Apple App Store Review Guidelines** (fetched directly October 2026; the page's "last updated" date was not visible in the fetched text):
  - **3.2.2(x):** "Apps must not force users to rate the app, review the app, download other apps, or other store-related actions in order to access functionality, content, or use of the app. Apps may otherwise incentivize users to take specific actions within apps (such as by completing a level or watching an ad)." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **Section 3 introduction:** developers who "attempted to manipulate reviews, inflate your chart rankings with paid, incentivized, filtered, or fake feedback… [risk] expelling you from the Apple Developer Program." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **5.1.1(v):** "Pulling basic profile information, sharing to the social network, or inviting friends to use the app are not considered core app functionality." Inviting friends therefore cannot be a precondition for sign-in or account access. — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **5.1.1(iii):** "Where possible, use the out-of-process picker or a share sheet rather than requesting full access to protected resources like Photos or Contacts." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **5.1.1(iv):** apps "must respect the user's permission settings and not attempt to manipulate, trick, or force people to consent to unnecessary data access." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **5.1.2(i):** apps may not require users to enable system functionalities (push, location, tracking) "in order to access functionality, content, use the app, or receive monetary or other compensation, including but not limited to gift cards and codes." Referral rewards therefore cannot be conditioned on enabling push or tracking. — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **5.1.2(iv):** "Do not use information from Contacts, Photos, or other APIs that access user data to build a contact database for your own use or for sale/distribution to third parties." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **5.1.2(v):** "Do not contact people using information collected via a user's Contacts or Photos, except at the explicit initiative of that user on an individualized basis; do not include a Select All option or default the selection of all contacts. You must provide the user with a clear description of how the message will appear to the recipient before sending it (for example, What will the message say? Who will appear to be the sender?)." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **4.5.3:** "Do not use Apple Services to spam, phish, or send unsolicited messages to customers, including Game Center, Push Notifications, Live Activities, etc." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **4.5.4:** push notifications must not be used "for promotions or direct marketing purposes unless customers have explicitly opted in… and you provide a method in your app for a user to opt out." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **5.6.3 Discovery Fraud:** "Manipulating any element of the App Store customer experience such as charts, search, reviews, or referrals to your app erodes customer trust and is not permitted." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **5.6.1:** apps must use Apple's API to prompt for reviews; "we will disallow custom review prompts." — [Apple](https://developer.apple.com/app-store/review/guidelines/)
  - **3.2.1(vii):** person-to-person monetary gifts are allowed without in-app purchase if optional and if 100% goes to the receiver. **3.1.1:** unlocking digital features must use in-app purchase. Granting premium features as a referral reward may therefore raise 3.1.1 questions; this is an inference that needs a compliance check. — [Apple](https://developer.apple.com/app-store/review/guidelines/)
- **Google Play.** Message Spam policy: apps may not send SMS, email or other messages on the user's behalf without letting the user confirm the content and intended recipients. Google's example violation is an app that messages people when the user taps "Share" with no review step. The rule dates to an August 2012 policy update that followed the "Find and Call" app, which uploaded contact lists and spammed contacts. — [Google Play policy](https://support.google.com/googleplay/android-developer/answer/9899034?hl=en); [Droid Life, Aug 2012](https://www.droid-life.com/2012/08/01/google-play-developer-program-policy-receives-update-see-ya-shady-ads-spam-and-deceptive-apps/)
- **FTC v. Path (February 2013).**
  - Path settled charges that it deceived users by collecting address-book data without knowledge or consent. Version 2.0 of its iOS app auto-uploaded the address book at first launch and at each later sign-in.
  - The $800,000 civil penalty was for the COPPA charge (data from about 3,000 children under 13), not the address-book charge.
  - Path must run a comprehensive privacy program with independent assessments every other year for 20 years.
  — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2013/02/path-social-networking-app-settles-ftc-charges-it-deceived-consumers-improperly-collected-personal)
- **Perkins v. LinkedIn (N.D. Cal., 2015–2016).**
  - Judge Lucy Koh found members consented to importing contacts and sending the initial "Add Connections" invitation, but not to the two automatic reminder emails.
  - LinkedIn agreed to a $13M settlement fund (up to $3.25M in fees; class period September 17, 2011 – October 31, 2014), with final approval on February 16, 2016.
  - LinkedIn agreed to disclose that up to two reminders are sent and to let members cancel invitations to stop them. It denied wrongdoing.
  — [Lieff Cabraser](https://lieffcabraser.com/?p=3837); [Techlicious](https://www.techlicious.com/blog/linkedin-to-pay-13-million-settlement-for-add-connections-service-spam/); [Top Class Actions](https://topclassactions.com/lawsuit-settlements/closed-settlements/178821-linkedin-add-connections-class-action-settlement/)
- **FCC TCPA Declaratory Ruling (adopted June 18, 2015, 3–2 vote; released July 10, 2015).**
  - An app is the "maker or initiator" of invitational texts it sends automatically to a user's contacts with little user control. Glide's petition was denied on this basis.
  - TextMe was not the maker, because the user selected recipients and initiated each invite, even though TextMe controlled the message content.
  - "A contact's presence in an application user's contact list or address book does not, standing alone, establish consent."
  — [Manatt](https://www.manatt.com/insights/newsletters/tcpa-connect/fcc-issues-long-awaited-tcpa-declaratory-ruling-an); [Mintz](https://www.mintz.com/insights-center/viewpoints/2015-07-fcc-releases-declaratory-ruling-clarifying-and-expanding-reach); [Keller & Heckman](https://www.khlaw.com/insights/fcc-releases-much-anticipated-tcpa-declaratory-ruling-and-order)
- **CAN-SPAM forward-to-a-friend** (FTC final rule May 12, 2008, effective July 7, 2008; guidance in the Statement of Basis and Purpose). A company that offers any consideration for forwarding its commercial email, even a coupon, discount or sweepstakes entry, becomes the responsible sender. It must then honour opt-out and notice requirements and scrub the recipient against its suppression list. Merely encouraging forwarding, or a plain "forward" feature, is exempt. — [Willkie Farr](https://www.willkie.com/publications/2008/06/ftc-issues-new-rules-under-the-can-spam-act-of-2__); [Proskauer](https://privacylaw.proskauer.com/2008/06/articles/canspam/new-canspam-rule-gives-longawaited-answers/); [Hunton](https://huntonak.com/media/legal/2587_Can_Spam_Alert_5.08.pdf)
- **FTC Rule on Consumer Reviews and Testimonials (announced August 2024).**
  - Bans offering incentives conditioned, expressly or implicitly, on a review's sentiment. The FTC's example: "Tell us how much you loved your visit" plus a coupon violates the rule.
  - Does not ban incentivized reviews in general, provided the incentive is not tied to sentiment.
  - Also covers fake reviews (including AI-generated), buying reviews, and undisclosed insider reviews, and enables civil penalties against knowing violators.
  — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials); [Davis Wright Tremaine](https://dwt.com/insights/2024/08/ftc-finalizes-rule-banning-fake-consumer-reviews); [BCLP](https://bclplaw.com/en-US/events-insights-news/part-3-what-the-ftcs-final-rule-means-for-incentivized-reviews.html)

### Inferences
- **Hard-block compliance rules for Inroad** (never recommend):
  - Auto-sending invites to an uploaded address book.
  - "Select all" or pre-checked contact lists.
  - Unpreviewed messages sent in the user's name.
  - Automatic reminder emails or texts to invitees without clear, up-front disclosure and opt-out.
  - Requiring invites, ratings, reviews, push opt-in or tracking to unlock core functionality or rewards.
  - Paying for app-store reviews or for positive reviews.
  - Storing non-user contacts in a growth database.
  - Fake social proof (fake follower or download counts).
- **Safe-pattern defaults:**
  - Share sheet or OS contact picker.
  - Individually selected recipients.
  - Editable message preview that shows the sender.
  - SMS sent from the user's own messaging app (user as "maker").
  - Invite links rather than server-sent texts.
  - At most one disclosed reminder, with cancel.
  - Referral rewards gated on a qualifying in-product action and disclosed in terms.
  - When users post referral links publicly for a reward, require "#ad"/material-connection disclosure under the FTC Endorsement Guides (recalled; see Gaps).
- **Server-sent SMS invites:** treat as high legal risk (TCPA and state mini-TCPAs). **Incentivized email forwards:** must be CAN-SPAM compliant as the sender.

### Gaps
- **Facebook v. Duguid** (US Supreme Court, April 2021), which narrowed the TCPA "autodialer" definition, and state mini-TCPA laws such as Florida's 2021 FTSA amendments were not verified this session [RECALLED]. Counsel should confirm current TCPA exposure for app-initiated texts.
- **FTC Endorsement Guides revision (June 2023)** and how it applies to referral-link posts by rewarded users: not verified this session [RECALLED].
- **FTC Reviews Rule effective date:** recalled as October 21, 2024, not verified. Any later litigation or amendments were not checked.
- **FTC's 2022 "Bringing Dark Patterns to Light" staff report** and any FTC case specifically about deceptive invite flows (e.g., state AG actions against Tagged, c. 2009–2010) were not retrieved.
- The current Google Play policy page text was not fetched verbatim. The rule above comes from a search summary.
