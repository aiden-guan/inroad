import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { AskProposal, AskThread, AskThreadSummary, AskTurn, EntityRef, ID } from "@/lib/domain/types";
import { FileDB, singletonDB } from "./file-db";

/**
 * Ask threads live in `.data/threads.json`, apart from the workspace (they're large and rarely read).
 *
 * Two histories per thread:
 *  - `turns`: what the founder sees. Display-only, so it may be patched (a pending answer becomes final).
 *  - `messages`: the Messages API conversation. Strictly append-only: preserved thinking rejects edited
 *    history, and editing anything early in it would throw away the prompt cache. Dates and the current
 *    context arrive as appended `role: "system"` messages instead.
 */

export interface StoredThread extends AskThread {
  messages: Anthropic.Beta.BetaMessageParam[];
  /** What the model has already been told, so each turn only appends what changed. */
  noted?: { date?: string; contextKey?: string; digestHash?: string; decidedIds?: ID[] };
}

interface ThreadsFile {
  threads: Record<ID, StoredThread>;
}

const MAX_THREADS = 80;

const db = () =>
  singletonDB<ThreadsFile>(
    "threads.json",
    () =>
      new FileDB<ThreadsFile>(
        "threads.json",
        () => ({ threads: {} }),
        (raw) => {
          const file = (raw ?? {}) as Partial<ThreadsFile>;
          return { threads: file.threads && typeof file.threads === "object" ? file.threads : {} };
        },
      ),
  );

export function refKey(ref: EntityRef | undefined): string {
  return ref ? `${ref.kind}:${ref.id}` : "";
}

export function getThread(id: ID): StoredThread | undefined {
  return db().read().threads[id];
}

/** What the browser gets: everything except the raw model history. */
export function publicThread(t: StoredThread): AskThread {
  return {
    id: t.id,
    title: t.title,
    context: t.context,
    contextLabel: t.contextLabel,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    turns: t.turns,
    approxTokens: t.approxTokens,
  };
}

function preview(t: StoredThread): string {
  for (let i = t.turns.length - 1; i >= 0; i--) {
    const turn = t.turns[i];
    const text = turn.instant?.title ?? turn.text;
    if (turn.role === "agent" && text) return text.replace(/\[ev_[a-z0-9]+\]/gi, "").replace(/[*`#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
  }
  return "";
}

/** `context: null` means threads started without a record. */
export function listThreads(opts: { context?: EntityRef | null; limit?: number } = {}): AskThreadSummary[] {
  const key = opts.context === null ? "" : refKey(opts.context);
  return Object.values(db().read().threads)
    .filter((t) => t.turns.length > 0 && (opts.context === undefined || refKey(t.context) === key))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, opts.limit ?? 30)
    .map((t) => ({
      id: t.id,
      title: t.title,
      context: t.context,
      contextLabel: t.contextLabel,
      updatedAt: t.updatedAt,
      turns: t.turns.length,
      preview: preview(t),
    }));
}

/** Rough token count of the model history (4 chars ≈ 1 token; thinking signatures excluded). */
export function estimateTokens(messages: Anthropic.Beta.BetaMessageParam[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      chars += m.content.length;
      continue;
    }
    for (const block of m.content) {
      if (block.type === "text") chars += block.text.length;
      else if (block.type === "thinking") chars += block.thinking.length;
      else if (block.type === "tool_use" || block.type === "server_tool_use") chars += JSON.stringify(block.input ?? {}).length;
      else if (block.type === "tool_result") chars += typeof block.content === "string" ? block.content.length : JSON.stringify(block.content ?? "").length;
      else chars += 2000; // search results and fetched pages: count a typical page
    }
  }
  return Math.round(chars / 4);
}

/**
 * Serialized mutation of one thread, creating it when missing. Prunes the oldest threads beyond the cap.
 * `fn` receives the live draft; return value passes through.
 */
export async function withThread<R>(
  id: ID,
  init: () => Omit<StoredThread, "id" | "messages" | "turns" | "approxTokens">,
  fn: (thread: StoredThread) => R,
): Promise<{ thread: StoredThread; value: R }> {
  const { value, state } = await db().update((draft) => {
    const thread = (draft.threads[id] ??= { ...init(), id, messages: [], turns: [], approxTokens: 0 });
    const value = fn(thread);
    const ids = Object.values(draft.threads)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => t.id);
    for (const old of ids.slice(MAX_THREADS)) if (old !== id) delete draft.threads[old];
    return value;
  });
  return { thread: state.threads[id], value };
}

/**
 * One serialized pass over the threads `match` picks (the file is only written when it picks one):
 * `fn` rewrites a thread in place (true) or asks for it to go ("delete"). The one exception to
 * append-only history: deleting a person's details reaches their Ask conversations this way.
 * Returns how many threads changed.
 */
export async function rewriteThreads(match: (thread: StoredThread) => boolean, fn: (thread: StoredThread) => boolean | "delete"): Promise<number> {
  if (!Object.values(db().read().threads).some(match)) return 0;
  const { value } = await db().update((draft) => {
    let changed = 0;
    for (const [id, thread] of Object.entries(draft.threads)) {
      if (!match(thread)) continue;
      const r = fn(thread);
      if (r === "delete") delete draft.threads[id];
      else if (r) thread.approxTokens = estimateTokens(thread.messages);
      if (r) changed++;
    }
    return changed;
  });
  return value;
}

/** Upserts a display turn by id (a pending answer is replaced by its final version in place). */
export function putTurn(thread: StoredThread, turn: AskTurn) {
  const i = thread.turns.findIndex((t) => t.id === turn.id);
  if (i === -1) thread.turns.push(turn);
  else thread.turns[i] = turn;
}

export async function decideProposal(
  threadId: ID,
  proposalId: ID,
  patch: { status: AskProposal["status"]; at: string; runId?: ID },
): Promise<StoredThread | null> {
  if (!getThread(threadId)) return null;
  const { value } = await db().update((draft) => {
    const thread = draft.threads[threadId];
    if (!thread) return null;
    for (const turn of thread.turns) {
      const p = turn.proposals?.find((x) => x.id === proposalId);
      if (!p) continue;
      p.status = patch.status;
      p.decidedAt = patch.at;
      if (patch.runId) p.runId = patch.runId;
      return thread;
    }
    return null;
  });
  return value;
}
