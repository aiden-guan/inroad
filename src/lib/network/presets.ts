import { headerKey, isLinkedInHeader } from "./csv";

/**
 * Column mapping for list imports. Fixed alias rules first (zero tokens); each preset knows how one
 * tool names its columns and what the list means (prospects, paying customers, product signups).
 */

export type FieldKey = "domain" | "company" | "email" | "first" | "last" | "name" | "title" | "linkedin" | "location" | "description" | "notes";

export const FIELDS: { key: FieldKey; label: string; group: "company" | "person" }[] = [
  { key: "domain", label: "Website or domain", group: "company" },
  { key: "company", label: "Company name", group: "company" },
  { key: "description", label: "Company description", group: "company" },
  { key: "email", label: "Email", group: "person" },
  { key: "first", label: "First name", group: "person" },
  { key: "last", label: "Last name", group: "person" },
  { key: "name", label: "Full name", group: "person" },
  { key: "title", label: "Job title", group: "person" },
  { key: "linkedin", label: "LinkedIn URL", group: "person" },
  { key: "location", label: "Location", group: "person" },
  { key: "notes", label: "Notes", group: "person" },
];

/** Header index per field, or null when unmapped. */
export type Mapping = Record<FieldKey, number | null>;

const ALIASES: Record<FieldKey, string[]> = {
  domain: ["website", "domain", "companydomain", "companywebsite", "websiteurl", "companyurl", "companywebsiteurl", "organizationdomain", "primarydomain", "companydomainname", "webaddress", "site", "url"],
  company: ["company", "companyname", "organization", "organizationname", "account", "accountname", "employer", "associatedcompany", "companynameforemails", "currentcompany", "business", "businessname"],
  email: ["email", "workemail", "emailaddress", "businessemail", "leademail", "personemail", "contactemail", "primaryemail", "emailaddresses", "findworkemail"],
  first: ["firstname", "first", "givenname"],
  last: ["lastname", "last", "surname", "familyname"],
  name: ["fullname", "name", "personname", "contactname", "leadname", "contact", "customername", "person"],
  title: ["title", "jobtitle", "position", "role", "headline", "currenttitle", "currentposition"],
  linkedin: ["personlinkedinurl", "linkedinurl", "linkedin", "linkedinprofile", "linkedinprofileurl", "profileurl", "linkedinurlperson", "defaultprofileurl", "salesnavigatorurl", "leadurl", "linkedinprofilelink"],
  location: ["location", "city", "personcity", "companycity", "hqcity", "country", "region", "state"],
  description: ["description", "companydescription", "shortdescription", "about", "oneliner", "companyoneliner", "companyabout"],
  notes: ["notes", "note", "whynow", "reason", "personalization", "icebreaker", "comments", "why", "firstline"],
};

export type PresetId = "apollo" | "clay" | "sales_navigator" | "hubspot" | "instantly" | "smartlead" | "muse" | "stripe" | "signups" | "generic";

/** What the rows are. Customers are never prospected; signups are people who already know the product. */
export type ListKind = "prospects" | "customers" | "signups";

export interface Preset {
  id: PresetId;
  label: string;
  /** "Looks like an Apollo export" */
  detected: string;
  kind: ListKind;
  /** Tag added to every account from this list. */
  tag?: string;
  /** Header keys (see `headerKey`) that identify the tool; score = matches. */
  signature: string[];
  /** Tool-specific header names, checked before the generic aliases. */
  aliases?: Partial<Record<FieldKey, string[]>>;
}

