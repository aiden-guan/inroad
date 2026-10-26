/**
 * Reading what Inroad's prompts contain: tagged blocks, the site and signal digests, evidence lists,
 * candidate cards. Playbooks build their tool input from these, so a quote they cite is really on the
 * page they cite and an id they use is one the request listed.
 */

export function between(text, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>\\n?([\\s\\S]*?)\\n?</${tag}>`).exec(text ?? "");
  return m ? m[1] : null;
}

export function attr(text, tag, name) {
  return new RegExp(`<${tag}\\s[^>]*${name}="([^"]*)"`).exec(text ?? "")?.[1] ?? null;
}

/** "Today is Tuesday, October 20, 2026 (2026-10-20)." → "2026-10-20" */
export function todayOf(text) {
  return /\((\d{4}-\d{2}-\d{2})\)/.exec(text ?? "")?.[1] ?? new Date().toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

export function clip(s, maxWords, maxChars = Infinity) {
  let out = String(s).replace(/\s+/g, " ").trim().split(" ").slice(0, maxWords).join(" ");
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, "");
  return out.replace(/[,;:\s]+$/, "");
}

export const sentenceCase = (s) => String(s).replace(/^\s*\w/, (c) => c.toUpperCase());

/** Words Inroad's lint and messaging rules ban; generated lines must not use them. */
const BANNED = /\b(ai-powered|leverage[sd]?|seamless(ly)?|unlock(s|ed)?|solutions?|revolutioni[sz]e|cutting-edge|empower(s|ed)?|streamline[sd]?|robust|next-generation|game-changer|best-in-class|world-class|supercharge[sd]?|synergy|platform)\b/gi;
export const plain = (s) => String(s).replace(BANNED, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();

/**
 * A run of whole words copied exactly from `text`, from its first sentence long enough to quote.
 * Exact copies always pass the app's verbatim checks.
 */
export function quoteFrom(text, { min = 4, max = 12, skip = 0 } = {}) {
  const sentences = String(text ?? "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => wordCount(s) >= min && !/^(Title|Description|Headings):/.test(s) && !/https?:\/\//.test(s));
  const s = sentences[skip] ?? sentences[0];
  if (!s) return null;
  const words = s.split(/\s+/).slice(0, max);
  return words.join(" ").replace(/[,;:.!?]+$/, "");
}

/** The pages inside <site> (siteDigestToText): url, title, description, headings and body text. */
export function sitePages(block) {
  if (!block) return [];
  const pages = [];
  let cur = null;
  for (const line of block.split("\n")) {
    const head = /^## (https?:\/\/\S+)\s*$/.exec(line);
    if (head) {
      cur = { url: head[1], title: "", description: "", headings: "", body: [] };
      pages.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^## /.test(line)) {
      cur = null;
      continue;
    }
    if (line.startsWith("Title: ")) cur.title = line.slice(7);
    else if (line.startsWith("Description: ")) cur.description = line.slice(13);
    else if (line.startsWith("Headings: ")) cur.headings = line.slice(10);
    else if (line.trim()) cur.body.push(line);
  }
  return pages.map((p) => ({ ...p, body: p.body.join("\n") }));
}

/** Dated bullet lines in a digest: "- 2026-10-01 · Head of Finance (Finance) · https://…". */
export function datedLines(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = /^-?\s*(\d{4}-\d{2}-\d{2}|undated) · (.+?) · (https?:\/\/\S+)\s*$/.exec(line.trim());
    if (!m) continue;
    const parts = m[2].split(" · ");
    out.push({ date: m[1] === "undated" ? null : m[1], title: parts[0].replace(/\s*\([^)]*\)\s*$/, ""), kind: parts.length > 1 ? "news" : "line", rest: parts.slice(1).join(" · "), url: m[3] });
  }
  return out;
}

/** Evidence the prompt lists: "[ev_x] claim — "quote" (url)" (foundation) or fmtEvidence blocks (compose). */
export function evidenceList(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/\[(ev_[a-z0-9_]+)\] ([^\n]*?) — "([^"]*)" \((https?:\/\/[^)]+)\)/gi)) out.push({ id: m[1], claim: m[2], quote: m[3], url: m[4] });
  for (const m of String(text ?? "").matchAll(/\[(ev_[a-z0-9_]+)\] ([a-z_]+) · ([^ ]+) · ([^ ]+) · (\w+)\n\s+claim: ([^\n]*)\n\s+quote: "([^\n]*)"/gi)) {
    out.push({ id: m[1], sourceType: m[2], host: m[3], date: m[4] === "undated" ? null : m[4], confidence: m[5], claim: m[6], quote: m[7] });
  }
  return out;
}

/** "Name: Acme (acme.com)" style lines inside a block. */
export function field(block, label) {
  return new RegExp(`^${label}:\\s*(.+)$`, "m").exec(block ?? "")?.[1]?.trim() ?? null;
}

/** A stable small number from a string, for deterministic variety. */
export function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function slugOf(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function titleCase(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}
