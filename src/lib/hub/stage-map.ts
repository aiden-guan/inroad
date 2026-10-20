/**
 * Suggests how our six stages map onto a CRM pipeline, by label, in code. The founder can change
 * any of them; the suggestion only fills stages they haven't set.
 */
import type { Stage } from "@/lib/domain/types";
import type { Pipeline } from "@/lib/connectors/types";

const HINTS: Record<Stage, RegExp[]> = {
  talking: [/appointment|discovery|intro|meeting|talking|conversation|engaged|in progress/i, /lead|new|contact/i],
  qualified: [/qualif/i, /need|interest/i],
  pilot: [/pilot|trial|poc|proof/i, /demo|presentation|evaluat|technical/i],
  proposal: [/proposal|quote|pricing/i, /contract|negotiat/i, /decision|commit/i],
  won: [/won|win|customer/i],
  lost: [/lost|disqualif|dead/i],
  nurture: [/nurture|on hold|later|paused/i, /lost/i],
};

export function suggestStageMap(pipeline: Pipeline): Partial<Record<Stage, string>> {
  const stages = pipeline.stages;
  const out: Partial<Record<Stage, string>> = {};
  if (!stages.length) return out;
  const used = new Set<string>();
  const order: Stage[] = ["won", "lost", "talking", "qualified", "pilot", "proposal", "nurture"];
  for (const stage of order) {
    for (const re of HINTS[stage]) {
      const hit =
        stage === "won"
          ? stages.find((s) => s.closed === "won") ?? stages.find((s) => re.test(s.label))
          : stage === "lost"
            ? stages.find((s) => s.closed === "lost") ?? stages.find((s) => re.test(s.label))
            : stages.find((s) => !s.closed && !used.has(s.id) && re.test(s.label)) ?? (stage === "nurture" ? stages.find((s) => re.test(s.label)) : undefined);
      if (hit) {
        out[stage] = hit.id;
        if (stage !== "nurture") used.add(hit.id);
        break;
      }
    }
  }
  // An unmapped open stage carries the previous stage's mapping forward, so deals never move backwards.
  const open = stages.filter((s) => !s.closed && !/won|lost/i.test(s.label));
  let carry = open[0]?.id ?? stages[0].id;
  for (const stage of ["talking", "qualified", "pilot", "proposal"] as const) {
    if (out[stage]) carry = out[stage];
    else out[stage] = carry;
  }
  out.won ??= stages[stages.length - 1].id;
  out.lost ??= stages[stages.length - 1].id;
  out.nurture ??= out.lost;
  return out;
}
