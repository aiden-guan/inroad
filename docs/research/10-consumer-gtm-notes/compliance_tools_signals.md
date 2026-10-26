# Consumer GTM: compliance and platform rulebook, tool/API landscape, and free public signals (for Inroad consumer mode)

*Method note for the report writer: researched 2026-10-26. This is not legal advice. Direct page fetches were blocked for most hosts in this session: ecfr.gov, ftc.gov, support.google.com, Yahoo, posthog.com, stripe.com, modash.io, rewardful.com, appfigures.com, producthunt.com API docs, developers.google.com and performance-partners.apple.com all failed. Only developer.apple.com and github.com could be fetched directly, and Apple text is quoted verbatim from those fetches. Everything else comes from web-search result summaries, which often surfaced primary-source URLs and quoted text. reddit.com was not reachable even through search. The shared web-search budget ran out before the creator, referral, app-intelligence, community and social-listening tool searches could run, so those tools appear only under Gaps, labelled as unverified prior knowledge.*

## 1. Consumer email marketing: CAN-SPAM, mailbox-provider bulk-sender rules, GDPR/ePrivacy, UK PECR, CASL

### Takeaway
In the US, consumer marketing email is opt-out. CAN-SPAM requires five things:
- accurate headers
- a subject line that is not deceptive
- an ad disclosure
- a physical postal address
- a working opt-out, honored within 10 business days

Gmail, Yahoo and Microsoft set stricter technical rules for senders of 5,000 or more messages a day:
- SPF, DKIM and DMARC authentication
- RFC 8058 one-click unsubscribe
- unsubscribes honored within about 2 days
- a spam rate kept below 0.3%

The EU, UK and Canada are opt-in for consumers. Each has a narrow existing-customer "soft opt-in" exception.

