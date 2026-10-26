import type { StudioState } from "@/lib/domain/types";
import type { Clock } from "./clock";
import { CLAIM, POV } from "./ids";

/**
 * Studio for the Ledgerline sample: what Priya told it, and one homepage hero she asked for. Every
 * specific in the options rests on a sample receipt (approved claims, POVs, customer words, her
 * material), so lint passes for the same reasons it would in a real workspace. Lint is computed
 * when the sample is assembled (see index.ts).
 */

export const MATERIAL = {
  closeStory: "mat_ll_close_story",
  demo: "mat_ll_demo",
  lateEvents: "mat_ll_late_events",
} as const;

export const PIECE = { hero: "stu_ll_hero" } as const;

const noLint = { passed: true, violations: [], stats: { words: 0, grade: 0, concrete: 0, vague: 0 } };

export function studio(c: Clock): StudioState {
  const created = c.at(-3, "16:40");
  return {
    profile: {
      audience: "b2b",
      reader: "a controller at a usage-priced software company who closes the books every month",
      productName: "Ledgerline",
      neverSay: ["excited", "touch base"],
    },
    material: [
      {
        id: MATERIAL.closeStory,
        kind: "story",
        text: "A controller walked me through her close: the usage export from the warehouse, the invoice export from billing, and a VLOOKUP on customer ID. It takes her first week of every month.",
        source: "Discovery call, October 2026",
        permission: "anonymized_only",
        createdAt: c.at(-9, "11:05"),
        uses: 1,
      },
      {
        id: MATERIAL.demo,
        kind: "demo",
        text: "Connect read-only to the warehouse and billing, pick last month, and Ledgerline lists every usage event that never reached an invoice line, with the amount.",
        createdAt: c.at(-9, "11:07"),
        uses: 0,
      },
      {
        id: MATERIAL.lateEvents,
        kind: "belief",
        text: "Leakage hides in the events that arrive after the invoice run. Nobody owns that gap.",
        createdAt: c.at(-9, "11:09"),
        uses: 0,
      },
    ],
    pieces: {
      [PIECE.hero]: {
        id: PIECE.hero,
        format: "homepage_hero",
        occasion: "evergreen",
        audience: "b2b",
        brief: "New homepage hero for controllers. The site still leads with the product category.",
        title: "Homepage hero: new hero for controllers",
        gaps: [],
        createdAt: created,
        updatedAt: created,
        options: [
          {
            id: "opt_ll_hours",
            moveId: "one_number",
            parts: {
              headline: "Close usage revenue in 6 hours instead of 4 days",
              subhead: "Ledgerline matches every metered usage event to the invoice line it landed on, so your controller stops rebuilding the close in spreadsheets.",
              cta: "Run last month's close",
              proof: "A design partner went from 4 days to 6 hours in their first close.",
            },
            receiptIds: [CLAIM.designPartner, "co_what"],
            why: "A controller reads the hours and thinks of their own last close.",
            lint: noLint,
            kept: true,
          },
          {
            id: "opt_ll_vlookup",
            moveId: "before_after",
            parts: {
              headline: "Month-end close without the VLOOKUP on customer ID",
              subhead: "The usage export, the invoice export, a week of matching. Ledgerline matches each event to its invoice line and flags the ones that arrived late.",
              cta: "Try one close",
              proof: "",
            },
            receiptIds: [MATERIAL.closeStory, MATERIAL.demo],
            why: "Names the exact spreadsheet step they did last week.",
            lint: noLint,
          },
          {
            id: "opt_ll_script",
            moveId: "villain_object",
            parts: {
              headline: "Retire the reconciliation script nobody else can read",
              subhead: "Ledgerline ties out usage to invoices event by event, including the late events that land after the invoice run.",
              cta: "See your unmatched usage",
              proof: "Built by Priya Raman, who ran the metering-to-invoice pipeline at Tollgate for five years.",
            },
            receiptIds: [POV.blackBox, POV.lateEvents, CLAIM.credential],
            why: "Every controller knows whose script that is.",
            lint: noLint,
          },
        ],
      },
    },
    images: {},
    visuals: {},
  };
}
