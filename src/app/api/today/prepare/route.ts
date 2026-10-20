import { z } from "zod";
import { pollConnectors } from "@/lib/hub/poll";
import { prepareToday } from "@/lib/moves/prepare";
import { errorResponse, readJSON } from "@/lib/server/http";

// Refresh is a code-only recompute: nothing a request sends can force a model call.
// Today waits this long for replies polled from connected tools; a slow vendor finishes in the background.
const POLL_BUDGET_MS = 4000;

const Body = z.object({
  reason: z.enum(["open", "action", "timer", "refresh"]).optional(),
});

/**
 * Polls connected tools that no webhook can reach (zero tokens), then recomputes Today's moves and
 * scoreboard in code and, only when something new deserves a sentence, starts the small brief run. Cheap enough to call on open, after actions and on a timer.
 */
export async function POST(request: Request) {
  try {
    const raw = await readJSON(request).catch(() => ({}));
    Body.parse(raw ?? {});
    const polled = pollConnectors().catch(() => []);
    await Promise.race([polled, new Promise((r) => setTimeout(r, POLL_BUDGET_MS))]);
    const result = await prepareToday();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
