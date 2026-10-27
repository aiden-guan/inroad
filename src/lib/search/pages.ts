import "server-only";
import { callCapability } from "@/lib/automation/connections";
import { reserveBrowserRequest } from "./budget";
import { automationTask } from "@/lib/automation/tasks";
import { chromium, type Browser } from "playwright-core";
import { fetchText, isPublicUrl } from "@/lib/signals/http";
import { digestPage } from "@/lib/signals/website";
import { getSecret } from "@/lib/store/workspace";
import { readSettings } from "@/lib/store/settings";
import { readAutomation, recordOperation } from "@/lib/automation/store";
import { canonicalUrl } from "./quality";

export interface PageEvidence {
  url: string;
  title: string;
  text: string;
  retrievedAt: string;
  method: "http" | "browser";
  provider: string;
  warnings: string[];
}
const live = globalThis as unknown as { __inroadBrowserReads?: number };
export const browserKey = () => getSecret("hub", "search_tinyfish") ?? process.env.TINYFISH_API_KEY;

async function renderPage(url: string, signal?: AbortSignal): Promise<PageEvidence> {
  if (readSettings().search?.browser !== "tinyfish") throw new Error("Enable optional TinyFish browser extraction under Web search in Settings first.");
  const key = browserKey();
  if (!key) throw new Error("Save a TinyFish key under Web search, or set TINYFISH_API_KEY, to render pages.");
  const release = reserveBrowserRequest();
  if (typeof release === "string") throw new Error(release);
  live.__inroadBrowserReads = (live.__inroadBrowserReads ?? 0) + 1;
  const started = Date.now();
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
  let sessionId: string | undefined, browser: Browser | undefined, error: string | undefined;
  const warnings: string[] = [];
  const stop = () => {
    void browser?.close().catch(() => undefined);
  };
  try {
    // Start blank so our request interception is installed before navigation.
    const response = await fetch("https://api.browser.tinyfish.ai", {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify({ timeout_seconds: 90 }),
      signal: combined,
    });
    if (!response.ok) throw new Error(`TinyFish could not create a browser (HTTP ${response.status}). Check access, limits and wallet balance.`);
    const session = await response.json();
    if (typeof session.session_id !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(session.session_id))
      throw new Error("TinyFish returned an invalid browser session.");
    sessionId = session.session_id;
    const cdp = new URL(session.cdp_url);
    if (cdp.protocol !== "wss:" || !/(^|\.)tinyfish\.(ai|io)$/.test(cdp.hostname)) throw new Error("TinyFish returned an unexpected browser address.");
    browser = await chromium.connectOverCDP(cdp.href, { timeout: 20_000 });
    combined.throwIfAborted();
    combined.addEventListener("abort", stop, { once: true });
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) || !(await isPublicUrl(request.url()))) return route.abort();
      return route.continue();
    });
    await context.routeWebSocket("**/*", (route) => route.close());
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("body").waitFor({ timeout: 10_000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    if (!(await isPublicUrl(page.url()))) throw new Error("The page redirected to an unavailable address.");
    const html = await page.content();
    const parsed = digestPage(page.url(), html.slice(0, 2_000_000), 16000);
    const text = [parsed.description, parsed.text].filter(Boolean).join("\n\n");
    if (text.length < 80) throw new Error("The rendered page did not contain enough readable text. It may require a login or block automated access.");
    return {
      url: page.url(),
      title: parsed.title || new URL(url).hostname,
      text,
      retrievedAt: new Date().toISOString(),
      method: "browser",
      provider: "TinyFish Browser",
      warnings,
    };
  } catch (cause) {
    error = combined.aborted
      ? "Browser extraction stopped or timed out."
      : cause instanceof Error && /^(TinyFish|The page|The rendered)/.test(cause.message)
        ? cause.message
        : "Browser extraction failed. Check TinyFish access and try the source in your browser.";
    throw new Error(error);
  } finally {
    combined.removeEventListener("abort", stop);
    await browser?.close().catch(() => undefined);
    if (sessionId) {
      try {
        const stopped = await fetch(`https://api.browser.tinyfish.ai/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
          redirect: "manual",
          headers: { "X-API-Key": key },
          signal: AbortSignal.timeout(10_000),
        });
        if (!stopped.ok) warnings.push("Browser cleanup was not confirmed; the session has a 90-second inactivity timeout.");
      } catch {
        warnings.push("Browser cleanup was not confirmed; the session has a 90-second inactivity timeout.");
      }
    }
    release();
    await recordOperation({
      kind: "fetch",
      provider: "TinyFish Browser",
      query: url,
      durationMs: Date.now() - started,
      cached: false,
      resultCount: error ? 0 : 1,
      costUsd: null,
      ...(error ? { error } : {}),
    });
    live.__inroadBrowserReads = Math.max(0, (live.__inroadBrowserReads ?? 1) - 1);
  }
}

async function runPageRead(raw: string, options: { mode?: "auto" | "http" | "browser"; signal?: AbortSignal } = {}): Promise<PageEvidence> {
  const url = canonicalUrl(raw);
  if (!url || !(await isPublicUrl(url))) throw new Error("Use a publicly accessible HTTP or HTTPS page.");
  options.signal?.throwIfAborted();
  if (options.mode === "browser") return renderPage(url, options.signal);
  const started = Date.now();
  const result = await fetchText(url, { timeoutMs: 15_000, maxBytes: 2_000_000, signal: options.signal });
  options.signal?.throwIfAborted();
  if (result && result.status < 400) {
    const html = /<html|<head|<body/i.test(result.body.slice(0, 2000));
    const page = html ? digestPage(result.url, result.body, 16000) : null;
    const text = page ? [page.description, page.text].filter(Boolean).join("\n\n") : result.body.slice(0, 16000);
    if (text.length >= 160) {
      await recordOperation({
        kind: "fetch",
        provider: "Direct HTTP",
        query: url,
        durationMs: Date.now() - started,
        cached: false,
        resultCount: 1,
        costUsd: 0,
      });
      return {
        url: result.url,
        title: page?.title || new URL(url).hostname,
        text,
        retrievedAt: new Date().toISOString(),
        method: "http",
        provider: "Direct HTTP",
        warnings: [],
      };
    }
  }
  const connectionId = readSettings().search?.pageConnectionId;
  if (options.mode !== "http" && connectionId) {
    const connection = readAutomation().connections.find((c) => c.id === connectionId && c.enabled);
    const rows = await callCapability(connectionId, "fetch", url, 1, options.signal);
    const row = rows[0];
    if (!row || typeof row.text !== "string" || row.text.trim().length < 80)
      throw new Error("The connected page reader returned too little text. Check its fetch mapping.");
    const finalUrl = canonicalUrl(typeof row.url === "string" ? row.url : url);
    if (!finalUrl || !(await isPublicUrl(finalUrl))) throw new Error("The connected page reader returned an unavailable source URL.");
    await recordOperation({
      kind: "fetch",
      provider: connection?.name ?? "Connected page reader",
      query: url,
      durationMs: Date.now() - started,
      cached: false,
      resultCount: 1,
      costUsd: null,
    });
    return {
      url: finalUrl,
      title: typeof row.title === "string" ? row.title.slice(0, 500) : new URL(url).hostname,
      text: row.text.slice(0, 16000),
      retrievedAt: new Date().toISOString(),
      method: "http",
      provider: connection?.name ?? "Connected page reader",
      warnings: [],
    };
  }
  if (options.mode !== "http" && readSettings().search?.browser === "tinyfish") return renderPage(url, options.signal);
  throw new Error("This page returned too little readable content. Open the source or enable optional browser extraction in Settings.");
}

export const readResearchPage = (raw: string, options: { mode?: "auto" | "http" | "browser"; signal?: AbortSignal } = {}) =>
  automationTask(options.signal, (signal) => runPageRead(raw, { ...options, signal }));
