import { connection } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { communityQuestions } from "@/lib/signals/community";
import { readWorkspace } from "@/lib/store/workspace";

/**
 * GET /api/content/questions
 * Recent public questions on Hacker News that match the playbook's pains, for the founder to answer (Playbook → Founder
 * content → Community answer). Free and keyless; no model calls.
 */
export async function GET() {
  await connection();
  try {
    return Response.json(await communityQuestions(readWorkspace(), new Date()), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
