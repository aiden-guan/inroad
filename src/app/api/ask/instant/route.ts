import { z } from "zod";
import { nowISO, todayISO } from "@/lib/domain/ids";
import { errorResponse, readJSON } from "@/lib/server/http";
import { publicThread, putTurn, withThread } from "@/lib/store/threads";
import { readWorkspace } from "@/lib/store/workspace";
import { MAX_MESSAGE, contextInfo, instantAnswer } from "@/lib/workflows/ask";

const Body = z.object({
  threadId: z.string().min(3).max(40),
  founderTurnId: z.string().min(3).max(40),
  turnId: z.string().min(3).max(40),
  message: z.string().trim().min(1).max(MAX_MESSAGE),
  context: z.object({ kind: z.enum(["account", "person", "deal", "meeting", "event", "guest", "evidence", "claim", "objection", "playbook", "draft"]), id: z.string().min(1).max(300) }).optional(),
});

/**
 * Tries to answer from the workspace in code, with no model call. `{ instant: false }` means the client should
 * start the `ask` workflow instead. Instant answers are appended to the thread's model history too, so a
 * follow-up question ("what should I do about these?") has them.
 */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    // Instant answers are short list questions; a pasted transcript goes straight to the model.
    if (body.message.length > 2000) return Response.json({ instant: false });
    const ws = readWorkspace();
    const now = new Date();
    const answer = instantAnswer(ws, body.message, now);
    if (!answer) return Response.json({ instant: false });

    const label = body.context ? contextInfo(ws, body.context, todayISO(now))?.label : undefined;
    const at = nowISO();
    const { thread } = await withThread(
      body.threadId,
      () => ({ title: body.message.slice(0, 64), context: body.context, contextLabel: label, createdAt: at, updatedAt: at }),
      (t) => {
        putTurn(t, { id: body.founderTurnId, role: "founder", text: body.message, at });
        putTurn(t, { id: body.turnId, role: "agent", text: "", at, instant: { title: answer.title, rows: answer.rows } });
        t.messages.push({ role: "user", content: [{ type: "text", text: body.message }] }, { role: "assistant", content: [{ type: "text", text: answer.text }] });
        t.approxTokens += Math.round((body.message.length + answer.text.length) / 4);
        t.updatedAt = at;
      },
    );
    return Response.json({ instant: true, thread: publicThread(thread) });
  } catch (err) {
    return errorResponse(err);
  }
}
