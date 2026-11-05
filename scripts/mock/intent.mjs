/**
 * Research → Intent in mock mode: the public APIs the intent radar reads, answered from saved responses that were
 * captured from the real endpoints and anonymized (src/test/fixtures/signals/intent, built so every field the real
 * API returns is still there). The app routes to these only in mock mode (src/lib/intent/http.ts):
 *
 *   GET  /intent/hn/api/v1/search?query=…            Hacker News (Algolia) search
 *   GET  /intent/hn/api/v1/users/:name               Hacker News user (the "about" field)
 *   GET  /intent/se/2.3/search/advanced?site=…&q=…   Stack Exchange search
 *   GET  /intent/gh/search/issues?q=…                GitHub issue search
 *   GET  /intent/gh/search/repositories?q=…          GitHub repository search
 *   GET  /intent/gh/users/:login, /orgs/:org/…       GitHub profiles and org repos
 *   GET  /intent/gh/repos/:owner/:name[/forks|/issues|/issues/comments|/stargazers/history|/stargazers]
 *   POST /intent/gh/graphql                          GitHub discussions
 *
 * Dates are shifted so the newest fixture post is a few hours old whenever the mock answers. A search that matches
 * no saved post gets two plausible posts built from its own words, so a scan has something to judge for any
 * playbook. Also exports the playbook for the relevance tool (submit_intent), used by plan.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { call } from "./blocks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, "../../src/test/fixtures/signals/intent");
/** When the fixtures were captured. Every date in them is shifted by (now − this). */
const ANCHOR = Date.parse("2026-11-05T09:00:00Z");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();

function fixture(name) {
  if (!cache.has(name)) cache.set(name, JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")));
  return structuredClone(cache.get(name));
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const UNIX_KEYS = new Set(["created_at_i", "creation_date", "last_activity_date", "last_edit_date", "closed_date", "week"]);

/** Moves every timestamp forward so the fixture reads as recent. */
function shift(value, deltaMs) {
  if (Array.isArray(value)) return value.map((v) => shift(v, deltaMs));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && ISO.test(v)) out[k] = new Date(Date.parse(v) + deltaMs).toISOString().replace(/\.\d{3}Z$/, "Z");
    else if (typeof v === "number" && UNIX_KEYS.has(k)) out[k] = Math.round(v + deltaMs / 1000);
    else out[k] = shift(v, deltaMs);
  }
  return out;
}

/** Fills {{repo}}, {{owner}} and {{name}} with the repository that was asked for. */
function forRepo(value, owner, name) {
  return JSON.parse(JSON.stringify(value).replaceAll("{{repo}}", `${owner}/${name}`).replaceAll("{{owner}}", owner).replaceAll("{{name}}", name));
}

const delta = () => Date.now() - ANCHOR;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));
}

const GH_HEADERS = (bucket) => ({
  "x-ratelimit-limit": bucket === "search" ? "10" : "60",
  "x-ratelimit-remaining": bucket === "search" ? "9" : "57",
  "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
  "x-ratelimit-resource": bucket,
});

