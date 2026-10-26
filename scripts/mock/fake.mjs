/**
 * Schema-driven tool input for tools without a playbook. It keeps to the schema's caps, including the ones
 * a strict tool carries in its description ("(maxLength 200, minimum 0)", "≤12 words"), so the result
 * passes the app's zod check the way a real model's would.
 */

const WORDS = {
  reason: "Clear owner for the problem and a dated reason to talk",
  note: "Their own site names the job this replaces",
  headline: "Hiring a first finance lead this quarter",
  summary: "They want to see it on their own data first",
  title: "A dated reason to talk this month",
  text: "Their team is hiring for the role this replaces",
  question: "Who owns this today, and what does it cost them?",
  why: "It decides the first three accounts",
  implication: "Likely means the manual process is about to break",
  name: "Northwind",
  label: "First touch",
  line: "Teams that just hired for the job this replaces",
  steps: "Send the first email Thursday morning",
  step: "Send the first email Thursday morning",
};

function humanize(key) {
  return String(key)
    .replace(/[0-9]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .trim();
}

/** Caps from JSON-schema keywords and from the notes strict tools carry in their descriptions. */
export function caps(schema) {
  const out = { ...schema };
  const desc = String(schema.description ?? "");
  const note = /\(([^()]*)\)\s*$/.exec(desc);
  if (note) {
    for (const part of note[1].split(/,\s*/)) {
      const m = /^([a-zA-Z]+)\s+(.+)$/.exec(part.trim());
      if (!m || out[m[1]] !== undefined) continue;
      try {
        out[m[1]] = JSON.parse(m[2]);
      } catch {
        // not a cap note
      }
    }
  }
  const words = /≤\s*(\d+)\s*words?/i.exec(desc) ?? /at most (\d+) words/i.exec(desc);
  if (words) out.maxWords = Number(words[1]);
  const chars = /≤\s*(\d+)\s*char/i.exec(desc);
  if (chars) out.maxLength = Math.min(out.maxLength ?? Infinity, Number(chars[1]));
  const items = /up to (\d+)/i.exec(desc);
  if (items && out.maxItems === undefined && (schema.type === "array" || schema.items)) out.maxItems = Number(items[1]);
  return out;
}

/** Trims a sentence to the caps: words first, then characters on a word boundary. */
export function fit(text, c = {}) {
  let s = String(text);
  if (c.maxWords) s = s.split(/\s+/).slice(0, c.maxWords).join(" ");
  if (c.maxLength !== undefined && s.length > c.maxLength) {
    s = s.slice(0, c.maxLength);
    const cut = s.lastIndexOf(" ");
    if (cut > c.maxLength * 0.5) s = s.slice(0, cut);
  }
  const base = s.trim() || "n/a";
  s = base;
  while (c.minLength && s.length < c.minLength) s = `${s} ${base}`;
  if (c.maxLength !== undefined && s.length > c.maxLength) s = s.slice(0, c.maxLength).trimEnd();
  return s;
}

function nonNull(schema) {
  if (schema.anyOf) return schema.anyOf.find((s) => s.type !== "null") ?? schema.anyOf[0];
  return schema;
}

export function fake(schema, key = "value", depth = 0) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.anyOf) return fake({ ...nonNull(schema), description: schema.description ?? nonNull(schema).description }, key, depth);
  const c = caps(schema);
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "object": {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = fake(v, k, depth + 1);
      return out;
    }
    case "array": {
      const want = depth > 2 ? 1 : 2;
      const n = Math.max(c.minItems ?? 0, Math.min(c.maxItems ?? want, want));
      return Array.from({ length: n }, (_, i) => fake(schema.items, `${key}${i + 1}`, depth + 1));
    }
    case "number":
    case "integer": {
      let n = /score|confidence|fit/i.test(key) ? 78 : /strength/i.test(key) ? 2 : /^i$|index|persona|theme/i.test(key) ? 1 : 3;
      if (c.minimum !== undefined) n = Math.max(n, c.minimum);
      if (c.maximum !== undefined) n = Math.min(n, c.maximum);
      return type === "integer" ? Math.round(n) : n;
    }
    case "boolean":
      return /^(is|has)?(needs|must|requires)/i.test(key) ? false : true;
    case "string": {
      if (schema.format === "date" || /(^|_)(date|on)$|Date$|At$|On$/.test(key)) return "2026-11-04";
      if (schema.format === "uri" || /url|website|link/i.test(key)) return "https://example.com";
      if (/email/i.test(key)) return "founder@example.com";
      if (/domain/i.test(key)) return "example.com";
      if (/(^|_)id$|Id$/.test(key)) return "";
      const base = WORDS[humanize(key).split(" ").pop()] ?? `The ${humanize(key) || "answer"} in one plain line`;
      return fit(base, c);
    }
    default:
      return null;
  }
}

/** The first size cap in a schema, broken on purpose (for the invalid_submit fault). */
export function breakCaps(schema, value) {
  if (!schema || typeof schema !== "object" || !value || typeof value !== "object") return false;
  for (const [k, sub] of Object.entries(schema.properties ?? {})) {
    const s = nonNull(sub);
    const c = caps(s);
    const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
    if (type === "string" && c.maxLength !== undefined) {
      value[k] = "x".repeat(c.maxLength + 40);
      return true;
    }
    if ((type === "number" || type === "integer") && c.maximum !== undefined) {
      value[k] = c.maximum + 10;
      return true;
    }
    if (type === "array" && c.maxItems !== undefined) {
      value[k] = Array.from({ length: c.maxItems + 1 }, () => (Array.isArray(value[k]) && value[k][0] !== undefined ? value[k][0] : fake(s.items, k)));
      return true;
    }
    if (type === "object" && breakCaps(s, value[k])) return true;
    if (type === "array" && Array.isArray(value[k]) && value[k].length && breakCaps(nonNull(s.items), value[k][0])) return true;
  }
  return false;
}
