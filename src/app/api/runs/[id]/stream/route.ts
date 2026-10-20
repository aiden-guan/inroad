import { connection } from "next/server";
import { subscribe } from "@/lib/runs/registry";

/** Server-Sent Events: replays the run's log so far, then streams live until it finishes. */
export async function GET(request: Request, ctx: RouteContext<"/api/runs/[id]/stream">) {
  await connection();
  const { id } = await ctx.params;
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      ping = setInterval(() => write(": ping\n\n"), 15_000);
      unsubscribe = subscribe(id, (event) => {
        write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "done") queueMicrotask(close);
      });
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      clearInterval(ping);
      unsubscribe();
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
