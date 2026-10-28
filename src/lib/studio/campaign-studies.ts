import type { Campaign, CampaignStudy } from "./campaign-types";
import type { StudioFormatId } from "@/lib/domain/types";

const SOCIAL: StudioFormatId[] = [
  "short_video",
  "creator_brief",
  "meta_ad",
  "image",
  "linkedin_post",
  "x_post",
  "community_post",
  "linkedin_ad",
  "email_announcement",
];
const SOFTWARE: StudioFormatId[] = [
  ...SOCIAL,
  "one_liner",
  "homepage_hero",
  "billboard",
  "search_ad",
  "waitlist_page",
  "show_hn",
  "product_hunt",
  "comparison_page",
];
type Input = Pick<
  Campaign,
  | "id"
  | "brand"
  | "title"
  | "channel"
  | "audiences"
  | "preferredFormat"
  | "approach"
  | "moveIds"
  | "evidence"
  | "result"
  | "caveat"
> &
  CampaignStudy & { software?: boolean; formats?: StudioFormatId[] };
function study(input: Input): Campaign {
  return {
    ...input,
    period: input.year ? String(input.year) : "Current official reference",
    formats: input.formats ?? (input.software ? SOFTWARE : SOCIAL),
    adaptation: input.blueprint
      .map((step) => `${step.title}: ${step.detail}`)
      .join(" "),
    reviewedAt: "2026-10-27",
    source: { label: input.sources[0].label, url: input.sources[0].url },
    study: input,
  };
}

