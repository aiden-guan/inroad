"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRuns, type RunState } from "@/components/providers/runs-provider";
import { newId, nowISO } from "@/lib/domain/ids";
import type { AskProposal, AskThread, AskThreadSummary, AskTurn, EntityRef } from "@/lib/domain/types";

/**
 * One Ask conversation: loads a thread, sends questions (instant answer from code first, else the `ask`
 * workflow), follows the live run, and records proposal decisions. Shared by the window and the inline panel.
 */

interface Optimistic {
  threadId: string;
  founder?: AskTurn;
  agent: AskTurn;
}

export interface SendOptions {
  web?: boolean;
  deep?: boolean;
}

async function fetchThread(id: string): Promise<AskThread | null> {
  const res = await fetch(`/api/ask/threads/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Couldn't load this conversation.");
  return ((await res.json()) as { thread: AskThread }).thread;
}

/** `context: null` lists only threads started without a record. */
export async function fetchThreads(context?: EntityRef | null, limit = 20): Promise<AskThreadSummary[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (context) qs.set("context", `${context.kind}:${context.id}`);
  else if (context === null) qs.set("context", "none");
  const res = await fetch(`/api/ask/threads?${qs}`, { cache: "no-store" });
  if (!res.ok) return [];
  return ((await res.json()) as { threads: AskThreadSummary[] }).threads;
}

/** A record's thread is picked up again for 3 days; a command-bar conversation for 30 minutes. */
const RESUME_RECORD_MS = 3 * 86_400_000;
const RESUME_BAR_MS = 30 * 60_000;

function draftTurns(message: string, o: SendOptions): { founder: AskTurn; agent: AskTurn } {
  return {
    founder: { id: newId("turn"), role: "founder", text: message, at: nowISO(), web: o.web || undefined, deep: o.deep || undefined },
    agent: { id: newId("turn"), role: "agent", text: "", at: nowISO(), pending: true },
  };
}

export function useConversation(opts: {
  threadId?: string;
  context?: EntityRef;
  resume?: boolean;
  prefill?: string;
  /** Called once the prefill has been sent, so the owner can clear it (a remount must not ask it again). */
  onBoot?: () => void;
}) {
  const { runs, start, stop } = useRuns();
  // Everything the first render needs, decided once. A prefill is asked right away in a fresh thread.
  const [init] = useState(() => {
    const prefill = opts.prefill?.trim();
    const id = opts.threadId ?? newId("thr");
    return {
      id,
      known: !!opts.threadId,
      resolving: !opts.threadId && !prefill && !!opts.resume,
      boot: prefill ? { message: prefill, ...draftTurns(prefill, {}) } : null,
    };
  });
  const [context, setContext] = useState<EntityRef | undefined>(opts.context);
  // `known`: the thread exists on the server (load it). New threads are created by the first answer.
  const [current, setCurrent] = useState<{ id: string; known: boolean; resolving: boolean }>({ id: init.id, known: init.known, resolving: init.resolving });
  const [loaded, setLoaded] = useState<{ id: string; thread: AskThread } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Optimistic | null>(() => (init.boot ? { threadId: init.id, founder: init.boot.founder, agent: init.boot.agent } : null));
  /** Agent turns that arrived live in this session keep revealing word by word after they're saved. */
  const [liveIds, setLiveIds] = useState<Set<string>>(() => new Set(init.boot ? [init.boot.agent.id] : []));

  // Pick up where the founder left off on this record (a recent thread), else start fresh.
  const resolving = current.resolving;
  const initialContext = opts.context;
  useEffect(() => {
    if (!resolving) return;
    let cancelled = false;
    void fetchThreads(initialContext ?? null, 1).then((list) => {
      if (cancelled) return;
      const window = initialContext ? RESUME_RECORD_MS : RESUME_BAR_MS;
      const recent = list[0] && Date.now() - new Date(list[0].updatedAt).getTime() < window ? list[0] : null;
      setCurrent((c) => (recent ? { id: recent.id, known: true, resolving: false } : { ...c, resolving: false }));
    });
    return () => {
      cancelled = true;
    };
    // Resolves once, for the record the conversation opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolving]);

  const loadId = current.known && !current.resolving ? current.id : null;
  useEffect(() => {
    if (!loadId) return;
    let cancelled = false;
    fetchThread(loadId)
      .then((thread) => {
        if (cancelled) return;
        if (thread) {
          setLoaded({ id: loadId, thread });
          setFailed(null);
        } else setFailed("This conversation is gone.");
      })
      .catch((e: Error) => !cancelled && setFailed(e.message));
    return () => {
      cancelled = true;
    };
  }, [loadId]);

  const thread = loaded?.id === current.id ? loaded.thread : null;

  const turns = useMemo(() => {
    const list = [...(thread?.turns ?? [])];
    if (optimistic && optimistic.threadId === current.id) {
      for (const t of [optimistic.founder, optimistic.agent]) {
        if (!t) continue;
        const i = list.findIndex((x) => x.id === t.id);
        // The server's copy wins once it's final. Until then (still pending, or an old error being retried)
        // the local copy does: it knows the new run.
        if (i === -1) list.push(t);
        else if (list[i].pending || list[i].error) list[i] = { ...list[i], ...t };
      }
    }
    return list;
  }, [thread, optimistic, current.id]);

  const pendingTurn = [...turns].reverse().find((t) => t.role === "agent" && t.pending && !t.error);
  const liveRun: RunState | undefined = pendingTurn?.runId ? runs[pendingTurn.runId] : undefined;
  const liveStatus = liveRun?.status;
  const busy = !!pendingTurn && (!liveRun || liveStatus === "running" || liveStatus === "queued");

  // When the run ends (done, error or stopped), the server has the final turn: swap it in.
  const settledRunId = liveRun && liveStatus !== "running" && liveStatus !== "queued" ? liveRun.id : null;
  const threadId = current.id;
  useEffect(() => {
    if (!settledRunId) return;
    let cancelled = false;
    void fetchThread(threadId)
      .then((t) => {
        if (cancelled || !t) return;
        setLoaded({ id: threadId, thread: t });
        setOptimistic((o) => (o && o.agent.runId === settledRunId ? null : o));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settledRunId, threadId]);

  const runTurn = useCallback(
    async (message: string, founder: AskTurn | undefined, agent: AskTurn, o: SendOptions) => {
      // Why a run didn't start (budget used up, invalid message) belongs on the turn, not in a passing toast.
      let failure: { message: string; code?: string } | undefined;
      const startOpts = {
        notify: false,
        onError: (e: { message: string; code?: string }) => {
          failure = e;
        },
      };
      const run = await start(
        "ask",
        { threadId, founderTurnId: founder?.id, turnId: agent.id, message, context, web: o.web || undefined, deep: o.deep || undefined },
        startOpts,
      );
      setOptimistic((cur) => {
        if (!cur || cur.agent.id !== agent.id) return cur;
        return run
          ? { ...cur, agent: { ...cur.agent, runId: run.id } }
          : {
              ...cur,
              agent: {
                ...cur.agent,
                pending: false,
                // Refused at start with rate_limit means the monthly budget, not the API: retrying won't help.
                error: { code: failure?.code === "rate_limit" ? "budget" : "start", message: failure?.message ?? "That didn't start. Try again in a moment." },
              },
            };
      });
    },
    [start, threadId, context],
  );

  /** Instant answer from code when possible (free), else the model. The turns are already on screen. */
  const deliver = useCallback(
    async (message: string, founder: AskTurn, agent: AskTurn, o: SendOptions) => {
      // Toggles mean the founder wants the model.
      if (!o.web && !o.deep) {
        try {
          const res = await fetch("/api/ask/instant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId, founderTurnId: founder.id, turnId: agent.id, message, context }),
          });
          const body = (await res.json()) as { instant?: boolean; thread?: AskThread };
          if (res.ok && body.instant && body.thread) {
            setLoaded({ id: threadId, thread: body.thread });
            setOptimistic(null);
            return;
          }
        } catch {
          // Fall through to the model.
        }
      }
      await runTurn(message, founder, agent, o);
    },
    [threadId, context, runTurn],
  );

  const send = useCallback(
    async (text: string, o: SendOptions = {}) => {
      const message = text.trim();
      if (!message || busy) return;
      const { founder, agent } = draftTurns(message, o);
      setOptimistic({ threadId, founder, agent });
      setLiveIds((s) => new Set(s).add(agent.id));
      await deliver(message, founder, agent, o);
    },
    [busy, threadId, deliver],
  );

  // A prefilled question (⌘K → Ask, "Ask about this") is sent once, on open.
  const booted = useRef(false);
  const onBoot = opts.onBoot;
  useEffect(() => {
    if (!init.boot || booted.current) return;
    booted.current = true;
    onBoot?.();
    void deliver(init.boot.message, init.boot.founder, init.boot.agent, {});
  }, [init, deliver, onBoot]);

  /** Re-answers a failed or stopped turn in place (the question isn't repeated). */
  const retry = useCallback(
    async (turn: AskTurn) => {
      if (busy) return;
      const i = turns.findIndex((t) => t.id === turn.id);
      const founder = [...turns.slice(0, i)].reverse().find((t) => t.role === "founder");
      if (!founder) return;
      const agent: AskTurn = { ...turn, text: "", pending: true, error: undefined, runId: undefined };
      setOptimistic({ threadId, founder, agent });
      setLiveIds((s) => new Set(s).add(agent.id));
      await runTurn(founder.text, founder, agent, { web: founder.web, deep: founder.deep });
    },
    [busy, turns, threadId, runTurn],
  );

  const stopRun = useCallback(() => {
    if (pendingTurn?.runId) void stop(pendingTurn.runId);
  }, [pendingTurn, stop]);

  const decide = useCallback(
    async (proposal: AskProposal, status: "applied" | "dismissed", runId?: string) => {
      const at = nowISO();
      setLoaded((l) =>
        l && l.id === threadId
          ? {
              ...l,
              thread: {
                ...l.thread,
                turns: l.thread.turns.map((t) => ({ ...t, proposals: t.proposals?.map((p) => (p.id === proposal.id ? { ...p, status, decidedAt: at, runId } : p)) })),
              },
            }
          : l,
      );
      const res = await fetch(`/api/ask/threads/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.id, status, runId }),
      }).catch(() => null);
      if (res?.ok) {
        const body = (await res.json()) as { thread: AskThread };
        setLoaded({ id: threadId, thread: body.thread });
      }
    },
    [threadId],
  );

  const openThread = useCallback((id: string, ctx?: EntityRef) => {
    setOptimistic(null);
    setFailed(null);
    setContext(ctx);
    setCurrent({ id, known: true, resolving: false });
  }, []);

  const newThread = useCallback((ctx?: EntityRef | null) => {
    setOptimistic(null);
    setFailed(null);
    if (ctx !== undefined) setContext(ctx ?? undefined);
    setCurrent({ id: newId("thr"), known: false, resolving: false });
  }, []);

  const loading = current.resolving || (current.known && !thread && !failed);
  return {
    threadId,
    thread,
    turns,
    context,
    loading,
    failed,
    busy,
    liveRun,
    liveIds,
    send,
    retry,
    stop: stopRun,
    decide,
    openThread,
    newThread,
  };
}

export type ConversationState = ReturnType<typeof useConversation>;