### Cited Findings
**CAN-SPAM (US; 15 U.S.C. 7701 et seq.; 16 CFR Part 316)**
- All commercial email must comply, not just bulk email. That includes messages to former customers announcing a new product line. — [FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- Core requirements:
  - Header information must not be false or misleading.
  - Subject lines must not be deceptive.
  - The message must clearly and conspicuously disclose that it is an advertisement.
  - It must include a valid physical postal address. That can be a street address, a USPS-registered PO box, or a private mailbox registered with a commercial mail receiving agency.
  - It must tell recipients how to opt out.

  — [FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- Opt-out rules:
  - Opt-outs must be honored within 10 business days.
  - The mechanism must keep working for at least 30 days after the message is sent.
  - Senders cannot charge a fee or ask for personal information beyond the email address. The recipient can be asked only to reply to an email or visit a single web page.
  - A menu of message categories is allowed, but it must include an option to stop all commercial messages.
  - Opted-out addresses cannot be sold or transferred.

  — [FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business); [FTC 2008 CAN-SPAM rule, 16 CFR 316](https://www.ftc.gov/sites/default/files/documents/federal_register_notices/definitions-and-implementation-under-can-spam-act-16-cfr-part-316/080521canspamact.pdf)
- Penalties run up to $53,088 per violating email, per the FTC guide. That figure is inflation-adjusted each year, so confirm the current amount. — [FTC CAN-SPAM Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

**Gmail (requirements effective February 2024)**
- Bulk sender threshold: the FAQ wording is "close to 5,000 messages" in 24 hours to personal Gmail accounts. All mail from the same primary domain counts toward the limit. The main guidelines page says "more than 5,000," so Google words the threshold differently on different pages. — [Gmail Email sender guidelines FAQ](https://support.google.com/mail/answer/14229414?hl=en); [Gmail Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en)
- Spam rate:
  - Keep the spam rate (user-reported, as shown in Postmaster Tools) below 0.1%, and never let it reach 0.3% or higher.
  - Bulk senders above 0.3% are ineligible for mitigation. They regain eligibility after 7 consecutive days below 0.3%.

  — [Gmail Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en); [Gmail FAQ](https://support.google.com/mail/answer/14229414?hl=en)
- One-click unsubscribe:
  - Marketing and subscribed messages must support it, using both the `List-Unsubscribe-Post` and `List-Unsubscribe` headers.
  - A mailto link or a landing page alone does not satisfy the requirement.
  - Transactional mail, such as password resets, is exempt.
  - Unsubscribes must be honored within 48 hours.

  — [Gmail Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en)
- Authentication: bulk senders need SPF, DKIM and DMARC. A DMARC policy of `p=none` is acceptable. — [Gmail Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en); [Google blog announcement](https://blog.google/products-and-platforms/products/gmail/gmail-security-authentication-spam-protection/)
- Google also publishes separate "Email subscription guidelines for senders." The contents were not retrieved in this session. — [Gmail Email subscription guidelines](https://support.google.com/mail/answer/15263077)
- From November 2025, Gmail moved from warnings to temporary deferrals (4xx) and rejections (5xx) for non-compliant traffic. This comes from deliverability-vendor reports, not a Google page retrieved here. — [Red Sift](https://redsift.com/blog/gmails-enforcement-ramps-up-what-bulk-senders-need-to-know); [PowerDMARC](https://powerdmarc.com/gmail-enforcement-email-rejection/)

**Yahoo (February 2024; from secondary sources, Yahoo's own page not retrieved)**
- Yahoo requires SPF, DKIM and DMARC, plus RFC 8058 one-click unsubscribe through List-Unsubscribe headers.
- Unsubscribes must be honored within 2 days.
- The spam complaint rate ceiling is 0.3%, and 0.1% is described as a warning level.

  — [Mailgun webinar takeaways](https://www.mailgun.com/blog/deliverability/gmail-yahoo-webinar-key-takeaways/); [Bird knowledge base](https://bird.com/docs/knowledge-base/deliverability/gmail-yahoo-requirements); [Warmy guide](https://www.warmy.io/guides/google-yahoo-sender-requirements/)

**Microsoft Outlook.com, Hotmail and Live (enforced from May 5, 2025)**
- Applies to domains sending more than 5,000 emails a day.
- Requirements:
  - SPF must pass.
  - DKIM must pass.
  - DMARC must be at least `p=none` and aligned with SPF or DKIM, preferably both.
- Recommended practices: valid From and Reply-To addresses, a working unsubscribe, list hygiene, and subject lines that are not deceptive.

  — [Microsoft Tech Community, Apr 2, 2025 post with Apr 29 update](https://techcommunity.microsoft.com/blog/outlook/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730); [dmarcian](https://dmarcian.com/microsoft-enforces-spf-dkim-dmarc/)
- Secondary sources report that non-compliant mail is rejected with `550 5.7.15 Access denied` rather than sent to junk. Microsoft's April 29 update changed the enforcement action, and its final wording was not retrieved. — [Site24x7](https://www.site24x7.com/blog/microsoft-outlook-new-email-authentication-requirements)

**EU: ePrivacy Directive 2002/58/EC, Article 13**
- Art. 13(1): email direct marketing is allowed only to subscribers or users "who have given their prior consent." — [Directive 2002/58/EC (EUR-Lex)](https://eur-lex.europa.eu/LexUriServ/LexUriServ.do?uri=OJ%3AL%3A2002%3A201%3A0037%3A0047%3AEN%3APDF)
- Art. 13(2), the soft opt-in: contact details obtained "in the context of the sale of a product or a service" may be used to market the sender's own similar products or services. The customer must be given a clear, free and easy chance to object, both at collection and in every message. — [Directive 2002/58/EC](https://eur-lex.europa.eu/LexUriServ/LexUriServ.do?uri=OJ%3AL%3A2002%3A201%3A0037%3A0047%3AEN%3APDF)
- In Case C-654/23 (2025), the CJEU read "sale" broadly as an existing customer relationship. It confirmed that the products must be similar products of the sender itself, and that the right to object must be offered at collection and in each message. — [CJEU C-654/23 (EUR-Lex)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A62023CJ0654)
- The ePrivacy Directive still applies. The Commission has proposed withdrawing the ePrivacy Regulation proposal. — [EP answer E-10-2025-001963](https://www.europarl.europa.eu/doceo/document/E-10-2025-001963-ASW_EN.html)

**UK: PECR regulation 22**
- Marketing email to individuals requires specific consent or the soft opt-in.
  - The soft opt-in covers existing customers who bought or negotiated to buy a similar product or service.
  - The sender must have offered an opt-out at collection and in every message.
  - It does not cover prospects or bought-in lists.

  — [ICO, Electronic mail marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/)
- Regulation 22 does not apply to corporate subscribers. Sole traders and some partnerships count as individuals. — [ICO, B2B marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/)
- The Data (Use and Access) Act 2025 adds a charity soft opt-in at regulation 22(3A). The ICO's direct marketing advice generator shows updates dated 28 April 2026. — [ICO direct marketing advice generator](https://ico.org.uk/for-organisations/advice-for-small-organisations/direct-marketing-and-data-protection/direct-marketing-advice-generator/); [Brabners](https://www.brabners.com/insights/data-protection/data-use-and-access-act-2025-how-opt-in-rules-are-changing-for-charities)
- Commencement of the DUAA PECR changes is disputed:
  - One commentary says the charity soft opt-in has applied since 5 February 2026.
  - UEA and Blake Morgan described these provisions as not yet in force or only partly in force when they wrote.
  - The higher PECR fine cap (the UK GDPR level, £17.5m or 4% of turnover) depends on commencement.

  — [ProArtsPlus](https://proartsplus.co.uk/?p=1642); contradicted by [UEA Law School](https://www.uea.ac.uk/about/law-school/research/research-blog/modernising-uk-e-privacy:-duaa-s-reform-of-pecr) and [Blake Morgan](https://www.blakemorgan.co.uk/data-use-and-access-act-2025-privacy-and-electronic-communications-regulations/); fine cap per [Cripps](https://www.cripps.co.uk/thinking/the-impact-of-the-data-use-and-access-act-on-uk-data-protection-law/)
- Enforcement example: the ICO fined ZMLUK Ltd £105,000 for emails sent without valid consent or soft opt-in. — [ICO ZMLUK monetary penalty notice](https://cy.ico.org.uk/media2/ltodxokk/monetary-penalty-notice-zmluk-ltd.pdf)

**Canada: CASL**
- Every commercial electronic message (CEM) needs three things: consent, identification of the sender, and an unsubscribe mechanism. — [ISED, Getting consent to send email](https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/getting-consent-send-email)
- Express consent:
  - It must be opt-in. Pre-checked boxes, silence and inaction do not count.
  - It does not lapse, but it can be withdrawn.

  — [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm)
- Implied consent:
  - It arises from an existing business relationship and is time-limited: 2 years from a purchase under s.10(10)(a), and 6 months from an inquiry under s.10(10)(e).
  - An abandoned cart is not a purchase.

  — [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm); [CRTC implied consent guidance](https://crtc.gc.ca/eng/com500/guide.htm)
- Unsubscribe:
  - The mechanism must stay valid for at least 60 days after sending.
  - Requests must be processed within 10 business days, at no cost to the recipient.

  — [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm); [ISED](https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/getting-consent-send-email)
- The sender must prove consent. — [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm)

### Inferences
- Candidate lint rules for consumer marketing email copy. Where regimes differ, each rule uses the strictest one.
  - `EMAIL.ADDRESS`: block if there is no physical postal address in the footer.
  - `EMAIL.OPTOUT`: block if there is no unsubscribe link or instruction. Warn if the unsubscribe path needs a login or asks for more than an email address.
  - `EMAIL.AD_DISCLOSURE`: warn if a promotional email has no "advertisement" or equivalent identification.
  - `EMAIL.SUBJECT_DECEPTIVE`: warn on subject lines that misrepresent content. This is a heuristic based on the FTC's "no deceptive subject lines." Patterns to flag: a fake "Re:" or "Fwd:" on a first touch, a false "your order," and false urgency.
  - `EMAIL.SENDER_CONFIG`: this is a sending-tool configuration check, not a copy check, because Inroad does not send. For volumes near or above 5,000 a day, confirm SPF, DKIM, DMARC, the `List-Unsubscribe` plus `List-Unsubscribe-Post` headers, and unsubscribe handling within 48 hours.
- Consent basis by audience: US consumers are opt-out under CAN-SPAM. EU and UK consumers need consent or the soft opt-in, which covers only existing customers and similar products. Canada needs express or still-valid implied consent. A consumer-mode linter should therefore require a "consent basis" field per audience and refuse "cold email to consumers" drafts for EU, UK or CA recipients.
- Inroad's B2B cold-email playbooks (Instantly, Smartlead, Lemlist) do not transfer to consumers in the EU, UK or Canada. In the US they are legal under CAN-SPAM only if the five requirements are met. They also run up against mailbox-provider complaint thresholds, where 0.3% is 3 complaints per 1,000 messages.

### Gaps
- Gmail's "all senders" requirements could not be fetched directly. Prior knowledge, unverified in this session, says they include SPF or DKIM, valid forward and reverse DNS (PTR), TLS, RFC 5322 formatting, and a spam rate below 0.3%.
- Yahoo's own sender page and Microsoft's final enforcement wording could not be retrieved.
- The DUAA 2025 commencement status for the PECR fines and the charity soft opt-in is conflicting. Check the commencement regulations on legislation.gov.uk.
- The current inflation-adjusted CAN-SPAM penalty for 2026 was not confirmed.

## 2. SMS and text marketing: TCPA, FCC 2025–2026 status, CTIA, 10DLC

### Takeaway
- The FCC's one-to-one consent rule never took effect. The 11th Circuit vacated it on January 24, 2025, and the FCC then restored the prior rule text.
- The FCC's "revoke-all" provision, 47 CFR 64.1200(a)(10), is delayed to January 31, 2027. The rest of the 2024 revocation order is in force.
- Quiet hours (8 a.m. to 9 p.m. in the recipient's local time) apply to telephone solicitations, and they are a live area for class actions.
- On the carrier side, CTIA principles and 10DLC registration set the de facto rules: opt-in confirmation, STOP and HELP.

### Cited Findings
- **One-to-one consent rule vacated.**
  - Case: *Insurance Marketing Coalition v. FCC*, No. 24-10277 (11th Cir., Jan. 24, 2025).
  - Holding: the FCC exceeded its TCPA authority. The rule conflicted with the ordinary meaning of "prior express consent," and the court relied on *Loper Bright*.
  - Both the one-to-one requirement and the "logically and topically associated" requirement were struck down.

  — [Perkins Coie](https://perkinscoie.com/insights/update/fccs-one-one-consent-rule-vacated-whats-next-tcpa-compliance); [Reed Smith](https://www.reedsmith.com/our-insights/blogs/technology-law-dispatch/102k2uj/eleventh-circuit-vacates-fcc-one-to-one-consent-rule/); [Morrison Foerster](https://mofo.com/resources/insights/250130-eleventh-circuit-vacates-fcc-s-tcpa-one-to-one-consent-rule)
- About an hour before the decision, the FCC had already postponed the rule to January 26, 2026. — [NCLC](https://www.nclc.org/consumers-denied-relief-from-unwanted-telemarketing-calls-after-federal-court-scraps-consent-rule/)
- The FCC later removed the vacated language and reinstated the prior version of the rule. — [Womble Bond Dickinson](https://www.womblebonddickinson.com/us/node/21214)
- **Revoke-all delayed.**
  - FCC CGB Order DA-26-12A (January 6, 2026) moved the effective date of the cross-channel revocation provision in 47 CFR 64.1200(a)(10) to January 31, 2027.
  - History: originally April 2025, then waived to April 2026, now January 2027, pending an October 2025 FNPRM on modifying or replacing the provision.

  — [Burr & Forman](https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027); [Privacy World](https://www.privacyworld.blog/2026/01/fcc-extends-waiver-of-tcpa-consent-rule-providing-stop-one-means-stop-all/); [Consumer Financial Services Law Monitor](https://www.consumerfinancialserviceslawmonitor.com/2026/01/fcc-further-extends-effective-date-for-tcpa-revoke-all-rule/)
- What remains in force from the 2024 consent order: the shortened opt-out timeframe, the opt-out confirmation message requirement, and the duty to honor revocations made by any reasonable means. — [Convoso](https://www.convoso.com/news/fcc-extends-tcpa-consent-revocation-rule-to-2027/); [Burr & Forman](https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027)
- **Quiet hours.** 47 CFR 64.1200(c)(1) limits telephone solicitations to 8 a.m. to 9 p.m. in the called party's local time. The definition of "telephone solicitation" excludes messages sent with the recipient's prior express invitation or permission. — [Privacy World](https://www.privacyworld.blog/2025/03/new-class-action-threat-tcpa-quiet-hours-and-marketing-messages/); [InfoLawGroup](https://www.infolawgroup.com/insights/2025/3/26/do-you-need-to-stop-sending-texts-at-nightearly-morning); [47 CFR 64.1200 text (CompliancePoint copy)](https://compliancepoint.com/wp-content/uploads/2025/03/47-CFR-64.1200.pdf)
- In early 2025, one plaintiffs' firm filed more than 100 class actions alleging marketing texts outside 8 a.m. to 9 p.m. — [Privacy World](https://www.privacyworld.blog/2025/03/new-class-action-threat-tcpa-quiet-hours-and-marketing-messages/)
- An e-commerce trade group, the EIA, petitioned the FCC to rule that people who gave prior express written consent cannot recover damages for texts received during quiet hours. The results did not show an FCC ruling. — [EIA petition (Orrick InfoBytes copy)](https://infobytes.orrick.com/wp-content/uploads/PETITION-FOR-DECLARATORY-RULING-1.pdf)
- **Prior express written consent (PEWC), 47 CFR 64.1200(f)(9)** requires a written agreement, signed by the consumer, authorizing the seller to deliver autodialed or prerecorded telemarketing to a specified number, with a clear and conspicuous disclosure. A 2025 Federal Register notice reprints the revised definition. — [Federal Register, Aug 29, 2025](https://www.govinfo.gov/content/pkg/FR-2025-08-29/html/2025-16641.htm); [Federal Register, Nov 6, 2024](https://www.govinfo.gov/content/pkg/FR-2024-11-06/html/2024-24908.htm)
- **CTIA Messaging Principles** (paraphrased by carriers and aggregators; the CTIA document itself was not retrieved):
  - Recurring programs must send a single opt-in confirmation. It must include the program or brand name, customer-care contact details, a message-frequency disclosure, "Message and data rates may apply," and opt-out instructions.
  - Senders must respond to the HELP keyword.
  - STOP is the minimum opt-out keyword, and the FCC requires honoring opt-outs by "any reasonable means."

  — [Telnyx](https://telnyx.com/resources/ctia-sms-guidelines); [Sinch](https://www.sinch.com/blog/sms-compliance-guide/); [Dialpad](https://help.dialpad.com/hc/en-us/articles/54907803504283-SMS-Messaging-Compliance-Principles-Best-Practices); [Bird](https://bird.com/explained/compliance/what-are-the-ctia-messaging-principles)
- **10DLC.** The brand and each campaign are registered, including the call to action and the opt-out language. Unregistered long-code (A2P) traffic is filtered aggressively. — [Clickatell](https://clickatell.com/help-center/sms/10dlc-us-long-numbers/10dlc-messaging-best-practices); [Bird](https://bird.com/explained/compliance/what-are-the-ctia-messaging-principles)

### Inferences
- Candidate lint rules for SMS copy and flows:
  - `SMS.CONSENT_COPY`: an opt-in form or keyword CTA must name the brand, state frequency ("recurring automated marketing texts," "X msgs/mo"), include "Msg & data rates may apply," give STOP and HELP instructions, link to terms and privacy, and say consent is not a condition of purchase.
    - Most of this list comes from the CTIA paraphrases above.
    - "Consent is not a condition of purchase" is a PEWC disclosure element under 64.1200(f)(9). It is prior knowledge whose exact text was not retrieved here.
  - `SMS.CONFIRMATION`: the first message must confirm the opt-in and carry the same disclosures.
  - `SMS.EVERY_MSG_ID`: each marketing text should identify the brand and include opt-out language such as "Reply STOP to opt out." This is industry practice, not verified CTIA text.
  - `SMS.QUIET_HOURS`: given the litigation risk, warn on any marketing SMS scheduled outside 8 a.m. to 9 p.m. in the recipient's local time, even with consent.
  - `SMS.NO_ONE_TO_ONE_DEPENDENCY`: do not encode the vacated one-to-one consent rule as federal law.
  - `SMS.REVOKE_ALL_2027`: track the 2027 revoke-all date as pending, not current law.
- SMS is high-risk for an AI drafting product. TCPA private actions carry statutory damages. Inroad should treat any SMS draft as consent-gated, never generate lists of phone numbers, and push sending to compliant ESPs or SMS tools such as Attentive, Postscript or Klaviyo SMS.

### Gaps
- The CTIA Messaging Principles text and The Campaign Registry's current requirements were not retrieved directly.
- The exact current text of the 2024 revocation order provisions now in force was not retrieved. Prior knowledge, unverified: honor revocations within 10 business days, and send at most one confirmation text within 5 minutes.
- State "mini-TCPA" laws were not researched, for example Florida's FTSA and Oklahoma's, with stricter consent rules and hours.
- Whether the FCC ruled on the EIA quiet-hours petition after March 2025 is unknown.
- No later FCC action on the revoke-all FNPRM after January 2026 was found.

## 3. Endorsements, influencer disclosure, and reviews: FTC rules, Apple, Google Play, Amazon

### Takeaway
- **FTC Reviews Rule (16 CFR Part 465, effective October 21, 2024).** It bans fake and AI-generated reviews, buying reviews, incentives conditioned on sentiment, undisclosed insider reviews, fake "independent" review sites, review suppression, and fake social-media indicators. Violations carry civil penalties.
- **Endorsement Guides (16 CFR 255).** Material connections, including free product, must be disclosed clearly and conspicuously.
- **App stores are stricter than the FTC.** Apple bans custom review prompts and any incentivized or manipulated ratings. Google Play bans any reward for a rating.
- **Amazon.** Free product in exchange for a review is allowed only through Vine.

### Cited Findings
**FTC Reviews Rule (16 CFR Part 465)**
- Published in the Federal Register in August 2024. Effective 60 days after publication, on October 21, 2024. An FTC 2025 warning-letter template says the rule "became fully effective on October 21, 2024 and has the full force and effect of federal law." — [Federal Register 2024-18519](https://www.federalregister.gov/documents/2024/08/22/2024-18519/trade-regulation-rule-on-the-use-of-consumer-reviews-and-testimonials); [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials); [FTC 2025 warning template](https://www.ftc.gov/system/files/ftc_gov/pdf/2025-Fake-Review-Warning-Template.pdf)
- Banned practices:
  - **Fake or false reviews and testimonials.** Writing, creating, selling, buying or procuring reviews that misrepresent the reviewer, including AI-generated or nonexistent people, or misrepresent their experience. Disseminating such reviews when the business knew or should have known they were fake. — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials); [eCFR Part 465](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-465)
  - **Sentiment-conditioned incentives.** Providing compensation or other incentives "conditioned on the writing of consumer reviews expressing a particular sentiment, either positive or negative." The condition can be express or implied. — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
  - **Insider reviews** without clear and conspicuous disclosure of the material connection. — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
  - **Company-controlled review websites** misrepresented as independent. — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
  - **Review suppression.** Using unfounded legal threats, physical threats, intimidation or certain false accusations to prevent or remove negative reviews. Also misrepresenting that displayed reviews are all or most reviews when some were suppressed for rating or sentiment. — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
  - **Fake social-media indicators.** Buying or selling fake followers or views generated by bots or hijacked accounts. — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
- Allowed: incentives for reviews that have no express or implied sentiment requirement, and simply asking satisfied customers to update their reviews. — [FTC Reviews Rule Q&A](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers)

**FTC Endorsement Guides (16 CFR Part 255)**
- The current eCFR text defines "clear and conspicuous" as difficult to miss and easily understandable by ordinary consumers. Visual disclosures must stand out by size, contrast, location and duration, and audio plus visual is preferred. — [eCFR 16 CFR 255](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255)
- §255.5 requires disclosing connections the audience would not expect that could affect the weight given to an endorsement. Examples include business or family relationships, payment, free or discounted products, and early access. — [eCFR 16 CFR 255.5](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255/section-255.5)
- FTC influencer guidance:
  - The disclosure must appear above the "more" button.
  - A disclosure in the comments is not clear and conspicuous.
  - Responsibility sits with the influencer and the brand, not the platform.
  - Affiliate-link commissions must be disclosed.

  — [FTC, Endorsement Guides: What People Are Asking](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking)
- The FTC published the final revised Guides as document P204500. — [FTC final Guides PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/P204500%20Guides%20Concerning%20Endors%20and%20Testimonials.pdf); 2022 proposal at [Federal Register 2022-12327](https://public-inspection.federalregister.gov/2022-12327.pdf)

**Apple App Store Review Guidelines (verbatim from developer.apple.com, fetched 2026-10-26)**
- 5.6.1: "Use the provided API to prompt users to review your app; this functionality allows customers to provide an App Store rating and review without the inconvenience of leaving your app, and we will disallow custom review prompts." Developer responses to reviews must not include "personal information, spam, or marketing." — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- Section 3 introduction: "If we find that you have attempted to manipulate reviews, inflate your chart rankings with paid, incentivized, filtered, or fake feedback, or engage with third-party services to do so on your behalf, we will take steps to preserve the integrity of the App Store, which may include expelling you from the Apple Developer Program." — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 3.2.2(x): "Apps must not force users to rate the app, review the app, download other apps, or other store-related actions in order to access functionality, content, or use of the app." — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 5.6.3: "Manipulating any element of the App Store customer experience such as charts, search, reviews, or referrals to your app erodes customer trust and is not permitted." — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- 4.5.4: push notifications "should not be used for promotions or direct marketing purposes unless customers have explicitly opted in to receive them via consent language displayed in your app's UI, and you provide a method in your app for a user to opt out." — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- The system prompt can be shown "up to three times in a 365-day period." Apple recommends asking after the user completes an action, level or task, without interrupting. Developer replies to reviews must not include "marketing language, or spam." — [Apple, Ratings, reviews, and responses](https://developer.apple.com/app-store/ratings-and-reviews/)

**Google Play**
- Developers must not offer rewards or incentives for ratings or reviews, use deceptive pop-ups, force users to rate, or use automated services to inflate installs or ratings.
- Google's example violation is a notification that offers a discount for a high rating.
- Reviews that promote coupons, codes or links are also prohibited.

  — [Play Console Help, User Ratings, Reviews, and Installs](https://support.google.com/googleplay/android-developer/answer/9898684?hl=en)

**Amazon**
- Free or discounted product in exchange for a review is allowed only through Amazon Vine. In Vine, Amazon picks the reviewers and does not influence content.
- Sellers may ask for honest feedback but must not offer compensation for it.

  — [About Amazon, Update on customer reviews](https://aboutamazon.com/news/innovation-at-amazon/update-on-customer-reviews); [eDesk (secondary)](https://www.edesk.com/blog/avoid-review-manipulation-amazon/)

### Inferences
- Candidate lint rules:
  - `REVIEW.SENTIMENT_INCENTIVE` (block): any offer tied to positive sentiment or star level. Example patterns: "5-star review" plus a reward; "leave a positive review and get"; "if you love it, review us for".
  - `REVIEW.APPSTORE_INCENTIVE` (block): any reward for an App Store or Google Play rating or review, even if neutral. Both stores ban any incentive, which is stricter than the FTC.
  - `REVIEW.CUSTOM_PROMPT` (warn on iOS in-app copy): custom "Rate us" dialogs that bypass the system prompt. A common pre-prompt pattern, "Enjoying the app? Yes/No," then the system prompt only on "Yes," is a known gray area. Flag it for human review.
  - `REVIEW.GATING` (warn): copy routing happy users to public reviews and unhappy users to private support. This can amount to misrepresenting displayed reviews or suppression under §465. It is an inference; the FTC text retrieved does not name "review gating."
  - `REVIEW.FAKE` (block): drafts that write reviews or testimonials "as a customer," or AI-generated testimonials.
  - `REVIEW.INSIDER` (warn): staff, founder or family reviews without disclosure.
  - `REVIEW.AMAZON_FREE_PRODUCT` (block): free product for an Amazon review outside Vine.
  - `ENDORSE.DISCLOSURE` (block for creator briefs and UGC scripts): paid, gifted or affiliate content must include a clear disclosure such as "#ad," "Paid partnership" or "I got this free from X." The disclosure goes in the first lines or on-screen, not only in comments or behind "more."
  - `PUSH.MARKETING_OPTIN` (warn): iOS promotional push copy needs an in-app opt-in with an opt-out.

### Gaps
- The exact final adoption and publication date of the 2023 Endorsement Guides revision was not confirmed in this session. The current eCFR text reflects the revised "clear and conspicuous" definition. Prior knowledge, unverified: the FTC approved it June 29, 2023, and it was published in July 2023.
- The civil-penalty amount per violation under Part 465 was not confirmed.
- The details of Amazon's "Request a Review" button policy and current Vine terms were not retrieved.
- The current section numbers in Google Play policy were not verified against the live page.

## 4. Claims substantiation: health, earnings, Made in USA, environmental, "free," negative-option; linter trigger words

### Takeaway
- **Health claims** generally need randomized controlled human clinical trials.
- **Earnings claims** must reflect typical results. Small-print "results not typical" does not cure them.
- **"Made in USA"** on labels means "all or virtually all."
- **Environmental claims** still follow the 2012 Green Guides. The FTC review opened in 2022 has not produced a final revision.
- **"Free" offers** must state their conditions clearly and conspicuously at the outset.
- **Subscription cancellation.** The FTC "click-to-cancel" rule was vacated in July 2025. ROSCA and state automatic-renewal laws still apply.

### Cited Findings
- **Health (FTC Health Products Compliance Guidance, Dec 2022).**
  - Health-benefit claims generally need "randomized, controlled human clinical testing" to meet the "competent and reliable scientific evidence" standard.
  - No minimum number of RCTs is required, but independent replication adds weight, and quality matters more than quantity.
  - Epidemiological evidence is accepted only where RCTs are not feasible and experts accept the substitute.

  — [FTC Health Products Compliance Guidance](https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance); [PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/Health-Products-Compliance-Guidance.pdf); [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2022/12/ftc-announces-new-business-guidance-marketers-sellers-health-products)
- **Earnings.**
  - In October 2021 the FTC sent Notices of Penalty Offenses on money-making claims to more than 1,100 businesses. Penalties were then up to $43,792 per violation and were later inflation-adjusted, with $46,517 cited in later filings.
  - The notice treats as unlawful any claim that participants will make a profit, or that represented profits are typical.
  - An earnings testimonial requires substantiation that the result is representative.

  — [FTC press release, Oct 2021](https://www.ftc.gov/news-events/news/press-releases/2021/10/ftc-puts-businesses-notice-false-money-making-claims-could-lead-big-penalties); [FTC business blog](https://www.ftc.gov/news-events/blogs/business-blog/2021/10/one-money-latest-notice-penalty-offenses-takes-deceptive); [FTC warning letter quoting the notice](https://www.ftc.gov/system/files/warning-letters/cease_and_desist_letter_to_family_first_life_llc-_12.27.2021.pdf)
- Earnings enforcement examples:
  - Lyft (2024): hourly-earnings ads were based on the top fifth of drivers. The settlement included a $2.1M civil penalty. — [FTC, Lyft](https://search.ftc.gov/news-events/news/press-releases/2024/10/ftc-takes-action-stop-lyft-deceiving-drivers-misleading-earnings-claims)
  - WealthPress: a small-print "not typical" disclaimer did not cure testimonials that implied typical returns. — [FTC WealthPress complaint](https://www.ftc.gov/system/files/ftc_gov/pdf/2123002WealthPressComplaint.pdf)
- **Made in USA (16 CFR Part 323, 2021 labeling rule).**
  - A label claim requires that final assembly or processing happens in the US, that all significant processing happens in the US, and that "all or virtually all" ingredients or components are made and sourced in the US.
  - Origin claims outside labels are enforced under FTC Act Section 5.

  — [FTC, Complying with the Made in USA Standard](https://www.ftc.gov/business-guidance/resources/complying-made-usa-standard); [Federal Register 2021-14610](https://www.federalregister.gov/documents/2021/07/14/2021-14610/made-in-usa-labeling-rule)
  - In July 2025 the FTC sent warning letters about Made in USA claims. — [FTC press release, July 2025](https://www.ftc.gov/news-events/news/press-releases/2025/07/federal-trade-commission-warns-companies-comply-made-usa-requirements)
  - An April 2026 FTC closing letter warns against stating or implying US origin "in marketing materials (including social media posts)" without substantiation. — [FTC closing letter, 2026-04-14](https://search.ftc.gov/system/files/ftc_gov/pdf/2026-04-14-marketing-holders-closing-letter.pdf)
- **Green Guides (16 CFR 260).**
  - First issued in 1992 and last revised in 2012. They are guidance, not regulations, but are cited in FTC enforcement.
  - The FTC requested comment in December 2022, with the deadline extended to April 24, 2023. Topics included carbon offsets, "recyclable," "recycled content," "sustainable" and degradable claims.
  - No final revision was found as of this research.

  — [Akin Gump](https://akingump.com/en/insights/blogs/speaking-sustainability/ftc-publishes-updates-to-its-green-guides-for-the-use-of-environmental-marketing-claims); [Net Zero Compare (2026)](https://netzerocompare.com/policies/ftc-green-guides); [State Impact Center](https://stateimpactcenter.org/issues/federal-regulatory-policy/green-guides)
- **"Free" (16 CFR 251).**
  - "All of the terms and conditions upon which one can receive and retain the 'Free' item should be set forth clearly and conspicuously at the outset of the offer."
  - A "free" offer is understood to be based on the regular price of the item that must be purchased.

  — [FTC, Guide Concerning Use of the Word "Free"](https://www.ftc.gov/legal-library/browse/rules/guide-concerning-use-word-free-similar-representations)
- **Negative option and "click-to-cancel."**
  - The 8th Circuit vacated the FTC's amended Negative Option Rule on July 8, 2025, in *Custom Communications, Inc. v. FTC*, No. 24-3137. Enforcement had been due to start July 14, 2025.
  - The ground was procedural: the FTC failed to prepare a preliminary regulatory analysis.
  - ROSCA and state automatic-renewal laws still apply.

  — [Fenwick](https://www.fenwick.com/insights/publications/eighth-circuit-vacates-ftcs-click-to-cancel-rule); [Loeb & Loeb](https://www.loeb.com/en/insights/passle/2025/07/the-ftcs-click-to-cancel-rule-has-beencanceled); [Gunderson](https://www.gunder.com/en/news-insights/insights/client-insight-eighth-circuit-vacates-ftcs-click-to-cancel-rule); [Keller and Heckman](https://www.khlaw.com/insights/eighth-circuit-court-appeals-strikes-down-ftcs-click-cancel-rule)

### Inferences
- Candidate linter trigger lexicon. Each hit is a warning that requires a substantiation note, not an automatic block.
  - **Health or medical** (requires RCT-level substantiation): "cure(s)," "treat(s)," "heal(s)," "prevent(s)," "clinically proven," "clinically tested," "doctor recommended," "dermatologist approved," "FDA approved" (also check whether FDA actually approves the product), "boosts immunity," "detox," "weight loss" with a number, "reverses," "anti-aging," "scientifically proven."
  - **Earnings or results**: "make $X," "earn," "passive income," "financial freedom," "quit your job," "6 figures," "guaranteed income," "results typical," before-and-after income testimonials. Also block any "results not typical" disclaimer used to rescue an atypical testimonial.
  - **Guarantee and risk**: "guaranteed," "100% guaranteed," "risk-free," "no risk." These need disclosed guarantee terms, a heuristic derived from the "free" guide's conditions-up-front principle.
  - **"Free"**: "free," "free trial," "on us," "$0." Require the conditions next to the claim, such as purchase required, auto-renew price and cancellation method. The auto-renew requirement comes from ROSCA and state laws, whose text was not retrieved.
  - **Origin**: "Made in USA," "American-made," "USA" with a flag, "Made in America." Require "all or virtually all" substantiation, or a qualified claim such as "Assembled in USA from imported parts."
  - **Environmental**: "eco-friendly," "green," "sustainable," "carbon neutral," "net zero," "biodegradable," "compostable," "recyclable," "non-toxic," "plastic-free." Unqualified general environmental benefit claims are high-risk under the Green Guides. This comes from prior knowledge of the 2012 Guides' structure; the guide text was not retrieved here.
  - **Superlatives and comparatives**: "#1," "best," "fastest," "cheapest," "better than [competitor]," "X% more." Each is an objective claim needing substantiation. This is general FTC Act Section 5 practice, inferred rather than fetched.
- Where the founder supplies a substantiation link, the linter can downgrade the hit to "info."

### Gaps
- The FTC's proposed Earnings Claim Rule rulemaking status was not researched.
- Comparative-advertising primary sources were not retrieved: the FTC Statement on Comparative Advertising and NAD precedent.
- ROSCA text and state automatic-renewal law specifics were not retrieved, for example California's ARL amendments effective July 2025, which is prior knowledge and unverified.
- Whether the FTC has restarted negative-option rulemaking after the vacatur is unknown.
- The FDA and FTC split on supplement structure/function claims was not researched.

## 5. Children and teens: COPPA 2025 amendments, age-appropriate design codes, platform rules

### Takeaway
- **COPPA amendments.** Published April 22, 2025. Effective June 23, 2025. Compliance was due April 22, 2026, so it is now fully in force. The headline changes:
  - separate verifiable parental consent before disclosing children's data to third parties, for example for targeted ads
  - retention limits that bar indefinite retention
- **California AADC.** Partly unenforceable. The Ninth Circuit's March 12, 2026 ruling let the coverage and age-estimation provisions stand facially, but kept the data-use and dark-pattern provisions enjoined.
- **Apple Kids Category.** Bars third-party advertising and most third-party analytics.

### Cited Findings
- **COPPA timeline.**
  - The amended rule was published April 22, 2025 and took effect June 23, 2025.
  - Regulated entities had until April 22, 2026 to comply, except §312.11(d)(1), (d)(4) and (g), the safe-harbor provisions.

  — [Federal Register 2025-05904](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule); [Toy Association](https://toyassociation.org/PressRoom2/News/2026-News/updated-coppa-rule-requirements-take-effect-april-22.aspx); [BBB National Programs](https://bbbprograms.org/media/insights/blog/coppa-amended)
  - Kirkland gives June 21, 2025 as the effective date, which conflicts with Mondaq and the Federal Register's June 23. — [Kirkland](https://www.kirkland.com/publications/kirkland-alert/2025/04/ftc-publishes-coppa-rule); [Mondaq](https://www.mondaq.com/unitedstates/privacy-protection/1626104/childrens-online-privacy-protection-act-amendments-effective-june-23-2025)
- **COPPA changes.**
  - Operators need separate verifiable parental consent before disclosing a child's data to third parties, for example for targeted advertising, unless the disclosure is integral to the service. — [Kirkland](https://www.kirkland.com/publications/kirkland-alert/2025/04/ftc-publishes-coppa-rule); [JD Supra](https://www.jdsupra.com/legalnews/ftc-finalizes-amendments-to-the-5148473); [Perkins Coie](https://perkinscoie.com/print/pdf/node/9535)
  - Children's data may be kept only as long as reasonably necessary for the purpose it was collected for. Indefinite retention is barred. — [Mondaq](https://www.mondaq.com/privacy-protection/1579750/ftc-finalizes-amendments-to-coppa-rule)
- **FTC policy statement (2026).** The FTC limited COPPA enforcement where children's data is collected for age-verification purposes before parental consent, provided the company complies "in every other respect." — [Davis Polk, Apr 16, 2026](https://www.davispolk.com/index%2Ephp/print/pdf/node/116375)
- **California AADC.**
  - In *NetChoice v. Bonta* (9th Cir., Mar 12, 2026), the court narrowed the preliminary injunction. NetChoice had not met the facial-challenge standard on the coverage definition or the age-estimation provision.
  - The data-use restrictions and the dark-patterns prohibition stay enjoined as likely unconstitutionally vague.
  - The case was remanded to N.D. Cal.

  — [Cooley](https://www.cooley.com/news/insight/2026/2026-03-30-netchoice-v-bonta-ninth-circuit-narrows-injunction-against-californias-ageappropriate-design-code-act); [Holland & Knight](https://www.hklaw.com/en/insights/publications/2026/03/ninth-circuit-issues-mixed-ruling-on-california-age-appropriate-design-code-act); [Tech Policy Press](https://techpolicy.press/the-ninth-circuit-provides-a-potential-roadmap-for-future-child-safety-laws)
- **Apple Kids Category, 1.3 (verbatim).**
  - Kids apps "must not include links out of the app, purchasing opportunities, or other distractions to kids unless reserved for a designated area behind a parental gate."
  - They "may not send personally identifiable information or device information to third parties."
  - They "should not include third-party analytics or third-party advertising," with limited exceptions for analytics that collect no IDFA or identifiable data.

  — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

### Inferences
- Candidate lint rules:
  - `KIDS.AUDIENCE` (block-and-escalate): any draft targeting under-13s, using copy like "for kids," "ages 8–12" or "your child can sign up," or proposing influencer campaigns with child creators. It routes to a COPPA review checklist covering verifiable parental consent, separate consent for third-party ad disclosure, and a retention policy.
  - `KIDS.ADTECH` (warn): proposals to add ad pixels or third-party analytics to child-directed experiences.
  - `TEEN.DARK_PATTERNS` (warn): urgency, streak-shaming or "don't miss out" copy aimed at teens. This is a design-code risk even where California enforcement is enjoined.
- Inroad should default consumer-mode personas to 18+ and require explicit confirmation before any youth-audience work.

### Gaps
- UK Age Appropriate Design Code (Children's Code) specifics were not retrieved. Prior knowledge, unverified: 15 standards, conformance expected from September 2, 2021.
- UK Online Safety Act child-safety duties (July 2025) were not researched.
- Other US state laws were not researched: the Maryland Kids Code, state app-store age-verification laws in Utah and Texas, and teen social-media laws.
- Google Play Families policy and Meta and TikTok under-18 ad-targeting restrictions were not retrieved.
- The exact compliance date for the excepted §312.11 safe-harbor provisions was not confirmed. One source says the safe-harbor disclosure deadline was October 22, 2025. — [BBB National Programs](https://bbbprograms.org/media/insights/blog/coppa-amended)

## 6. Platform rules for founder and brand posting and DMs: Reddit, TikTok, Instagram, X, Discord, Product Hunt

### Takeaway
- **Across platforms:** automated, bulk or unsolicited DMs are banned, and so is anything that artificially inflates engagement.
- **X** allows automated DMs and replies only after the user opts in or contacts you first, and AI-generated replies need X's approval.
- **Discord** bans unsolicited bulk messages and self-bots.
- **Meta** limits business messaging to a 24-hour window after the user's last message, with a human-agent tag for up to 7 days.
- **Product Hunt** bans asking for upvotes outright.
- **TikTok** bans bulk automation and fake engagement.
- **Reddit's** own rules could not be retrieved in this session.

### Cited Findings
- **X automation rules.**
  - Automated replies are allowed only after a user opts in, for example by mentioning the account with clear intent, and only one reply per interaction. Keyword-triggered auto-replies count as unsolicited.
  - AI-generated replies require X's prior approval.
  - Automated DMs are allowed only after the user contacts you first, with an easy opt-out. Welcome DMs to new followers are not allowed.
  - "You may not send unsolicited Direct Messages in a bulk or automated manner."
  - Non-API automation, such as scraping or browser scripting, can lead to permanent suspension.

  — [X Automation rules](https://help.x.com/en/rules-and-policies/x-automation); [X Developer Guidelines](https://docs.x.com/developer-guidelines); [X Developer Policy](https://docs.x.com/developer-terms/policy); [X Platform manipulation and spam policy](https://help.x.com/en/rules-and-policies/platform-manipulation)
- **Discord.**
  - Community Guidelines (updated Aug 29, 2025): #13 bars unsolicited bulk messages and selling spam tools. #14 requires every account to be associated with a human, which bans self-bots. — [Discord Community Guidelines](https://discord.com/guidelines)
  - The Developer Policy says apps must not contact users without their explicit permission, and must not automate messages to keep a server looking active. — [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy)
  - Self-bots, meaning user accounts automated outside the bot API, can lead to account termination. — [Discord, Automated User Accounts](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots); [Platform Manipulation Policy Explainer](https://discord.com/safety/platform-manipulation-policy-explainer)
  - Unsolicited advertising DMs and mass server invites are listed as spam. — [Discord, spam tips](https://discord.com/safety/360044104071-tips-against-spam-and-hacking)
- **Meta (Instagram and Messenger messaging API).**
  - The "Standard Messaging Window" is the 24 hours after the person's last message, and promotional content is allowed inside it.
  - The Human Agent tag allows manual replies for up to 7 days. Automated messages and unrelated content are disallowed uses of that tag.
  - Using tags outside approved cases can restrict sending.

  — [Meta Messenger/IG Messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy); [Send API reference](https://developers.facebook.com/docs/messenger-platform/reference/send-api/); [IG Human Agent Escalation](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/human-agent-escalation)
- **TikTok.**
  - Prohibited: platform manipulation, including automation that registers or operates accounts in bulk; bots or scripts that distribute content or interactions in bulk to inflate engagement; and selling or buying followers or likes.
  - Penalties include account bans and reach restrictions.

  — [TikTok, Integrity and Authenticity](https://www.tiktok.com/safety/en/policies-and-engagement/integrity-authenticity); [TikTok Community Guidelines](https://www.tiktok.com/community-guidelines)
- **Product Hunt.**
  - "Never ask outright for upvotes or run anything that requires them. It breaks Product Hunt's rules and can get your launch disqualified." — [Product Hunt Launch Guide](https://help.producthunt.com/en/articles/17350772-launch-guide)
  - "Mass messaging users, asking for upvotes, using bots, incentivizing upvotes, and any other form of artificially increasing activity on your contribution is not acceptable." — [Product Hunt Community Guidelines](https://help.producthunt.com/en/articles/3615694-community-guidelines)
  - Sharing the launch link is allowed. Product Hunt suggests asking people to "visit and comment" instead of upvote. — [Product Hunt, Sharing your launch](https://www.producthunt.com/launch/sharing-your-launch); [Help: asking friends to upvote](https://help.producthunt.com/en/articles/484935-can-i-ask-my-community-friends-family-to-upvote-a-product)
- **Reddit (secondary sources only; reddit.com was not reachable).**
  - Reddit announced a "Responsible Builder Policy" in November 2025. It describes a review-and-approval framework for Data API access. — [r/redditdev mirror](https://r.datuan.dev/r/redditdev/s/gquSJqMgrM); [KeyAPI migration guide](https://www.keyapi.ai/blog/reddit-data-api-overhaul-major-changes-and-migration-guide/)

### Inferences
- Candidate lint rules:
  - `PH.UPVOTE_ASK` (block): Product Hunt launch copy containing "upvote," "vote for us," or "support us with an upvote," or any reward for votes. Suggest "check it out and leave feedback" instead.
  - `DM.BULK` (block in consumer mode): any plan to send the same DM to many users on X, Instagram, TikTok or Discord who have not contacted the brand first.
  - `X.AUTO_REPLY` (block): keyword-triggered or AI auto-replies to strangers.
  - `DISCORD.UNSOLICITED` (block): DMing members of a server you joined to promote.
  - `IG.WINDOW` (info): Instagram DM follow-ups more than 24 hours after the user's last message cannot be promotional.
  - `REDDIT.SELF_PROMO` (warn): founder posts that are mainly links to their own product. Requires checking the subreddit's own rules. Reddit's sitewide text could not be verified.
- Inroad's "draft only, never send" posture fits these rules well. The linter should still flag plans and sequences that would break them if the founder sent them by hand at scale.

### Gaps
- Reddit's sitewide spam and self-promotion rules, Reddiquette, the "Reddit Rules" text, and the brand guidance were not retrievable. Reddit domains blocked the search crawler, and no primary text was obtained.
  - The commonly cited "10% self-promotion" guideline is old Reddit guidance, possibly retired, and was not verified.
- TikTok's and Instagram's in-app DM limits and their policies on third-party DM-automation tools were not retrieved.
- LinkedIn and YouTube community rules were not researched. They were out of scope, but they matter for founder posting.

## 7. Consumer GTM tool stack and API availability (as of October 2026)

### Takeaway
- Almost every core consumer tool has a documented API. Data comes in two forms:
  - pull-based reporting: PostHog HogQL, Amplitude Dashboard REST, Mixpanel Query, RevenueCat metrics and charts, App Store Connect Analytics Reports, AppsFlyer Pull and Master, Adjust Report Service, Klaviyo metric aggregates
  - webhooks: RevenueCat, Superwall, Adapty, Attentive, Postscript, beehiiv
- Shopify's Admin API should be integrated through GraphQL. REST has been "legacy" since October 2024.
- Creator-discovery, referral, app-intelligence, community and social-listening tools could not be verified this session because the search budget ran out. They are listed under Gaps.

### Cited Findings
**Product analytics**
- **PostHog.**
  - Query API: `POST /api/projects/{project_id}/query` with a `HogQLQuery` (SQL) payload. Authentication is a personal API key with the "Query Read" scope.
  - Limits: 2,400 requests per hour, counted per personal API key. OFFSET is rejected for personal keys, so pagination must use timestamps.
  - Large exports should use batch exports, not `/query`.

  — [PostHog Query API](https://posthog.com/docs/api/query); [PostHog API overview](https://posthog.com/docs/api)
  - The SQL API was described as free during its public beta, but that page may be stale. — [PostHog SQL docs](https://posthog.com/docs/sql)
- **Amplitude.**
  - Dashboard REST API endpoints: `GET /api/2/funnels` (ordered, unordered or sequential modes), `GET /api/2/retention` (start event `se`, return event `re`, retention mode `rm` of bracket, rolling or n-day), and `GET /api/2/events/segmentation`.
  - Limits: 5 concurrent requests and a cost-based budget of 108,000 per hour per project. Retention costs 8 per query. Group-by results are capped at 1,000 rows.

  — [Amplitude Dashboard REST API](https://amplitude.com/docs/apis/analytics/dashboard-rest); [Amplitude limits and quotas](https://amplitude.com/docs/faq/limits-and-quotas)
- **Mixpanel.**
  - The Query API covers Insights, Funnels, Retention and JQL. The Funnels query endpoint is in maintenance mode, and Mixpanel recommends the Insights query of a saved report instead.
  - Authentication is service accounts with HTTP Basic auth and `project_id`.
  - Retention-frequency queries are limited to 60 per hour and 5 concurrent.
  - Raw event export is available, and Data Pipelines handle warehouse export.
  - Mixpanel also documents an MCP server.

  — [Mixpanel API overview](https://docs.mixpanel.com/reference/overview); [Funnels query](https://docs.mixpanel.com/reference/funnels-query); [Retention frequency](https://docs.mixpanel.com/reference/retention-frequency-query); [Mixpanel MCP](https://docs.mixpanel.com/docs/mcp)

**Subscription infrastructure**
- **RevenueCat (REST API v2).**
  - Overview metrics: `GET /projects/{project_id}/metrics/overview`, with the `charts_metrics:overview:read` permission and a default limit of 25 requests per minute. — [RevenueCat Charts & Metrics API](https://www.revenuecat.com/docs/api-v2/charts-and-metrics)
  - Chart data became available through the API in February 2026. Charts take a revenue type (gross, net of taxes, or proceeds), and recent periods may be flagged incomplete. Charts v2 is being deprecated in favor of v3. — [RevenueCat release, 2026-02-05](https://www.revenuecat.com/release/access-your-revenuecat-chart-data-via-api-2026-02-05); [Charts & Metrics API](https://www.revenuecat.com/docs/api-v2/charts-and-metrics)
  - Webhooks:
    - Events include INITIAL_PURCHASE, RENEWAL and CANCELLATION, with `cancel_reason` on CANCELLATION and `is_trial_conversion` on RENEWAL.
    - Delivery is at-least-once, with up to 5 retries over about 80 minutes.
    - RevenueCat recommends calling `GET /subscribers` after each webhook.

    — [RevenueCat Webhooks](https://www.revenuecat.com/docs/integrations/webhooks); [Event types and fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)
- **Superwall.**
  - Webhooks V2 are managed through the Superwall API with the `webhooks:read` and `webhooks:write` scopes.
  - Event types include initial_purchase, renewal, cancellation, billing_issue, refund and expiration.
  - Requests are signed with Svix (HMAC-SHA256).
  - Paywall events such as paywall_open and transaction_complete are client-side SDK events, not server webhooks.

  — [Superwall Webhooks V2](https://superwall.com/docs/integrations/webhooks/v2); [Superwall Webhooks](https://superwall.com/docs/integrations/webhooks); [Superwall web events](https://superwall.com/docs/web/guides/events)
- **Adapty.**
  - Webhooks POST subscription events with a shared Authorization header. They arrive typically 5–60 seconds after the event, and cancellations can lag up to 2 hours.
  - Delivery is at-least-once, with retries up to 9 times over 24 hours. The payload includes `paywall_name` and `cohort_name`.
  - Server-side API v2 covers profiles, attributes and access, not event streams.

  — [Adapty Webhook](https://adapty.io/docs/webhook); [Webhook event types](https://adapty.io/docs/webhook-event-types-and-fields); [Adapty server-side API](https://adapty.io/docs/getting-started-with-server-side-api); [legacy API note](https://adapty.io/docs/getting-started-with-server-side-api-legacy)

**App-store first-party reporting**
- **Apple App Store Connect.**
  - The Analytics Reports API offers ONGOING (recurring) and ONE_TIME_SNAPSHOT (historical) report requests covering engagement, commerce and subscription reports. Reports are compressed TSV files, and an Admin key is needed for the first request.
  - The new subscription reports replace the legacy Sales and Trends subscription reports.
  - Sales and Trends reports remain available through the API as next-day data.

  — [Apple Analytics Reports API](https://developer.apple.com/help/app-store-connect-analytics/overview/analytics-reports-api/); [Sales and Trends availability](https://developer.apple.com/help/app-store-connect/reference/reporting/sales-and-trends-reports-availability/); [Apple news: IAP and subscription data in Analytics](https://developer.apple.com/news/?id=hh6v4b55)
- **Google Play Developer Reporting API.**
  - Covers vitals only: ANR rate, crash rate, slow start, errors and anomalies, queried as metric sets.
  - It is not a sales API.

  — [Play Developer Reporting API](https://developers.google.com/play/developer/reporting); [Metric sets](https://developers.google.com/play/developer/reporting/metricset-intro)

**Mobile attribution**
- **AppsFlyer.**
  - Reporting options: the Pull API for aggregate reports and the Master API, a premium feature returning LTV, activity, retention, cohort and Protect360 KPIs as CSV or JSON. Master API data lands 24–48 hours later. — [AppsFlyer reporting APIs](https://support.appsflyer.com/hc/en-us/articles/360005437257); [Master API](https://support.appsflyer.com/hc/en-us/articles/213223166)
  - Per Singular's connector notes, the Cohort API is premium, must be enabled by AppsFlyer, and uses a V2 token. — [Singular connector notes](https://support.singular.net/hc/en-us/articles/360044490911)
- **Adjust.** The Report Service API queries aggregated reporting data as JSON, CSV or pivot reports. — [Adjust Report Service API](https://docs.adjust.com/en/article/report-service-api); [Adjust dev docs](https://dev.adjust.com/en/api/rs-api)

**E-commerce and owned channels**
- **Shopify.**
  - The REST Admin API has been "legacy" since October 1, 2024.
  - From April 1, 2025, new public App Store apps must use GraphQL only. Existing apps can keep using REST.

  — [Shopify changelog](https://shopify.dev/changelog/starting-april-2025-new-public-apps-submitted-to-shopify-app-store-must-use-graphql); [REST Admin API reference](https://shopify.dev/docs/api/admin-rest); [Shopify Partners blog](https://www.shopify.com/partners/blog/all-in-on-graphql)
- **Klaviyo.**
  - Query Metric Aggregates: POST with the `metrics:read` scope, limited to 3 per second burst and 60 per minute steady.
  - A required `revision` header defaults to 2026-07-15.
  - Authentication header: `Authorization: Klaviyo-API-Key <private key>`.
  - For campaign and flow performance that matches the app, Klaviyo recommends its Reporting API.

  — [Klaviyo Query Metric Aggregates](https://developers.klaviyo.com/en/reference/query_metric_aggregates); [Metrics API overview](https://developers.klaviyo.com/en/reference/metrics_api_overview); [Export data from Klaviyo](https://developers.klaviyo.com/en/docs/export_data_from_klaviyo)
- **Attentive (SMS and email).**
  - Webhooks POST JSON. Events include sms.subscribed, sms.sent, sms.message_link_click, email.subscribed, email.unsubscribed, email.opened and custom_attribute.set.
  - A Subscribers API handles subscribe and unsubscribe. It requires a signUpSourceID obtained through your CSM.
  - Authentication is OAuth 2.0 or a bearer token.

  — [Attentive Webhooks](https://docs.attentive.com/docs/overview); [Attentive's APIs](https://help.attentive.com/hc/en-us/articles/360062103592-Attentive-s-APIs); [Subscribers](https://docs.attentive.com/docs/subscribers)
- **Postscript (Shopify SMS).**
  - Subscribers endpoint: `api.postscript.io/api/v2/subscribers`.
  - Webhooks include `shop.subscriber.opt_in`, `shop.subscriber.opt_out` and `shop.incoming_message`.

  — [Postscript, Add subscribers via API](https://developers.postscript.io/docs/how-to-add-subscribers-using-api); [Postscript, Configuring webhooks](https://developers.postscript.io/docs/configuring-webhooks); [Celigo connector notes](https://docs.celigo.com/hc/en-us/articles/23525282380955)

**Email and newsletter**
- **beehiiv.**
  - Webhooks are available on paid plans. Newsletter-list subscription events need Max or Enterprise. — [beehiiv webhooks help](https://www.beehiiv.com/support/article/18034325358743-using-webhooks-with-your-beehiiv-account)
  - API access requires a paid plan. Scopes include subscriptions:read, posts:read and publications:read. — [PostHog beehiiv source docs](https://posthog.com/docs/data-warehouse/sources/beehiiv)
  - One third-party guide says webhooks start at Scale ($43/mo). This conflicts with beehiiv's "paid plans" wording. — [smtpedia](https://smtpedia.com/platforms/beehiiv/integrations/)
- **Kit (ConvertKit).**
  - API v4 at `https://api.kit.com/v4`, with OAuth for apps or API keys for personal use. v3 keys are incompatible, and v3 is deprecated.
  - Pagination is cursor-based, with a maximum page size of 1,000.
  - Endpoints include `GET /v4/subscribers`, `POST /v4/subscribers/filter` (engagement filter) and broadcasts list and create.

  — [Kit API overview](https://developers.kit.com/api-reference/overview.md); [Upgrading to v4](https://developers.kit.com/api-reference/upgrading-to-v4); [Kit v4](https://developers.kit.com/v4)
- **Loops.**
  - The REST API covers contacts (create, find, update), custom properties, events that trigger automations, and transactional sends. API keys are server-side only. — [Loops API intro](https://loops.so/docs/api-reference/intro.md)
  - Loops segments cannot use event-history conditions. — [Loops, migrate from Customer.io](https://loops.so/resources/migrate-customerio-to-loops)
- **Customer.io.** The Pipelines API (and Track API) handles data in. The App API, with bearer auth, triggers broadcasts and transactional messages. — [Customer.io APIs](https://docs.customer.io/api/); [Customer.io API overview](https://docs.customer.io/integrations/api/customerio-apis.md)

### Inferences
- Priority connector set for consumer mode, judged by value to a weekly growth review and by how clean the API is:
  - **Tier 1:** Stripe, RevenueCat, PostHog (or Amplitude or Mixpanel), Shopify (GraphQL), Klaviyo.
  - **Tier 2:** App Store Connect Analytics Reports, Superwall or Adapty webhooks, AppsFlyer or Adjust, Kit, beehiiv or Loops.
  - **Tier 3:** Attentive or Postscript, Customer.io.
- Several APIs are paid or premium-gated: the AppsFlyer Master and Cohort APIs, and the beehiiv API and webhooks. Inroad should detect plan-gating errors and explain them, not fail silently.
- Webhook-first tools (Superwall, Adapty) need an Inroad-hosted receiver with signature verification and idempotency. Pull-first tools can run on the weekly cron.

### Gaps
None of the following were verified in this session because the search budget ran out and direct fetches were blocked. Items marked "prior knowledge" come from my training, not from sources found here, and must be checked before encoding.
- **Stripe** (prior knowledge): REST API with `/v1/customers`, `/v1/subscriptions`, `/v1/invoices`, `/v1/charges`, `/v1/refunds` and `/v1/balance_transactions`. Webhooks include `customer.subscription.created/updated/deleted`, `invoice.paid` and `charge.refunded`. Stripe Sigma and Data Pipeline are paid add-ons.
- **Branch** Query and Export APIs, and **Resend** (prior knowledge: email API, with audiences/contacts and broadcasts APIs): not verified.
- **Creator discovery and management** (Modash, Upfluence, Aspire, GRIN, CreatorIQ, Shopify Collabs): not verified. Prior knowledge: Modash sells a Discovery API and a Raw API, priced separately from its app; GRIN and CreatorIQ expose enterprise APIs; Shopify Collabs has no general public API.
- **Referral and affiliate** (Viral Loops, ReferralCandy, Rewardful, Tolt): not verified. Prior knowledge: Rewardful has a REST API for affiliates, referrals and commissions, plus webhooks, and is tied to Stripe.
- **App-store intelligence** (Appfigures, Sensor Tower, AppTweak): not verified. Prior knowledge: Appfigures has a public REST API with ranks, reviews and estimates on paid plans; AppTweak has a credit-based API; Sensor Tower API access is enterprise-only.
- **Social listening** (for example Brand24, Mention, Sprout Social): not researched.
- **Community:** the Discord API (bot and OAuth2; gateway events for member joins and messages) and the Circle Admin and Headless APIs, including plan requirements: not verified.
- **Pricing tiers** for 2026 were not verified for any tool, apart from the conflicting beehiiv note above.

## 8. Which tools expose data for an AI-computed weekly growth review (signups, activation, retention cohorts, revenue, refunds)

### Takeaway
A full weekly review is achievable from the documented APIs:
- **Signups, activation and retention** come from product analytics: PostHog HogQL, the Amplitude retention and funnels endpoints, or Mixpanel Insights and Retention.
- **Subscription revenue, trials, churn and refunds** come from RevenueCat's metrics and chart APIs, plus webhooks from RevenueCat, Superwall or Adapty. Superwall has an explicit `refund` event.
- **Store-level subscription data** comes from App Store Connect Analytics Reports.
- **E-commerce orders and refunds** come from Shopify GraphQL.
- **Channel attribution** comes from AppsFlyer, Adjust and Klaviyo.

### Cited Findings
- PostHog's HogQL query endpoint runs arbitrary SQL over events, so signup and activation counts and cohort retention can be computed. Rate limit: 2,400 requests per hour. — [PostHog Query API](https://posthog.com/docs/api/query)
- Amplitude's `GET /api/2/retention` supports n-day, rolling and bracket retention. `GET /api/2/funnels` supports activation funnels. — [Amplitude Dashboard REST API](https://amplitude.com/docs/apis/analytics/dashboard-rest)
- Mixpanel's Query API exposes Insights and Retention reports. — [Mixpanel API overview](https://docs.mixpanel.com/reference/overview)
- RevenueCat exposes overview metrics and time-series charts (revenue as gross, net or proceeds) through API v2. Its webhooks report purchases, renewals (including trial conversions via `is_trial_conversion`) and cancellations with `cancel_reason`. — [RevenueCat Charts & Metrics API](https://www.revenuecat.com/docs/api-v2/charts-and-metrics); [Event types and fields](https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields)
- Superwall webhooks include `refund`, `billing_issue`, `expiration` and `cancellation`. — [Superwall Webhooks V2](https://superwall.com/docs/integrations/webhooks/v2)
- Adapty webhooks carry paywall attribution (`paywall_name`, `cohort_name`), so revenue can be attributed to paywall experiments. — [Adapty webhook event types](https://adapty.io/docs/webhook-event-types-and-fields)
- App Store Connect Analytics Reports include subscription reports, and Sales and Trends gives next-day unit and sales data. — [Apple Analytics Reports API](https://developer.apple.com/help/app-store-connect-analytics/overview/analytics-reports-api/); [Sales and Trends availability](https://developer.apple.com/help/app-store-connect/reference/reporting/sales-and-trends-reports-availability/)
- The AppsFlyer Master API returns retention, cohort and LTV KPIs (premium), with a 24–48 hour lag. — [AppsFlyer Master API](https://support.appsflyer.com/hc/en-us/articles/213223166)
- Klaviyo Query Metric Aggregates can count events such as Placed Order and Subscribed by date. Klaviyo recommends its Reporting API for campaign and flow figures that match the app. — [Klaviyo Query Metric Aggregates](https://developers.klaviyo.com/en/reference/query_metric_aggregates)
- The Google Play Developer Reporting API does not cover sales. Play revenue needs another route. — [Play Developer Reporting API](https://developers.google.com/play/developer/reporting)

### Inferences
- Minimal consumer weekly-review recipes:
  - **Subscription app:** PostHog or Amplitude (signups, activation, D1/D7/D30 retention), RevenueCat (MRR, new trials, trial conversion, churn, refunds), and AppsFlyer or Adjust (installs by channel).
  - **DTC brand:** Shopify GraphQL (orders, AOV, refunds, repeat rate), Klaviyo (email- and SMS-attributed orders, list growth), and Attentive or Postscript webhooks (SMS opt-ins and opt-outs).
- Account for data lags: RevenueCat flags recent periods incomplete, AppsFlyer Master lags 24–48 hours, and Apple Sales and Trends is next-day. The review should cover the last complete week, for example a Wednesday run for the Monday–Sunday week before it, and label any partial data.

### Gaps
- Whether RevenueCat emits a distinct refund event, or represents refunds as CANCELLATION with a specific `cancel_reason`, was not confirmed. Prior knowledge suggests the latter.
- Shopify GraphQL refund and order field names, and Stripe refund endpoints, were not verified in this session.
- How to pull Google Play sales programmatically was not found. Prior knowledge, unverified: Play financial reports are exported to a Google Cloud Storage bucket, and the Play Developer API offers purchase and subscription verification.

## 9. Free public signals for consumer opportunity and traction, and their terms

### Takeaway
- **Fully open:** the Hacker News API has no auth and no stated rate limit.
- **Usable with limits:**
  - Apple's iTunes Search and Lookup API, at about 20 calls per minute.
  - Shopify `/products.json` can be read on most stores, but it can be disabled, and no Shopify primary source on terms was found.
- **Gated or restricted:**
  - Reddit: API access is now under a Responsible Builder Policy approval regime. Reports that open `.json` access has ended are unverified.
  - Google Trends: no free official API. An alpha API (July 2025) is limited to a small pilot.
  - Trustpilot: terms reportedly prohibit scraping without permission.
- **Not verified this session:** YouTube, TikTok, Google Play listing data, and Apple RSS feeds.

### Cited Findings
- **Hacker News API.**
  - Base URL: `https://hacker-news.firebaseio.com/v0/`.
  - Endpoints: `/item/<id>.json`, `/user/<id>.json`, `/topstories` (up to 500), `/newstories`, `/beststories`, `/showstories` (up to 200 Show HN), `/askstories` (up to 200).
  - "There is currently no rate limit," and no authentication is mentioned.

  — [HackerNews/API on GitHub](https://github.com/HackerNews/API)
- **Apple iTunes Search API.** "The Search API is limited to approximately 20 calls per minute (subject to change)." Apple recommends caching and points heavy users to the Enterprise Partner Feed. — [Apple Performance Partners, Search API](https://performance-partners.apple.com/search-api); [Search API documentation](https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/)
  - Developers report 403 errors after about 25 rapid requests from one IP. — [Apple Developer Forums](https://developer.apple.com/forums/thread/66399?page=2)
- **Google Trends.**
  - Google announced the Trends API (alpha) on July 24, 2025. It offers consistently scaled search-interest data over 1,800 days, with daily, weekly, monthly and yearly aggregation and region filters, but not "Trending Now."
  - Access is rolling out gradually to a limited number of applicants. — [Google Search Central blog](https://developers.google.com/search/blog/2025/07/trends-api)
  - Google's John Mueller described the pilot as small. — [Search Engine Journal](https://www.searchenginejournal.com/google-trends-api-alpha-mueller-confirms-small-pilot-group/554078/)
  - No general-availability announcement was found, and a 2026 third-party guide still describes it as alpha with no published pricing. — [Scrapfly](https://scrapfly.io/blog/posts/google-trends-api-alternatives)
- **Reddit.**
  - A 2023 Reddit staff post set the free tier at 100 queries per minute per OAuth client ID, and 10 per minute without OAuth. — [r/redditdev 2023 post (mirror)](https://reddit.rtrace.io/r/redditdev/comments/13wsiks/api_update_enterprise_level_tier_for_large_scale/jmo7dah/?context=3)
  - The November 2025 Responsible Builder Policy requires approval for Data API access. — [r/redditdev mirror](https://r.datuan.dev/r/redditdev/s/gquSJqMgrM); [KeyAPI](https://www.keyapi.ai/blog/reddit-data-api-overhaul-major-changes-and-migration-guide/)
  - One third-party guide claims "Open .json access ended. All API requests now need login." No Reddit primary source confirmed this. — [KeyAPI](https://www.keyapi.ai/blog/reddit-data-api-overhaul-major-changes-and-migration-guide/)
  - The Data API sign-up reportedly goes through a support-ticket form rather than self-serve. This is one developer's account. — [read-it MCP notes (Glama)](https://glama.ai/mcp/servers/gavinmcfall/read-it)
  - Third-party sources disagree on commercial pricing. One cites $0.24 per 1,000 calls, and another lists terms as "not specified." — [SocialCrawl](https://www.socialcrawl.dev/blog/reddit-data-api-2026); [KeyAPI](https://www.keyapi.ai/blog/reddit-data-api-overhaul-major-changes-and-migration-guide/)
- **Shopify `/products.json`.**
  - Most storefronts expose `/products.json`, with up to 250 products per page via `?limit=250&page=N` and no API key.
  - Some stores disable it or put it behind a WAF, and `/collections/all/products.json` sometimes works as a fallback.
  - `/meta.json` exposes `published_products_count` and currency.
  - All of this comes from third-party developer and scraper sources, not Shopify docs or terms.

  — [DEV Community](https://dev.to/shan_yun_ab0c7ad30b46ad2d/shopifys-open-secret-every-store-exposes-productsjson-30ni); [DEV Community (meta.json)](https://dev.to/devil_scrapes/shopify-store-leads-the-productcount-field-that-undercounts-every-store-5a5h); [Apify actor docs](https://apify.com/cynix_dev/shopify-store-scraper.md)
- **Trustpilot.** Secondary sources say Trustpilot's consumer and business terms prohibit text mining, data mining and web scraping without express permission. The legitimate route is the Trustpilot for Business API, which needs a Business account with the API module. — [WebScraping.AI FAQ (secondary)](https://webscraping.ai/faq/trustpilot-scraping/what-are-the-risks-of-trustpilot-scraping)
- **Product Hunt.** The public launch pages and leaderboards are a signal. The platform's spam rules ban bots used to inflate activity. — [Product Hunt Community Guidelines](https://help.producthunt.com/en/articles/3615694-community-guidelines)
- **X.** Its developer rules treat non-API automation such as scraping and browser scripting as a violation that can lead to permanent suspension. — [X Developer Guidelines](https://docs.x.com/developer-guidelines); [X Automation rules](https://help.x.com/en/rules-and-policies/x-automation)

### Inferences
- Recommended plain-HTTP signal collectors for Inroad consumer mode, in order of legal clarity:
  1. Hacker News API, which is open.
  2. Apple iTunes Search and Lookup, throttled to 20 calls per minute or less and cached. It gives app category, price, rating and rating count.
  3. Shopify `/products.json` and `/meta.json` for competitor DTC catalog size, price points and launch cadence. Respect robots.txt, throttle, and treat it as a gray area until Shopify's terms are checked.
  4. Google Trends only through the official alpha API if Inroad is accepted. Otherwise treat it as manual or founder-supplied.
  5. Reddit only through an approved OAuth Data API client. Do not depend on unauthenticated `.json`.
  6. Trustpilot, YouTube and TikTok: do not scrape. Use official APIs or founder-exported data.
- Signals worth computing:
  - week-over-week change in an app's rating count, a proxy for install velocity
  - review sentiment themes for competitors
  - Show HN and Ask HN mentions of a category
  - competitor catalog changes from new product handles in `/products.json`
  - Product Hunt launches in a category

### Gaps
- **App Store RSS feeds.** The RSS feed generator at rss.marketingtools.apple.com (top free and top paid charts) and the per-app customer-reviews RSS feed could not be fetched, so their URL formats, limits and terms are unverified. Prior knowledge: the feed generator exists and returns JSON top-N charts per country; a legacy `itunes.apple.com/{cc}/rss/customerreviews/id={id}/json` feed has historically returned recent reviews.
- **iTunes Search API permitted-use terms** were not retrieved, for example whether use is limited to promoting Apple content or affiliate use.
- **Google Play listing data.** No official public API for ratings or rank was found, and Google's terms on scraping Play were not retrieved.
- **YouTube.** The Data API v3 quota and the Terms of Service on automated access were not retrieved. Prior knowledge, unverified: the default quota is 10,000 units per day, `search.list` costs 100 units, and the YouTube ToS prohibits accessing the service by automated means except public search engines under robots.txt.
- **TikTok.** The Research API eligibility and the ToS on scraping were not retrieved.
- **Product Hunt.** API v2 (GraphQL) terms, including any commercial-use restriction, were not retrieved.
- **Shopify.** Official terms on accessing `/products.json` at scale and any rate limit were not found.