export const PRESETS: Preset[] = [
  {
    id: "apollo",
    label: "Apollo export",
    detected: "Looks like an Apollo export",
    kind: "prospects",
    signature: ["personlinkedinurl", "companynameforemails", "emailstatus", "seniority", "departments", "apolloaccountid", "apollocontactid", "numberofretaillocations"],
    aliases: { company: ["companynameforemails", "company"], linkedin: ["personlinkedinurl"], location: ["city"] },
  },
  {
    id: "clay",
    label: "Clay table",
    detected: "Looks like a Clay table",
    kind: "prospects",
    signature: ["findworkemail", "enrichperson", "enrichcompany", "claycompanyid", "companydomain", "linkedinprofile", "findpeople"],
    aliases: { domain: ["companydomain", "domain"], email: ["workemail", "findworkemail"], linkedin: ["linkedinprofile", "linkedinurl"] },
  },
  {
    id: "sales_navigator",
    label: "Sales Navigator list",
    detected: "Looks like a Sales Navigator list",
    kind: "prospects",
    signature: ["salesnavigatorurl", "leadurl", "salesnavigatorprofileurl", "linkedinsalesnavigatorurl", "companylinkedinurl", "regularcompanyurl"],
    aliases: { linkedin: ["linkedinurl", "profileurl", "defaultprofileurl", "salesnavigatorurl", "leadurl"], domain: ["companywebsite", "website", "companydomain"] },
  },
  {
    id: "hubspot",
    label: "HubSpot export",
    detected: "Looks like a HubSpot export",
    kind: "prospects",
    signature: ["recordid", "lifecyclestage", "contactowner", "companyowner", "companydomainname", "associatedcompany", "createdate"],
    aliases: { domain: ["companydomainname", "website", "websiteurl"], company: ["companyname", "associatedcompany"] },
  },
  {
    id: "instantly",
    label: "Instantly leads",
    detected: "Looks like an Instantly lead export",
    kind: "prospects",
    signature: ["personalization", "leadstatus", "intereststatus", "campaign", "campaignname", "emailopened", "emailreplied", "esp"],
    aliases: { notes: ["personalization"] },
  },
  {
    id: "smartlead",
    label: "Smartlead leads",
    detected: "Looks like a Smartlead lead export",
    kind: "prospects",
    signature: ["linkedinprofile", "companyurl", "leadcategory", "category", "isunsubscribed", "customfields", "campaignleadmapid"],
    aliases: { domain: ["companyurl", "website"], linkedin: ["linkedinprofile"] },
  },
  {
    id: "muse",
    label: "Muse spreadsheet",
    detected: "Looks like a spreadsheet from Muse",
    kind: "prospects",
    signature: ["muse", "musenotes", "whynow", "reason", "contact", "contactname", "contacttitle", "contactemail", "contactlinkedin", "sourceurl"],
    aliases: { name: ["contactname", "contact"], title: ["contacttitle", "title"], email: ["contactemail", "email"], linkedin: ["contactlinkedin", "linkedin"], notes: ["whynow", "reason", "notes"] },
  },
  {
    id: "stripe",
    label: "Stripe customers",
    detected: "Looks like a Stripe customer export",
    kind: "customers",
    tag: "customer",
    signature: ["createdutc", "delinquent", "cardlast4", "cardbrand", "defaultsource", "businessvatid", "accountbalance", "totalspend"],
    aliases: { name: ["name", "description"] },
  },
  {
    id: "signups",
    label: "Signups or product users",
    detected: "Looks like a signup or user list",
    kind: "signups",
    tag: "signup",
    signature: ["signedup", "signedupat", "signupdate", "signupat", "lastseen", "lastactive", "lastloginat", "userid", "plan", "trialendsat"],
  },
  {
    id: "generic",
    label: "Spreadsheet",
    detected: "A spreadsheet",
    kind: "prospects",
    signature: [],
  },
];

export function presetById(id: string | undefined): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}

/** Best preset for these headers. Raw headers are checked too ("(Clay)" suffixes, "Muse" columns). */
export function detectPreset(headers: string[]): Preset {
  const keys = new Set(headers.map(headerKey));
  const raw = headers.join(" ").toLowerCase();
  let best = PRESETS[PRESETS.length - 1];
  let bestScore = 0;
  for (const p of PRESETS) {
    let score = p.signature.filter((s) => keys.has(s)).length;
    if (p.id === "clay" && /\bclay\b|^(find|enrich|lookup) /m.test(headers.map((h) => h.toLowerCase()).join("\n"))) score += 2;
    if (p.id === "muse" && /\bmuse\b/.test(raw)) score += 2;
    if (p.id === "sales_navigator" && /sales ?nav/.test(raw)) score += 2;
    // Generic words alone (campaign, category, plan) don't prove a tool.
    const needed = p.id === "muse" || p.id === "signups" || p.id === "smartlead" || p.id === "instantly" ? 2 : 1;
    if (score >= needed && score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export function looksLikeConnections(headers: string[]): boolean {
  return isLinkedInHeader(headers) && headers.map(headerKey).includes("connectedon");
}

const PERSON_FIELDS: FieldKey[] = ["email", "first", "last", "title", "linkedin"];

/** Picks a column for every field. Each column is used once; tool-specific names win over generic ones. */
export function autoMap(headers: string[], preset: Preset, sample: string[][] = []): Mapping {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const mapping = Object.fromEntries(FIELDS.map((f) => [f.key, null])) as Mapping;
  const order: FieldKey[] = ["email", "linkedin", "first", "last", "title", "domain", "company", "name", "location", "description", "notes"];
  for (const field of order) {
    const names = [...(preset.aliases?.[field] ?? []), ...ALIASES[field]];
    for (const name of names) {
      const i = keys.findIndex((k, idx) => k === name && !used.has(idx));
      if (i === -1) continue;
      // A bare "URL" column is a LinkedIn profile in some tools; only take it as the website when it isn't.
      if (field === "domain" && name === "url" && sample.some((r) => /linkedin\.com/i.test(r[i] ?? ""))) continue;
      if (field === "linkedin" && sample.length && !sample.some((r) => /linkedin\.com/i.test(r[i] ?? "")) && sample.some((r) => (r[i] ?? "").trim())) continue;
      mapping[field] = i;
      used.add(i);
      break;
    }
  }
  // A list of companies often calls the company column "Name".
  const personish = PERSON_FIELDS.some((f) => mapping[f] !== null);
  if (!personish && mapping.name !== null && mapping.company === null) {
    mapping.company = mapping.name;
    mapping.name = null;
  }
  return mapping;
}

export function emptyMapping(): Mapping {
  return Object.fromEntries(FIELDS.map((f) => [f.key, null])) as Mapping;
}
