import "server-only";
import type { AgentEvent } from "./events";
import { AgentError } from "./errors";

/**
 * Streams an agent run to the browser as Server-Sent Events.
 *
 * The run is deliberately NOT tied to the request's lifetime: if the founder closes the tab
 * halfway through building their playbook, the work still finishes and is saved. Each run
 * persists its own result to the store; the stream is only a live window onto it.
 */
export function streamRun(run: (emit: (event: AgentEvent) => void) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const emit = (event: AgentEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
      // Comment pings keep proxies from closing an idle connection during long web research.
      const ping = setInterval(() => write(": ping\n\n"), 15_000);

      run(emit)
        .then((data) => emit({ type: "result", data: data ?? null }))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Something went wrong.";
          const code = err instanceof AgentError ? err.code : "unknown";
          if (!(err instanceof AgentError)) console.error("[agent] run failed:", err);
          emit({ type: "error", message, code });
        })
        .finally(() => {
          clearInterval(ping);
          emit({ type: "done" });
          if (open) {
            open = false;
            try {
              controller.close();
            } catch {
              // already closed by the client
            }
          }
        });
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
