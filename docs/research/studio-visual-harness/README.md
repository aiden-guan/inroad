# Studio visual harness: concept before decoration

Reviewed October 28, 2026. This work draws on 25 primary-source brand and campaign case studies, plus sampled stills and animation frames from 14 COLLINS galleries. The visual samples include identities, illustrations, campaign applications and product mockups. They are creative references, not a dataset of independently measured ad performance. A recognizable brand or an agency's reported business result does not establish that a particular graphic treatment caused engagement.

## What held the old harness back

- Image rules explicitly preferred ordinary real-world scenes and plain lighting. The prompt-writing example was a desk, coffee and invoices.
- SVG direction restricted the palette to a background, ink and one accent, and the default statement layout to a headline and thin rule.
- ChatGPT subscription generation skipped the richer prompt-writing stage and used a short generic photograph/illustration instruction.
- Two designs were encouraged to vary layout, with no reference-driven concept development or memory of previous images for the message.
- The reviewer could flag `template: true`, but that flag did not trigger a revision. An overall score could hide a weak idea. Missing reviews could still leave an image appearing ready.

## Findings translated into behavior

| Finding | Harness behavior |
| --- | --- |
| A visual surprise works best when it expresses the message | Explore three different visual mechanisms before choosing one. Reject interchangeable objects and stock scenes. Preserve a user's explicit scene or medium. |
| Richness comes from deliberate craft, not a pile of effects | Name the subject/action, scale, silhouette, viewpoint, material, light or mark-making, background, palette roles and calm copy area. |
| A small visual vocabulary can still produce variety | Offer seven media families and three creative ranges; adapt relevant reference techniques without reproducing a brand's appearance. |
| Physical contrast makes abstract software benefits tangible | Permit surreal construction, illustration/photo contrast, purposeful gradients and dramatic light. Keep invented interfaces and endorsements excluded. |
| Typography belongs in the composition from the start | Reserve an explicit copy area and platform-safe coordinates. Keep exact copy in the checked SVG layer. Avoid automatically squeezing a complete illustration into a narrow side slot. |
| Recoloring is not a new idea | Send the last three image prompts for this option as bounded diversity context. Different SVG compositions may share the same supplied picture, but need distinct hierarchy and image/type relationships. |
| Prompt quality is not pixel quality | Full design runs inspect the generated image itself, allow one targeted regeneration, then inspect actual SVG renders and allow one design revision. |

The runtime library and source URLs live in `src/lib/studio/visual-references.ts`. Selection favors subject relevance before medium, with stable tie rotation. Only three written techniques are injected per request. No reference assets are copied into generated images or bundled into the application.

## Routes and review limits

| Route | Concept development | Independent pixel review |
| --- | --- | --- |
| OpenAI API + finished graphic | Shared brief → prompt writer → production contract | Generated image review, at most one image regeneration; final graphic review, at most one SVG revision |
| ChatGPT plan + finished graphic | Shared brief asks the connected runtime to compare concepts privately and render one | Same bounded image and graphic reviews, using the creator already selected for design |
| Image-only ChatGPT plan | Same detailed brief and production contract; no separate prompt-writing call | None; UI says **Visual review not run**. This route still needs only the ChatGPT connection. |
| Copyable prompt | Same reference-aware brief → prompt writer → production contract | None until an image is supplied and designed |
| Type & illustration / supplied image | Shared brief → SVG composition | Final graphic review and one revision; a previously generated image without a review stays marked for inspection |

Readiness requires an overall score of at least 8, concept/originality/craft each at least 7, no generic-template flag, and no readability, contrast or broken-render issue. The weaker creative dimension affects ranking. A missing reviewer, an unsuccessful refinement or an unresolved weak result remains visible as a review note. Automatic refinement uses the same provider; it never switches a subscription request to API billing.

Generated image records store the exact selected prompt, harness version, medium, creative range, source IDs and available review scores. These fields are optional for existing images, so old workspaces remain readable.

## Example and observed failure

![Sculptural reconciliation concept](examples/reconciliation-sculpture.png)

The illustrative brief was revenue reconciliation for finance teams: many tangled paper strips resolving into a precise folded ribbon. It uses material transformation and scale rather than a worker-at-a-desk scene. This sample was generated with Codex's built-in image tool using the compiled shared brief, **not** through a live Inroad API or subscription account.

