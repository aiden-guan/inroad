import type { RelationshipTag } from "@/lib/domain/types";

/**
 * Relationship tags (SPEC W2 approval point): the founder says who knows them, one click per person.
 * Someone who used the product, was a design partner, signed up or worked with the founder "knows the
 * product": when they change jobs to an ICP company, that's a champion_job_change, the strongest signal.
 * Shared by the server and the browser.
 */

export const KNOWS_PRODUCT_TAGS: readonly RelationshipTag[] = ["design_partner", "past_user", "customer", "ex_colleague", "signup"];

/** The tags a founder picks by hand, in menu order. customer and signup come from imports and Customers. */
export const PICKABLE_TAGS: readonly RelationshipTag[] = ["design_partner", "past_user", "ex_colleague", "investor", "connector"];

export const TAG_LABEL: Record<RelationshipTag, string> = {
  design_partner: "Design partner",
  past_user: "Past user",
  ex_colleague: "Ex-colleague",
  customer: "Customer",
  investor: "Investor",
  connector: "Connector",
  signup: "Signed up",
};

export const knowsByTag = (tags: readonly RelationshipTag[] | undefined): boolean => !!tags?.some((t) => KNOWS_PRODUCT_TAGS.includes(t));

/** "was a design partner", "used your product": the clause a ways-in line or a signal headline uses. */
export function tagPhrase(tags: readonly RelationshipTag[] | undefined): string | null {
  const t = tags ?? [];
  if (t.includes("design_partner")) return "was a design partner";
  if (t.includes("customer")) return "is at a customer of yours";
  if (t.includes("past_user")) return "used your product";
  if (t.includes("signup")) return "signed up for your product";
  if (t.includes("ex_colleague")) return "worked with you";
  if (t.includes("investor")) return "is your investor";
  if (t.includes("connector")) return "introduces people for you";
  return null;
}

export function isRelationshipTag(v: unknown): v is RelationshipTag {
  return typeof v === "string" && v in TAG_LABEL;
}
