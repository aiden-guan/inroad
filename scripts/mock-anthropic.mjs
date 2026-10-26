#!/usr/bin/env node
/**
 * Dev-only mock of the Anthropic Messages API (streaming), for exercising the agent engine
 * and UI without spending tokens. It speaks the real SSE wire format:
 *   thinking → web_search (server tool + results) → web_fetch → app tool call → end.
 * Tool inputs are synthesized from each tool's JSON schema, so every workflow round-trips.
 * It also fakes the three Firecrawl Alexandria people capabilities Inroad uses (any fc-… key works;
 * fc-terms… simulates a provider whose data terms aren't accepted yet), and OpenAI's image endpoint
 * for Studio graphics (OPENAI_BASE_URL=http://localhost:4010/v1).
 *
 *   node scripts/mock-anthropic.mjs            # listens on :4010
 *   ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=mock FIRECRAWL_API_URL=http://localhost:4010 npm run dev
 */
import http from "node:http";
import { Resvg } from "@resvg/resvg-js";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const DELAY = Number(process.env.MOCK_DELAY ?? 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let counter = 0;
const id = (p) => `${p}_mock${(++counter).toString(36)}`;

function fake(schema, key = "value", depth = 0) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.anyOf) return fake(schema.anyOf.find((s) => s.type !== "null") ?? schema.anyOf[0], key, depth);
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "object": {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = fake(v, k, depth + 1);
      return out;
    }
    case "array":
      return Array.from({ length: depth > 2 ? 2 : 3 }, (_, i) => fake(schema.items, `${key}${i + 1}`, depth + 1));
    case "number":
    case "integer":
      return /score|confidence|fit/i.test(key) ? 78 : 3;
    case "boolean":
      return true;
    case "string":
      if (schema.format === "date" || /date/i.test(key)) return "2026-11-04";
      if (schema.format === "uri" || /url|website|link/i.test(key)) return "https://example.com";
      if (/email/i.test(key)) return "founder@example.com";
      return `Mock ${key.replace(/_/g, " ")}`;
    default:
      return null;
  }
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const t = m.content.find((b) => b.type === "text");
    if (t) return t.text;
    if (m.content.some((b) => b.type === "tool_result")) return null;
  }
  return "";
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[mock] request failed:", err?.message ?? err);
    if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: String(err?.message ?? err) } }));
  });
});

/* ───────────── Firecrawl Alexandria (people data) ───────────── */

const FIRST = ["Maya", "Daniel", "Priya", "Tom", "Sofia", "Kenji", "Amara", "Lucas", "Nora", "Ravi"];
const LAST = ["Okafor", "Lindqvist", "Raman", "Becker", "Alvarez", "Sato", "Mensah", "Moreau", "Fischer", "Iyer"];
const fcPeople = (domain, titles) =>
  FIRST.slice(0, 6).map((first, i) => ({
    id: `ap_${domain.replace(/\W/g, "")}_${i}`,
    first,
    last: LAST[i],
    title: titles[i % Math.max(1, titles.length)] ?? ["VP Engineering", "Head of Platform", "CTO", "Staff Engineer"][i % 4],
    hasEmail: i % 3 !== 2,
    domain,
  }));
