import { z, ZodError } from "zod";
import { readJSON } from "@/lib/server/http";
import { WaitlistConnectBody, WaitlistError } from "@/lib/waitlist/databases";
import { connectWaitlist, disconnectWaitlist, setWaitlistGoal } from "@/lib/waitlist/sync";

function failure(error: unknown) {
  const message = error instanceof WaitlistError ? error.message : error instanceof ZodError ? "Check the connection details and try again." : "Couldn't save your waitlist connection. Try again.";
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = WaitlistConnectBody.parse(await readJSON(request));
    return Response.json(await connectWaitlist(body.provider, body.credential, body.table), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function DELETE() {
  try { await disconnectWaitlist(); return Response.json({ ok: true }); }
  catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const { goal } = z.object({ goal: z.number().int().positive().safe().nullable() }).parse(await readJSON(request));
    await setWaitlistGoal(goal);
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
