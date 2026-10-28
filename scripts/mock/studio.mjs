/**
 * Studio graphics in the mock: OpenAI's Images endpoint for the painted layer (POST /v1/images/generations;
 * with OPENAI_BASE_URL pointing here, any key paints), and the visual workflow's tool inputs shaped so the
 * pipeline's checks pass: designs that use only the approved words, a passing review, a clean image prompt.
 */
import { Resvg } from "@resvg/resvg-js";
import { call } from "./blocks.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────── OpenAI Images (Studio's picture layer) ───────────── */

export async function images(req, res, delay) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}");
  const [w, h] = String(body.size ?? "1024x1024").split("x").map(Number);
  await sleep(delay * 4);
  // A calm, wordless "photo": warm wall, a desk edge, a mug. Enough to see the slot and crop work.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D9CBB4"/><stop offset="1" stop-color="#B8A48A"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#wall)"/><rect y="${h * 0.68}" width="${w}" height="${h * 0.32}" fill="#5B4636"/>
    <rect x="${w * 0.58}" y="${h * 0.5}" width="${w * 0.1}" height="${h * 0.19}" rx="${w * 0.01}" fill="#F2EEE8"/><rect x="${w * 0.72}" y="${h * 0.6}" width="${w * 0.2}" height="${h * 0.09}" fill="#FAFAF7"/></svg>`;
  const png = new Resvg(svg).render().asPng();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: png.toString("base64") }], usage: { input_tokens: 80, output_tokens: 4160 } }));
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
    return { reviews: ns.map((n) => ({ n, readable: true, broken: false, lowContrast: false, template: false, concept: 8, distinctiveness: 8, craft: 8, issues: [], fix: "", score: 8 })) };
  }
  if (tool.name === "submit_image_review") {
    // Scripted transport fixture, not evidence of actual image quality.
    return { score: 8, concept: 8, distinctiveness: 8, craft: 8, template: false, issues: [], fix: "" };
  }
  if (tool.name === "submit_image_prompt") {
    return {
      prompt: "Concept: complexity resolving into one precise form. Subject: many blank ivory paper strips converge into a single folded ribbon on the right side. Composition: a clear sculptural silhouette against a deep blue field, with the left third quiet and empty for type. Materials: visible paper fibers and crisp layered edges. Light: a coral sidelight reveals the paper's contours and casts one long shadow. No printed marks on any surface. No text, letters, logos or interface anywhere.",
      alt: "Blank paper strips resolving into a precise sculptural ribbon",
    };
  }
  return null;
}

const STUDIO_TOOLS = ["submit_designs", "submit_review", "submit_image_prompt", "submit_image_review"];

/** One playbook per Studio tool: the shaped input, called the way a model would. */
export const STUDIO_PLAYBOOKS = STUDIO_TOOLS.map((name) => ({
  name: `studio:${name}`,
  match: (ctx) => ctx.toolNames.includes(name),
  act: (ctx) => ({ blocks: [call(name, shaped(ctx.tool(name), ctx.body))] }),
}));