const fcIndex = new Map();
let fcCredits = 4200;

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function firecrawl(req, res) {
  const key = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!key.startsWith("fc-")) return json(res, 401, { success: false, error: "Unauthorized: invalid token" });
  if (req.method === "GET" && req.url.startsWith("/v2/team/credit-usage")) {
    return json(res, 200, { success: true, data: { remainingCredits: fcCredits, planCredits: 5000, billingPeriodStart: null, billingPeriodEnd: null } });
  }
  if (req.method !== "POST" || !req.url.startsWith("/v2/scrape")) return json(res, 404, { success: false, error: "Not found" });
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const calls = JSON.parse(raw).alexandria ?? [];
  await sleep(DELAY * 4);
  const out = calls.map(({ provider, capability, options = {} }) => {
    if (key.startsWith("fc-terms") && provider !== "firecrawl") {
      return { provider, capability, error: { code: "THIRD_PARTY_DATA_TERMS_REQUIRED", message: "Accept the provider's data terms first.", status: 403 }, requiresAction: { type: "accept_terms", url: "https://www.firecrawl.dev/app/alexandria" } };
    }
    if (provider === "apollo" && capability === "people/search" && !options.q_organization_domains_list && options.person_locations?.length) {
      // Near a place: buyers at several companies in that city.
      const where = String(options.person_locations[0]);
      const city = where.split(",")[0].trim();
      const firms = ["Tallyrock", "Meterly", "Brightledger", "Quantaloop", "Northpeak", "Sablewire", "Coppergate"];
      const people = FIRST.slice(0, 7).map((first, i) => {
        const firm = firms[i];
        const p = { id: `ap_near_${city.toLowerCase().replace(/\W/g, "")}_${i}`, first, last: LAST[(i + 3) % LAST.length], title: (options.person_titles ?? [])[i % Math.max(1, (options.person_titles ?? []).length)] ?? "Controller", hasEmail: i % 3 !== 1, domain: `${firm.toLowerCase()}.example`, firm, where };
        fcIndex.set(p.id, p);
        return p;
      });
      return {
        provider, capability, creditsCost: 0, records: people.length,
        data: { people: people.map((p) => ({ id: p.id, first_name: p.first, last_name: `${p.last[0]}***`, title: p.title, organization: { name: p.firm, primary_domain: p.domain }, has_email: p.hasEmail })), total_entries: 140 },
      };
    }
    if (provider === "apollo" && capability === "people/search") {
      const domain = options.q_organization_domains_list?.[0] ?? "example.com";
      const people = fcPeople(domain, options.person_titles ?? []);
      people.forEach((p) => fcIndex.set(p.id, p));
      return {
        provider, capability, creditsCost: 0, records: people.length,
        data: { people: people.map((p) => ({ id: p.id, first_name: p.first, last_name: `${p.last[0]}***`, title: p.title, organization: { name: domain.split(".")[0] }, has_email: p.hasEmail })), total_entries: 23 },
      };
    }
    if (provider === "apollo" && capability === "people/match") {
      const p = fcIndex.get(options.id);
      if (!p) return { provider, capability, creditsCost: 0, data: { person: null } };
      return {
        provider, capability, creditsCost: 30, records: 1,
        data: {
          person: {
            id: p.id, name: `${p.first} ${p.last}`, first_name: p.first, last_name: p.last, title: p.title,
            linkedin_url: `https://www.linkedin.com/in/${p.first.toLowerCase()}-${p.last.toLowerCase()}`,
            email: p.hasEmail ? `${p.first.toLowerCase()}@${p.domain}` : "email_not_unlocked@domain.com",
            email_status: p.hasEmail ? "verified" : "unavailable",
            ...(p.where ? { city: p.where.split(",")[0].trim(), country: "United States" } : { city: "San Francisco", state: "California", country: "United States" }),
            organization: { name: p.firm ?? p.domain.split(".")[0], primary_domain: p.domain },
          },
        },
      };
    }
    if (provider === "fullenrich" && capability === "contacts/work-email") {
      const first = (options.first_name ?? options.linkedin_url?.match(/\/in\/([a-z]+)/)?.[1] ?? "").toLowerCase();
      const known = [...fcIndex.values()].find((p) => p.first.toLowerCase() === first);
      const domain = options.domain ?? known?.domain ?? "example.com";
      if (!first || first.startsWith("x")) return { provider, capability, creditsCost: 0, data: { results: [] } };
      return {
        provider, capability, creditsCost: 20, records: 1,
        data: { results: [{ input: options, contact_info: { most_probable_work_email: { email: `${first}@${domain}`, status: "DELIVERABLE" }, work_emails: [{ email: `${first}@${domain}`, status: "DELIVERABLE" }] }, profile: {} }] },
      };
    }
    return { provider, capability, error: { code: "UNKNOWN_CAPABILITY", message: `Unknown capability ${provider}/${capability}`, status: 400 } };
  });
  const spent = out.reduce((n, r) => n + (r.creditsCost ?? 0), 0);
  fcCredits -= spent;
  json(res, 200, { success: true, scrape_id: id("scrape"), data: { alexandria: out, creditsCost: spent } });
}

/* ───────────── OpenAI Images (Studio's picture layer) ───────────── */

