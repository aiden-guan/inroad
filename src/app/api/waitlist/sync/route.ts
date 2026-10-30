import { WaitlistError } from "@/lib/waitlist/databases";
import { syncWaitlist } from "@/lib/waitlist/sync";

export async function POST() {
  try {
    const result = await syncWaitlist();
    if (!result) return Response.json({ error: "Open your consumer workspace to sync this waitlist." }, { status: 400 });
    return Response.json(result.ok ? { ok: true } : { error: result.summary }, { status: result.ok ? 200 : 502 });
  } catch (error) {
    return Response.json({ error: error instanceof WaitlistError ? error.message : "Couldn't sync your waitlist. Try again." }, { status: 400 });
  }
}
