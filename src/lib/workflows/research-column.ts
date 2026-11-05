import "server-only";
import { z } from "zod";
import { AgentError } from "@/lib/ai/errors";
import { askModel, searchMode } from "@/lib/columns/answer";
import { endJob, markActive, markDone, startJob } from "@/lib/columns/jobs";
import { buildMaterial, type Gathered } from "@/lib/columns/material";
import { quickAnswer } from "@/lib/columns/quick";
import { putCell, readColumns } from "@/lib/columns/store";
import { LIMITS, type ColumnCell, type ColumnsData } from "@/lib/columns/types";
import { cellLabel, questionKey, shortQuestion } from "@/lib/columns/values";
import { daysBetween, nowISO, todayISO } from "@/lib/domain/ids";
import { monthSpend } from "@/lib/runs/registry";
import { gatherSignals, toDomain } from "@/lib/signals";
import { defineWorkflow } from "./types";

/**
 * Research columns: one question asked of many companies ("Do they bill on usage?"). Per company, cheapest
 * first: an answer already given to this question (zero tokens) → what code can settle from free facts, like
 * a count on their job board or a script on their site (zero tokens) → the cheap model reading what Inroad
 * knows and their own site, with up to two more pages and one web search within today's limit. Three
 * companies at a time; each answer is saved the moment it's checked, so the table fills in live.
 */

const CONCURRENCY = 3;
/** The same question in another column is reused when answered this recently. */
const REUSE_DAYS = 30;
/** Failures that would fail every other company too: stop the run instead of repeating them. */
const FATAL = new Set(["no_key", "auth", "no_credit", "model_unavailable", "rate_limit", "stopped"]);
/** Questions about news are worth the slower news lookup; others skip it. */
const NEWSY = /\b(rais\w*|fund\w*|series [a-e]|investors?|news|announc\w*|launch\w*|acqui\w*|partner\w*|press|layoffs?|ipo)\b/i;

const args = z.object({
  columnId: z.string().min(1).max(64),
  domains: z.array(z.string().min(3).max(253)).min(1).max(LIMITS.domains),
  /** Ask again even where there's an answer. */
  force: z.boolean().default(false),
  /** The 5-row try before a full run. */
  preview: z.boolean().default(false),
});

function reusable(data: ColumnsData, key: string, columnId: string, domain: string, today: string): ColumnCell | undefined {
  for (const c of data.columns) {
    if (c.id === columnId || questionKey(c) !== key) continue;
    const cell = data.cells[c.id]?.[domain];
    if (cell && !cell.error && daysBetween(cell.at.slice(0, 10), today) <= REUSE_DAYS) return cell;
  }
  return undefined;
}

