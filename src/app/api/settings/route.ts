import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { connection } from "next/server";
import { z } from "zod";
import type { SettingsStatus } from "@/components/settings/types";
import { checkGithubToken } from "@/lib/signals/github";
import { errorResponse, readJSON } from "@/lib/server/http";
import { DATA_DIR, dataDirInsideApp, readSettings, writeSettings } from "@/lib/store/settings";

function status(): SettingsStatus {
  const settings = readSettings();
  const saved = settings.anthropicApiKey;
  const env = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE;
  return {
    hasKey: Boolean(saved || env),
    keySource: saved ? "settings" : env ? "env" : null,
    keyHint: saved ? `…${saved.slice(-4)}` : null,
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

const Body = z.object({
  /** A new key to validate and save; null or "" removes the saved key (an env key still applies). */
  anthropicApiKey: z.string().max(400).nullable().optional(),
  newsSource: z.enum(["gdelt", "google_news", "off"]).optional(),
  geocoder: z.enum(["osm", "off"]).optional(),
  companyIcons: z.enum(["letters", "site"]).optional(),
  /** A GitHub token to check and save; null or "" removes it. */
  githubToken: z.string().max(400).nullable().optional(),
  /** An email for SEC EDGAR's User-Agent; null or "" removes it. */
  secContact: z.string().max(254).nullable().optional(),
});

/** Saves local-only settings. The API key gets a cheap validity check with Anthropic first. */
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

    if (body.anthropicApiKey === null || body.anthropicApiKey === "") {
      writeSettings({ anthropicApiKey: undefined });
    } else if (body.anthropicApiKey !== undefined) {
      const key = body.anthropicApiKey.trim();
      if (!key.startsWith("sk-ant-")) {
        return Response.json({ error: "That doesn't look like an Anthropic API key. It starts with sk-ant-." }, { status: 400 });
      }
      try {
        await new Anthropic({ apiKey: key, maxRetries: 1, timeout: 10_000 }).models.list({ limit: 1 });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          return Response.json({ error: "Anthropic rejected that key. Check it and try again." }, { status: 400 });
        }
        // Network hiccups shouldn't block saving a plausible key.
      }
      writeSettings({ anthropicApiKey: key });
    }

    return Response.json(status());
  } catch (err) {
    return errorResponse(err);
  }
}
