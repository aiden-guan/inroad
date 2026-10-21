import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { connection } from "next/server";
import { z } from "zod";
import type { SettingsStatus } from "@/components/settings/types";
import { errorResponse, readJSON } from "@/lib/server/http";
import { DATA_DIR, readSettings, writeSettings } from "@/lib/store/settings";

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
    dataDir: path.resolve(DATA_DIR),
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
});

/** Saves local-only settings. The API key gets a cheap validity check with Anthropic first. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));

    if (body.newsSource) writeSettings({ newsSource: body.newsSource });
    if (body.geocoder) writeSettings({ geocoder: body.geocoder });

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