The first output introduced invoice-like printing despite a no-text instruction. A targeted image edit removed those marks while preserving the composition. This led to an additional production constraint requiring all paper, packaging, signs and surfaces to be unprinted, including pseudo-writing. The original full prompt and refinement prompt are saved beside the sample. This manual edit demonstrates the repair direction; it is not evidence that the application's reviewer would always detect or fix that issue.

## Validation

- 130 Vitest files passed: 1,300 tests passed, 3 skipped, with `npm test -- --maxWorkers=2`. Integration tests render and composite real PNGs; network/model responses are scripted. Real renderer groups allow 20 seconds for font discovery/compositing on a busy machine; earlier parallel checks hit the previous 5-second test deadline without assertion failures.
- New regression coverage checks prompt parity, explicit medium/creative-range propagation, source selection, safe areas, bounded history, generic-template revisions, weak-dimension revisions, selection of the better image, exact prompt persistence, same-provider failures and unavailable reviewers.
- TypeScript and ESLint pass. The production build passes; it retains existing filesystem-tracing warnings in the updater/backup/settings modules.
- Browser inspection uses an isolated sample workspace. It covers medium and creative-range controls, source disclosure, and a 390px layout with no document overflow. [Desktop](examples/studio-desktop.jpg) and [mobile](examples/studio-mobile.jpg) screenshots are saved. The existing browser tests were updated for the new labels, request arguments and review status; the Playwright suite was not run in this change.
- No live Inroad OpenAI, Claude-plan or ChatGPT-plan generation was exercised. The built-in sample is a visual smoke check, not a measured quality benchmark. User engagement, conversion, cross-model consistency and reliability across arbitrary briefs remain unmeasured.

## Repeatable visual evaluation

Use the same eight briefs before and after a future harness change: finance reconciliation, collaborative design, a study aid, a food launch, a restrained wellness concept, an engineering system, a community event and an explicitly specified photograph. Include a detailed user direction and an open brief in each comparison. Keep model, output size and quality settings fixed. Randomize presentation order to reviewers.

Judge message relevance, distinctiveness, craft, copy-space fit and fidelity to explicit instructions separately. Record failures such as incidental text, meaningless props, cropping and invented evidence. Do not use the harness's own reviewer as the only judge or call a prettier result an engagement lift without a real experiment.

## Source casebook

The table below contains our observations and transferable techniques. It makes no claim that these techniques caused the brands' business outcomes.

<!-- Source table is generated from visual-references.ts. -->

