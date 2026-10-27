import "server-only";
/** Reads may outlive their request. Stop and drain them before swapping/restoring a workspace. */
const global = globalThis as unknown as { __inroadReadTasks?: Map<string, { abort: AbortController; done: Promise<unknown> }> };
const tasks = (global.__inroadReadTasks ??= new Map());
export async function automationTask<T>(signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const id = crypto.randomUUID(),
    abort = new AbortController();
  const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  combined.throwIfAborted();
  const done = Promise.resolve().then(() => run(combined));
  tasks.set(id, { abort, done });
  try {
    return await done;
  } finally {
    tasks.delete(id);
  }
}
export async function stopReadTasks() {
  const current = [...tasks.values()];
  for (const task of current) task.abort.abort();
  await Promise.allSettled(current.map((task) => task.done));
}
