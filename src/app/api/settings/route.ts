import path from "node:path";
import { connection } from "next/server";
import { z } from "zod";
import type { SettingsStatus } from "@/components/settings/types";
import { activeProvider } from "@/lib/ai/client";
import { PROVIDERS, type ProviderId } from "@/lib/ai/providers";
import { aiStatus, removeAiKey, saveAiSetup } from "@/lib/ai/setup";
import { checkGithubToken } from "@/lib/signals/github";
import { errorResponse, readJSON } from "@/lib/server/http";
import { DATA_DIR, dataDirInsideApp, readSettings, writeSettings } from "@/lib/store/settings";

function status(): SettingsStatus {
  const settings = readSettings();
  const active = activeProvider();
  const ai = aiStatus();
  return {
    hasKey: active !== null,
    keySource: !active ? null : active.keySource === "saved" ? "settings" : "env",
    keyHint: active ? (ai.saved[active.id]?.hint ?? null) : null,
    ai,
    newsSource: settings.newsSource ?? "gdelt",
    geocoder: settings.geocoder ?? "osm",
    companyIcons: settings.companyIcons ?? "letters",
    githubTokenHint: settings.githubToken ? `…${settings.githubToken.slice(-4)}` : null,
    secContact: settings.secContact ?? null,
    dataDir: path.resolve(DATA_DIR),
    dataDirInApp: dataDirInsideApp(),
  };
}

export async function GET() {
  await connection();
  return Response.json(status(), { headers: { "Cache-Control": "no-store" } });
}

const PROVIDER_IDS = PROVIDERS.map((p) => p.id) as [ProviderId, ...ProviderId[]];
const Price = z.object({ input: z.number().min(0).max(10_000), output: z.number().min(0).max(10_000), cacheRead: z.number().min(0).max(10_000).optional() });
const Model = z.string().trim().min(1).max(200);

const Body = z.object({
  /** Earlier clients: an Anthropic key to validate and save; null or "" removes it (an env key still applies). */
  anthropicApiKey: z.string().max(400).nullable().optional(),
  /** Pick a provider, and with it a key to check and save, its address (custom, Ollama), models and prices. */
  ai: z
    .object({
      provider: z.enum(PROVIDER_IDS),
      key: z.string().max(500).optional(),
      baseUrl: z.string().max(300).optional(),
      model: Model.optional(),
      models: z.object({ strategist: Model.nullable(), operator: Model.nullable(), fast: Model.nullable() }).partial().optional(),
      prices: z.record(Model, Price.nullable()).optional(),
      refresh: z.boolean().optional(),
    })
    .optional(),
  /** Forget a provider's saved key. */
  removeKey: z.enum(PROVIDER_IDS).optional(),
  newsSource: z.enum(["gdelt", "google_news", "off"]).optional(),
  geocoder: z.enum(["osm", "off"]).optional(),
  companyIcons: z.enum(["letters", "site"]).optional(),
  /** A GitHub token to check and save; null or "" removes it. */
  githubToken: z.string().max(400).nullable().optional(),
  /** An email for SEC EDGAR's User-Agent; null or "" removes it. */
  secContact: z.string().max(254).nullable().optional(),
});

/** Saves local-only settings. A provider key is checked with the provider (it lists the models it can use) before it's kept. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));

    if (body.newsSource) writeSettings({ newsSource: body.newsSource });
    if (body.geocoder) writeSettings({ geocoder: body.geocoder });
    if (body.companyIcons) writeSettings({ companyIcons: body.companyIcons });

    if (body.githubToken === null || body.githubToken === "") writeSettings({ githubToken: undefined });
    else if (body.githubToken !== undefined) {
      const token = body.githubToken.trim();
      if (!/^(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token)) {
        return Response.json({ error: "That doesn't look like a GitHub token. It starts with github_pat_ or ghp_." }, { status: 400 });
      }
      // A network hiccup shouldn't block saving a plausible token; a rejected one never saves.
      if ((await checkGithubToken(token)) === "bad") return Response.json({ error: "GitHub rejected that token. Check it and try again." }, { status: 400 });
      writeSettings({ githubToken: token });
    }

    if (body.secContact === null || body.secContact === "") writeSettings({ secContact: undefined });
    else if (body.secContact !== undefined) {
      const contact = body.secContact.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return Response.json({ error: "Use an email address, like you@yourcompany.com." }, { status: 400 });
      writeSettings({ secContact: contact });
    }

    if (body.removeKey) removeAiKey(body.removeKey);
    if (body.anthropicApiKey === null || body.anthropicApiKey === "") removeAiKey("anthropic");
    else if (body.anthropicApiKey !== undefined) {
      const r = await saveAiSetup({ provider: "anthropic", key: body.anthropicApiKey });
      if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    }
    if (body.ai) {
      const r = await saveAiSetup(body.ai);
      if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    }

    return Response.json(status());
  } catch (err) {
    return errorResponse(err);
  }
}