/** Current campaign studies. Results are attributed; the explanations and small-team briefs are our analysis. */
export const CAMPAIGN_STUDIES: readonly Campaign[] = [
  study({
    id: "duolingo-death-of-duo",
    brand: "Duolingo",
    title: "The Death of Duo",
    year: 2025,
    market: "Global",
    channel: "Social & product",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "community_post",
    playbooks: ["participation", "story"],
    moveIds: ["scoreboard", "for_you_news", "show_it"],
    evidence: "reach",
    approach:
      "An unfolding mascot mystery gave fans a role in the story, then made doing lessons the way to resolve it.",
    objective: "Turn a social conversation into renewed product participation.",
    audience:
      "Existing learners, lapsed users and people already familiar with Duo's personality.",
    setup:
      "Duolingo announced its mascot's death, released clues and invited learners to earn a collective 50 billion XP to revive him. The story ran across social, press and a dedicated website.",
    execution: [
      {
        title: "Interrupt a familiar pattern",
        detail:
          "A mock announcement disrupted the brand's established mascot narrative.",
      },
      {
        title: "Give the story somewhere to go",
        detail:
          "Clues, reactions and community theories created several reasons to return.",
      },
      {
        title: "Make participation useful",
        detail:
          "Lesson XP advanced a shared goal instead of ending the experience at a like or comment.",
      },
    ],
    mechanisms: [
      {
        title: "A real audience relationship",
        detail:
          "The surprise mattered because people already knew Duo. The reusable idea is a change to an established story, not an unexplained stunt.",
      },
      {
        title: "An open loop with a finish",
        detail:
          "A mystery sustained attention; a visible collective target supplied resolution.",
      },
      {
        title: "The CTA was the product",
        detail:
          "The action people took to help was the same action the business wanted them to resume.",
      },
    ],
    lookFor:
      "How the death announcement, clues and XP challenge form a sequence rather than three unrelated posts.",
    blueprint: [
      {
        title: "Set up",
        detail:
          "Name a familiar customer ritual and introduce a meaningful change.",
      },
      {
        title: "Invite",
        detail:
          "Give customers one useful action that moves a visible shared goal.",
      },
      {
        title: "Resolve",
        detail:
          "Show progress and publish a satisfying ending with a product next step.",
      },
    ],
    useWhen:
      "You have an existing community and a product action people can repeat.",
    avoidWhen:
      "A new audience has no reason to care about your mascot, or your team cannot sustain the story.",
    measure:
      "Reactivated users and completed product actions, alongside participation.",
    result: {
      value: "1.7B",
      label: "Social impressions in two weeks",
      detail:
        "The campaign team reported this early total in a Fast Company interview. A later award entry reports a larger full-campaign total.",
    },
    resultScope:
      "First two weeks · aggregate social impressions · team reported",
    caveat:
      "Impressions are not unique people or incremental revenue. The campaign ran alongside the rest of Duolingo's marketing.",
    sources: [
      {
        label: "Campaign-team interview · Fast Company",
        url: "https://www.fastcompany.com/91313082/duolingo-dead-duo-owl-social-media-campaign",
        note: "Early reach total, team decisions and the XP challenge.",
      },
      {
        label: "Duolingo's award submission · The One Club",
        url: "https://www.oneclub.org/awards/theoneshow/-award/63707/the-death-of-duo/",
        note: "Execution sequence and later full-campaign reporting; a different measurement window.",
      },
    ],
  }),
  study({
    id: "cerave-michael",
    brand: "CeraVe",
    title: "Michael CeraVe",
    year: 2024,
    market: "United States",
    channel: "Creators, PR & film",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "short_video",
    playbooks: ["story", "proof"],
    moveIds: ["show_it", "against_the_model", "footnoted_claim"],
    evidence: "results",
    approach:
      "A month of staged speculation made the final reveal teach the brand's actual differentiator: developed with dermatologists.",
    objective:
      "Make a functional skincare difference memorable during the Super Bowl.",
    audience:
      "Beauty audiences who knew the name but not necessarily the science behind it.",
    setup:
      "The brand played on Michael Cera's name to seed a fictional origin story. Creators and dermatologist responses built the narrative before the commercial corrected it.",
    execution: [
      {
        title: "Seed a question",
        detail:
          "Unexpected appearances and creator content made the name connection a story people could discuss.",
      },
      {
        title: "Bring in the real experts",
        detail:
          "Dermatologists became part of the conversation, keeping the actual product authority in frame.",
      },
      {
        title: "Pay off with the truth",
        detail:
          "The final commercial made dermatologist development the resolution, not a small-print afterthought.",
      },
    ],
    mechanisms: [
      {
        title: "The hook carried the message",
        detail:
          "The celebrity pun led back to the product's origin. Attention and positioning were part of the same idea.",
      },
      {
        title: "A sequence multiplied attention",
        detail:
          "Each appearance added context before the expensive media moment. The film was a payoff rather than the whole campaign.",
      },
      {
        title: "Authority survived the joke",
        detail:
          "The reveal restored the brand's scientific positioning instead of leaving the celebrity as its only association.",
      },
    ],
    lookFor:
      "The switch from celebrity fantasy to dermatologist authority at the reveal.",
    blueprint: [
      {
        title: "Hook",
        detail: "Open with a real misconception about your category.",
      },
      {
        title: "Develop",
        detail:
          "Show several short pieces that explore the question with credible users or experts.",
      },
      {
        title: "Resolve",
        detail:
          "Demonstrate the true product difference and give one next step.",
      },
    ],
    useWhen:
      "Your category has a misconception and a distinctive fact worth revealing.",
    avoidWhen:
      "The reveal cannot substantiate the opening, or the joke needs a celebrity your audience does not know.",
    measure:
      "Message recall, qualified visits and conversion lift across the sequence.",
    result: {
      value: "+25%",
      label: "Sales increase reported",
      detail:
        "The campaign team's award entry reports a sales increase alongside earned attention and searches for the product's origin.",
    },
    resultScope:
      "Award-entry result · measurement period and baseline not disclosed",
    caveat:
      "This is an agency-submitted result, not a public controlled test of the film or celebrity alone.",
    sources: [
      {
        label: "Campaign submission · The One Club",
        url: "https://www.oneclub.org/awards/theoneshow/-award/53015/michael-cerave/",
        note: "Execution, sales claim and the limits of the published measurement.",
      },
      {
        label: "Creative account · D&AD",
        url: "https://www.dandad.org/work/d-ad-awards-archive/michael-cerave",
        note: "How the month-long creator story led to the reveal.",
      },
    ],
  }),
  study({
    id: "vaseline-verified",
    brand: "Vaseline",
    title: "Vaseline Verified",
    year: 2025,
    market: "Global",
    channel: "Creators & social",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "creator_brief",
    playbooks: ["proof", "participation"],
    moveIds: ["show_it", "footnoted_claim", "lesson"],
    evidence: "reach",
    approach:
      "The brand turned existing user hacks into an ongoing verification format, giving creators both recognition and credible answers.",
    objective:
      "Expand product relevance while separating useful applications from online misinformation.",
    audience: "People discovering product uses through short-form creators.",
    setup:
      "Instead of competing with community tips, Vaseline brought them into the lab. Its scientists tested ideas and the brand shared approvals or debunks back with creators.",
    execution: [
      {
        title: "Listen before making",
        detail:
          "Start with applications people already cared enough to demonstrate.",
      },
      {
        title: "Make the test the content",
        detail:
          "Lab-style videos showed an idea being assessed rather than merely asserting authority.",
      },
      {
        title: "Return value to the creator",
        detail:
          "A recognizable verification badge rewarded useful contributions and made the series repeatable.",
      },
    ],
    mechanisms: [
      {
        title: "Demand existed first",
        detail:
          "The subject came from audience behavior, reducing the need to invent interest from scratch.",
      },
      {
        title: "Proof became entertaining",
        detail:
          "A question, a test and a result supplied a simple narrative with a clear payoff.",
      },
      {
        title: "Participation had status",
        detail:
          "Recognition gave creators a reason to contribute more than a routine sponsored mention.",
      },
    ],
    lookFor:
      "The repeated question → test → verdict structure and how the creator remains part of the story.",
    blueprint: [
      {
        title: "Find",
        detail: "Choose one real customer question or workaround.",
      },
      {
        title: "Test",
        detail:
          "Show your team checking it against a clear, supportable standard.",
      },
      {
        title: "Return",
        detail:
          "Publish the result, credit the contribution and invite the next question.",
      },
    ],
    useWhen: "You can demonstrate or independently substantiate the answer.",
    avoidWhen:
      "You cannot test the claim, or a branded seal would imply more assurance than your evidence supports.",
    measure:
      "Useful submissions, completed demonstrations and qualified product exploration.",
    result: {
      value: "136M+",
      label: "Social views reported",
      detail:
        "Unilever's 2025 account reports the campaign's social views after its March launch.",
    },
    resultScope: "2025 brand update · social views · company reported",
    caveat:
      "Views are not incremental buyers. The campaign combined creators, paid distribution and a wider brand program.",
    sources: [
      {
        label: "Campaign and science team · Unilever",
        url: "https://www.unilever.com/news/news-search/2025/vaseline-verified-meet-the-mythbusting-scientists-behind-unilevers-awardwinning-campaign/",
        note: "Launch timing, verification process and reported reach.",
      },
      {
        label: "Creative approach · WPP",
        url: "https://www.wpp.com/en/case-studies/ogilvy-mindshare-vaseline-verified",
        note: "The creator feedback loop and original campaign imagery.",
      },
    ],
  }),
  study({
    id: "spotify-wrapped",
    brand: "Spotify",
    title: "Wrapped 2025",
    year: 2025,
    market: "Global",
    channel: "Product, social & outdoor",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "image",
    playbooks: ["participation", "story"],
    moveIds: ["one_number", "their_words", "for_you_news"],
    evidence: "reach",
    approach:
      "Personal listening history became a story people wanted to tell about themselves, with a shared annual moment to tell it.",
    objective:
      "Bring listeners back into the product and make their participation visible outside it.",
    audience:
      "Existing listeners with enough history to receive a meaningful recap.",
    setup:
      "Wrapped packaged individual behavior into a visual annual recap. In 2025, Spotify extended the moment through real-world installations and artist-specific creative.",
    execution: [
      {
        title: "Start with the person",
        detail:
          "The story used a listener's behavior, rather than a corporate year-end milestone.",
      },
      {
        title: "Make it easy to express",
        detail:
          "A recognizable visual system made personal results legible as social content.",
      },
      {
        title: "Create a common moment",
        detail:
          "A coordinated release and physical campaign gave individual posts a larger cultural setting.",
      },
    ],
    mechanisms: [
      {
        title: "Identity was the reward",
        detail:
          "A recap offered a way to describe taste and belonging. Sharing could benefit the listener as well as the brand.",
      },
      {
        title: "Personalization stayed recognizable",
        detail:
          "Different personal results used the same visual language, helping scattered posts accumulate into one campaign.",
      },
      {
        title: "Product and distribution reinforced each other",
        detail:
          "The product generated the story; social posts and artist activations made others curious about theirs.",
      },
    ],
    lookFor:
      "How the outdoor work belongs to the same visual world as the personal recaps.",
    blueprint: [
      {
        title: "Select",
        detail:
          "Pick one meaningful customer milestone from real, permitted usage data.",
      },
      {
        title: "Interpret",
        detail:
          "Explain what it means to that person, rather than listing raw activity.",
      },
      {
        title: "Package",
        detail:
          "Create a useful shareable artifact with an optional next step back into the product.",
      },
    ],
    useWhen:
      "You have meaningful customer history and users benefit from reflecting on it.",
    avoidWhen:
      "The recap exposes sensitive behavior or makes low usage feel like failure.",
    measure:
      "Returning users, recap completion and voluntary sharing, separately.",
    result: {
      value: "300M+",
      label: "Users engaged with Wrapped",
      detail:
        "Spotify reports the engagement total in its Q4 2025 shareholder update.",
    },
    resultScope: "Wrapped 2025 · company-reported engaged users",
    caveat:
      "This is a product engagement measure, not campaign-attributed revenue. Spotify's installed audience is central to its scale.",
    sources: [
      {
        label: "Q4 2025 shareholder update · Spotify",
        url: "https://www.sec.gov/Archives/edgar/data/1639920/000114036126004482/ef20065075_ex99-1.htm",
        note: "The engagement total and reporting period.",
      },
      {
        label: "2025 creative campaign · Spotify Newsroom",
        url: "https://newsroom.spotify.com/2025-12-03/wrapped-marketing-campaign/",
        note: "Design rationale, installations and original photography.",
      },
    ],
  }),
  study({
    id: "notion-think-make",
    brand: "Notion",
    title: "Think it. Make it.",
    year: 2024,
    market: "Global",
    channel: "Outdoor, motion & social",
    audiences: ["prosumer", "b2b", "developer"],
    preferredFormat: "homepage_hero",
    software: true,
    playbooks: ["demonstration", "positioning"],
    moveIds: ["show_it", "category_feeling", "name_the_job"],
    evidence: "reach",
    approach:
      "A paper-like visual metaphor made a flexible software product feel understandable before listing its features.",
    objective:
      "Explain what an open-ended workspace enables without making it look complicated.",
    audience:
      "People and teams who could imagine a project but did not yet understand Notion's role.",
    setup:
      "Notion and BUCK built its 2024 flagship brand campaign around ideas becoming tangible work. Motion and physical placements carried a consistent visual language across markets.",
    execution: [
      {
        title: "Choose a familiar material",
        detail:
          "Paper supplied a simple metaphor for a product with many possible uses.",
      },
      {
        title: "Show possibilities becoming work",
        detail:
          "The campaign visualized making rather than reciting a menu of tools.",
      },
      {
        title: "Repeat across contexts",
        detail:
          "Outdoor and motion executions kept the core idea recognizable across different cities and formats.",
      },
    ],
    mechanisms: [
      {
        title: "A metaphor reduced explanation",
        detail:
          "The audience could understand the product's flexibility through something familiar.",
      },
      {
        title: "The work preserved product character",
        detail:
          "The campaign's restraint linked an imaginative promise to the product's established visual identity.",
      },
      {
        title: "One idea accommodated many uses",
        detail:
          "A broad platform avoided becoming a collage of unrelated feature claims.",
      },
    ],
    lookFor:
      "How paper, typography and motion explain flexibility without an interface tour.",
    blueprint: [
      {
        title: "Promise",
        detail: "Name one thing your audience wants to make or finish.",
      },
      {
        title: "Visualize",
        detail:
          "Use one familiar metaphor, supported by a real product moment.",
      },
      {
        title: "Land",
        detail: "End on a concrete task the customer can try immediately.",
      },
    ],
    useWhen:
      "Your product supports many workflows but has one clear underlying idea.",
    avoidWhen:
      "The metaphor obscures the actual job or makes the product appear more capable than it is.",
    measure:
      "Understanding of the product promise and first-time qualified visits.",
    result: {
      value: "460M+",
      label: "Impressions reported",
      detail:
        "Production partner BUCK reports campaign impressions and increases in first-time visitors and search in key markets.",
    },
    resultScope: "2024 global campaign · production-partner reporting",
    caveat:
      "The public case does not quantify conversion lift or separate the effect of individual executions.",
    sources: [
      {
        label: "Campaign case study · BUCK",
        url: "https://buck.co/work/notion-think-it-make-it",
        note: "Creative brief, original executions and reported reach.",
      },
      {
        label: "Brand team's rationale · Notion",
        url: "https://www.notion.com/de/blog/the-thinking-behind-our-latest-brand-campaign",
        note: "The brand's own explanation of the 2024 campaign.",
      },
    ],
  }),
  study({
    id: "heinz-ketchup-fraud",
    brand: "Heinz",
    title: "Ketchup Fraud",
    year: 2023,
    market: "North America",
    channel: "Outdoor, PR & social",
    audiences: ["b2c", "b2b"],
    preferredFormat: "image",
    playbooks: ["participation", "positioning"],
    moveIds: ["against_the_model", "their_words", "honest_comparison"],
    evidence: "results",
    approach:
      "A recognizable customer grievance became public evidence of brand preference—and a route to new restaurant accounts.",
    objective: "Turn consumer preference into demand from restaurant buyers.",
    audience:
      "Diners who expected Heinz and restaurant operators deciding what to stock.",
    setup:
      "The campaign called out restaurants refilling Heinz bottles with other ketchup. Caught-in-the-act imagery led to a website where people could report examples.",
    execution: [
      {
        title: "Name the behavior",
        detail:
          "A concrete, recognizable practice gave the story an immediate subject.",
      },
      {
        title: "Invite corroboration",
        detail:
          "Fans could contribute their own experiences instead of only reacting to the ad.",
      },
      {
        title: "Connect to the buyer",
        detail:
          "Consumer demand created a business reason for restaurants to stock the real product.",
      },
    ],
    mechanisms: [
      {
        title: "Preference became visible",
        detail:
          "A bottle being reused was an unusually tangible signal that the brand itself carried value.",
      },
      {
        title: "The story served two audiences",
        detail:
          "Consumers supplied pressure; business buyers could resolve the problem by changing a purchase.",
      },
      {
        title: "Specificity made it discussable",
        detail:
          "A real behavior was easier to recognize and share than a generic claim of superior taste.",
      },
    ],
    lookFor:
      "The caught-in-the-act imagery and how the customer report becomes a commercial opportunity.",
    blueprint: [
      {
        title: "Observe",
        detail:
          "Find one documented behavior that shows customers value your product.",
      },
      {
        title: "Surface",
        detail: "Show the behavior fairly and invite real customer examples.",
      },
      {
        title: "Convert",
        detail:
          "Offer the responsible buyer a concrete way to meet that demand.",
      },
    ],
    useWhen: "End users and purchasing decision-makers are different people.",
    avoidWhen:
      "You cannot document the behavior or your comparison relies on invented competitor shortcomings.",
    measure:
      "New qualified buyer conversations and accounts, not only consumer engagement.",
    result: {
      value: "33",
      label: "New accounts in under a month",
      detail:
        "The creative team's account and award submission both report new restaurant accounts.",
    },
    resultScope:
      "First month · new business accounts · campaign-team reporting",
    caveat:
      "The team also reports broader sales and share growth; those figures do not isolate the creative's contribution.",
    sources: [
      {
        label: "Campaign submission · The One Club",
        url: "https://www.oneclub.org/awards/theoneshow/-award/52081/heinz-ketchup-fraud/",
        note: "Buyer outcomes, participation and measurement limits.",
      },
      {
        label: "Original work · Kate A. Spencer",
        url: "https://www.kateaspencer.com/recent-work/heinz",
        note: "Creative-team account and original campaign assets.",
      },
    ],
  }),
  study({
    id: "doordash-all-ads",
    brand: "DoorDash",
    title: "All The Ads",
    year: 2024,
    market: "United States",
    channel: "Live event, PR & social",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "short_video",
    playbooks: ["participation", "demonstration"],
    moveIds: ["offer_first", "show_it", "scoreboard"],
    evidence: "reach",
    approach:
      "One giant delivery prize made every other Super Bowl advertiser a demonstration of DoorDash's expanded range.",
    objective:
      "Make people understand that DoorDash could deliver more than restaurant meals.",
    audience:
      "Super Bowl viewers who still associated the brand mainly with food delivery.",
    setup:
      "DoorDash offered products from the game's advertisers as one prize, spanning 76 brands. The cart grew as ads aired, turning the event into a demonstration of breadth.",
    execution: [
      {
        title: "Promise an understandable spectacle",
        detail:
          "Winning everything advertised made a broad catalog idea easy to grasp.",
      },
      {
        title: "Let the event add examples",
        detail: "Other brands' spots kept adding to the same live story.",
      },
      {
        title: "Give viewers an action",
        detail:
          "A sweepstakes entry connected attention to a campaign destination.",
      },
    ],
    mechanisms: [
      {
        title: "Distribution demonstrated the proposition",
        detail:
          "The media setting supplied the product categories the brand wanted people to remember.",
      },
      {
        title: "The offer was a story",
        detail:
          "An unusually concrete prize gave press and viewers a simple way to describe the campaign.",
      },
      {
        title: "Participation had urgency",
        detail:
          "A shared live event supplied a natural reason to pay attention together.",
      },
    ],
    lookFor:
      "How each additional product reinforces the same 'more than meals' message.",
    blueprint: [
      {
        title: "Define",
        detail: "Choose one mistaken limit customers place on your product.",
      },
      {
        title: "Demonstrate",
        detail:
          "Build a small, relevant bundle that makes the wider capability obvious.",
      },
      {
        title: "Invite",
        detail:
          "Tie participation to a qualified next step, not just a large prize.",
      },
    ],
    useWhen:
      "A product has expanded but audience perception has not caught up.",
    avoidWhen:
      "The prize attracts people with no interest in the product, or the event budget hides poor acquisition economics.",
    measure: "Qualified new users and message recall separately from entries.",
    result: {
      value: "8M+",
      label: "Sweepstakes entries reported",
      detail:
        "The award entry reports participation alongside earned impressions and the live broadcast audience.",
    },
    resultScope: "Super Bowl 2024 activation · entry volume · agency reported",
    caveat:
      "Entries are not unique customers, purchases or a measure of profitable acquisition.",
    sources: [
      {
        label: "Integrated campaign submission · The One Club",
        url: "https://www.oneclub.org/awards/theoneshow/-award/52641/doordash-all-the-ads/",
        note: "The live execution, product breadth and reported entry count.",
      },
    ],
  }),
  study({
    id: "ikea-coworker",
    brand: "IKEA",
    title: "The Co-Worker",
    year: 2024,
    market: "United Kingdom & Ireland",
    channel: "Gaming, recruitment & PR",
    audiences: ["b2c", "prosumer", "b2b"],
    preferredFormat: "community_post",
    playbooks: ["participation", "demonstration"],
    moveIds: ["show_it", "name_the_job", "offer_first"],
    evidence: "results",
    approach:
      "A real paid role inside a virtual store turned an employer promise into something candidates could experience.",
    objective: "Introduce a younger audience to IKEA's approach to careers.",
    audience:
      "Potential future co-workers who spent time in gaming environments.",
    setup:
      "IKEA advertised ten paid roles in its Roblox store, then launched a game where players could experience store departments and progression.",
    execution: [
      {
        title: "Make a real offer",
        detail:
          "The paid virtual roles created a concrete reason to notice the launch.",
      },
      {
        title: "Put the promise in the experience",
        detail: "Moving between store tasks made career flexibility visible.",
      },
      {
        title: "Connect the virtual and real",
        detail: "The recruitment story introduced the wider employer brand.",
      },
    ],
    mechanisms: [
      {
        title: "Experience replaced assertion",
        detail:
          "The audience could encounter the career idea rather than read another employer slogan.",
      },
      {
        title: "The channel fit the audience",
        detail:
          "A gaming environment gave the story a setting relevant to the people IKEA wanted to reach.",
      },
      {
        title: "A genuine offer created stakes",
        detail:
          "The possibility of paid work made participation more consequential than a branded game alone.",
      },
    ],
    lookFor:
      "The connection between virtual store tasks and the real employer's career proposition.",
    blueprint: [
      {
        title: "Select",
        detail:
          "Choose one product or workplace promise people struggle to imagine.",
      },
      {
        title: "Make tangible",
        detail: "Offer a short, realistic trial or interactive demonstration.",
      },
      {
        title: "Bridge",
        detail:
          "Give interested participants a clear next step into the real opportunity.",
      },
    ],
    useWhen: "Your experience is more persuasive than your description of it.",
    avoidWhen:
      "A novel platform adds friction or the paid prize becomes the only reason to engage.",
    measure:
      "Qualified applicants or trials after the experience, alongside participation.",
    result: {
      value: "178K+",
      label: "Applications in two weeks",
      detail:
        "IKEA reports applications for the ten paid virtual co-worker positions.",
    },
    resultScope:
      "June 2024 recruitment window · virtual paid roles · IKEA reported",
    caveat:
      "These are not ordinary retail applications or hires. The unusually scarce paid roles influenced demand.",
    sources: [
      {
        label: "Launch and recruitment results · IKEA",
        url: "https://www.ikea.com/gb/en/newsroom/corporate-news/ikea-is-now-live-on-roblox-get-your-first-look-today-pub3a269100/",
        note: "The actual offer, application window and original virtual-store imagery.",
      },
      {
        label: "Experience design · The Gang",
        url: "https://www.thegang.io/case-studies/ikea-the-co-worker-case-study",
        note: "How the virtual store reflected the career proposition.",
      },
    ],
  }),
  study({
    id: "pedigree-adoptable",
    brand: "Pedigree",
    title: "Adoptable",
    year: 2024,
    market: "New Zealand test launch",
    channel: "Dynamic digital ads",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "meta_ad",
    playbooks: ["demonstration", "proof"],
    moveIds: ["show_it", "offer_first", "situation_qualifier"],
    evidence: "results",
    approach:
      "Brand media featured actual local shelter dogs, so an ad could lead directly to a relevant adoption opportunity.",
    objective:
      "Use existing advertising reach to help real shelter dogs find homes.",
    audience: "Potential adopters near participating shelters.",
    setup:
      "Pedigree, Colenso and Nexus transformed shelter photos into usable advertising assets. Featured dogs varied by location and changed when an animal was adopted.",
    execution: [
      {
        title: "Use a real subject",
        detail: "The dog in the ad was an animal someone could actually adopt.",
      },
      {
        title: "Make relevance operational",
        detail:
          "Location and current availability determined which dog appeared.",
      },
      {
        title: "Close the loop",
        detail:
          "Updating adopted dogs kept the advertisement connected to the real opportunity.",
      },
    ],
    mechanisms: [
      {
        title: "The message could become an action",
        detail:
          "Interest did not have to travel from a generic brand promise to a separate search for a suitable animal.",
      },
      {
        title: "Technology removed a bottleneck",
        detail:
          "Image production made existing shelter inventory usable at advertising scale.",
      },
      {
        title: "Relevance improved the next step",
        detail:
          "A local, available subject made a click more meaningful than a universal brand image.",
      },
    ],
    lookFor:
      "How the original shelter dog remains identifiable in the finished advertising asset.",
    blueprint: [
      {
        title: "Find",
        detail: "Choose real, available inventory or customer opportunities.",
      },
      {
        title: "Match",
        detail:
          "Show the right example to the right audience using a few reliable signals.",
      },
      {
        title: "Maintain",
        detail: "Update the message when the underlying opportunity changes.",
      },
    ],
    useWhen:
      "You have current inventory and a meaningful local or situational match.",
    avoidWhen:
      "Your information becomes stale or generated imagery misrepresents what is actually available.",
    measure:
      "Completed relevant actions and time to outcome, not clicks alone.",
    result: {
      value: "50%",
      label: "Featured dogs adopted in two weeks",
      detail:
        "Nexus reports this result from initial test markets, alongside higher shelter traffic.",
    },
    resultScope:
      "Initial test launch · featured animals · production-partner reported",
    caveat:
      "The public account does not disclose the sample size or a randomized comparison. This is not a population-wide adoption rate.",
    sources: [
      {
        label: "Campaign and production account · Nexus Studios",
        url: "https://nexusstudios.com/work/pedigree-adoptable",
        note: "How the system worked, original creative and test-market outcomes.",
      },
      {
        label: "2024 results account · Nexus Studios",
        url: "https://nexusstudios.com/insight/pedigree-ai-cannes-lions-grand-prix-2024/",
        note: "Additional detail on the launch and its measurement.",
      },
    ],
  }),
  study({
    id: "orange-womens-football",
    brand: "Orange",
    title: "WoMen's Football",
    year: 2023,
    market: "France → global",
    channel: "Film & social",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "short_video",
    playbooks: ["demonstration", "positioning"],
    moveIds: ["show_it", "before_after", "against_the_model"],
    evidence: "reach",
    approach:
      "Viewers admired the performance before a reveal confronted the assumption shaping their judgment.",
    objective:
      "Build interest in the French women's team ahead of the World Cup.",
    audience: "Football viewers whose attention favored the men's game.",
    setup:
      "Marcel assembled impressive football highlights with male players' appearances, then revealed the original women's footage and the visual effects behind the edit.",
    execution: [
      {
        title: "Let the audience judge first",
        detail:
          "The highlight reel established the quality of the play before discussing bias.",
      },
      {
        title: "Reveal the original",
        detail:
          "The edit visibly explained that the skills belonged to the women's team.",
      },
      {
        title: "Connect the lesson to the occasion",
        detail:
          "The World Cup supplied a timely next opportunity to watch the team.",
      },
    ],
    mechanisms: [
      {
        title: "The audience supplied the proof",
        detail:
          "A favorable initial reaction made the later realization personal rather than merely an assertion from the sponsor.",
      },
      {
        title: "The reveal rewarded attention",
        detail:
          "The second half changed the meaning of the first, creating a reason to finish and share the film.",
      },
      {
        title: "The brand had a role",
        detail:
          "A football sponsor could credibly use its reach to put an overlooked team in view.",
      },
    ],
    lookFor:
      "The before-and-after comparison that makes the editing explicit and reframes the same performance.",
    blueprint: [
      {
        title: "Demonstrate",
        detail:
          "Let people assess a genuine result without a distracting category label.",
      },
      {
        title: "Reveal",
        detail: "Explain the source and any editing clearly.",
      },
      {
        title: "Act",
        detail:
          "Offer a real next opportunity to try or support the overlooked option.",
      },
    ],
    useWhen:
      "A genuine demonstration can challenge a specific audience assumption.",
    avoidWhen:
      "The effect depends on hiding material facts after the reveal or falsifying the demonstration.",
    measure:
      "Completed viewing, message understanding and the relevant follow-on action.",
    result: {
      value: "200M+",
      label: "Views reported",
      detail:
        "D&AD's 2024 account describes the campaign's cumulative view count after its 2023 release.",
    },
    resultScope:
      "Cumulative views as reported in 2024 · campaign released in 2023",
    caveat:
      "The view total does not measure ticket purchases or prove a lasting change in attitudes.",
    sources: [
      {
        label: "Behind the campaign · D&AD",
        url: "https://www.dandad.org/work/annual-2024/behind-the-work/the-award-winning-campaign-that-made-millions-switch-to-womens-football",
        note: "The creative brief, execution and reported views.",
      },
      {
        label: "Original work · Marcel / La Réclame",
        url: "https://lareclame.fr/marcel/realisations/orange-et-marcel-vous-font-voir-les-bleues-comme-jamais-vous-ne-les-avez-vues",
        note: "Campaign frames showing the original footage and effects.",
      },
    ],
  }),
  study({
    id: "poptarts-edible-mascot",
    brand: "Pop-Tarts",
    title: "The First Edible Mascot",
    year: 2023,
    market: "United States",
    channel: "Live event & earned media",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "short_video",
    playbooks: ["story", "demonstration"],
    moveIds: ["show_it", "for_you_news", "taboo_literal"],
    evidence: "reach",
    approach:
      "The product became the event's payoff: a mascot entered a toaster and the winning team ate the resulting pastry.",
    objective:
      "Give a new bowl-game sponsor a role people would remember and retell.",
    audience:
      "Sports viewers and social audiences watching the post-game celebration.",
    setup:
      "Pop-Tarts made a giant edible mascot the centerpiece of its 2023 bowl sponsorship. The celebration ended with the winning team sharing the snack on the field.",
    execution: [
      {
        title: "Build anticipation",
        detail:
          "A living mascot created a character audiences could follow through the game.",
      },
      {
        title: "Create one unmistakable payoff",
        detail:
          "The toaster ritual made the product the center of the celebration.",
      },
      {
        title: "Let the moment travel",
        detail:
          "A visually self-contained scene gave social and press coverage an easy story.",
      },
    ],
    mechanisms: [
      {
        title: "The product was indispensable",
        detail:
          "The idea could not work the same way with an unrelated sponsor's logo.",
      },
      {
        title: "A ritual created a memory",
        detail:
          "A clear sequence and ending made the event easier to describe than a generic sponsorship.",
      },
      {
        title: "The clip carried its own context",
        detail:
          "A strange but legible visual helped the moment spread beyond people who watched the whole game.",
      },
    ],
    lookFor:
      "The character, toaster and shared snack: each sets up or completes the same idea.",
    blueprint: [
      {
        title: "Choose",
        detail: "Find an event where your product can do something meaningful.",
      },
      {
        title: "Build",
        detail: "Design one real product demonstration as the payoff.",
      },
      {
        title: "Capture",
        detail: "Make the moment understandable in one short, complete clip.",
      },
    ],
    useWhen: "Your product can take an active role in an existing event.",
    avoidWhen:
      "The spectacle has no link to the product or requires an audience your event does not have.",
    measure:
      "Earned coverage quality and brand attribution, then relevant follow-on demand.",
    result: {
      value: "15×",
      label: "Media mentions vs. other sponsored bowls",
      detail:
        "The award entry reports this comparison and an estimated media-value figure for the week after the game.",
    },
    resultScope: "2023 bowl activation · agency's sponsored-bowl comparison",
    caveat:
      "Media value and mentions are not revenue or measured incremental sales.",
    sources: [
      {
        label: "Campaign submission · The One Club",
        url: "https://www.oneclub.org/awards/theoneshow/-award/52935/the-first-edible-mascot/",
        note: "The event sequence, original work and reported media comparison.",
      },
    ],
  }),
  study({
    id: "specsavers-misheard",
    brand: "Specsavers",
    title: "The Misheard Version",
    year: 2023,
    market: "United Kingdom",
    channel: "Music, PR & social",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "short_video",
    playbooks: ["demonstration", "participation"],
    moveIds: ["show_it", "situation_qualifier", "offer_first"],
    evidence: "results",
    approach:
      "A familiar song made people notice mishearing for themselves, then connected that moment to a hearing-test booking.",
    objective:
      "Make a hearing check feel approachable rather than intimidating.",
    audience:
      "People who might recognize everyday mishearing but avoid thinking about a hearing test.",
    setup:
      "Rick Astley re-recorded his familiar hit with commonly misheard lyrics. The campaign used the altered song to start a public conversation and direct people toward a check.",
    execution: [
      {
        title: "Start with recognition",
        detail:
          "A familiar performer and song gave the audience a reason to listen.",
      },
      {
        title: "Make the issue experiential",
        detail:
          "The changed lyrics let people encounter the campaign's subject rather than read about it.",
      },
      {
        title: "Offer a low-friction next step",
        detail:
          "The brand linked the conversation to a hearing-test appointment.",
      },
    ],
    mechanisms: [
      {
        title: "Humor lowered the barrier",
        detail:
          "An everyday experience supplied an approachable way into a topic people could otherwise avoid.",
      },
      {
        title: "The entertainment demonstrated the service",
        detail:
          "Listening closely was already relevant to the action Specsavers wanted people to take.",
      },
      {
        title: "The CTA answered the moment",
        detail:
          "The booking offer followed naturally from the question raised by the content.",
      },
    ],
    lookFor:
      "How a recognizable listening experience leads directly to the service offer.",
    blueprint: [
      {
        title: "Recognize",
        detail:
          "Choose one familiar customer experience connected to your service.",
      },
      {
        title: "Demonstrate",
        detail:
          "Let the audience notice the issue in a simple, honest example.",
      },
      {
        title: "Help",
        detail: "Offer one approachable next step that addresses it.",
      },
    ],
    useWhen:
      "Your service solves a problem people recognize but hesitate to discuss.",
    avoidWhen:
      "The joke makes the audience feel judged, or the demonstration is presented as a diagnosis.",
    measure:
      "Completed qualified bookings and attendance, alongside content engagement.",
    result: {
      value: "+66%",
      label: "Hearing-test bookings reported",
      detail:
        "Published campaign accounts report a launch-period increase in bookings. Later effectiveness reporting uses a different comparison against target.",
    },
    resultScope: "Launch-period bookings · reported campaign result",
    caveat:
      "A percentage above a campaign target is a different measure from growth in bookings. Neither isolates the song from distribution and the service offer.",
    sources: [
      {
        label: "Campaign result · PRmoment Awards 2024",
        url: "https://www.prmomentawards.com/the-winners-of-the-prmoment-awards-2024",
        note: "The 66% booking increase reported with the campaign's entry.",
      },
      {
        label: "Effectiveness follow-up · Golin",
        url: "https://golin.com/emea/cannes-lions-2025-golin-gold-silver-effectiveness/",
        note: "Campaign execution and later results measured against target.",
      },
      {
        label: "Original campaign · Specsavers",
        url: "https://www.specsavers.ie/misheard-version",
        note: "The public-facing campaign and its appointment action.",
      },
    ],
  }),
  study({
    id: "axa-three-words",
    brand: "AXA",
    title: "Three Words",
    year: 2025,
    market: "France",
    channel: "Product change, PR & film",
    audiences: ["b2c", "b2b"],
    preferredFormat: "homepage_hero",
    playbooks: ["proof", "positioning"],
    moveIds: ["show_it", "against_the_model", "footnoted_claim"],
    evidence: "results",
    approach:
      "The brand changed its insurance product first, giving the campaign a concrete action to explain rather than a purpose claim to repeat.",
    objective:
      "Make protection more meaningful by addressing emergency relocation after domestic violence.",
    audience:
      "Home-insurance customers and the wider public considering what an insurer should protect.",
    setup:
      "AXA added domestic violence to the circumstances covered by emergency relocation. The campaign explained the contract change and the practical support behind it.",
    execution: [
      {
        title: "Change the offer",
        detail:
          "The clause was added to existing home contracts, rather than reserved for a new promotional tier.",
      },
      {
        title: "Make the change legible",
        detail:
          "A short phrase provided a simple way to explain a consequential product decision.",
      },
      {
        title: "Back the claim operationally",
        detail:
          "Relocation and support made the promise something customers could use.",
      },
    ],
    mechanisms: [
      {
        title: "The proof was the product",
        detail:
          "The central claim could be checked against a contractual change.",
      },
      {
        title: "Simplicity carried consequence",
        detail:
          "A small wording change helped explain a much larger practical benefit.",
      },
      {
        title: "Existing capability made the action credible",
        detail:
          "Emergency relocation extended something an insurer already knew how to provide.",
      },
    ],
    lookFor:
      "How the communication points to an actual change in coverage, not just a new brand line.",
    blueprint: [
      {
        title: "Find the gap",
        detail:
          "Identify one customer problem your current offer leaves unresolved.",
      },
      {
        title: "Change the offer",
        detail: "Make a concrete improvement your team can deliver.",
      },
      {
        title: "Explain the consequence",
        detail:
          "Use a simple before-and-after account with the actual terms beside it.",
      },
    ],
    useWhen:
      "You can change the product, policy or service behind the message.",
    avoidWhen:
      "The campaign promises a social benefit that operations or contract terms do not support.",
    measure:
      "Use of the new benefit, customer understanding and new contracts separately.",
    result: {
      value: "+9.1%",
      label: "New contracts over six months",
      detail:
        "The 2026 award entry reports new-contract growth against the same period in 2024, alongside use of the support service.",
    },
    resultScope:
      "First six months · year-over-year contracts · campaign-team reported",
    caveat:
      "The product change and communication worked together. The public comparison does not isolate campaign causality.",
    sources: [
      {
        label: "Product, execution and results · The One Club",
        url: "https://www.oneclub.org/awards/theoneshow/-award/63733/three-words/",
        note: "Contract scope, support delivered and the six-month comparison.",
      },
      {
        label: "2025 recognition · Cannes Lions",
        url: "https://www.canneslions.com/news/lion-winners-announced-for-day-four-of-the-festival",
        note: "Independent confirmation of the campaign's 2025 creative recognition.",
      },
    ],
  }),
  study({
    id: "asics-desk-break",
    brand: "ASICS",
    title: "The Desk Break",
    year: 2024,
    market: "Global",
    channel: "Film, employers & social",
    audiences: ["prosumer", "b2b", "b2c"],
    preferredFormat: "short_video",
    playbooks: ["participation", "positioning"],
    moveIds: ["villain_object", "show_it", "name_the_job"],
    evidence: "results",
    approach:
      "A familiar workplace tension became a small action people and employers could take together.",
    objective:
      "Turn a brand belief about movement into participation during the working day.",
    audience:
      "Office workers and employers who could make room for a movement break.",
    setup:
      "Brian Cox played an intimidating boss in a campaign that challenged desk-bound routines. ASICS invited workers to take a break and supported the idea with workplace guidance.",
    execution: [
      {
        title: "Name a familiar obstacle",
        detail: "The desk and working-day routine supplied a concrete subject.",
      },
      {
        title: "Give the behavior a name",
        detail:
          "A Desk Break made an abstract brand belief into an understandable action.",
      },
      {
        title: "Help the system support it",
        detail:
          "Guidance for employers extended the idea beyond an individual social post.",
      },
    ],
    mechanisms: [
      {
        title: "The problem was recognizable",
        detail:
          "The workplace setting let the audience identify the situation immediately.",
      },
      {
        title: "Participation was manageable",
        detail:
          "A short break was easier to imagine than a complete lifestyle change.",
      },
      {
        title: "The brand crossed audience roles",
        detail:
          "Workers could participate while employers could enable the same behavior.",
      },
    ],
    lookFor:
      "The contrast between the intimidating boss character and the simple action the film requests.",
    blueprint: [
      {
        title: "Name",
        detail: "Choose one everyday obstacle your audience recognizes.",
      },
      {
        title: "Reduce",
        detail:
          "Offer one small action that expresses your product's real value.",
      },
      {
        title: "Enable",
        detail:
          "Give the person who controls the environment a practical way to support it.",
      },
    ],
    useWhen: "Your product or service fits a repeatable everyday behavior.",
    avoidWhen:
      "A wellness message substitutes for a useful product connection or claims effects your evidence cannot support.",
    measure: "Documented completion of the action and repeat participation.",
    result: {
      value: "1M+",
      label: "Documented desk breaks",
      detail:
        "ASICS's 2024 sustainability report records more than one million documented desk breaks in October 2024.",
    },
    resultScope: "October 2024 · documented actions · company reported",
    caveat:
      "Documented actions are not necessarily unique participants, product sales or evidence of clinical outcomes.",
    sources: [
      {
        label: "2024 sustainability report · ASICS",
        url: "https://assets.asics.com/system/libraries/4037/ASICS_sustainability_report_2024.pdf",
        note: "Page 19 records the campaign and October participation measure.",
      },
      {
        label: "Creative and employer activation · Golin",
        url: "https://golin.com/emea/cannes-lions-2025-golin-gold-silver-effectiveness/",
        note: "How the film extended into workplace participation.",
      },
    ],
  }),
  study({
    id: "barbie-selfie",
    brand: "Warner Bros.",
    title: "Barbie Selfie Generator",
    year: 2023,
    market: "Global",
    channel: "Interactive tool & social",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "image",
    playbooks: ["participation", "demonstration"],
    moveIds: ["for_you_news", "show_it", "offer_first"],
    evidence: "reach",
    approach:
      "Fans received a personal version of the campaign's own artwork, making participation an act of self-expression.",
    objective:
      "Give audiences a reason to create and distribute the movie's visual identity themselves.",
    audience:
      "Fans, creators and brands who wanted to join the movie conversation.",
    setup:
      "The generator removed a selfie's background and placed the person inside an official-style movie poster. A usable personal artifact was the immediate reward.",
    execution: [
      {
        title: "Use an established visual system",
        detail:
          "The personal poster belonged to the same world as the movie's promotion.",
      },
      {
        title: "Make creation fast",
        detail:
          "Automated background removal reduced the work required to participate.",
      },
      {
        title: "Let the person carry the story",
        detail:
          "The output was about the participant, with the campaign identity built in.",
      },
    ],
    mechanisms: [
      {
        title: "The artifact had personal value",
        detail:
          "People were not asked to share a generic brand asset; they could share themselves inside the idea.",
      },
      {
        title: "Consistency connected contributions",
        detail:
          "A common template made many personal images recognizable as one campaign.",
      },
      {
        title: "Low effort supported scale",
        detail:
          "Fast creation reduced the chance that interest would disappear before the result was ready.",
      },
    ],
    lookFor:
      "What stays fixed in the poster system and what changes for each participant.",
    blueprint: [
      {
        title: "Give",
        detail:
          "Create a useful or expressive result the participant will want to keep.",
      },
      {
        title: "Personalize",
        detail:
          "Let them supply one meaningful input without a complicated setup.",
      },
      {
        title: "Connect",
        detail:
          "Keep the product identity recognizable while making sharing optional and easy.",
      },
    ],
    useWhen:
      "Personalization adds value for the audience, not just exposure for the brand.",
    avoidWhen:
      "The artifact feels like unpaid advertising or demands more personal information than the result merits.",
    measure:
      "Completed creations, voluntary shares and qualified follow-on visits separately.",
    result: {
      value: "13M+",
      label: "Generator uses reported",
      detail:
        "The original July 2023 supplier release reports use of the tool more than 13 million times.",
    },
    resultScope: "April–July 2023 · tool uses · supplier reported",
    caveat:
      "Uses are not unique people or verified shares. The movie's wider marketing and existing cultural presence were major advantages.",
    sources: [
      {
        label: "Original 2023 announcement · Photoroom",
        url: "https://www.prnewswire.com/news-releases/photoroom-and-warner-bros-join-forces-to-create-viral-barbie-selfie-generator-using-cutting-edge-ai-technology-301881685.html",
        note: "The original usage measure; it is not a share count.",
      },
      {
        label: "Implementation and creative · Photoroom",
        url: "https://www.photoroom.com/customer-stories/barbie",
        note: "How the tool worked and original campaign output.",
      },
    ],
  }),
  study({
    id: "liquid-death-ozzy",
    brand: "Liquid Death",
    title: "Infinitely Recyclable Ozzy",
    year: 2025,
    market: "United States",
    channel: "Limited drop & PR",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "short_video",
    playbooks: ["positioning", "story"],
    moveIds: ["taboo_literal", "offer_first", "category_feeling"],
    evidence: "results",
    approach:
      "A literal twist on 'recyclable' turned a commodity beverage into a peculiar collectible and a story people could repeat.",
    objective: "Create a distinctive cultural moment for the beverage brand.",
    audience:
      "Fans of Ozzy Osbourne and the brand's irreverent entertainment style.",
    setup:
      "The brand offered ten signed cans Ozzy had drunk from, packaged as DNA specimens. The collectible drop made the recycling joke into a real, extremely limited offer.",
    execution: [
      {
        title: "Extend an established voice",
        detail: "The premise fit a brand already associated with dark humor.",
      },
      {
        title: "Make the joke physical",
        detail:
          "An actual collectible gave the story an object to photograph and discuss.",
      },
      {
        title: "Finish with a real offer",
        detail:
          "A small, explicit quantity made the product page part of the execution.",
      },
    ],
    mechanisms: [
      {
        title: "An unexpected connection carried the hook",
        detail:
          "Recyclability and a celebrity's DNA made a surprising premise with a direct link to the can.",
      },
      {
        title: "The object compressed the story",
        detail:
          "The packaging made the idea understandable without a long explanation.",
      },
      {
        title: "Scarcity was concrete",
        detail:
          "A disclosed tiny production run made the offer finite, rather than relying on manufactured urgency.",
      },
    ],
    lookFor:
      "How the specimen-style packaging completes the premise of the announcement.",
    blueprint: [
      {
        title: "Connect",
        detail:
          "Find an unexpected but honest link between your product and a shared interest.",
      },
      {
        title: "Materialize",
        detail: "Make a small real artifact that expresses the idea.",
      },
      {
        title: "Offer",
        detail:
          "State the genuine quantity and use the story to introduce the wider product.",
      },
    ],
    useWhen:
      "You have a distinctive voice and an audience likely to appreciate the same joke.",
    avoidWhen:
      "Shock replaces a product connection or the stunt needs attention your brand has not earned.",
    measure:
      "Relevant earned coverage and downstream product interest, beyond the collectible sales.",
    result: {
      value: "Sold out",
      label: "A drop of ten collectibles",
      detail:
        "The original product page marks the limited Ozzy DNA collectible sold out.",
    },
    resultScope: "June 2025 collectible drop · ten units · brand storefront",
    caveat:
      "Selling ten collectibles does not prove scalable beverage demand or profitable customer acquisition. This is primarily a study in earned attention.",
    sources: [
      {
        label: "Original offer and artwork · Liquid Death",
        url: "https://liquiddeath.com/pages/ozzy",
        note: "The quantity, packaging and sold-out product status.",
      },
      {
        label: "Launch reporting · Marketing Dive / MediaPost",
        url: "https://www.mediapost.com/publications/article/406828/liquid-death-sells-cans-with-ozzy-osbournes-dna.html",
        note: "Contemporaneous June 2025 account of the drop.",
      },
    ],
  }),
  study({
    id: "wispr-old-way",
    brand: "Wispr Flow",
    title: "Break up with your keyboard",
    year: null,
    market: "Official brand film",
    channel: "Product demonstration & film",
    audiences: ["prosumer", "b2c", "developer", "b2b"],
    preferredFormat: "short_video",
    software: true,
    playbooks: ["demonstration", "positioning"],
    moveIds: ["villain_object", "show_it", "finally_works"],
    evidence: "reference",
    approach:
      "Making the keyboard the antagonist turns an abstract productivity promise into a familiar habit the audience can reconsider.",
    objective:
      "Make voice input understandable as a replacement for a daily behavior.",
    audience:
      "People who spend much of their working day typing across applications.",
    setup:
      "The official brand film dramatizes a relationship with the keyboard, then offers voice as a different way to write. Wispr includes the film in its current media kit; the kit does not publish a release date.",
    execution: [
      {
        title: "Choose a concrete old way",
        detail:
          "The keyboard gives the audience something more specific than 'inefficiency' to recognize.",
      },
      {
        title: "Dramatize the friction",
        detail: "The familiar habit becomes the subject of the story.",
      },
      {
        title: "Connect to a product demonstration",
        detail:
          "The new behavior must explain how the product changes an actual task.",
      },
    ],
    mechanisms: [
      {
        title: "A physical object makes the tension legible",
        detail:
          "A viewer can recognize the old behavior before understanding the technology.",
      },
      {
        title: "The contrast supplies a structure",
        detail:
          "Old way, frustration and alternative give the message a clear sequence.",
      },
      {
        title: "The promise can be tried",
        detail:
          "The idea becomes stronger when a real demonstration closes the gap between a film and first use.",
      },
    ],
    lookFor:
      "How the keyboard stays the central foil instead of being replaced by a list of software features.",
    blueprint: [
      {
        title: "Old way",
        detail: "Name the specific habit your customer performs today.",
      },
      {
        title: "New way",
        detail: "Show your real product doing the same job differently.",
      },
      {
        title: "First win",
        detail:
          "Offer one small task where the difference is immediately visible.",
      },
    ],
    useWhen: "Your product meaningfully replaces a recognizable behavior.",
    avoidWhen:
      "The old method works well for the audience or your first-use experience cannot deliver the contrast.",
    measure: "Demo comprehension and successful first-task completion.",
    result: {
      value: "Creative study",
      label: "Campaign-level results are not public",
      detail:
        "Included as a current official example because its structure is useful to product teams. No conversion lift or campaign ROI has been verified.",
    },
    resultScope:
      "Official media kit reviewed October 2026 · release date not published",
    caveat:
      "The explanations here are creative analysis, not proof this film caused company growth.",
    sources: [
      {
        label: "Official film and media kit · Wispr Flow",
        url: "https://wisprflow.ai/media-kit",
        note: "The publisher's own selected brand film. Campaign-level measurement and release date are not supplied.",
      },
    ],
  }),
  study({
    id: "ramp-time-money",
    brand: "Ramp",
    title: "Multiply What's Possible",
    year: 2026,
    market: "United States",
    channel: "Brand film & live activation",
    audiences: ["b2b", "prosumer"],
    preferredFormat: "short_video",
    software: true,
    playbooks: ["demonstration", "story"],
    moveIds: ["show_it", "two_buyers", "villain_object"],
    evidence: "reference",
    approach:
      "One overwhelmed finance worker becomes many versions of himself, turning saved capacity into a visible, humorous idea.",
    objective:
      "Make a finance-software benefit understandable beyond a feature list.",
    audience:
      "Finance teams and business buyers familiar with administrative overload.",
    setup:
      "Ramp's 2026 Super Bowl film used Brian Baumgartner and multiplying workers to dramatize the promise of getting more done. The same character had appeared in an earlier receipts stunt.",
    execution: [
      {
        title: "Start in a recognizable situation",
        detail:
          "Receipts and a looming meeting establish the administrative job.",
      },
      {
        title: "Visualize the benefit",
        detail:
          "Multiplication makes additional capacity visible without a technical explanation.",
      },
      {
        title: "Keep the product attached",
        detail:
          "The brand's role is to change the workflow rather than merely sponsor the joke.",
      },
    ],
    mechanisms: [
      {
        title: "A metaphor does explanatory work",
        detail:
          "Additional versions of a worker make the abstract promise of saved time concrete.",
      },
      {
        title: "The setting qualifies the audience",
        detail:
          "Finance-specific friction helps the right buyer see themselves in a broad-reach film.",
      },
      {
        title: "A recurring character creates continuity",
        detail:
          "The stunt and film can reinforce the same association over several exposures.",
      },
    ],
    lookFor:
      "The moment the worker multiplies and how that maps back to the product's promised benefit.",
    blueprint: [
      {
        title: "Situation",
        detail: "Show one recognizable bottleneck in your buyer's day.",
      },
      {
        title: "Transformation",
        detail:
          "Make the real benefit visible through one simple metaphor or demonstration.",
      },
      {
        title: "Proof",
        detail:
          "Connect the metaphor to your own supported product capability.",
      },
    ],
    useWhen: "Your benefit is real but hard to visualize in a screenshot.",
    avoidWhen:
      "Celebrity recognition or production scale carries the whole idea, or the metaphor exaggerates the product.",
    measure:
      "Benefit recall and qualified buyer interest, then supported conversion measures.",
    result: {
      value: "Creative study",
      label: "No isolated conversion result verified",
      detail:
        "This is a current B2B creative reference. The library does not treat broad company growth or estimated media attention as campaign ROI.",
    },
    resultScope: "Super Bowl LX · 2026 official film",
    caveat:
      "A successful-looking production is not evidence of profitable acquisition. The mechanism is an interpretation of the creative.",
    sources: [
      {
        label: "Official campaign film · Ramp",
        url: "https://www.youtube.com/watch?v=1-mgrFS00B0",
        note: "The original 2026 commercial.",
      },
      {
        label: "Production and creative account · LBB",
        url: "https://lbbonline.com/news/Ramp-Super-Bowl-LX-Brian-Baumgartner",
        note: "Campaign date, authorship and execution.",
      },
    ],
  }),
  study({
    id: "volvo-human-story",
    brand: "Volvo",
    title: "EX90: For Life",
    year: 2024,
    market: "Global",
    channel: "Film & YouTube",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "short_video",
    playbooks: ["story", "demonstration"],
    moveIds: ["before_after", "show_it"],
    evidence: "reach",
    approach:
      "A safety feature becomes the turning point in a human story; shorter versions retell the same idea from different perspectives.",
    objective:
      "Make the EX90's safety proposition emotionally meaningful during its launch.",
    audience:
      "Potential vehicle buyers weighing safety and the people they want to protect.",
    setup:
      "Volvo combined a four-minute film, a 60-second version from the car's perspective and a 15-second spot. The product was part of the narrative rather than a final logo reveal.",
    execution: [
      {
        title: "Establish human stakes",
        detail:
          "The longer film gives the audience a reason to care about the outcome.",
      },
      {
        title: "Let the product change the story",
        detail: "A real capability supplies the turning point.",
      },
      {
        title: "Retell rather than simply crop",
        detail:
          "The shorter executions carry the idea through different lengths and viewpoints.",
      },
    ],
    mechanisms: [
      {
        title: "Emotion had a product reason",
        detail:
          "The story's payoff made the safety proposition relevant rather than decorative.",
      },
      {
        title: "Different lengths had different jobs",
        detail:
          "A long film could establish context while short versions reinforced the same association.",
      },
      {
        title: "Consistency accumulated meaning",
        detail:
          "Repeated exposure could connect several executions to one central promise.",
      },
    ],
    lookFor:
      "How the four-minute and shorter films preserve the product's role while changing the viewpoint.",
    blueprint: [
      {
        title: "Moment",
        detail: "Choose a true customer situation with meaningful stakes.",
      },
      {
        title: "Turning point",
        detail: "Show the real capability that changes the outcome.",
      },
      {
        title: "Cutdown",
        detail:
          "Retell the same idea at a shorter length with its own clear beginning and payoff.",
      },
    ],
    useWhen:
      "You have a real product capability and a customer story that makes it matter.",
    avoidWhen:
      "The emotion could belong to any brand or the turning point depends on an unsupported capability.",
    measure:
      "Message recall and qualified search or visits across the full sequence.",
    result: {
      value: "+250%",
      label: "Search lift increase reported",
      detail:
        "Google's campaign analysis cites Volvo's internal 2024 data for the multi-format campaign.",
    },
    resultScope: "2024 EX90 campaign · Volvo internal data cited by Google",
    caveat:
      "Search lift is not vehicle sales. The report covers the campaign and its distribution, not a controlled test of one film.",
    sources: [
      {
        label: "Campaign analysis · Google / Volvo",
        url: "https://business.google.com/uk/think/search-and-video/cannes-lions-2025-youtube-creator-marketing/",
        note: "The three creative lengths and the reported search measure.",
      },
    ],
  }),
  study({
    id: "ocado-show-tell",
    brand: "Ocado",
    title: "Value Worth Talking About",
    year: 2025,
    market: "United Kingdom",
    channel: "YouTube & Demand Gen",
    audiences: ["b2c", "prosumer"],
    preferredFormat: "short_video",
    playbooks: ["proof", "story"],
    moveIds: ["their_words", "show_it", "before_after"],
    evidence: "results",
    approach:
      "Real customer audio gave animated food a credible voice, while an ongoing media program kept testing the message and the audience.",
    objective:
      "Find a scalable acquisition engine as existing channels became more expensive.",
    audience:
      "Grocery shoppers who might assume Ocado was too expensive or not relevant to them.",
    setup:
      "The creative paired actual customer interview audio with animated produce and on-screen text. Ocado also changed from short media bursts to an always-on YouTube program.",
    execution: [
      {
        title: "Use customer language",
        detail:
          "Real interviews supplied recognizable concerns and reasons to buy.",
      },
      {
        title: "Make the voice memorable",
        detail:
          "Animated food provided a distinctive carrier for the testimony.",
      },
      {
        title: "Keep learning after launch",
        detail:
          "The team refreshed concepts and adjusted audiences, bidding and measurement.",
      },
    ],
    mechanisms: [
      {
        title: "Specific words made the reassurance credible",
        detail:
          "A customer's own explanation addressed a real objection more directly than a generic value slogan.",
      },
      {
        title: "The visual device supplied distinctiveness",
        detail:
          "The animated subject made testimony easier to notice without replacing its meaning.",
      },
      {
        title: "Distribution was part of the result",
        detail:
          "Creative learning and media optimization continued together; the ad was not a standalone magic ingredient.",
      },
    ],
    lookFor:
      "How the spoken customer sentence, animated subject and visible text reinforce one point.",
    blueprint: [
      {
        title: "Listen",
        detail:
          "Choose a permitted customer quote addressing one buying objection.",
      },
      {
        title: "Show",
        detail:
          "Pair it with a distinctive visual that keeps the meaning intact.",
      },
      {
        title: "Learn",
        detail:
          "Test meaningfully different concepts and judge completed customer actions.",
      },
    ],
    useWhen:
      "You have credible customer language and enough distribution to learn from variants.",
    avoidWhen:
      "The testimony is invented or a production gimmick obscures what the customer actually means.",
    measure:
      "New-customer acquisition cost and incrementality over a defined period.",
    result: {
      value: "−73%",
      label: "Cost per acquisition reported",
      detail:
        "Ocado's marketing leader describes a year-over-year improvement after changing its wider YouTube strategy.",
    },
    resultScope: "Year-over-year program comparison · reported January 2026",
    caveat:
      "Creative, audiences, bidding and measurement changed together. The result cannot be attributed to the talking-food execution alone.",
    sources: [
      {
        label: "Marketing leader's account · Ocado / Google",
        url: "https://business.google.com/uk/think/search-and-video/ocado-retail-youtube-demand-gen-strategy/",
        note: "Creative, operating changes, measurement and reported acquisition results.",
      },
    ],
  }),
];