async function openai(req, res) {
  if (req.method === "GET" && req.url.startsWith("/v1/models")) return json(res, 200, { object: "list", data: [{ id: "gpt-image-2.5-sunburst", object: "model" }] });
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  const [w, h] = String(body.size ?? "1024x1024").split("x").map(Number);
  await sleep(DELAY * 4);
  // A calm, wordless "photo": warm wall, a desk edge, a mug. Enough to see the slot and crop work.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D9CBB4"/><stop offset="1" stop-color="#B8A48A"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#wall)"/><rect y="${h * 0.68}" width="${w}" height="${h * 0.32}" fill="#5B4636"/>
    <rect x="${w * 0.58}" y="${h * 0.5}" width="${w * 0.1}" height="${h * 0.19}" rx="${w * 0.01}" fill="#F2EEE8"/><rect x="${w * 0.72}" y="${h * 0.6}" width="${w * 0.2}" height="${h * 0.09}" fill="#FAFAF7"/></svg>`;
  const png = new Resvg(svg).render().asPng();
  json(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: png.toString("base64") }], usage: { input_tokens: 80, output_tokens: 4160 } });
}

/* ───────────── Studio visuals: inputs shaped so the pipeline's checks pass ───────────── */

function wrap(text, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function designs(task) {
  const w = Number(task.match(/<canvas width="(\d+)"/)?.[1] ?? 1200);
  const h = Number(task.match(/<canvas width="\d+" height="(\d+)"/)?.[1] ?? 630);
  const approved = [...(task.match(/<approved_text>\n([\s\S]*?)\n<\/approved_text>/)?.[1] ?? "").matchAll(/^- ([^:]+): (.+)$/gm)].map((m) => ({ label: m[1], text: m[2] }));
  const headline = approved.find((a) => !/^(Proof|Source|Product name)/.test(a.label))?.text ?? "Mock headline";
  const source = approved.find((a) => a.label === "Source")?.text;
  const n = /Design one graphic/.test(task) ? 1 : Number(task.match(/Design (\d) graphics/)?.[1] ?? 2);
  const withImage = /<image width=/.test(task);
  const layout = /- screenshot:/.test(task) ? "screenshot" : /- photo:/.test(task) ? "photo" : "statement";
  const margin = Math.round(w * 0.08);
  const size = Math.round(w / (h > w ? 13 : 17));
  const top = h > w * 1.5 ? h * 0.2 : h * 0.22;
  const out = [];
  for (let i = 0; i < n; i++) {
    const dark = i % 2 === 1;
    const [bg, ink, accent] = dark ? ["#14120F", "#F4F1EA", "#7FA0FF"] : ["#F4F1EA", "#14120F", "#2F5BEA"];
    const textW = withImage ? w * 0.5 - margin : w - margin * 2;
    const lines = wrap(headline, Math.floor(textW / (size * 0.62)));
    const tspans = lines.map((l, j) => `<tspan x="${margin}" dy="${j ? "1.15em" : "0"}">${esc(l)}</tspan>`).join("");
    const slot = withImage ? `<rect data-slot="image" x="${Math.round(w * 0.55)}" y="0" width="${Math.round(w * 0.45)}" height="${h}" fill="#C9C3B8"/>` : "";
    const rule = `<rect x="${margin}" y="${Math.round(top - size * 1.4)}" width="${Math.round(w * 0.06)}" height="${Math.max(4, Math.round(h * 0.008))}" fill="${accent}"/>`;
    const foot = source ? `<text x="${margin}" y="${Math.round(h * (h > w * 1.5 ? 0.6 : 0.88))}" font-family="Georgia" font-size="${Math.ceil(w / 45)}" fill="${ink}">Source: ${esc(source)}</text>` : "";
    out.push({
      layout: withImage ? layout : i === 0 ? "statement" : "announcement",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${slot}${rule}<text x="${margin}" y="${Math.round(top)}" font-family="Inter" font-size="${size}" font-weight="700" fill="${ink}">${tspans}</text>${foot}</svg>`,
      why: dark ? "Dark ground makes the number the only bright thing in the feed." : "The headline alone, big, with nothing competing.",
    });
  }
  return { designs: out };
}

function shaped(tool, body) {
  const last = body.messages[body.messages.length - 1];
  const text = typeof last.content === "string" ? last.content : (last.content.find((b) => b.type === "text")?.text ?? "");
  if (tool.name === "submit_designs") return designs(text);
  if (tool.name === "submit_review") {
    const ns = Array.isArray(last.content) ? last.content.filter((b) => b.type === "text" && /^Image \d+:$/.test(b.text)).map((b) => Number(b.text.match(/\d+/)[0])) : [];
    return { reviews: ns.map((n) => ({ n, readable: true, broken: false, lowContrast: false, template: false, issues: [], fix: "", score: 8 })) };
  }
  if (tool.name === "submit_image_prompt") {
    return {
      prompt: "A controller's desk at 7am on the first of the month: a cold coffee in a white mug, a printed invoice run with pencil ticks, a laptop closed beside it. The left half is a plain warm wall, calm and empty. Overcast window light from the right, 35mm, shallow depth of field, muted warm palette. No text, letters, logos or interface anywhere.",
      alt: "A desk at month-end with a coffee and a printed invoice run",
    };
  }
  return null;
}

