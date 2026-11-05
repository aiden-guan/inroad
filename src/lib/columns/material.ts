import { corpus, normUrl } from "@/lib/deals/ledger";
import { daysBetween, todayISO } from "@/lib/domain/ids";
import type { Account, Evidence } from "@/lib/domain/types";
import type { CompanySignals } from "@/lib/signals";
import type { QuickFacts } from "./quick";
import type { SourceKind } from "./types";
import type { MaterialSource } from "./verify";

/**
 * What the model may read and cite for one company, built in code from what Inroad already knows (the
 * account's enrichment, signals, dossier evidence) and what it read for free just now (their site, job board,
 * DNS). Each source is a URL with exactly the text shown for it, so every quote can be checked afterwards.
 * Pure: the caller does the fetching.
 */

export interface Material {
  /** The <sources> block for the prompt. */
  prompt: string;
  sources: Map<string, MaterialSource>;
  /** Pages of their own site in the material. */
  pages: number;
  facts: QuickFacts;
}

/** Only these signal fields are read. CompanySignals has them; tests build them by hand. */
export type Gathered = Pick<CompanySignals, "site" | "jobs" | "jobSource" | "news" | "dns">;

export const JOB_BOARD_URL: Record<string, (token: string) => string> = {
  greenhouse: (t) => `https://boards.greenhouse.io/${t}`,
  lever: (t) => `https://jobs.lever.co/${t}`,
  ashby: (t) => `https://jobs.ashbyhq.com/${t}`,
  workable: (t) => `https://apply.workable.com/${t}`,
};

const SITE_BUDGET = 12_000;
const PAGE_MAX = 3_500;
/** Enrichment older than this isn't "what we know" about jobs any more. */
const STALE_DAYS = 21;

