import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { defineTool } from "@/lib/ai/engine";
import { AgentError } from "@/lib/ai/errors";
import { EMBER_CORE, companyContext, taskHeader } from "@/lib/ai/prompts/core";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Connection, Evidence, NetworkCompany, PersonaRole, Signal, Workspace } from "@/lib/domain/types";
import { ensureAccount } from "@/lib/hub/records";
import { isRealCompany, normalizeCompany } from "@/lib/network/csv";
import { attachWarmPaths, connectionPerson, fullName, knowsProduct } from "@/lib/network/import";
import { mutateNetwork, readConnections, readNetwork, updateConnections, type Fit } from "@/lib/network/store";
import { buyerTitleMatcher, isBuyerRole, normalizeTitle, seniority } from "@/lib/network/titles";
import { ycDirectory, type YcCompany } from "@/lib/signals/yc";
import { pool, tierFor, whyNowScore, whyNowSentence } from "./enrich";
import { defineWorkflow, type WorkflowContext } from "./types";

/**
 * W2: screen the founder's LinkedIn connections (warm before cold).
 *
 * Code does nearly everything: buyer titles from persona titles, company grouping, matching to
 * existing accounts and the YC directory, warm paths, the job-change diff and the summary line.
 * Haiku sees UNIQUE company names with job titles only (never a person's name or contact
 * details) in batches of 40, and its verdicts are cached per company until the ICP changes, so
 * a monthly re-import only pays for companies it hasn't seen. Typical cost: a few cents.
 */

type Args = { reason?: "import" | "rescreen"; importId?: string };

const BATCH = 40;
const MAX_SCREEN = 600;
const TOP = 25;

const NETWORK_RULES = `NETWORK RULES (screening the founder's LinkedIn connections against the ICP bet)
You see company names and the job titles the founder's connections hold there. Never people's names or contact details.
For each company decide: likely / unknown / unlikely, with a one-line reason.

How to judge
- Use only the company name, the titles listed and any directory data supplied (YC one-liner, team size, industry).
  Never guess a company's size, funding, revenue or customers. One exception: a household-name public company (Google,
  Walmart, JPMorgan) is a large enterprise.
- likely: the directory data or the name plainly fits a must-have ICP criterion, or the titles show the buying function
  the ICP sells into at a company nothing excludes. Name the fact that made it likely.
- unlikely: a concrete mismatch you can point to. An anti-ICP match; a competitor; an agency, consultancy or recruiter
  when the ICP buys software; a university, government body, hospital or investor when the ICP is companies; a large
  enterprise when the ICP is small teams. Name the mismatch.
- unknown: everything else. Unknown is not unlikely. Most companies you can't judge from a name alone are unknown.
- Titles are evidence of what a company has ("Head of Platform" means a platform team exists), not of its size.
- Reasons: 90 characters or fewer, specific, no people's names, no hedging. Good: "YC W23 usage-based billing API, 18 people".
  Good: "3 finance leaders incl. a VP Finance; fintech per YC". Bad: "Could be a good fit".
- One result per company index you were given. Never invent an index.`;

const screenTool = defineTool({
  name: "submit_screen",
  description: "Submit one verdict per company, by its index in the list.",
  terminal: true,
  schema: z.object({
    results: z
      .array(
        z.object({
          i: z.number().int().describe("The company's index from the list"),
          fit: z.enum(["likely", "unknown", "unlikely"]),
          reason: z.string().max(90).describe("≤90 characters: the fact behind the verdict, from the name, titles or directory data only"),
        }),
      )
      .max(BATCH + 5)
      .describe(`Up to ${BATCH} results, one per company`),
  }),
});
type ScreenOut = { results: { i: number; fit: Fit; reason: string }[] };

interface Group {
  norm: string;
  name: string;
  rows: Connection[];
  buyers: number;
  positions: string[];
  accountDomain?: string;
  yc?: YcCompany;
  domain?: string;
  fit?: Fit;
  reason?: string;
  jobChanges: number;
  champions: number;
}