| Primary source | Observation | Transfer |
| --- | --- | --- |
| [Mailchimp](https://wearecollins.com/case-studies/mailchimp/) | Wry humor, expressive drawing and sophisticated typography make an ordinary software category feel idiosyncratic. | Literalize one phrase from the message with an unexpected physical relationship. Keep the drawing expressive and the surrounding composition disciplined. |
| [Dropbox](https://wearecollins.com/case-studies/dropbox/) | Unexpected combinations of color, art, photography and type communicate co-creation. | Combine two relevant materials with deliberately different textures, united by one geometry. Make their interaction express the benefit. |
| [Figma](https://wearecollins.com/case-studies/figma/) | A campaign challenges the lone-genius story and treats collaboration as the central idea. | Make several distinct contributions resolve into one coherent subject. Borrow the relationship, never fabricated product screens or cursor UI. |
| [Spotify Wrapped](https://vucko.co/work/spotify-wrapped-2024) | A shared expressive system connects campaign and product, while each year's execution reflects its cultural moment. | Use rhythm, repetition and a surprising crop as the graphic idea. Keep one dominant contrast; set exact words separately in code. |
| [Notion](https://www.instrument.com/work/notion) | Specific human stories and real environments give a technology campaign emotional relevance. | Choose a telling moment or trace of activity rather than a staged happy worker. Use viewpoint and environmental detail to carry the story. |
| [Reddit](https://www.pentagram.com/work/reddit) | A conversation bubble and carefully defined character system build a cohesive, playful visual language. | Give a relevant object a distinctive silhouette and tactile personality. Do not reproduce a mascot or invent a customer likeness. |
| [Slack](https://www.pentagram.com/work/slack) | A small geometric vocabulary scales into a recognizable family of illustrations and advertising applications. | Build a meaningful motif from a few repeatable shapes, then vary scale and arrangement instead of adding unrelated decoration. |
| [Channel 4](https://www.pentagram.com/work/channel-4) | A unifying behavior lets a brand move through expressive, interconnected worlds without losing attribution. | Make a frame, aperture or crop reveal a surprising second world tied to the message. Let depth do a storytelling job. |
| [Burger King](https://www.jkrglobal.com/work/burger-king) | Food and the physical eating experience anchor a broad identity, rather than a generic corporate finish. | Art-direct a close crop around a sensorial material truth: grain, moisture, folds or texture. Make the category tangible. |
| [Nike Run](https://www.portorocha.com/nikerun) | A flexible system moves between confident race-day expression and technical precision. | Create directional tension with a tight crop, decisive diagonal or repetition. Use energetic composition, not random sports props. |
| [MIT Media Lab](https://www.pentagram.com/work/mit-media-lab) | A shared modular grid gives an interdisciplinary organization both unity and variation. | Give all supporting forms one construction rule. Make a change in that rule express a before/after or new possibility. |
| [The Public Theater](https://www.pentagram.com/work/the-public-theater) | Typography functions as a public voice rather than a neutral caption. | Let approved words become a large graphic mass with deliberate scale contrast. Keep the reading order immediate. |
| [Mastercard](https://www.pentagram.com/work/mastercard) | Simple geometry and calibrated color preserve recognition across many applications. | Reduce a complicated benefit to one legible relationship between forms. Make color separation intentional and test at thumbnail size. |
| [Mohawk](https://www.pentagram.com/work/mohawk) | A paper company's identity connects a simple mark to a broad range of physical applications. | Use folds, overlaps and material edges to create depth. Physical construction should explain the idea, not just decorate a background. |
| [Twitch](https://wearecollins.com/case-studies/twitch/) | An expanded palette and expressive typography support many creators while preserving a recognizable core. | Hold one brand anchor constant and use one high-energy intervention around it. Keep the subject ahead of the supporting effects. |
| [Robinhood](https://wearecollins.com/case-studies/robinhood/) | Detailed illustrated worlds connect financial access to an imaginative future, rather than reducing every graphic to a chart. | Build a scene whose spatial relationships express the audience's ambition. Do not substitute decorative coins or invented performance graphs for meaning. |
| [Sweetgreen](https://wearecollins.com/case-studies/sweetgreen/) | Oversized ingredients meet small line-drawn figures; material contrast and playful scale make freshness tangible. | Combine a real category-specific material with an expressive drawn gesture at an unexpected scale. Give the two layers an interaction, not just proximity. |
| [Bose](https://wearecollins.com/case-studies/bose/) | Close crops, saturated edge lighting and deep shadow turn small material details into a dramatic sensory experience. | Magnify a relevant surface or physical effect with precise light and a decisive crop. Use material behavior rather than generic decorative waves. |
| [San Francisco Symphony](https://wearecollins.com/case-studies/san-francisco-symphony/) | Measured variation in letterform construction turns typography into an expressive performance. | Express rhythm through measured changes in form, width and spacing. Keep exact text legible while the surrounding structure carries emotion. |
| [YouTube Gaming](https://wearecollins.com/case-studies/youtube-gaming/) | Illustrated worlds, nested image planes and oversized type establish a sense of entering another space. | Use a controlled frame and one meaningful interruption in scale or depth to create immersion. Do not fabricate gameplay or a product capture. |
| [CNET](https://wearecollins.com/case-studies/cnet/) | A confident serif masthead and emphatic color hold together varied editorial imagery without making every image look the same. | Make hierarchy decisive: one focal statement, one supporting object and a restrained information layer. Avoid filling every corner. |
| [Girl Scouts](https://wearecollins.com/case-studies/girl-scouts/) | A recognizable silhouette coexists with a bright toolkit of simple graphic symbols. | Build an optimistic, repeatable graphic gesture around the actual activity. Test its silhouette small; vary its behavior rather than inventing a generic mascot. |
| [OpenWeb](https://wearecollins.com/case-studies/open-web/) | Editorial serif type, a radial mark and image mosaics bring publishing's cultural voice to a conversation platform. | Create a deliberate relationship between an authoritative type area and a varied image field. Give every fragment a shared compositional rule. |
| [Vitaminwater](https://wearecollins.com/case-studies/vitaminwater/) | Stacked blocks and contrasting color fields reduce the bottle to a recognizable graphic silhouette. | Abstract a relevant object into a few purposeful color planes, preserving the identifying silhouette. Let shape and color do more than decorative texture. |
| [Freeform](https://wearecollins.com/case-studies/freeform/) | Cut and recombined letterforms create a repeatable behavior across saturated title cards and story imagery. | Give supporting shapes one distinctive construction rule and repeat that behavior across compositions. Keep approved words readable and exact. |
