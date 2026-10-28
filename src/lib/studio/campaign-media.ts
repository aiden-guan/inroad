/** Current original creative. Removed/private clips and outdated launch media are not retained here. */
export type CampaignMedia = {
  title: string;
  alt: string;
  credit: string;
  sourceUrl: string;
} & (
  | { kind: "youtube"; videoId: string; poster: string }
  | { kind: "image"; src: string }
);

export const CAMPAIGN_MEDIA: Readonly<
  Record<string, readonly CampaignMedia[]>
> = {
  "duolingo-death-of-duo": [
    {
      kind: "image",
      src: "https://d2z00kf51ll94q.cloudfront.net//archive/2026/large/OS26_BS041M_1.jpg",
      title: "The Death of Duo · original campaign work",
      alt: "Original campaign creative for Duolingo’s Death of Duo",
      credit: "Original campaign work · The One Club",
      sourceUrl:
        "https://www.oneclub.org/awards/theoneshow/-award/63707/the-death-of-duo/",
    },
  ],
  "cerave-michael": [
    {
      kind: "image",
      src: "https://d2z00kf51ll94q.cloudfront.net//archive/2024/large/OS24_HW006G_0.jpg",
      title: "Michael CeraVe · original campaign work",
      alt: "Michael Cera in the CeraVe campaign",
      credit: "Original campaign work · The One Club",
      sourceUrl:
        "https://www.oneclub.org/awards/theoneshow/-award/53015/michael-cerave/",
    },
  ],
  "vaseline-verified": [
    {
      kind: "image",
      src: "https://res.cloudinary.com/wpp-cloudinary/image/upload/c_auto%2Cw_3840%2Cg_auto/f_auto/q_92/v1/wpp/project/wpp/images/featured-work/featured-work-2025/vaseline-verified_thumbnail?_a=BAVMn6DY0",
      title: "Vaseline Verified · creator and lab creative",
      alt: "A collage of creator and product-use imagery from Vaseline Verified",
      credit: "Vaseline / Ogilvy · WPP campaign archive",
      sourceUrl:
        "https://www.wpp.com/en/case-studies/ogilvy-mindshare-vaseline-verified",
    },
  ],
  "spotify-wrapped": [
    {
      kind: "image",
      src: "https://storage.googleapis.com/pr-newsroom-wp/1/2025/12/2025-Wrapped-OOH-Miami-HunterX-WestFace0033-1024x576.jpg",
      title: "Wrapped 2025 · Miami",
      alt: "Spotify Wrapped campaign billboard in Miami",
      credit: "Spotify Newsroom · campaign photography",
      sourceUrl:
        "https://newsroom.spotify.com/2025-12-03/wrapped-marketing-campaign/",
    },
    {
      kind: "image",
      src: "https://storage.googleapis.com/pr-newsroom-wp/1/2025/12/2025-Wrapped-OOH-Nashville-Taylor341-1024x576.jpg",
      title: "Wrapped 2025 · Nashville",
      alt: "Spotify Wrapped billboard featuring Taylor Swift in Nashville",
      credit: "Spotify Newsroom · campaign photography",
      sourceUrl:
        "https://newsroom.spotify.com/2025-12-03/wrapped-marketing-campaign/",
    },
  ],
  "notion-think-make": [
    {
      kind: "image",
      src: "https://cdn.sanity.io/images/uk7b627p/production/eb61a4b5229ecce43de7fb198e85d178357e2ebc-2736x2800.png?auto=format&q=95&w=600",
      title: "Think it. Make it. · original outdoor work",
      alt: "Yellow Notion campaign poster in a subway station",
      credit: "Notion / BUCK · campaign photography",
      sourceUrl: "https://buck.co/work/notion-think-it-make-it",
    },
    {
      kind: "image",
      src: "https://cdn.sanity.io/images/uk7b627p/production/2cad3db11962d1fa5c319b5f3da7aba4e165a938-5218x3913.png?auto=format&dpr=2&q=75&w=600",
      title: "The visual system across a station",
      alt: "A series of Notion campaign posters in a London Underground corridor",
      credit: "Notion / BUCK · campaign photography",
      sourceUrl: "https://buck.co/work/notion-think-it-make-it",
    },
  ],
  "heinz-ketchup-fraud": [
    {
      kind: "image",
      src: "https://images.squarespace-cdn.com/content/v1/67d08ce4b6eff9353ec5a601/bb4da0c5-0e8f-464f-ade8-95b7f2821dd6/HeinzCF_Kitchen_",
      title: "Ketchup Fraud · original creative",
      alt: "Caught-in-the-act campaign photography from Heinz Ketchup Fraud",
      credit: "Heinz · creative-team portfolio",
      sourceUrl: "https://www.kateaspencer.com/recent-work/heinz",
    },
  ],
  "doordash-all-ads": [
    {
      kind: "image",
      src: "https://d2z00kf51ll94q.cloudfront.net//archive/2024/large/OS24_CE009B_10.jpg",
      title: "All The Ads · original campaign work",
      alt: "DoorDash’s All The Ads campaign work submitted to The One Show",
      credit: "DoorDash / Wieden+Kennedy / Superette · The One Club",
      sourceUrl:
        "https://www.oneclub.org/awards/theoneshow/-award/52641/doordash-all-the-ads/",
    },
  ],
  "ikea-coworker": [
    {
      kind: "image",
      src: "https://www.ikea.com/images/the-co-worker-image-and-ikea-badge-93ef9c0f5fc20c66664ec689e193f370.jpg?f=sg",
      title: "The Co-Worker · recruitment creative",
      alt: "IKEA Co-Worker campaign artwork for its Roblox store",
      credit: "IKEA · official campaign imagery",
      sourceUrl:
        "https://www.ikea.com/ie/en/newsroom/corporate-news/ikea-is-opening-a-new-store-on-roblox-and-you-could-be-paid-to-work-there-pub8a9272d0/",
    },
  ],
  "pedigree-adoptable": [
    {
      kind: "image",
      src: "https://cdn.nexusstudios.com/uploads/2024/04/NexusStudios_Pedigree_Adoptable_ApprovedAssets_Support-Image-2.jpg",
      title: "Adoptable · original campaign asset",
      alt: "A real shelter dog featured in Pedigree Adoptable creative",
      credit: "Pedigree / Colenso / Nexus Studios",
      sourceUrl: "https://nexusstudios.com/work/pedigree-adoptable",
    },
  ],
  "orange-womens-football": [
    {
      kind: "image",
      src: "https://d9m1iyeq935g9.cloudfront.net/orange-bleues-0031692716360-realisation-fancybox.png?width=auto",
      title: "WoMen’s Football · the reveal",
      alt: "Side-by-side campaign frames revealing the original women’s football footage",
      credit: "Orange / Marcel · original campaign frames",
      sourceUrl:
        "https://lareclame.fr/marcel/realisations/orange-et-marcel-vous-font-voir-les-bleues-comme-jamais-vous-ne-les-avez-vues",
    },
  ],
  "poptarts-edible-mascot": [
    {
      kind: "image",
      src: "https://d2z00kf51ll94q.cloudfront.net//archive/2024/large/OS24_EX027B_0.jpg",
      title: "The First Edible Mascot · event creative",
      alt: "Original Pop-Tarts edible mascot campaign work",
      credit: "Original campaign work · The One Club",
      sourceUrl:
        "https://www.oneclub.org/awards/theoneshow/-award/52935/the-first-edible-mascot/",
    },
  ],
  "specsavers-misheard": [
    {
      kind: "image",
      src: "https://storage.googleapis.com/nub-news-files/nub-news-file-storage/505943/conversions/text-article.jpg",
      title: "The Misheard Version · campaign publicity",
      alt: "Rick Astley at a mixing desk with the Specsavers campaign title",
      credit: "Specsavers · campaign publicity still",
      sourceUrl: "https://www.specsavers.ie/misheard-version",
    },
  ],
  "axa-three-words": [
    {
      kind: "image",
      src: "https://d2z00kf51ll94q.cloudfront.net//archive/2026/large/OS26_CD004G_1.jpg",
      title: "Three Words · original campaign work",
      alt: "AXA Three Words campaign work illustrating its contract change",
      credit: "Original campaign work · The One Club",
      sourceUrl:
        "https://www.oneclub.org/awards/theoneshow/-award/63733/three-words/",
    },
  ],
  "asics-desk-break": [
    {
      kind: "image",
      src: "https://aor-images-prod.s3.amazonaws.com/omu4fqmkpzhg5i0eix0wwmdbr4sc",
      title: "The Desk Break · original film frame",
      alt: "Brian Cox behind a desk in ASICS’s Desk Break campaign",
      credit: "ASICS / Golin · Ads of the World archive",
      sourceUrl:
        "https://www.adsoftheworld.com/campaigns/the-desk-break-case-study",
    },
  ],
  "barbie-selfie": [
    {
      kind: "image",
      src: "https://storyblok-cdn.photoroom.com/f/191576/1440x686/7e8c3af09a/barbie_selfie_poster_before_after-1.webp/m/3840x0/filters%3Aquality%2880%29%3Ano_upscale%28%29%3Aformat%28webp%29",
      title: "Barbie Selfie Generator · personalized output",
      alt: "A before-and-after showing a selfie becoming a Barbie campaign poster",
      credit: "Warner Bros. / Photoroom · campaign output",
      sourceUrl: "https://www.photoroom.com/customer-stories/barbie",
    },
  ],
  "liquid-death-ozzy": [
    {
      kind: "image",
      src: "https://liquiddeath.com/cdn/shop/files/Ozzy-Dna-2.jpg?v=1750124872&width=2040",
      title: "Infinitely Recyclable Ozzy · the collectible",
      alt: "The signed Ozzy collectible in specimen-style packaging",
      credit: "Liquid Death · original product photography",
      sourceUrl: "https://liquiddeath.com/pages/ozzy",
    },
  ],
  "wispr-old-way": [
    {
      kind: "youtube",
      videoId: "9KqGpxtsawc",
      title: "Break up with your keyboard",
      alt: "Wispr Flow’s official keyboard-replacement brand film",
      credit: "Wispr Flow · official media kit",
      sourceUrl: "https://wisprflow.ai/media-kit",
      poster: "https://i.ytimg.com/vi/9KqGpxtsawc/hqdefault.jpg",
    },
  ],
  "ramp-time-money": [
    {
      kind: "youtube",
      videoId: "1-mgrFS00B0",
      title: "Multiply What’s Possible",
      alt: "Ramp’s 2026 campaign film featuring Brian Baumgartner",
      credit: "Ramp · official campaign film",
      sourceUrl: "https://www.youtube.com/watch?v=1-mgrFS00B0",
      poster: "https://i.ytimg.com/vi/1-mgrFS00B0/hqdefault.jpg",
    },
  ],
  "volvo-human-story": [
    {
      kind: "youtube",
      videoId: "cQX-QXxwGvA",
      title: "EX90 · the original film",
      alt: "Volvo’s human-focused EX90 campaign film",
      credit: "Volvo Cars · original campaign film",
      sourceUrl:
        "https://business.google.com/uk/think/search-and-video/cannes-lions-2025-youtube-creator-marketing/",
      poster: "https://i.ytimg.com/vi/cQX-QXxwGvA/hqdefault.jpg",
    },
  ],
  "ocado-show-tell": [
    {
      kind: "image",
      src: "https://www.gstatic.com/marketing-cms/assets/images/ads/f1/ba/80da503740669d9908e0e6ddf075/twg-content-original-images-twg-uk-1345-inline-1600-min.webp%3Dn-w794-h444-fcrop64%3D1%2C00000000ffffffff",
      title: "Customer voices, talking food · campaign still",
      alt: "An onion and garlic with on-screen customer testimony in Ocado’s campaign",
      credit: "Ocado Retail / Google · campaign still",
      sourceUrl:
        "https://business.google.com/uk/think/search-and-video/ocado-retail-youtube-demand-gen-strategy/",
    },
  ],
};

export function campaignMedia(id: string): readonly CampaignMedia[] {
  return CAMPAIGN_MEDIA[id] ?? [];
}
export function mediaPoster(media: CampaignMedia): string {
  return media.kind === "youtube" ? media.poster : media.src;
}
export function mediaOriginal(media: CampaignMedia): string {
  return media.kind === "youtube"
    ? "https://www.youtube.com/watch?v=" + media.videoId
    : media.src;
}
export function mediaPreviewUrl(id: string, index = 0): string {
  return "/api/studio/campaign-media/" + encodeURIComponent(id) + "/" + index;
}