/** Changes when the ICP bet changes, so cached verdicts are reused only against the same bet. */
function icpKeyOf(ws: Workspace): string {
  const f = ws.foundation;
  if (!f) return "none";
  const basis = JSON.stringify([f.icp.hypothesis.sentence, f.icp.primarySegment, f.icp.criteria.map((c) => [c.text, c.mustHave]), f.icp.antiIcp.map((a) => a.text)]);
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

function card(g: Group, i: number): string {
  const titles = g.positions.slice(0, 4).map((p) => `"${p.slice(0, 60)}"`).join("; ");
  const more = g.positions.length > 4 ? ` (+${g.positions.length - 4} more)` : "";
  const yc = g.yc
    ? `\n    YC ${g.yc.batch}: ${g.yc.oneLiner.slice(0, 140)}${g.yc.teamSize ? ` · ${g.yc.teamSize} people` : ""}${g.yc.industry ? ` · ${g.yc.industry}` : ""}${g.yc.status && g.yc.status !== "Active" ? ` · ${g.yc.status}` : ""}`
    : "";
  return `[${i}] ${g.name} · ${g.rows.length} connection${g.rows.length === 1 ? "" : "s"} · titles: ${titles}${more}${yc}`;
}

function shortDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

async function screenCompanies(ctx: WorkflowContext<Args>, ws: Workspace, groups: Group[]): Promise<{ screened: number; blocked?: string }> {
  const batches: Group[][] = [];
  for (let i = 0; i < groups.length; i += BATCH) batches.push(groups.slice(i, i + BATCH));
  let screened = 0;
  let blocked: string | undefined;
  const run = async (batch: Group[]) => {
    if (blocked) return;
    const content = `${taskHeader()}
Screen these ${batch.length} companies where the founder has LinkedIn connections. Judge each company against the ICP bet.

Companies:
${batch.map((g, i) => card(g, i + 1)).join("\n")}`;
    try {
      const r = await ctx.agent<ScreenOut>({
        tier: "fast",
        effort: "low",
        maxTokens: 6000,
        requireTerminal: true,
        cacheTtl: "1h",
        system: [EMBER_CORE, NETWORK_RULES, companyContext(ws)],
        messages: [{ role: "user", content }],
        tools: [screenTool],
      });
      for (const res of r.result?.results ?? []) {
        const g = batch[res.i - 1];
        if (!g || g.fit) continue;
        g.fit = res.fit;
        g.reason = res.reason.replace(/\s+/g, " ").trim().slice(0, 90);
        screened++;
      }
      ctx.emit({ type: "status", text: `Screened ${Math.min(groups.length, screened).toLocaleString("en-US")} of ${groups.length.toLocaleString("en-US")} companies` });
    } catch (err) {
      if (err instanceof AgentError && err.code === "stopped") throw err;
      if (err instanceof AgentError && (err.code === "no_key" || err.code === "auth" || err.code === "rate_limit")) {
        blocked = err.message;
        return;
      }
      // One bad batch leaves its companies unknown; the rest still count.
      console.warn("[network] screen batch failed:", err instanceof Error ? err.message : err);
    }
  };
  // The first batch writes the prompt cache; the rest read it in parallel.
  if (batches.length) await run(batches[0]);
  await pool(batches.slice(1), 3, run, ctx.signal);
  return { screened, blocked };
}

export default defineWorkflow<Args>({
  id: "network",
  args: z.object({ reason: z.enum(["import", "rescreen"]).optional(), importId: z.string().max(64).optional() }),
  title: (a) => (a.reason === "rescreen" ? "Rescreening your network" : "Screening your network"),
  heavy: false,
  run: async (ctx) => {
    const { emit } = ctx;
    const at = nowISO();
    const today = todayISO();
    emit({ type: "status", text: "Reading your connections" });
    const rows = readConnections();
    if (!rows.length) {
      emit({ type: "status", text: "No connections imported yet" });
      return { total: 0 };
    }
    const ws = ctx.read();
    const network = readNetwork();
    const linkedinImports = network.imports.filter((b) => b.kind === "linkedin" && !b.undoneAt);
    const batch = (ctx.args.importId && linkedinImports.find((b) => b.id === ctx.args.importId)) || linkedinImports[0];
    const changeDay = batch ? todayISO(new Date(batch.importedAt)) : today;
    const previousImport = linkedinImports.find((b) => batch && b.importedAt < batch.importedAt);

    /* 1 · Buyer titles, in code */
    const matcher = buyerTitleMatcher(ws);
    const personas = ws.foundation?.personas.length ?? 0;
    const roleOf = new Map<string, PersonaRole | undefined>();
    for (const r of rows) roleOf.set(r.id, matcher(r.position)?.role);
    const buyerIds = new Set(rows.filter((r) => isBuyerRole(roleOf.get(r.id))).map((r) => r.id));
    emit({
      type: "action",
      text: personas ? `Matched ${buyerIds.size.toLocaleString("en-US")} buyer titles against your ${personas} personas` : "No personas yet, so no buyer titles to match",
    });

    /* 2 · Group by company */
    const own = ws.company?.name ? normalizeCompany(ws.company.name) : "";
    const groups = new Map<string, Group>();
    const spellings = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const norm = r.companyNorm || normalizeCompany(r.company);
      if (!isRealCompany(norm) || norm === own) continue;
      let g = groups.get(norm);
      if (!g) {
        g = { norm, name: r.company, rows: [], buyers: 0, positions: [], jobChanges: 0, champions: 0 };
        groups.set(norm, g);
      }
      g.rows.push(r);
      if (buyerIds.has(r.id)) g.buyers++;
      const s = spellings.get(norm) ?? new Map<string, number>();
      s.set(r.company, (s.get(r.company) ?? 0) + 1);
      spellings.set(norm, s);
    }
    for (const g of groups.values()) {
      g.name = [...(spellings.get(g.norm) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? g.name;
      // Buyer titles first, so the model sees the titles that matter.
      const ps = [...new Set(g.rows.sort((a, b) => Number(buyerIds.has(b.id)) - Number(buyerIds.has(a.id))).map((r) => r.position).filter(Boolean))];
      g.positions = ps.slice(0, 8);
    }
    emit({ type: "status", text: `Grouped ${rows.length.toLocaleString("en-US")} connections into ${groups.size.toLocaleString("en-US")} companies` });

    /* 3 · Existing accounts and the YC directory (free) */
    const accountByName = new Map<string, string>();
    for (const a of Object.values(ws.accounts)) accountByName.set(normalizeCompany(a.name), a.domain);
    for (const g of groups.values()) {
      const byRow = g.rows.find((r) => r.matchedDomain && ws.accounts[r.matchedDomain])?.matchedDomain;
      g.accountDomain = accountByName.get(g.norm) ?? byRow;
    }
    emit({ type: "read", url: "https://yc-oss.github.io/api/companies/all.json", host: "yc-oss.github.io" });
    const dir = await ycDirectory();
    ctx.noteFreeSignals(1);
    const ycByNorm = new Map<string, YcCompany | null>();
    for (const c of dir) {
      const n = normalizeCompany(c.name);
      if (n.length >= 2) ycByNorm.set(n, ycByNorm.has(n) ? null : c); // null = ambiguous, never matched
    }
    let ycHits = 0;
    for (const g of groups.values()) {
      const yc = ycByNorm.get(g.norm) ?? undefined;
      // A short one-word name ("Atlas", "Pilot") is shared by many companies; take it only when an email or account confirms it.
      // Never corroborate with matchedDomain: this workflow writes it, so a wrong match would confirm itself next run.
      const distinctive = g.norm.includes(" ") || g.norm.length >= 7;
      const corroborated = !!yc && (yc.domain === g.accountDomain || g.rows.some((r) => r.email?.toLowerCase().endsWith(`@${yc.domain}`)));
      g.yc = yc && (distinctive || corroborated) ? yc : undefined;
      if (g.yc) ycHits++;
      g.domain = g.accountDomain ?? g.yc?.domain ?? network.fits[g.norm]?.domain ?? g.rows.find((r) => r.matchedDomain)?.matchedDomain;
    }
    if (ycHits) emit({ type: "action", text: `Found ${ycHits.toLocaleString("en-US")} of them in the YC directory` });

    /* 4 · Screen unique companies (Haiku, cached per company until the ICP changes) */
    const icpKey = icpKeyOf(ws);
    let blocked: string | undefined;
    let screenedNow = 0;
    let unscreened = 0;
    if (ws.foundation) {
      for (const g of groups.values()) {
        const hit = network.fits[g.norm];
        if (hit && hit.icpKey === icpKey) {
          g.fit = hit.fit;
          g.reason = hit.reason;
        }
      }
      const todo = [...groups.values()]
        .filter((g) => !g.fit)
        .sort((a, b) => b.buyers - a.buyers || Number(!!b.accountDomain) - Number(!!a.accountDomain) || Number(!!b.yc) - Number(!!a.yc) || b.rows.length - a.rows.length);
      const now = todo.slice(0, MAX_SCREEN);
      unscreened = todo.length - now.length;
      const cached = groups.size - todo.length;
      if (cached) emit({ type: "action", text: `Reused ${cached.toLocaleString("en-US")} verdict${cached === 1 ? "" : "s"} from your last screen` });
      if (now.length) {
        emit({ type: "status", text: `Screening ${now.length.toLocaleString("en-US")} companies against your ICP` });
        const r = await screenCompanies(ctx, ws, now);
        screenedNow = r.screened;
        blocked = r.blocked;
        if (blocked) emit({ type: "status", text: `Screening stopped. ${blocked}` });
      }
      await mutateNetwork((n) => {
        for (const g of now) if (g.fit) n.fits[g.norm] = { fit: g.fit, reason: g.reason ?? "", at, icpKey, ...(g.domain ? { domain: g.domain } : {}) };
      });
    } else {
      emit({ type: "status", text: "No ICP yet, so I'm only matching titles and companies" });
    }

    /* 5 · Write the screen back to connections.json */
    const byNorm = new Map([...groups.values()].map((g) => [g.norm, g]));
    await updateConnections((list) => {
      for (const r of list) {
        const role = roleOf.get(r.id) ?? matcher(r.position)?.role;
        if (role) r.titleRole = role;
        else delete r.titleRole;
        const g = byNorm.get(r.companyNorm || normalizeCompany(r.company));
        if (g?.domain) r.matchedDomain = g.domain;
        if (g?.fit) {
          r.fit = g.fit;
          r.fitReason = g.reason;
        }
        r.screen = { icpCompany: g?.fit === "likely" ? "yes" : g?.fit === "unlikely" ? "no" : "maybe", buyerTitle: isBuyerRole(role), screenedAt: at };
      }
    });

    /* 6 · Workspace: warm paths, job-change signals, the summary */
    const changed = rows.filter((r) => r.previous?.changedOn === changeDay);
    const result = await ctx.mutate((w) => {
      let warmPaths = 0;
      let accountsWarmed = 0;
      for (const g of groups.values()) {
        const acc = g.accountDomain ? w.accounts[g.accountDomain] : undefined;
        if (!acc || acc.status === "disqualified") continue;
        warmPaths += attachWarmPaths(w, acc.domain, g.rows);
        accountsWarmed++;
      }

      let signals = 0;
      let championMoves = 0;
      for (const r of changed) {
        const g = byNorm.get(r.companyNorm || normalizeCompany(r.company));
        if (!g || g.fit === "unlikely") continue;
        g.jobChanges++;
        const knows = knowsProduct(w, r);
        const role = roleOf.get(r.id);
        const senior = seniority(normalizeTitle(r.position)) >= 3;
        const type: Signal["type"] | null = knows ? "champion_job_change" : isBuyerRole(role) && senior ? "new_leader" : null;
        if (!type) continue;
        // A champion at a likely-ICP company is worth a new account; anyone else only adds to one we already have.
        const domain = g.accountDomain ?? (knows && g.fit === "likely" ? g.domain : undefined);
        if (!domain) continue;
        if (!w.accounts[domain]) ensureAccount(w, { domain, name: g.name }, { source: "founder_network", sourceDetail: "LinkedIn re-import", at, tag: "warm" });
        const acc = w.accounts[domain];
        if (acc.status === "disqualified") continue;
        const prev = r.previous!;
        const url = r.url || "https://www.linkedin.com/mynetwork/";
        // Rescreens see the same diff again; one signal per person per move.
        if (acc.signals.some((s) => (s.type === "champion_job_change" || s.type === "new_leader") && s.url === url && s.date === prev.changedOn)) continue;
        const ev: Evidence = {
          id: newId("ev"),
          claim: `${fullName(r)} changed jobs since your import on ${shortDay(previousImport?.importedAt ?? prev.changedOn)}`.slice(0, 200),
          quote: `Company: ${prev.company || "?"} → ${r.company}; Position: ${r.position}`.slice(0, 300),
          url,
          host: "linkedin.com",
          sourceType: "user_input",
          publishedAt: prev.changedOn,
          retrievedAt: at,
          confidence: "high",
          runId: ctx.runId,
        };
        w.evidence[ev.id] = ev;
        const first = r.firstName || "A connection";
        acc.signals.push({
          id: newId("sig"),
          type,
          headline: (knows ? `${first}, who knows your product, joined as ${r.position}` : `${r.position} joined from your network`).split(/\s+/).slice(0, 14).join(" "),
          date: prev.changedOn,
          url,
          host: "linkedin.com",
          evidenceId: ev.id,
          strength: knows ? 3 : 2,
          usableInOutreach: true,
          implication: knows
            ? "Champions bring the tools they trust into a new role, usually in their first 90 days."
            : "New leaders usually review tools and processes in their first 30–60 days.",
        });
        acc.warmPathCount = Math.max(acc.warmPathCount, g.rows.length);
        acc.whyNowScore = whyNowScore(acc.signals, today, acc.warmPathCount);
        acc.whyNow = whyNowSentence(acc.signals, today) ?? acc.whyNow;
        const tier = tierFor(acc.fitScore, acc.whyNowScore);
        if (tier) acc.tier = tier;
        if (knows) {
          const person = connectionPerson(w, domain, r);
          if (role && !person.role) person.role = role;
          person.champion ??= "untested";
          person.notes = person.notes ?? `Knew your product at ${prev.company}.`;
          g.champions++;
          championMoves++;
        }
        signals++;
      }

      // Totals and the ranked list, in warm-path order.
      const all = [...groups.values()];
      const likely = all.filter((g) => g.fit === "likely");
      const atIcp = likely.reduce((n, g) => n + g.rows.length, 0);
      const buyersAtIcp = likely.reduce((n, g) => n + g.buyers, 0);
      const unknown = all.filter((g) => !g.fit || g.fit === "unknown").length;
      const ranked = all
        .filter((g) => g.fit !== "unlikely" && (g.fit === "likely" || g.champions > 0 || g.rows.length >= 2 || g.buyers > 0))
        .map((g) => ({ g, score: g.champions * 1000 + (g.fit === "likely" ? 300 : 0) + g.jobChanges * 40 + g.buyers * 25 + Math.min(g.rows.length, 20) * 3 + (g.domain ? 5 : 0) }))
        .sort((a, b) => b.score - a.score || a.g.name.localeCompare(b.g.name))
        .slice(0, TOP);
      const topCompanies: NetworkCompany[] = ranked.map(({ g }) => {
        const domain = g.accountDomain ?? g.domain;
        const acc = domain ? w.accounts[domain] : undefined;
        return {
          name: g.name,
          ...(domain ? { domain } : {}),
          contacts: g.rows.length,
          buyerTitles: g.buyers,
          fit: g.fit ?? "unknown",
          reason: g.reason ?? (g.yc ? `YC ${g.yc.batch}: ${g.yc.oneLiner}`.slice(0, 90) : ws.foundation ? "Not screened yet" : "Screened once your ICP is ready"),
          ...(g.jobChanges ? { jobChanges: g.jobChanges } : {}),
          ...(acc && acc.status !== "disqualified" && (acc.watch || acc.status !== "new") ? { tracked: true } : {}),
        };
      });

      const total = rows.length;
      const fmt = (n: number) => n.toLocaleString("en-US");
      let line: string;
      if (!w.foundation) {
        line = `${fmt(total)} connections at ${fmt(groups.size)} companies. I'll screen them against your ICP once the playbook is ready.`;
      } else if (blocked && !likely.length) {
        line = `${fmt(total)} connections at ${fmt(groups.size)} companies. I couldn't screen them yet: ${blocked}`;
      } else {
        line = `${fmt(atIcp)} of your ${fmt(total)} connections ${atIcp === 1 ? "works" : "work"} at likely-ICP companies; ${fmt(buyersAtIcp)} ${buyersAtIcp === 1 ? "has a buyer title" : "have buyer titles"}.`;
        if (championMoves) {
          line += ` ${championMoves === 1 ? "1 person who knows your product" : `${championMoves} people who know your product`} changed jobs to ICP companies${previousImport ? ` since ${shortDay(previousImport.importedAt)}` : ""}.`;
        } else if (changed.length && previousImport) {
          line += ` ${fmt(changed.length)} changed jobs or titles since ${shortDay(previousImport.importedAt)}.`;
        }
        if (blocked) line += " Some companies aren't screened yet.";
      }

      w.network = {
        ...(w.network ?? {}),
        importedAt: w.network?.importedAt ?? batch?.importedAt ?? at,
        total,
        atIcpCompanies: atIcp,
        buyerTitles: buyersAtIcp,
        jobChanges: changed.length,
        companies: groups.size,
        icpCompanies: likely.length,
        unknownCompanies: unknown,
        withEmail: rows.filter((r) => r.email).length,
        line,
        screenedAt: at,
        runId: ctx.runId,
        topCompanies,
      };
      return { warmPaths, accountsWarmed, signals, line, icpCompanies: likely.length, atIcp, buyersAtIcp };
    });

    if (result.warmPaths) emit({ type: "action", text: `Attached ${result.warmPaths} warm paths at ${result.accountsWarmed} companies you already track` });
    if (result.signals) emit({ type: "action", text: `Flagged ${result.signals} job change${result.signals === 1 ? "" : "s"} as why-now signals` });

    return {
      total: rows.length,
      companies: groups.size,
      screened: screenedNow,
      unscreened,
      icpCompanies: result.icpCompanies,
      atIcpCompanies: result.atIcp,
      buyerTitles: result.buyersAtIcp,
      jobChanges: changed.length,
      signals: result.signals,
      warmPaths: result.warmPaths,
      line: result.line,
      ...(blocked ? { blocked } : {}),
    };
  },
});