export default defineWorkflow({
  id: "research_column",
  args,
  title: (a, ws) => {
    const col = readColumns().columns.find((c) => c.id === a.columnId);
    const q = col ? shortQuestion(col.question, 60) : "a research column";
    const n = a.domains.length;
    if (a.preview) return `Trying “${q}” on ${n} ${n === 1 ? "company" : "companies"}`;
    if (n === 1) return `Asking ${ws.accounts[toDomain(a.domains[0]) ?? a.domains[0]]?.name ?? a.domains[0]}: ${q}`;
    return `Asking ${n} companies: ${q}`;
  },
  heavy: true,
  run: async (ctx) => {
    const today = todayISO();
    const start = readColumns();
    const column = start.columns.find((c) => c.id === ctx.args.columnId);
    if (!column) throw new Error("That column was deleted.");
    const key = questionKey(column);
    const ws = ctx.read();
    const domains = [...new Set(ctx.args.domains.map((d) => toDomain(d)).filter((d): d is string => !!d && !!ws.accounts[d]))];
    if (!domains.length) throw new Error("None of those companies are in your list any more.");

    const search = searchMode();
    const budget = ws.caps.monthlyBudgetUsd;
    // Stops the companies still in flight when one failure means all of them would fail.
    const halt = new AbortController();
    const onStop = () => halt.abort();
    ctx.signal.addEventListener("abort", onStop, { once: true });

    const counts = { answered: 0, unknown: 0, cached: 0, reused: 0, free: 0, failed: 0 };
    let spent = 0;
    let lookups = 0;
    let fatal: unknown = null;
    let changed = false;
    let budgetHit = false;

    startJob({ runId: ctx.runId, columnId: column.id, domains, preview: ctx.args.preview });
    ctx.emit({ type: "status", text: `${domains.length === 1 ? "Asking 1 company" : `Asking ${domains.length} companies`}, ${CONCURRENCY} at a time` });

    const handle = async (domain: string) => {
      const account = ws.accounts[domain];
      const data = readColumns();
      const col = data.columns.find((c) => c.id === column.id);
      if (!col || questionKey(col) !== key) {
        changed = true;
        halt.abort();
        return;
      }
      const existing = data.cells[col.id]?.[domain];
      if (existing && !existing.error && !ctx.args.force) {
        counts.cached++;
        markDone(ctx.runId, domain);
        return;
      }
      if (budget > 0 && monthSpend() + spent >= budget) {
        budgetHit = true;
        halt.abort();
        return;
      }

      markActive(ctx.runId, domain);
      try {
        let cell: Omit<ColumnCell, "columnId" | "domain" | "at" | "runId">;
        const prior = ctx.args.force ? undefined : reusable(data, key, col.id, domain, today);
        if (prior) {
          cell = { value: prior.value, confidence: prior.confidence, sources: prior.sources, ...(prior.note ? { note: prior.note } : {}), method: "reused", costUsd: 0 };
          counts.reused++;
        } else {
          ctx.emit({ type: "status", text: `Reading ${domain}` });
          let gathered: (Gathered & { lookups: number }) | null = null;
          try {
            gathered = await gatherSignals(domain, { name: account.name, maxPages: 4, includeNews: NEWSY.test(col.question), newsTimeoutMs: 8_000 });
            lookups += gathered.lookups;
          } catch {
            gathered = null; // free sources are best-effort; the model still gets what's on file
          }
          if (halt.signal.aborted) return;
          const material = buildMaterial({ account, evidence: ws.evidence, gathered, checkedAt: nowISO(), today });
          const quick = quickAnswer(col, material.facts);
          if (quick) {
            cell = { ...quick, method: "workspace", costUsd: 0, searches: 0, pagesRead: material.pages };
            counts.free++;
          } else {
            const a = await askModel(col, account, material, {
              agent: ctx.agent,
              emit: ctx.emit,
              signal: halt.signal,
              search,
              today,
              noteSearch: () => ctx.noteExternalSearch?.(),
            });
            spent += a.costUsd ?? 0;
            cell = { ...a, method: "model" };
          }
        }
        // A finished answer is kept even if the run is stopping: it was paid for, and it was checked.
        const saved = await putCell({ ...cell, columnId: col.id, domain, at: nowISO(), runId: ctx.runId }, key);
        if (!saved) {
          changed = true;
          halt.abort();
          return;
        }
        if (cell.error) counts.failed++;
        else if (cell.value === null) counts.unknown++;
        else counts.answered++;
        ctx.emit({ type: "action", text: `${account.name}: ${cellLabel({ ...cell, columnId: col.id, domain, at: "" })}` });
      } catch (err) {
        if (halt.signal.aborted) return; // stopped, or another company hit a fatal error: leave this one empty
        if (err instanceof AgentError && FATAL.has(err.code)) {
          fatal = err;
          halt.abort();
          return;
        }
        // One company failing (a timeout, an overloaded turn) doesn't stop the rest; its cell says so.
        const message = err instanceof Error ? err.message : "Something went wrong.";
        const cost = err instanceof AgentError ? (err.costUsd ?? 0) : 0;
        spent += cost;
        counts.failed++;
        await putCell({ columnId: col.id, domain, value: null, confidence: null, sources: [], at: nowISO(), method: "model", runId: ctx.runId, costUsd: cost, error: message.slice(0, 300) }, key).catch(() => false);
      } finally {
        markDone(ctx.runId, domain);
      }
    };

    try {
      let next = 0;
      const worker = async () => {
        while (next < domains.length && !halt.signal.aborted) await handle(domains[next++]);
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, domains.length) }, worker));
    } finally {
      endJob(ctx.runId);
      ctx.signal.removeEventListener("abort", onStop);
      if (lookups) ctx.noteFreeSignals(lookups);
    }

    if (ctx.signal.aborted) throw new AgentError("Stopped.", "stopped");
    if (fatal) throw fatal;
    if (changed) throw new Error("The question changed while I was working, so I stopped. Ask again to fill it in.");
    const done = counts.answered + counts.unknown;
    const parts = [
      `${counts.answered} answered`,
      counts.unknown ? `${counts.unknown} unknown` : null,
      counts.free + counts.reused ? `${counts.free + counts.reused} at no cost` : null,
      counts.cached ? `${counts.cached} already answered` : null,
      counts.failed ? `${counts.failed} failed` : null,
    ].filter(Boolean);
    ctx.emit({ type: "action", text: parts.join(" · ") });
    if (budgetHit) {
      const left = domains.length - done - counts.cached - counts.failed;
      throw new AgentError(`This month's AI budget ($${budget}) is used up, so I stopped with ${left} ${left === 1 ? "company" : "companies"} left. Raise it in Settings → Usage to finish.`, "rate_limit");
    }
    return { columnId: column.id, ...counts, costUsd: spent };
  },
});
