/**
 * Primary-source creative studies, reviewed 2026-10-28. Principles and transfers are our
 * analysis, not claims that a particular visual treatment caused commercial results.
 * Only these written techniques enter prompts; other brands' assets and copy never do.
 */
export type ArtStyle = "surreal" | "collage" | "sculptural" | "illustration" | "graphic" | "editorial" | "photography";

export interface VisualReference {
  id: string;
  brand: string;
  url: string;
  styles: ArtStyle[];
  keywords: string[];
  observation: string;
  transfer: string;
}

export const VISUAL_REFERENCES: readonly VisualReference[] = [
  {
    id: "mailchimp", brand: "Mailchimp", url: "https://wearecollins.com/case-studies/mailchimp/",
    styles: ["surreal", "illustration"], keywords: ["marketing", "small business", "email", "growth"],
    observation: "Wry humor, expressive drawing and sophisticated typography make an ordinary software category feel idiosyncratic.",
    transfer: "Literalize one phrase from the message with an unexpected physical relationship. Keep the drawing expressive and the surrounding composition disciplined.",
  },
  {
    id: "dropbox", brand: "Dropbox", url: "https://wearecollins.com/case-studies/dropbox/",
    styles: ["collage", "illustration", "graphic"], keywords: ["team", "collaboration", "files", "creative"],
    observation: "Unexpected combinations of color, art, photography and type communicate co-creation.",
    transfer: "Combine two relevant materials with deliberately different textures, united by one geometry. Make their interaction express the benefit.",
  },
  {
    id: "figma", brand: "Figma", url: "https://wearecollins.com/case-studies/figma/",
    styles: ["graphic", "collage"], keywords: ["team", "design", "collaboration", "build"],
    observation: "A campaign challenges the lone-genius story and treats collaboration as the central idea.",
    transfer: "Make several distinct contributions resolve into one coherent subject. Borrow the relationship, never fabricated product screens or cursor UI.",
  },
  {
    id: "spotify-wrapped", brand: "Spotify Wrapped", url: "https://vucko.co/work/spotify-wrapped-2024",
    styles: ["graphic", "editorial"], keywords: ["music", "personal", "year", "celebrate", "data"],
    observation: "A shared expressive system connects campaign and product, while each year's execution reflects its cultural moment.",
    transfer: "Use rhythm, repetition and a surprising crop as the graphic idea. Keep one dominant contrast; set exact words separately in code.",
  },
  {
    id: "notion", brand: "Notion", url: "https://www.instrument.com/work/notion",
    styles: ["photography", "editorial"], keywords: ["work", "life", "organize", "productivity", "plan"],
    observation: "Specific human stories and real environments give a technology campaign emotional relevance.",
    transfer: "Choose a telling moment or trace of activity rather than a staged happy worker. Use viewpoint and environmental detail to carry the story.",
  },
  {
    id: "reddit", brand: "Reddit", url: "https://www.pentagram.com/work/reddit",
    styles: ["sculptural", "illustration"], keywords: ["community", "conversation", "people", "social"],
    observation: "A conversation bubble and carefully defined character system build a cohesive, playful visual language.",
    transfer: "Give a relevant object a distinctive silhouette and tactile personality. Do not reproduce a mascot or invent a customer likeness.",
  },
  {
    id: "slack", brand: "Slack", url: "https://www.pentagram.com/work/slack",
    styles: ["graphic", "illustration"], keywords: ["team", "communication", "message", "connect"],
    observation: "A small geometric vocabulary scales into a recognizable family of illustrations and advertising applications.",
    transfer: "Build a meaningful motif from a few repeatable shapes, then vary scale and arrangement instead of adding unrelated decoration.",
  },
  {
    id: "channel4", brand: "Channel 4", url: "https://www.pentagram.com/work/channel-4",
    styles: ["surreal", "graphic", "sculptural"], keywords: ["entertainment", "discover", "world", "video"],
    observation: "A unifying behavior lets a brand move through expressive, interconnected worlds without losing attribution.",
    transfer: "Make a frame, aperture or crop reveal a surprising second world tied to the message. Let depth do a storytelling job.",
  },
  {
    id: "burger-king", brand: "Burger King", url: "https://www.jkrglobal.com/work/burger-king",
    styles: ["editorial", "photography", "illustration"], keywords: ["food", "flavor", "eat", "restaurant"],
    observation: "Food and the physical eating experience anchor a broad identity, rather than a generic corporate finish.",
    transfer: "Art-direct a close crop around a sensorial material truth: grain, moisture, folds or texture. Make the category tangible.",
  },
  {
    id: "nike-run", brand: "Nike Run", url: "https://www.portorocha.com/nikerun",
    styles: ["editorial", "photography", "graphic"], keywords: ["run", "sport", "performance", "motion", "fitness"],
    observation: "A flexible system moves between confident race-day expression and technical precision.",
    transfer: "Create directional tension with a tight crop, decisive diagonal or repetition. Use energetic composition, not random sports props.",
  },
  {
    id: "mit", brand: "MIT Media Lab", url: "https://www.pentagram.com/work/mit-media-lab",
    styles: ["graphic"], keywords: ["research", "system", "technology", "science", "modular"],
    observation: "A shared modular grid gives an interdisciplinary organization both unity and variation.",
    transfer: "Give all supporting forms one construction rule. Make a change in that rule express a before/after or new possibility.",
  },
  {
    id: "public", brand: "The Public Theater", url: "https://www.pentagram.com/work/the-public-theater",
    styles: ["editorial", "graphic"], keywords: ["launch", "culture", "event", "announce"],
    observation: "Typography functions as a public voice rather than a neutral caption.",
    transfer: "Let approved words become a large graphic mass with deliberate scale contrast. Keep the reading order immediate.",
  },
  {
    id: "mastercard", brand: "Mastercard", url: "https://www.pentagram.com/work/mastercard",
    styles: ["graphic"], keywords: ["payment", "finance", "simple", "connect"],
    observation: "Simple geometry and calibrated color preserve recognition across many applications.",
    transfer: "Reduce a complicated benefit to one legible relationship between forms. Make color separation intentional and test at thumbnail size.",
  },
  {
    id: "mohawk", brand: "Mohawk", url: "https://www.pentagram.com/work/mohawk",
    styles: ["collage", "graphic"], keywords: ["paper", "print", "craft", "material"],
    observation: "A paper company's identity connects a simple mark to a broad range of physical applications.",
    transfer: "Use folds, overlaps and material edges to create depth. Physical construction should explain the idea, not just decorate a background.",
  },
  {
    id: "twitch", brand: "Twitch", url: "https://wearecollins.com/case-studies/twitch/",
    styles: ["editorial", "graphic", "collage"], keywords: ["creator", "community", "stream", "game"],
    observation: "An expanded palette and expressive typography support many creators while preserving a recognizable core.",
    transfer: "Hold one brand anchor constant and use one high-energy intervention around it. Keep the subject ahead of the supporting effects.",
  },
  {
    id: "robinhood", brand: "Robinhood", url: "https://wearecollins.com/case-studies/robinhood/",
    styles: ["surreal", "illustration"], keywords: ["money", "finance", "invest", "future", "revenue", "billing"],
    observation: "Detailed illustrated worlds connect financial access to an imaginative future, rather than reducing every graphic to a chart.",
    transfer: "Build a scene whose spatial relationships express the audience's ambition. Do not substitute decorative coins or invented performance graphs for meaning.",
  },
  {
    id: "sweetgreen", brand: "Sweetgreen", url: "https://wearecollins.com/case-studies/sweetgreen/",
    styles: ["illustration", "photography", "editorial"], keywords: ["food", "health", "fresh", "sustainable"],
    observation: "Oversized ingredients meet small line-drawn figures; material contrast and playful scale make freshness tangible.",
    transfer: "Combine a real category-specific material with an expressive drawn gesture at an unexpected scale. Give the two layers an interaction, not just proximity.",
  },
  {
    id: "bose", brand: "Bose", url: "https://wearecollins.com/case-studies/bose/",
    styles: ["photography", "editorial", "sculptural"], keywords: ["sound", "music", "listen", "hardware"],
    observation: "Close crops, saturated edge lighting and deep shadow turn small material details into a dramatic sensory experience.",
    transfer: "Magnify a relevant surface or physical effect with precise light and a decisive crop. Use material behavior rather than generic decorative waves.",
  },
  {
    id: "sf-symphony", brand: "San Francisco Symphony", url: "https://wearecollins.com/case-studies/san-francisco-symphony/",
    styles: ["editorial", "graphic"], keywords: ["music", "culture", "emotion", "expression"],
    observation: "Measured variation in letterform construction turns typography into an expressive performance.",
    transfer: "Express rhythm through measured changes in form, width and spacing. Keep exact text legible while the surrounding structure carries emotion.",
  },
  {
    id: "youtube-gaming", brand: "YouTube Gaming", url: "https://wearecollins.com/case-studies/youtube-gaming/",
    styles: ["graphic", "collage"], keywords: ["game", "creator", "video", "play"],
    observation: "Illustrated worlds, nested image planes and oversized type establish a sense of entering another space.",
    transfer: "Use a controlled frame and one meaningful interruption in scale or depth to create immersion. Do not fabricate gameplay or a product capture.",
  },
  {
    id: "cnet", brand: "CNET", url: "https://wearecollins.com/case-studies/cnet/",
    styles: ["editorial", "graphic"], keywords: ["technology", "news", "information", "review"],
    observation: "A confident serif masthead and emphatic color hold together varied editorial imagery without making every image look the same.",
    transfer: "Make hierarchy decisive: one focal statement, one supporting object and a restrained information layer. Avoid filling every corner.",
  },
  {
    id: "girl-scouts", brand: "Girl Scouts", url: "https://wearecollins.com/case-studies/girl-scouts/",
    styles: ["illustration", "graphic"], keywords: ["learn", "grow", "education", "community"],
    observation: "A recognizable silhouette coexists with a bright toolkit of simple graphic symbols.",
    transfer: "Build an optimistic, repeatable graphic gesture around the actual activity. Test its silhouette small; vary its behavior rather than inventing a generic mascot.",
  },
  {
    id: "openweb", brand: "OpenWeb", url: "https://wearecollins.com/case-studies/open-web/",
    styles: ["editorial", "illustration"], keywords: ["conversation", "web", "publish", "community"],
    observation: "Editorial serif type, a radial mark and image mosaics bring publishing's cultural voice to a conversation platform.",
    transfer: "Create a deliberate relationship between an authoritative type area and a varied image field. Give every fragment a shared compositional rule.",
  },
  {
    id: "vitaminwater", brand: "Vitaminwater", url: "https://wearecollins.com/case-studies/vitaminwater/",
    styles: ["photography", "graphic", "sculptural"], keywords: ["drink", "color", "flavor", "energy"],
    observation: "Stacked blocks and contrasting color fields reduce the bottle to a recognizable graphic silhouette.",
    transfer: "Abstract a relevant object into a few purposeful color planes, preserving the identifying silhouette. Let shape and color do more than decorative texture.",
  },
  {
    id: "freeform", brand: "Freeform", url: "https://wearecollins.com/case-studies/freeform/",
    styles: ["collage", "graphic", "editorial"], keywords: ["entertainment", "culture", "story", "discover"],
    observation: "Cut and recombined letterforms create a repeatable behavior across saturated title cards and story imagery.",
    transfer: "Give supporting shapes one distinctive construction rule and repeat that behavior across compositions. Keep approved words readable and exact.",
  },
];