/** The words a query asks for: quotes and operators dropped, short words ignored. */
function wordsOf(q) {
  return String(q ?? "")
    .toLowerCase()
    .replace(/\b(in|is|created|repo|org|author|sort|order):\S+/g, " ")
    .replace(/["()]/g, " ")
    .split(/[^a-z0-9'-]+/)
    .filter((w) => w.length > 2 && !["and", "the", "for", "with"].includes(w));
}
const matches = (text, words) => words.length > 0 && words.every((w) => text.toLowerCase().includes(w.replace(/s$/, "")));

/** Two posts built from the query, for playbooks the saved fixtures don't cover. */
function madeUp(q, n = 2) {
  const phrase = String(q ?? "").replace(/["()]/g, "").replace(/\b\w+:\S+/g, "").trim() || "this";
  return [
    { title: `Ask HN: Is there a tool for ${phrase}?`, text: `We handle ${phrase} by hand every month and it takes most of a week. What do you use? Has anyone found something that works?` },
    { title: `How are teams handling ${phrase} in 2026?`, text: `Our team is struggling with ${phrase}. We tried spreadsheets and a script, and both break at month-end. Looking for recommendations.` },
  ].slice(0, n);
}

/* ───────────── Hacker News ───────────── */

function hn(url, res) {
  const p = url.pathname.replace(/^\/intent\/hn/, "");
  if (p.startsWith("/api/v1/users/")) {
    const name = decodeURIComponent(p.split("/").pop());
    const users = fixture("hn-users.json");
    return send(res, 200, users[name] ?? { about: "", karma: 1, username: name });
  }
  if (p !== "/api/v1/search" && p !== "/api/v1/search_by_date") return send(res, 404, { message: "Not found" });
  const data = shift(fixture("hn-search.json"), delta());
  const q = url.searchParams.get("query") ?? "";
  const words = wordsOf(q);
  let hits = data.hits.filter((h) => matches(`${h.title ?? ""} ${h.story_title ?? ""} ${h.story_text ?? ""} ${h.comment_text ?? ""}`, words));
  if (!hits.length) {
    const base = 99_100_000 + (Math.abs([...q].reduce((n, c) => (n * 31 + c.charCodeAt(0)) | 0, 7)) % 800_000);
    hits = madeUp(q).map((m, i) => {
      const at = Date.now() - (6 + i * 20) * 3_600_000;
      return { ...structuredClone(data.hits[0]), objectID: String(base + i), title: m.title, story_text: m.text, author: `fixture_user${i + 1}`, created_at: new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z"), created_at_i: Math.floor(at / 1000), _tags: ["story", `author_fixture_user${i + 1}`, `story_${base + i}`, "ask_hn"] };
    });
  }
  return send(res, 200, { ...data, hits, nbHits: hits.length, query: q });
}

/* ───────────── Stack Exchange ───────────── */

function se(url, res) {
  if (!url.pathname.endsWith("/search/advanced")) return send(res, 400, { error_id: 400, error_message: "No method found with this name", error_name: "no_method" });
  const site = url.searchParams.get("site") ?? "stackoverflow";
  const all = shift(fixture("se-search.json"), delta());
  const data = all[site] ?? { items: [], has_more: false, quota_max: 300, quota_remaining: 280 };
  // Lenient on purpose: any of the query's words, so a mock scan has a question or two to judge.
  const words = wordsOf(url.searchParams.get("q"));
  const items = data.items.filter((i) => words.some((w) => `${i.title} ${i.body}`.toLowerCase().includes(w.replace(/s$/, ""))));
  return send(res, 200, { ...data, items });
}

/* ───────────── GitHub ───────────── */

async function gh(req, url, res) {
  const p = url.pathname.replace(/^\/intent\/gh/, "");
  const users = fixture("gh-users.json");
  if (req.method === "POST" && p === "/graphql") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { variables = {} } = JSON.parse(raw || "{}");
    return send(res, 200, forRepo(shift(fixture("gh-discussions.json"), delta()), variables.owner ?? "owner", variables.name ?? "repo"), GH_HEADERS("graphql"));
  }
  if (p === "/search/issues") {
    const data = shift(fixture("gh-search-issues.json"), delta());
    const words = wordsOf(url.searchParams.get("q"));
    let items = data.items.filter((i) => matches(`${i.title} ${i.body}`, words));
    if (!items.length) {
      items = madeUp(url.searchParams.get("q"), 1).map((m, n) => ({ ...structuredClone(data.items[0]), number: 900 + n, id: 4_200_000_000 + n, title: m.title.replace(/^Ask HN: /, ""), body: m.text, html_url: `https://github.com/fixture-org/fixture-repo/issues/${900 + n}`, created_at: new Date(Date.now() - 30 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z") }));
    }
    return send(res, 200, { ...data, total_count: items.length, items }, GH_HEADERS("search"));
  }
  if (p === "/search/repositories") {
    const q = wordsOf(url.searchParams.get("q"))[0] ?? "repo";
    const items = fixture("gh-org-repos.json").map((r) => ({ ...r, full_name: r.full_name.replace("fixture-meterbook", `fixture-${q}`), html_url: r.html_url.replace("fixture-meterbook", `fixture-${q}`), owner: { login: `fixture-${q}` } }));
    return send(res, 200, { total_count: items.length, incomplete_results: false, items: items.slice(0, Number(url.searchParams.get("per_page") ?? 3)) }, GH_HEADERS("search"));
  }
  let m = p.match(/^\/users\/([^/]+)$/);
  if (m) {
    const login = decodeURIComponent(m[1]);
    const known = users[login] ?? Object.values(users).find((u) => u.login.toLowerCase() === login.toLowerCase());
    // A competitor's name as an org, so repository suggestions have something to verify.
    const org = !known && /^[a-z0-9-]+$/i.test(login) ? { ...structuredClone(users["fixture-meterbook"]), login, name: login, blog: `https://${login}.example` } : null;
    return known || org ? send(res, 200, known ?? org, GH_HEADERS("core")) : send(res, 404, { message: "Not Found" }, GH_HEADERS("core"));
  }
  m = p.match(/^\/(?:orgs|users)\/([^/]+)\/repos$/);
  if (m) {
    const owner = decodeURIComponent(m[1]);
    return send(res, 200, fixture("gh-org-repos.json").map((r) => ({ ...r, full_name: r.full_name.replace("fixture-meterbook", owner), html_url: r.html_url.replace("fixture-meterbook", owner) })), GH_HEADERS("core"));
  }
  if (/^\/orgs\/[^/]+\/public_members$/.test(p)) return send(res, 200, [], GH_HEADERS("core"));
  m = p.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
  if (m) {
    const [, owner, name, rest = ""] = m;
    const d = delta();
    const pick = {
      "": "gh-repo.json",
      "/forks": "gh-forks.json",
      "/issues": "gh-issues.json",
      "/issues/comments": "gh-comments.json",
      "/stargazers/history": "gh-stars-history.json",
    }[rest];
    // Since July 2026 GitHub lists stargazers only to a repository's admins and collaborators.
    if (rest === "/stargazers") return send(res, 401, { message: "Requires authentication", documentation_url: "https://docs.github.com/rest/activity/starring#list-stargazers", status: "401" }, GH_HEADERS("core"));
    if (!pick) return send(res, 404, { message: "Not Found" }, GH_HEADERS("core"));
    return send(res, 200, forRepo(shift(fixture(pick), d), owner, name), GH_HEADERS("core"));
  }
  return send(res, 404, { message: "Not Found" }, GH_HEADERS("core"));
}

export async function intent(req, res, DELAY = 120) {
  const url = new URL(req.url, "http://localhost");
  await sleep(Math.min(DELAY, 200));
  if (url.pathname.startsWith("/intent/hn/")) return hn(url, res);
  if (url.pathname.startsWith("/intent/se/")) return se(url, res);
  if (url.pathname.startsWith("/intent/gh/")) return gh(req, url, res);
  return send(res, 404, { error: "Unknown intent mock route" });
}

/* ───────────── The relevance tool (submit_intent) ───────────── */

const ASK = /\?|\b(anyone (here )?(use|used|tried)|recommend|what do (you|people) use|looking for|is there a tool|best way to)\b/i;
const COMPARE = /\b(vs\.?|versus|or [A-Z]\w+ for|compared?|alternatives?)\b/;
const NOISE = /\b(show hn|who is hiring|lease|real estate|syntax error|grant usage|exercise)\b/i;

/**
 * Judges each post the way a careful fast model would: noise and vendor posts out, questions as asks, competitor
 * comparisons as compare, first-person pain as problem. The quote is copied from the post, so the app's verbatim
 * check passes; the company is named only when the post says "At X we".
 */
export const intentPlaybook = {
  name: "intent",
  match: (ctx) => ctx.toolNames.includes("submit_intent"),
  thinking: () => ["Reading each post for who has the problem now.", "Vendors, job posts and other meanings of the words are noise.", "Quoting their own words."],
  act(ctx) {
    const terms = [...ctx.system.matchAll(/^([PCK]\d+) (pain|competitor|category): (.+)$/gm)].map((m) => ({ id: m[1], kind: m[2], label: m[3] }));
    const posts = ctx.firstText.split(/\n(?=\[\d+\] )/).flatMap((block) => {
      const m = block.match(/^\[(\d+)\] ([^\n]*)\n([\s\S]*)$/);
      return m ? [{ i: Number(m[1]), head: m[2], body: m[3].trim() }] : [];
    });
    const verdicts = posts.map((p) => {
      const title = p.head.split(" · ").slice(2).join(" · ");
      const text = `${title}\n${p.body}`;
      const lower = text.toLowerCase();
      const matched = terms
        .filter((t) => (t.kind === "competitor" ? lower.includes(t.label.toLowerCase()) : t.label.toLowerCase().split(/\W+/).filter((w) => w.length > 4).filter((w) => lower.includes(w)).length >= 2))
        .map((t) => t.id)
        .slice(0, 4);
      const noise = NOISE.test(text) || !matched.length;
      const label = noise ? "irrelevant" : matched.some((id) => id.startsWith("C")) && COMPARE.test(text) ? "compare" : ASK.test(text) ? "ask" : "problem";
      const sentence = (p.body.split(/(?<=[.!?])\s+/).find((s) => s.length > 30) ?? p.body).slice(0, 240);
      const company = p.body.match(/\bAt ([A-Z][A-Za-z0-9]+) we\b/)?.[1] ?? null;
      return {
        i: p.i,
        label,
        relevance: noise ? 0 : matched.length >= 2 ? 3 : 2,
        matched: noise ? [] : matched,
        quote: noise ? "" : sentence,
        why: noise ? "Not about this problem." : label === "compare" ? "Weighing the tools you compete with." : label === "ask" ? "Asking how others solve the problem you solve." : "Describes the problem as their own, right now.",
        company: noise ? null : company,
      };
    });
    return { blocks: [call("submit_intent", { posts: verdicts })] };
  },
};

export const INTENT_PLAYBOOKS = [intentPlaybook];
