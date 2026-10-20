import "server-only";
import { fetchJSON, fetchText } from "./http";
import type { SiteDigest } from "./website";

/** Open roles from public ATS job-board APIs. Free, no key, no tokens. */
export interface JobPosting {
  title: string;
  team?: string;
  location?: string;
  url?: string;
  postedAt?: string;
}

type Board = SiteDigest["jobBoards"][number];

interface GreenhouseResp {
  jobs?: { title: string; absolute_url?: string; location?: { name?: string }; updated_at?: string; departments?: { name: string }[] }[];
}
interface LeverPosting {
  text: string;
  hostedUrl?: string;
  createdAt?: number;
  categories?: { team?: string; location?: string; department?: string };
}
interface AshbyResp {
  jobs?: { title: string; department?: string; team?: string; location?: string; jobUrl?: string; publishedAt?: string; isListed?: boolean }[];
}
interface WorkableResp {
  jobs?: { title: string; department?: string; city?: string; country?: string; url?: string; published_on?: string }[];
}

async function fromBoard(board: Board): Promise<JobPosting[]> {
  const token = encodeURIComponent(board.token);
  switch (board.provider) {
    case "greenhouse": {
      const data = await fetchJSON<GreenhouseResp>(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
      return (data?.jobs ?? []).map((j) => ({
        title: j.title,
        team: j.departments?.[0]?.name,
        location: j.location?.name,
        url: j.absolute_url,
        postedAt: j.updated_at,
      }));
    }
    case "lever": {
      const data = await fetchJSON<LeverPosting[]>(`https://api.lever.co/v0/postings/${token}?mode=json`);
      return (Array.isArray(data) ? data : []).map((j) => ({
        title: j.text,
        team: j.categories?.team ?? j.categories?.department,
        location: j.categories?.location,
        url: j.hostedUrl,
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      }));
    }
    case "ashby": {
      const data = await fetchJSON<AshbyResp>(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
      return (data?.jobs ?? [])
        .filter((j) => j.isListed !== false)
        .map((j) => ({ title: j.title, team: j.department ?? j.team, location: j.location, url: j.jobUrl, postedAt: j.publishedAt }));
    }
    case "workable": {
      const data = await fetchJSON<WorkableResp>(`https://www.workable.com/api/accounts/${token}?details=false`);
      return (data?.jobs ?? []).map((j) => ({
        title: j.title,
        team: j.department,
        location: [j.city, j.country].filter(Boolean).join(", ") || undefined,
        url: j.url,
        postedAt: j.published_on,
      }));
    }
  }
}

const RESERVED_TLD = /\.(example|test|invalid|localhost|local)$/i;

/** Newest first, so a 60-role cap keeps the fresh postings that carry why-now signals. */
function newest(jobs: JobPosting[]): JobPosting[] {
  return [...jobs].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "")).slice(0, 60);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(jobs?|careers?|at|inc|llc|ltd|hq|labs?|technologies|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** The company that owns a job board, from the board itself. Null when it can't be told. */
async function boardOwner(board: Board): Promise<string | null> {
  const token = encodeURIComponent(board.token);
  if (board.provider === "greenhouse") {
    return (await fetchJSON<{ name?: string }>(`https://boards-api.greenhouse.io/v1/boards/${token}`))?.name ?? null;
  }
  const page =
    board.provider === "ashby"
      ? await fetchText(`https://jobs.ashbyhq.com/${token}`)
      : board.provider === "lever"
        ? await fetchText(`https://jobs.lever.co/${token}`)
        : null;
  return page?.body.match(/<title>([^<]{1,120})<\/title>/i)?.[1]?.trim() ?? null;
}

/**
 * A slug guessed from a domain ("saltmarsh") can belong to a different company on the same ATS.
 * Accept a guess only when the board's own name matches the company.
 */
async function ownsBoard(board: Board, domain: string, name?: string): Promise<boolean> {
  const owner = await boardOwner(board);
  if (!owner) return false;
  const o = norm(owner);
  const candidates = [domain.split(".")[0], name].filter(Boolean).map((x) => norm(x!)).filter((x) => x.length >= 3);
  return candidates.some((c) => o === c || (o.length >= 4 && (o.includes(c) || c.includes(o))));
}

/**
 * Tries detected boards first, then (or when `guessed`) slug guesses verified against the board's
 * owner name, so another company's roles never show up as this account's hiring signal.
 */
export async function findOpenRoles(
  boards: Board[],
  domain: string,
  opts: { guessed?: boolean; name?: string } = {},
): Promise<{ jobs: JobPosting[]; source?: Board }> {
  if (RESERVED_TLD.test(domain)) return { jobs: [] };
  const known = opts.guessed ? [] : boards;
  const guesses: Board[] = opts.guessed ? [...boards] : [];
  const stem = domain.split(".")[0];
  if (!known.length && !guesses.length && stem && stem.length >= 3) {
    for (const provider of ["ashby", "greenhouse", "lever"] as const) guesses.push({ provider, token: stem });
  }
  for (const board of known) {
    const jobs = await fromBoard(board);
    if (jobs.length) return { jobs: newest(jobs), source: board };
  }
  for (const board of guesses) {
    const jobs = await fromBoard(board);
    if (jobs.length && (await ownsBoard(board, domain, opts.name))) return { jobs: newest(jobs), source: board };
  }
  return { jobs: [] };
}

/** Groups roles by team so a prompt (or a person) can see hiring focus at a glance. */
export function summarizeRoles(jobs: JobPosting[]): string {
  if (!jobs.length) return "No public job board found.";
  const byTeam = new Map<string, string[]>();
  for (const j of jobs) {
    const team = j.team || "Other";
    byTeam.set(team, [...(byTeam.get(team) ?? []), j.title]);
  }
  return [...byTeam.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([team, titles]) => `${team} (${titles.length}): ${[...new Set(titles)].slice(0, 6).join("; ")}`)
    .join("\n");
}