const LABEL: Record<SourceKind, string> = {
  site: "their site",
  job_board: "their job board, read in code",
  dns: "their DNS records, read in code",
  evidence: "a fact already on file",
  signal: "a signal already on file",
  page: "news",
  search: "a search result",
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

export function buildMaterial(input: { account: Account; evidence: Record<string, Evidence>; gathered: Gathered | null; checkedAt: string; today?: string }): Material {
  const { account, evidence, gathered } = input;
  const today = input.today ?? todayISO();
  const checkedOn = input.checkedAt.slice(0, 10);
  const domain = account.domain;
  const order: string[] = [];
  const map = new Map<string, MaterialSource>();
  const add = (url: string, text: string, kind: SourceKind, date?: string) => {
    const t = text.trim();
    if (!url || !t) return;
    const key = normUrl(url);
    const prev = map.get(key);
    if (prev) {
      prev.text = `${prev.text}\n${t}`;
      prev.haystack = corpus(prev.text);
      return;
    }
    order.push(key);
    map.set(key, { url, text: t, haystack: corpus(t), kind, ...(date ? { date } : {}) });
  };

  // 1. Their own site, as read just now (cached for a week), else the title and description on file.
  let pages = 0;
  let siteChars = 0;
  const site = gathered?.site;
  if (site?.pages.length) {
    for (const p of site.pages) {
      const body = [p.title && `Title: ${p.title}`, p.description && `Description: ${p.description}`, p.headings.length ? `Headings: ${p.headings.join(" · ")}` : "", clip(p.text, PAGE_MAX)]
        .filter(Boolean)
        .join("\n");
      if (siteChars + body.length > SITE_BUDGET && pages > 0) break;
      siteChars += body.length;
      add(p.url, body, "site", checkedOn);
      pages++;
    }
  } else if (account.enrichment && (account.enrichment.title || account.enrichment.description)) {
    const e = account.enrichment;
    add(`https://${domain}`, [e.title && `Title: ${e.title}`, e.description && `Description: ${e.description}`].filter(Boolean).join("\n"), "site", e.crawledAt.slice(0, 10));
    pages++;
  }

  // 2. The tools they use, as code saw them: scripts their pages load, records in their DNS.
  const siteTech = site?.tech?.length ? site.tech : [];
  const homeUrl = site?.pages[0]?.url ?? `https://${domain}`;
  if (siteTech.length) add(homeUrl, `Scripts loaded on their site: ${siteTech.join(", ")}`, "site", checkedOn);
  const dnsUrl = `https://dns.google/resolve?name=${domain}&type=TXT`;
  if (gathered?.dns?.saas.length) add(dnsUrl, `Verification records in their DNS: ${gathered.dns.saas.join(", ")}. Email provider: ${gathered.dns.emailProvider}.`, "dns", checkedOn);

  // 3. Their job board: just read, else what enrichment found when it's recent.
  let jobs: QuickFacts["jobs"];
  const enr = account.enrichment;
  if (gathered?.jobSource) {
    const board = JOB_BOARD_URL[gathered.jobSource.provider]?.(gathered.jobSource.token);
    const byTeam = new Map<string, string[]>();
    for (const j of gathered.jobs) byTeam.set(j.team || "Other", [...(byTeam.get(j.team || "Other") ?? []), j.title]);
    const teams = [...byTeam.entries()].sort((a, b) => b[1].length - a[1].length).map(([team, titles]) => ({ team, count: titles.length, titles: [...new Set(titles)].slice(0, 6) }));
    if (board) jobs = { boardUrl: board, provider: gathered.jobSource.provider, checkedOn, total: gathered.jobs.length, teams };
    const recent = gathered.jobs
      .filter((j) => j.url)
      .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
      .slice(0, 10);
    for (const j of recent) add(j.url!, `${j.postedAt?.slice(0, 10) ?? "undated"} · ${j.title}${j.team ? ` (${j.team})` : ""}`, "job_board", j.postedAt?.slice(0, 10) ?? checkedOn);
  } else if (enr?.jobBoard && daysBetween(enr.crawledAt.slice(0, 10), today) <= STALE_DAYS) {
    const board = JOB_BOARD_URL[enr.jobBoard.provider]?.(enr.jobBoard.token);
    if (board) jobs = { boardUrl: board, provider: enr.jobBoard.provider, checkedOn: enr.crawledAt.slice(0, 10), total: enr.openRoles, teams: enr.rolesByTeam };
  }
  if (jobs) {
    const lines = jobs.teams.map((t) => `${t.team} (${t.count}): ${t.titles.join("; ")}`);
    add(jobs.boardUrl, `Open roles: ${jobs.total}\n${lines.join("\n") || "None listed."}`, "job_board", jobs.checkedOn);
  }

  // 4. News: just read, else what's on file.
  const news = gathered?.news?.length ? gathered.news : (enr?.news ?? []);
  for (const n of news.slice(0, 6)) add(n.url, `${n.publishedAt?.slice(0, 10) ?? "undated"} · ${n.title}${n.source ? ` · ${n.source}` : ""}`, "page", n.publishedAt?.slice(0, 10));

  // 5. Signals and the evidence behind them and behind the dossier.
  const evIds = new Set<string>();
  for (const s of account.signals) {
    if (s.type === "sensitive") continue;
    const ev = s.evidenceId ? evidence[s.evidenceId] : undefined;
    if (ev && !ev.flaggedWrong) evIds.add(ev.id);
    else add(s.url, `${s.date} · ${s.headline}`, "signal", s.date);
  }
  const d = account.dossier;
  if (d) {
    for (const id of d.snapshot.descriptionEvidenceIds ?? []) evIds.add(id);
    if (d.snapshot.funding?.evidenceId) evIds.add(d.snapshot.funding.evidenceId);
    for (const f of d.facts) for (const id of f.evidenceIds) evIds.add(id);
    for (const p of d.painHypotheses) for (const id of p.evidenceIds) evIds.add(id);
  }
  for (const id of [...evIds].slice(0, 16)) {
    const ev = evidence[id];
    if (!ev || ev.flaggedWrong) continue;
    add(ev.url, `"${ev.quote}" (${ev.claim})`, "evidence", ev.publishedAt);
  }

  const blocks = order.map((key) => {
    const s = map.get(key)!;
    return `## ${s.url}\nSource: ${LABEL[s.kind]}${s.date ? ` · ${s.kind === "site" || s.kind === "job_board" || s.kind === "dns" ? "read" : "dated"} ${s.date}` : ""}\n${s.text}`;
  });

  const notes = [account.oneLiner, d?.snapshot.plainDescription].filter(Boolean).map((t) => clip(String(t), 240));
  const prompt = [
    `<company>\nName: ${account.name} (${domain})${notes.length ? `\nInroad's notes (context only, not a source): ${notes.join(" / ")}` : ""}\n</company>`,
    blocks.length ? `<sources>\n${blocks.join("\n\n")}\n</sources>` : "<sources>\nNone yet: their site couldn't be read and nothing is on file.\n</sources>",
  ].join("\n\n");

  const facts: QuickFacts = {
    domain,
    ...(jobs ? { jobs } : {}),
    ...(siteTech.length ? { siteTech: { url: homeUrl, checkedOn, names: siteTech } } : {}),
    ...(gathered?.dns?.saas.length ? { dnsTech: { url: dnsUrl, checkedOn, names: gathered.dns.saas } } : {}),
  };
  return { prompt, sources: map, pages, facts };
}
