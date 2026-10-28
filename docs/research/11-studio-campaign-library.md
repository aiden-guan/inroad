# Studio campaign library

Updated October 28, 2026. The records are curated and bundled with Inroad; no advertising account is required. Original creative previews load from their publishers or YouTube's image CDN. Video players load only when the user presses Play. Browsing or playing media never sends the workspace or supporting product material to those publishers.

The library's job is to supply useful creative starting points without requiring founders to assemble a swipe file. It includes public campaign records and explicitly labeled positioning references. A large audience, an advertising platform's case study, and a tested headline are different evidence.

## Source ledger

| Record | Evidence shown | What the record supports | Source |
| --- | --- | --- | --- |
| Wispr Flow | Creative reference | Replacing a familiar habit with a visible product demonstration; no campaign ROI claim | [Product campaign](https://wisprflow.ai/) |
| Notion | Reported reach | One billion aggregate #Notion TikTok views reported in a marketing-team interview; not one campaign's attributed sales | [First Round interview](https://review.firstround.com/how-notion-does-marketing-a-deep-dive-into-its-community-influencers-growth-playbooks/) |
| Ramp | Creative reference | The 2026 film makes saved finance time visible; product savings estimates are separate from campaign performance | [Official film](https://www.youtube.com/watch?v=1-mgrFS00B0), [savings calculator](https://ramp.com/savings-calculator) |
| Supabase | Creative reference | Historical launch positioning around a known alternative and a concrete difference | [Original Auth launch](https://supabase.com/blog/supabase-auth) |
| Linear | Creative reference | Historical positioning connecting a software category with a different feeling; not its current homepage | [Historical repository copy](https://github.com/linear/linear/commit/3a1906970affdf824e8b7ec5512529067ca05b03) |
| Spotify Wrapped 2025 | Reported reach | More than 300 million engaged users, as reported in the company's shareholder update | [Q4 2025 update](https://www.sec.gov/Archives/edgar/data/1639920/000114036126004482/ef20065075_ex99-1.htm) |
| Oatly | Reported reach | Average megathread viewing time of 1.4 minutes; conversation included negative responses | [Reddit case study](https://www.business.reddit.com/success-stories/advertisers/oatly-free-form) |
| Cider | Reported results | Google reports 33% lower acquisition cost with its Shorts campaign, alongside targeting and conversion changes | [Google case study](https://business.google.com/us/resources/success-stories/cider/) |
| Away | Reported results | Google describes a Conversion Lift study and reports a 78% increase in incremental sales for creator distribution | [Google case study](https://business.google.com/aunz/think/search-and-video/demand-generation-performance-marketing-drive-consumer-intent/) |
| Volvo EX90 | Reported reach | A 250% increase in search lift, citing Volvo's internal 2024 data; not a sales measure | [Google campaign analysis](https://business.google.com/uk/think/search-and-video/cannes-lions-2025-youtube-creator-marketing/) |
| Ocado | Reported results | The marketing leader reports 73% lower acquisition cost after a broader always-on YouTube program | [Ocado / Google account](https://business.google.com/uk/think/search-and-video/ocado-retail-youtube-demand-gen-strategy/) |
| ClickLearn | Reported results | LinkedIn reports 400% more conversions for an account-targeting and attribution program; not a creative-only experiment | [LinkedIn case study](https://business.linkedin.com/en-us/marketing-solutions/case-studies/clicklearn-hubspot) |
| Connectd | Reported results | HubSpot reports a 98% increase in ROAS with LinkedIn integration and operating changes | [HubSpot case study](https://www.hubspot.com/case-studies/connectd) |
| Studytube | Reported results | HubSpot reports 193% growth in MQL conversions; qualified leads are not closed revenue | [HubSpot case study](https://www.hubspot.com/case-studies/studytube) |
| Deuna | Reported results | TikTok reports more than 15,300 attributed Android registrations during October–November; the year is not stated | [TikTok case study](https://ads.tiktok.com/business/en-US/inspiration/deuna-eficiencia-full-funnel) |

Where publication or campaign dates are absent, the record says “Public case study.” Deuna's headline and body disagree on payment lift, so the library uses the stated registration count instead. Suggested adaptations are our interpretation, not claims that a copy technique independently caused a reported business result.

## Original creative ledger

The visual gallery includes nine records with identified original creative. Six records (Linear, Away, ClickLearn, Connectd, Studytube and Deuna) remain available as supporting research; a company logo, team portrait or generic homepage is not substituted for an ad. The media registry is `src/lib/studio/campaign-media.ts`.

| Campaign | Original media | Identification / attribution |
| --- | --- | --- |
| Wispr Flow | “Break up with your keyboard”, YouTube `9KqGpxtsawc` | Linked by Wispr's [official media kit](https://wisprflow.ai/media-kit) under selected brand videos |
| Notion | Ali Abdaal, “6 AI Tools I Use to Boost My Productivity”, YouTube `WoNZUlRu168` | [Creator's original sponsored video](https://www.youtube.com/watch?v=WoNZUlRu168); Notion sponsorship is identified in the video. This is an example of creator distribution, not the cause of the aggregate hashtag reach figure. |
| Ramp | “Multiply What's Possible”, YouTube `1-mgrFS00B0` | [Ramp's official film](https://www.youtube.com/watch?v=1-mgrFS00B0); identified as the Ramp channel's Super Bowl LX spot in [CBS's campaign roundup](https://www.cbsnews.com/news/early-super-bowl-commercials-2026/). No isolated ROI claim is made. |
| Supabase | Auth product demo MP4 and original launch cover artwork | Embedded in the [original Auth launch](https://supabase.com/blog/supabase-auth) and its [source MDX](https://github.com/supabase/supabase/blob/master/apps/www/_blog/2020-08-05-supabase-auth.mdx). The unmodified 33 KB launch artwork is bundled for its poster; credit and original source remain visible. |
| Spotify | Wrapped 2025 Miami and Nashville billboard photography | Actual campaign images linked in the [Spotify Newsroom campaign announcement](https://newsroom.spotify.com/2025-12-03/wrapped-marketing-campaign/), credited to Spotify Newsroom |
| Oatly | Published Reddit campaign screenshot | Screenshot asset linked by [Reddit's Oatly megathread case study](https://www.business.reddit.com/success-stories/advertisers/oatly-free-form); publisher URL is retained, with a source fallback if unavailable |
| Cider | Videos `kOXr65vDDUo` and `51QSeMfsaNc` | Both “Watch the video” links in [Google's Cider campaign case study](https://business.google.com/us/resources/success-stories/cider/). Playback availability can depend on the publisher; the source is always accessible from the record. |
| Volvo | EX90 film `cQX-QXxwGvA`, 60-second `O9Z_vzJyToA`, 15-second `sBOdXYsK7c8` | All three are explicitly linked as the campaign film and cutdowns in [Google's campaign analysis](https://business.google.com/uk/think/search-and-video/cannes-lions-2025-youtube-creator-marketing/) |
| Ocado | Talking-food ad `ppwIZ4tn-E0` and campaign still | Video and still are linked and described in the [Ocado marketing leader's account](https://business.google.com/uk/think/search-and-video/ocado-retail-youtube-demand-gen-strategy/) |

Media illustrate creative approaches; outcome claims still come from the separate source ledger above. Notion's sample video is not presented as the single campaign responsible for its reach. Publisher assets remain third-party material for study, not assets to reuse in a founder's ad. No generated imitation is shown as an original. Images preserve the complete frame. YouTube uses a click-to-load `youtube-nocookie.com` player; direct video uses native controls, with no background video downloads. Each example retains its original-media link, caption and publisher credit. External media requires an internet connection and can be removed or restricted by its publisher. A failed preview keeps the original link and creation action available.

## Product organization

- **Create:** format, occasion and an optional brief. Relevant approaches are recommended automatically from the audience, format, occasion and techniques supported by the workspace's material. The write action remains accessible while scrolling.
- **Campaign library:** search by brand, channel or approach; filter by audience and evidence. Every detail record explains its approach, adaptation, reported result, source and limits. Choosing an approach opens creation with a suggested format and preserves unfinished input.
- **Your work:** search saved pieces and open their options directly. Existing `?piece=` links still work.
- **Brand & material:** a drawer for profile, voice preferences, claims, stories and image assets. It keeps the creation path short while retaining the existing controls.

Custom example text and links remain optional under creative direction. Switching Studio views preserves unfinished brief and example input. Campaign choices and supplied examples are saved with the resulting piece and reused by Write more.

## Quality contract

Campaigns influence creative direction. They are never product evidence. The writer receives approaches and adaptation guidance, with supported related techniques prioritized. Campaign outcome metrics are deliberately omitted from that context. Custom examples are marked as untrusted reference text rather than instructions or product claims.

Only the founder's existing receipts can substantiate product claims. Existing lint, revision, blind-reader review, gap handling and manual approval remain in place. A missing customer result still blocks customer-story generation before a model call. The technique-research label on options describes the evidence behind a technique, rather than implying the generated draft has been tested.

Recommendations do not rank incomparable view, conversion and revenue metrics. They require a matching audience, format and at least one available technique. The same recommended approaches are included in the agent copy guide, without turning campaign results into receipts.

Regression coverage exercises search and evidence filtering, sources, campaign selection, browser history, unfinished input, failed-run recovery, saved result provenance, existing work links, phone and tablet layouts, and the separation between inspiration and supported product claims. These checks verify behavior; they do not establish conversion improvements for the founder's campaigns.
