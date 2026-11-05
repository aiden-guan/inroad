import type { Account, ISODateTime, PersonaRole, SignalType, Stage } from "@/lib/domain/types";

/**
 * Plays the founder writes: a recipe (trigger, audience, guardrails, action, measure) that code runs
 * exactly like a built-in play. The model only turns a sentence into a recipe; matching costs nothing.
 * Logic lives in recipes.ts (matching) and custom.ts (versions, lessons, suggestions).
 */

export type RecipeActionKind = "write" | "research" | "intro" | "deal";
export type RecipeMeasure = "reply" | "meeting" | "won";
/** none: no open or parked deal · open: an open deal (at `stages`, when set) · any: either. */
export type RecipeDealFilter = "none" | "open" | "any";
export type RecipeStatus = Extract<Account["status"], "new" | "tracked" | "in_pipeline">;

export interface RecipeTrigger {
  /** Any of these signal types fires it. */
  signals: SignalType[];
  /** A signal counts for this many days after its date. */
  withinDays: number;
  /** When set, the signal's headline or implication must mention one of these (case-insensitive, from a word start). */
  keywords: string[];
  /** The weakest signal that counts, 1 (any) to 3 (strong only). */
  minStrength: 1 | 2 | 3;
  /** At least this many different signal types fresh at once (stacked signals). 1 = any one. */
  stack: 1 | 2 | 3;
}

export interface RecipeAudience {
  /** Empty = any tier. */
  tiers: Account["tier"][];
  /** 0–100. */
  minFit: number;
  /** Empty = any. Customers and disqualified companies are always out. */
  statuses: RecipeStatus[];
  deal: RecipeDealFilter;
  /** With deal "open": the stages it runs on (empty = any open stage). */
  stages: Stage[];
  /** Who to contact, in order of preference. Empty = the best person on file. */
  personas: PersonaRole[];
  /** Never contact these (usually learned from "wrong person" skips). */
  excludePersonas: PersonaRole[];
  /** ICP criterion ids the company must meet. */
  criteria: string[];
  /** The company's facts on file (name, description, stack, evidence) must mention one of these. */
  keywords: string[];
}

export interface RecipeGuardrails {
  /** No new card at a company that anyone, or this play, reached in the last N days. 0 = off. */
  cooldownDays: number;
  /** New companies a week, at most. */
  maxPerWeek: number;
}

export interface Recipe {
  /** ≤ 60 characters: "RevOps or billing hire, no open deal". */
  name: string;
  trigger: RecipeTrigger;
  audience: RecipeAudience;
  guardrails: RecipeGuardrails;
  /** `angle`: the reason to write, in a sentence the drafts follow. */
  action: { kind: RecipeActionKind; angle: string };
  measure: RecipeMeasure;
}

export interface RecipeVersion {
  version: number;
  recipe: Recipe;
  at: ISODateTime;
  /** What changed, in one line: "Cooldown 30 → 60 days". */
  note: string;
  source: "compiled" | "suggested" | "edit" | "learned";
}

/** A part of the founder's sentence InRoad can't detect, and the nearest thing it can. Never dropped silently. */
export interface UnsupportedPart {
  phrase: string;
  why: string;
  nearest: string;
}

export interface CustomPlay {
  id: string;
  createdAt: ISODateTime;
  /** The founder's sentence, or how a suggestion described itself. */
  sentence: string;
  origin: "sentence" | "suggestion";
  /** The suggestion it came from, so it isn't suggested again. */
  suggestion?: string;
  /** Saved versions, oldest first. Empty until the first time it's turned on. */
  versions: RecipeVersion[];
  /** Which version was current from when: one entry per save or rollback, oldest first. */
  history: { version: number; at: ISODateTime }[];
  /** Unsaved: the whole recipe before the first enable, or changes to a play that has run. */
  draft?: Recipe;
  /** What the sentence asked for that it can't run, and what the compiler assumed. */
  unsupported: UnsupportedPart[];
  assumptions: string[];
  /** Skip lessons the founder said no to, and how many skips each rested on (a new one needs 3 more). */
  dismissed: { key: string; at: ISODateTime; skips: number }[];
  archivedAt?: ISODateTime;
  /** The compile run, for its receipt. */
  runId?: string;
}

export type CustomPlayAction =
  /** Create a play (a draft from a suggestion), or put a snapshot back (undo). */
  | { type: "customPlay.upsert"; play: CustomPlay }
  /** Change the recipe: in place before the first enable, else as unsaved changes. */
  | { type: "customPlay.edit"; id: string; recipe: Recipe; at: string }
  /** Save the draft (or `recipe`, for a lesson) as the next version and make it current. */
  | { type: "customPlay.commit"; id: string; at: string; note?: string; source: RecipeVersion["source"]; recipe?: Recipe }
  | { type: "customPlay.rollback"; id: string; version: number; at: string }
  | { type: "customPlay.discardDraft"; id: string }
  | { type: "customPlay.dismissLesson"; id: string; key: string; skips: number; at: string }
  /** Archived plays stop running and leave the list; their results are kept. */
  | { type: "customPlay.archive"; id: string; archived: boolean; at: string }
  /** Drafts that never ran. */
  | { type: "customPlay.remove"; id: string };
