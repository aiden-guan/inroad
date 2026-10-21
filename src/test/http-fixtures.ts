import fs from "node:fs";

/**
 * Saved responses for the free signal sources (src/test/fixtures/signals), shaped like what the real
 * endpoints return, served to `fetchText`/`fetchJSON` mocks by exact URL. Unrouted URLs answer null,
 * the way the real helpers report a failed fetch.
 */

export function fixture(name: string): string {
  return fs.readFileSync(new URL(`./fixtures/signals/${name}`, import.meta.url), "utf8");
}

type Routes = Record<string, string | { url: string; body: string }>;

export function routeFetches(routes: Routes) {
  const requested: string[] = [];
  const fetchText = async (url: string) => {
    requested.push(url);
    const hit = routes[url];
    if (hit === undefined) return null;
    return typeof hit === "string" ? { url, status: 200, body: hit } : { status: 200, ...hit };
  };
  const fetchJSON = async (url: string) => {
    const res = await fetchText(url);
    return res ? JSON.parse(res.body) : null;
  };
  return { fetchText, fetchJSON, requested };
}
