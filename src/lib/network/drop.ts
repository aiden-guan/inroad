import { isLinkedInHeader, parseCsv } from "./csv";
import { autoMap, detectPreset, type Mapping, type PresetId } from "./presets";
import type { ImportBatchSummary } from "./types";

/**
 * Onboarding's "Got a list?" drop: one file, no mapping screen. LinkedIn's Connections.csv goes in as the
 * network (screened once the bet exists); any other list (a waitlist, a user export) goes in as companies
 * and people when its columns map on their own. Zero tokens either way.
 */

export type DropPlan = { kind: "linkedin" } | { kind: "list"; preset: PresetId; mapping: Mapping } | { kind: "unmapped" } | { kind: "empty" };

export function planDrop(text: string): DropPlan {
  const linkedin = parseCsv(text, { isHeader: isLinkedInHeader });
  if (isLinkedInHeader(linkedin.headers)) return linkedin.rows.length ? { kind: "linkedin" } : { kind: "empty" };
  const p = parseCsv(text);
  if (!p.headers.length || !p.rows.length) return { kind: "empty" };
  const preset = detectPreset(p.headers);
  const mapping = autoMap(p.headers, preset, p.rows.slice(0, 20));
  // Companies are matched by domain: a website or a work email has to be there.
  if (mapping.domain === null && mapping.email === null) return { kind: "unmapped" };
  return { kind: "list", preset: preset.id, mapping };
}

const fmt = (n: number) => n.toLocaleString("en-US");
const count = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** One line for what just came in. */
export function droppedLine(batch: ImportBatchSummary): string {
  if (batch.kind === "linkedin") {
    const total = batch.linkedin?.total ?? batch.rows;
    return `${count(total, "connection", "connections")} in. I'll start with the people who already know you, and screen the rest against your bet once it's ready.`;
  }
  const companies = batch.counts.accountsCreated + batch.counts.accountsUpdated;
  const people = batch.counts.peopleCreated + batch.counts.peopleUpdated;
  const what = [companies ? count(companies, "company", "companies") : "", people ? count(people, "person", "people") : ""].filter(Boolean).join(" and ");
  return what ? `${what} from ${batch.fileName}. I'll look at them first.` : `Nothing new in ${batch.fileName}: those companies are already here.`;
}
