import type { ID, PersonaRole, Workspace } from "@/lib/domain/types";

/**
 * Buyer-title matching in code (zero tokens): persona titles, their synonyms and seniority
 * variants. "VP Engineering" also matches "Head of Engineering" and "Director, Platform
 * Engineering", but not "Software Engineer". Shared by the network screen and the import preview.
 */

/** Roles that make someone worth a warm path: they buy, champion, or sign off. */
export const BUYER_ROLES: PersonaRole[] = ["economic_buyer", "champion", "technical_approver"];

const ABBREV: [RegExp, string][] = [
  [/\bv\.?p\.?\b/g, "vp"],
  [/\bvice[- ]president\b/g, "vp"],
  [/\bs\.?v\.?p\.?\b|\be\.?v\.?p\.?\b|\ba\.?v\.?p\.?\b/g, "vp"],
  [/\bsr\.?(?=\s|$)/g, "senior"],
  [/\bjr\.?(?=\s|$)/g, "junior"],
  [/\bdir\.?(?=\s|$)/g, "director"],
  [/\bmgr\.?(?=\s|$)/g, "manager"],
  [/\bmgmt\b/g, "management"],
  [/\beng\.?(?=\s|$)/g, "engineering"],
  [/\bops\b/g, "operations"],
  [/\bdev\b/g, "development"],
  [/\binfra\b/g, "infrastructure"],
  [/\bfp ?& ?a\b/g, "fpa"],
  [/\brev ?ops\b/g, "revenue operations"],
  [/\bsec ?ops\b/g, "security operations"],
  [/\bco-?founder\b/g, "founder"],
  [/&/g, " and "],
];

const C_LEVEL: Record<string, string> = {
  ceo: "executive",
  cto: "technology",
  cfo: "finance",
  coo: "operations",
  cro: "revenue",
  cmo: "marketing",
  cio: "information",
  ciso: "security",
  cpo: "product",
  cdo: "data",
  cso: "security",
};

