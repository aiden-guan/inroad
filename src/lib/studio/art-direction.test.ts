import { describe, expect, it } from "vitest";
import { creativeBrief, creativeReviewRank, needsCreativeWork, productionImagePrompt, visualReferencesFor, type CreativeBriefInput } from "./art-direction";
import { checkImagePrompt } from "./visuals";
import { VISUAL_REFERENCES } from "./visual-references";

const brief: CreativeBriefInput = {
  message: "Give the team room to build together", direction: "", brief: "A collaboration tool for designers",
  palette: ["#213F9A", "#FFF5E5", "#F95C45"], format: "Feed graphic", width: 1080, height: 1350, seed: "option-a",
};

describe("creative art direction", () => {
  it("grounds inspiration in relevant work and selects distinct source brands", () => {
    const sources = visualReferencesFor("Design team collaboration", "collage", "option-a");
    expect(sources.map((r) => r.id)).toEqual(expect.arrayContaining(["dropbox", "figma"]));
    expect(new Set(sources.map((r) => r.brand)).size).toBe(sources.length);
    expect(visualReferencesFor("Design team collaboration", "collage", "option-a")).toEqual(sources);
    expect(new Set(VISUAL_REFERENCES.map((r) => r.id)).size).toBe(VISUAL_REFERENCES.length);
    for (const r of VISUAL_REFERENCES) expect(new URL(r.url).protocol).toBe("https:");
  });

  it("keeps explicit direction and approved campaign data intact while adding bounded exploration", () => {
    const direction = "A restrained blue ink drawing of exactly one folded leaf; keep its placement in the lower right.";
    const text = creativeBrief({ ...brief, direction, style: "illustration", energy: "focused" });
    expect(text).toContain(direction);
    expect(text).toContain("Those choices take precedence");
    expect(text).toContain("Medium: Expressive illustration");
    expect(text).toContain("Creative range: Focused");
    expect(text).toContain("three genuinely different concepts");
    expect(text).toContain("not performance evidence");
  });

  it("uses platform safe zones and bounds old prompts to discourage repeated concepts", () => {
    const text = creativeBrief({ ...brief, width: 1080, height: 1920, safe: { top: 0.14, bottom: 0.35, side: 0.06 }, previousPrompts: Array(10).fill("Folded paper bridge. ".repeat(1000)) });
    expect(text).toContain("x=65…1015, y=269…1248");
    expect(text).toContain("Change the central mechanism and composition");
    expect(text.length).toBeLessThan(12000);
    expect(text).toContain("central safe area");
  });

  it("does not mistake exclusions or vivid art direction for forbidden content", () => {
    const text = productionImagePrompt("Concept: an impossible folded-paper bridge joining two complementary materials. Hard raking light. Neon yellow paper with visible fibers. Leave the upper third calm.", 1080, 1350);
    expect(checkImagePrompt(text)).toEqual([]);
    expect(checkImagePrompt("No dashboard or screenshot. A dashboard showing revenue.")).toContain("The prompt paints the product's interface.");
    expect(checkImagePrompt("Avoid glowing brains. A glowing brain made of neon circuitry.")).toContain("The prompt uses an AI-art cliché.");
    expect(text).toContain("Do not reproduce their assets");
  });

  it("does not let an overall score hide a weak concept or a generic template", () => {
    const strong = { score: 8, concept: 8, distinctiveness: 8, craft: 8, template: false };
    const generic = { score: 10, concept: 9, distinctiveness: 4, craft: 10, template: true };
    expect(needsCreativeWork(strong)).toBe(false);
    expect(needsCreativeWork(generic)).toBe(true);
    expect(needsCreativeWork({ ...strong, concept: 6 })).toBe(true);
    expect(creativeReviewRank(strong)).toBeGreaterThan(creativeReviewRank(generic));
  });
});
