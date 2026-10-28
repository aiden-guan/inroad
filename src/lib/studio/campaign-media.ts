/** Original creative, separate from performance evidence. No generated stand-ins or homepage captures.
 * These are publisher-hosted assets/players; the source ledger records how each was identified. */
export type CampaignMedia = {
  title: string;
  alt: string;
  credit: string;
  sourceUrl: string;
} & (
  | { kind: "youtube"; videoId: string }
  | { kind: "image"; src: string }
  | { kind: "video"; src: string; poster: string }
);

const spotifySource =
  "https://newsroom.spotify.com/2025-12-03/wrapped-marketing-campaign/";
const volvoSource =
  "https://business.google.com/uk/think/search-and-video/cannes-lions-2025-youtube-creator-marketing/";
const ocadoSource =
  "https://business.google.com/uk/think/search-and-video/ocado-retail-youtube-demand-gen-strategy/";

export const CAMPAIGN_MEDIA: Readonly<
  Record<string, readonly CampaignMedia[]>
> = {
  "wispr-old-way": [
    {
      kind: "youtube",
      videoId: "9KqGpxtsawc",
      title: "Break up with your keyboard",
      alt: "Wispr Flow's official keyboard replacement brand film",
      credit: "Wispr Flow · official media kit",
      sourceUrl: "https://wisprflow.ai/media-kit",
    },
  ],
  "notion-creators": [
    {
      kind: "youtube",
      videoId: "WoNZUlRu168",
      title: "6 AI Tools I Use to Boost My Productivity",
      alt: "Ali Abdaal demonstrates his workflow in a video sponsored by Notion",
      credit: "Ali Abdaal · Notion sponsorship",
      sourceUrl: "https://www.youtube.com/watch?v=WoNZUlRu168",
    },
  ],
  "ramp-time-money": [
    {
      kind: "youtube",
      videoId: "1-mgrFS00B0",
      title: "Multiply What's Possible",
      alt: "Ramp's 2026 Super Bowl commercial featuring Brian Baumgartner",
      credit: "Ramp · official campaign film",
      sourceUrl: "https://www.youtube.com/watch?v=1-mgrFS00B0",
    },
  ],
  "supabase-alternative": [
    {
      kind: "video",
      src: "https://xguihxuzqibwxjnimxev.supabase.co/storage/v1/object/public/videos/docs/auth-zoom2.mp4",
      poster: "/campaigns/supabase-auth-cover.png",
      title: "Supabase Auth launch demo",
      alt: "The user-management product demonstration embedded in the original Supabase Auth launch",
      credit: "Supabase · original 2020 launch",
      sourceUrl: "https://supabase.com/blog/supabase-auth",
    },
    {
      kind: "image",
      src: "/campaigns/supabase-auth-cover.png",
      title: "Original launch artwork",
      alt: "Original Supabase Auth launch graphic on a dark geometric background",
      credit: "Supabase · launch artwork",
      sourceUrl:
        "https://github.com/supabase/supabase/blob/master/apps/www/public/images/blog/supabase-auth-cover.png",
    },
  ],
  "spotify-wrapped": [
    {
      kind: "image",
      src: "https://storage.googleapis.com/pr-newsroom-wp/1/2025/12/2025-Wrapped-OOH-Miami-HunterX-WestFace0033-1024x576.jpg",
      title: "Wrapped 2025 · Miami",
      alt: "Spotify Wrapped out-of-home campaign billboard in Miami",
      credit: "Spotify Newsroom · campaign photography",
      sourceUrl: spotifySource,
    },
    {
      kind: "image",
      src: "https://storage.googleapis.com/pr-newsroom-wp/1/2025/12/2025-Wrapped-OOH-Nashville-Taylor341-1024x576.jpg",
      title: "Wrapped 2025 · Nashville",
      alt: "Spotify Wrapped billboard featuring Taylor Swift in Nashville",
      credit: "Spotify Newsroom · campaign photography",
      sourceUrl: spotifySource,
    },
  ],
  "oatly-conversation": [
    {
      kind: "image",
      src: "https://cdn.prod.website-files.com/68779613f0480ed104c47c15/68c5e1325e297da74a98317d_68068701de31fea35d4b0183_647791fa062a73fa4c69c575_Screenshot%2525202023-05-31%252520at%2525209.57.57%252520AM%252520copy.png",
      title: "Oatly's Reddit megathread",
      alt: "Reddit's published screenshot of the Oatly campaign",
      credit: "Oatly / Reddit · campaign screenshot",
      sourceUrl:
        "https://www.business.reddit.com/success-stories/advertisers/oatly-free-form",
    },
  ],
  "cider-shorts": [
    {
      kind: "youtube",
      videoId: "kOXr65vDDUo",
      title: "Cider · vertical video creative",
      alt: "Cider video creative linked in Google's YouTube Shorts campaign case study",
      credit: "Cider / Google · published campaign video",
      sourceUrl:
        "https://business.google.com/us/resources/success-stories/cider/",
    },
    {
      kind: "youtube",
      videoId: "51QSeMfsaNc",
      title: "Cider · second campaign video",
      alt: "Second Cider video linked in Google's campaign case study",
      credit: "Cider / Google · published campaign video",
      sourceUrl:
        "https://business.google.com/us/resources/success-stories/cider/",
    },
  ],
  "volvo-human-story": [
    {
      kind: "youtube",
      videoId: "cQX-QXxwGvA",
      title: "EX90 · four-minute film",
      alt: "Volvo's human-focused EX90 campaign film",
      credit: "Volvo Cars · campaign film",
      sourceUrl: volvoSource,
    },
    {
      kind: "youtube",
      videoId: "O9Z_vzJyToA",
      title: "EX90 · 60-second cut",
      alt: "The EX90 story retold from the car's perspective",
      credit: "Volvo Cars · campaign cutdown",
      sourceUrl: volvoSource,
    },
    {
      kind: "youtube",
      videoId: "sBOdXYsK7c8",
      title: "EX90 · 15-second spot",
      alt: "Volvo's short EX90 campaign spot",
      credit: "Volvo Cars · campaign cutdown",
      sourceUrl: volvoSource,
    },
  ],
  "ocado-show-tell": [
    {
      kind: "youtube",
      videoId: "ppwIZ4tn-E0",
      title: "Ocado · real customers, talking vegetables",
      alt: "Ocado campaign video using customer interview audio and animated food",
      credit: "Ocado Retail / Google · campaign film",
      sourceUrl: ocadoSource,
    },
    {
      kind: "image",
      src: "https://www.gstatic.com/marketing-cms/assets/images/ads/f1/ba/80da503740669d9908e0e6ddf075/twg-content-original-images-twg-uk-1345-inline-1600-min.webp%3Dn-w794-h444-fcrop64%3D1%2C00000000ffffffff",
      title: "Customer testimonial creative",
      alt: "An onion and garlic in an Ocado ad with on-screen customer testimonial text",
      credit: "Ocado Retail / Google · campaign still",
      sourceUrl: ocadoSource,
    },
  ],
};

export function campaignMedia(id: string): readonly CampaignMedia[] {
  return CAMPAIGN_MEDIA[id] ?? [];
}

export function mediaPoster(media: CampaignMedia): string {
  return media.kind === "youtube"
    ? `https://i.ytimg.com/vi/${media.videoId}/hqdefault.jpg`
    : media.kind === "video"
      ? media.poster
      : media.src;
}

export function mediaOriginal(media: CampaignMedia): string {
  return media.kind === "youtube"
    ? `https://www.youtube.com/watch?v=${media.videoId}`
    : media.src;
}