export function normalizeTitle(raw: string): string {
  // Headlines carry the employer ("VP Eng at Acme | ex-Stripe"); keep the role only.
  let t = (raw.split(/\s(?:[aA][tT]|@)\s|\s[|·•]\s|\s[-–—]\s(?=[A-Z])/)[0] ?? raw).toLowerCase();
  for (const [re, rep] of ABBREV) t = t.replace(re, rep);
  t = t.replace(/\bchief (\w+) officer\b/g, (_, w: string) => Object.entries(C_LEVEL).find(([, v]) => v === w)?.[0] ?? `c${w[0]}o`);
  return t.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** 0 individual contributor · 1 senior · 2 manager/lead · 3 head/director · 4 VP · 5 C-level/founder. */
export function seniority(norm: string): number {
  if (/\b(founder|chief|president|partner|managing director|general manager)\b/.test(norm) || Object.keys(C_LEVEL).some((c) => new RegExp(`\\b${c}\\b`).test(norm))) return 5;
  if (/\bvp\b/.test(norm)) return 4;
  if (/\b(head|director)\b/.test(norm)) return 3;
  if (/\b(manager|lead|leader|supervisor|controller|owner)\b/.test(norm)) return 2;
  if (/\b(senior|staff|principal)\b/.test(norm)) return 1;
  return 0;
}

const NOISE = new Set(["of", "and", "the", "for", "a", "an", "in", "to", "global", "group", "team", "head", "director", "manager", "lead", "leader", "vp", "senior", "staff", "principal", "junior", "associate", "assistant", "interim", "acting", "deputy", "executive", "chief", "officer", "founding", "first", "supervisor", "us", "emea", "na", "apac"]);

const stem = (w: string) => w.replace(/ing$/, "").replace(/(ers|er|s)$/, "");

function coreWords(norm: string): string[] {
  return norm.split(" ").filter((w) => w.length > 1 && !NOISE.has(w) && !(w in C_LEVEL)).map(stem);
}

const FUNCTION_RE: [string, RegExp][] = [
  ["finance", /\b(financ\w*|accounting|accountant|controller|cfo|fpa|treasury|billing|payroll|revenue accounting)\b/],
  ["revops", /\b(revenue operations|sales operations|gtm operations|cro)\b/],
  ["security", /\b(security|ciso|cso|compliance|grc|privacy|trust)\b/],
  ["data", /\b(data|analytics|machine learning|ml|ai|cdo|bi)\b/],
  ["engineering", /\b(engineer\w*|developer|development|devops|sre|platform|infrastructure|software|cto|architect\w*|technology)\b/],
  ["product", /\b(product|cpo)\b/],
  ["sales", /\b(sales|account executive|business development|bdr|sdr)\b/],
  ["marketing", /\b(marketing|growth|demand|brand|content|cmo)\b/],
  ["people", /\b(people|hr|human resources|talent|recruit\w*)\b/],
  ["legal", /\b(legal|counsel|attorney)\b/],
  ["support", /\b(support|customer success|customer experience|cx)\b/],
  ["operations", /\b(operations|coo|supply chain|logistics)\b/],
  ["design", /\b(design\w*|ux)\b/],
];

function functionsOf(norm: string): string[] {
  return FUNCTION_RE.filter(([, re]) => re.test(norm)).map(([k]) => k);
}

interface TitleRule {
  personaId: ID;
  role: PersonaRole;
  phrase: string;
  core: string[];
  level: number;
  fns: string[];
  cLevel?: string;
}

export interface TitleMatch {
  personaId: ID;
  role: PersonaRole;
  /** "exact" phrase, "core" words at a similar level, or the same "function" at manager level or above. */
  how: "exact" | "core" | "function";
}

const ROLE_RANK: Record<PersonaRole, number> = { economic_buyer: 0, champion: 1, technical_approver: 2, user: 3, blocker: 4, early_adopter: 5, payer: 6, influencer: 7 };

/** Builds a matcher from the playbook's personas. Returns null for everyone when there are no personas yet. */
export function buyerTitleMatcher(ws: Pick<Workspace, "foundation">): (position: string) => TitleMatch | null {
  const rules: TitleRule[] = [];
  const personas = ws.foundation?.personas ?? [];
  for (const p of personas) {
    for (const raw of p.titles) {
      const phrase = normalizeTitle(raw);
      if (!phrase) continue;
      const cLevel = Object.keys(C_LEVEL).find((c) => new RegExp(`\\b${c}\\b`).test(phrase));
      rules.push({ personaId: p.id, role: p.role, phrase, core: coreWords(phrase), level: seniority(phrase), fns: functionsOf(phrase), cLevel });
    }
  }
  const hypothesisRole = ws.foundation?.icp.hypothesis.role;
  if (hypothesisRole && personas.length) {
    const champion = personas.find((p) => p.role === "champion") ?? personas[0];
    const phrase = normalizeTitle(hypothesisRole);
    if (phrase) rules.push({ personaId: champion.id, role: champion.role, phrase, core: coreWords(phrase), level: seniority(phrase), fns: functionsOf(phrase) });
  }
  rules.sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
  if (!rules.length) return () => null;

  return (position: string) => {
    const norm = normalizeTitle(position);
    if (!norm) return null;
    const words = new Set(norm.split(" ").map(stem));
    const level = seniority(norm);
    const fns = functionsOf(norm);
    let best: TitleMatch | null = null;
    const better = (m: TitleMatch) => !best || ROLE_RANK[m.role] < ROLE_RANK[best.role] || (ROLE_RANK[m.role] === ROLE_RANK[best.role] && m.how === "exact" && best.how !== "exact");
    for (const r of rules) {
      let how: TitleMatch["how"] | null = null;
      if (` ${norm} `.includes(` ${r.phrase} `)) how = "exact";
      else if (r.cLevel && new RegExp(`\\b${r.cLevel}\\b`).test(norm)) how = "exact";
      else if (r.core.length && r.core.every((w) => words.has(w)) && level >= Math.max(0, r.level - 1) && (r.level < 2 || level >= 2)) how = "core";
      else if (r.level >= 2 && level >= Math.max(2, r.level - 1) && r.fns.length && r.fns.some((f) => fns.includes(f))) how = "function";
      if (how) {
        const m = { personaId: r.personaId, role: r.role, how };
        if (better(m)) best = m;
      }
    }
    return best;
  };
}

export function isBuyerRole(role: PersonaRole | undefined): boolean {
  return !!role && BUYER_ROLES.includes(role);
}