async function handle(req, res) {
  if (req.url.startsWith("/v2/")) return firecrawl(req, res);
  if (req.url.startsWith("/v1/images/") || req.url.startsWith("/v1/models")) return openai(req, res);
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  if (!Array.isArray(body.messages) || !body.messages.length) throw new Error("messages: field required");
  const tools = body.tools ?? [];
  const appTools = tools.filter((t) => !t.type || t.type === "custom");
  const hasSearch = tools.some((t) => t.name === "web_search");
  const hasFetch = tools.some((t) => t.name === "web_fetch");
  const lastMsg = body.messages[body.messages.length - 1];
  const afterToolResult = Array.isArray(lastMsg.content) && lastMsg.content.some((b) => b.type === "tool_result");
  const userText = lastUserText(body.messages) ?? "";
  console.log(`[mock] ${appTools.map((t) => t.name).join(",") || "no tools"} | after tool result: ${afterToolResult} | betas: ${req.headers["anthropic-beta"] ?? "-"}`);

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const send = async (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    await sleep(DELAY);
  };

  let index = 0;
  const content = [];
  await send({
    type: "message_start",
    message: { id: id("msg"), type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } },
  });

  // thinking (summarized)
  const thoughts = ["Reviewing what the founder asked for.", "Checking public sources before drafting.", "Making sure every claim has a source."];
  await send({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
  for (const t of thoughts) await send({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: t + " " } });
  await send({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: "mock-signature" } });
  await send({ type: "content_block_stop", index });
  index++;

  const terminal = appTools.find((t) => /^submit_|^save_|^finish_/.test(t.name));
  const firstPass = !afterToolResult;

  if (firstPass && hasSearch) {
    const sid = id("srvtoolu");
    const query = `${userText.slice(0, 40) || "startup"} funding news 2026`;
    await send({ type: "content_block_start", index, content_block: { type: "server_tool_use", id: sid, name: "web_search", input: {} } });
    await send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query }) } });
    await send({ type: "content_block_stop", index });
    index++;
    const results = [
      { type: "web_search_result", title: "Acme raises $12M Series A to automate procurement", url: "https://techcrunch.com/2026/09/12/acme-series-a", encrypted_content: "x", page_age: "1 month ago" },
      { type: "web_search_result", title: "Acme careers — Head of Finance Operations", url: "https://jobs.ashbyhq.com/acme/123", encrypted_content: "x", page_age: "2 weeks ago" },
      { type: "web_search_result", title: "Why procurement teams are buying AI in 2026", url: "https://www.forbes.com/sites/procurement-ai", encrypted_content: "x", page_age: "3 weeks ago" },
    ];
    await send({ type: "content_block_start", index, content_block: { type: "web_search_tool_result", tool_use_id: sid, content: results } });
    await send({ type: "content_block_stop", index });
    index++;
  }
  if (firstPass && hasFetch) {
    const fid = id("srvtoolu");
    await send({ type: "content_block_start", index, content_block: { type: "server_tool_use", id: fid, name: "web_fetch", input: {} } });
    await send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify({ url: "https://example.com" }) } });
    await send({ type: "content_block_stop", index });
    index++;
    await send({
      type: "content_block_start",
      index,
      content_block: { type: "web_fetch_tool_result", tool_use_id: fid, content: { type: "web_fetch_result", url: "https://example.com", retrieved_at: new Date().toISOString(), content: { type: "document", source: { type: "text", media_type: "text/plain", data: "Example Domain" }, title: "Example" } } },
    });
    await send({ type: "content_block_stop", index });
    index++;
  }

  let stop = "end_turn";
  const tool = firstPass ? terminal ?? (appTools.length && /add|create|log|save/i.test(userText) ? appTools[0] : null) : null;
  if (tool) {
    // Real models often narrate before a lookup; Ask treats that text as working notes, not the answer.
    if (tool !== terminal) {
      await send({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
      for (const word of "Let me check your workspace first. ".split(/(?<= )/)) await send({ type: "content_block_delta", index, delta: { type: "text_delta", text: word } });
      await send({ type: "content_block_stop", index });
      index++;
    }
    const input = shaped(tool, body) ?? fake(tool.input_schema, tool.name);
    const json = JSON.stringify(input);
    const tid = id("toolu");
    await send({ type: "content_block_start", index, content_block: { type: "tool_use", id: tid, name: tool.name, input: {} } });
    for (let i = 0; i < json.length; i += 400) {
      await send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 400) } });
    }
    await send({ type: "content_block_stop", index });
    content.push({ type: "tool_use" });
    stop = "tool_use";
  } else {
    const reply = afterToolResult
      ? "Done — I've updated your workspace. Anything else you want me to take on?"
      : `Here's my take on “${userText.slice(0, 80)}”.\n\n**Lead with the pain, not the product.** Your best accounts are teams that just raised and are hiring for the role your product replaces.\n\n- Start with the three warmest accounts in your pipeline\n- Send the drafts I prepared this morning\n- Book follow-ups for Thursday`;
    await send({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
    for (const word of reply.split(/(?<= )/)) await send({ type: "content_block_delta", index, delta: { type: "text_delta", text: word } });
    await send({ type: "content_block_stop", index });
  }

  await send({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 420 } });
  await send({ type: "message_stop" });
  res.end();
}

process.on("uncaughtException", (err) => console.error("[mock] uncaught:", err));
process.on("unhandledRejection", (err) => console.error("[mock] unhandled:", err));

server.listen(PORT, () => console.log(`[mock] Anthropic mock listening on http://localhost:${PORT}`));
