import fs from "node:fs";

/**
 * Saved responses for the free signal sources (src/test/fixtures/signals), shaped like what the real
 * endpoints return, served to `fetchText`/`fetchJSON` mocks by exact URL. Unrouted URLs answer null,
 * the way the real helpers report a failed fetch.
 */

export function fixture(name: string): string {
  return fs.readFileSync(new URL(`./fixtures/signals/${name}`, import.meta.url), "utf8");
}

/** A body, or a whole response: a redirect's final `url`, an error `status`, response `headers` (rate limits). */
type Routes = Record<string, string | { url?: string; body: string; status?: number; headers?: Record<string, string> }>;

export function routeFetches(routes: Routes) {
  const requested: string[] = [];
  // Like the real helper, an error status reads as a failed fetch unless the caller asked to see it.
  const fetchText = async (url: string, opts?: { allowErrors?: boolean }) => {
    requested.push(url);
    const hit = routes[url];
    if (hit === undefined) return null;
    const res = typeof hit === "string" ? { url, status: 200, body: hit } : { status: 200, ...hit, url: hit.url ?? url };
    return res.status >= 400 && !opts?.allowErrors ? null : res;
  };
  const fetchJSON = async (url: string) => {
    const res = await fetchText(url);
    return res ? JSON.parse(res.body) : null;
  };
  return { fetchText, fetchJSON, requested };
}
