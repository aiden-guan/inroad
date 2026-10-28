import { connection } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { chatGptStatus, connectChatGpt, disconnectChatGpt } from "@/lib/studio/chatgpt";

/** Same-computer/origin access is enforced by proxy.ts, including the OAuth connection actions. */
export async function GET() {
  await connection();
  try { return Response.json(await chatGptStatus()); } catch (error) { return errorResponse(error); }
}
export async function POST() {
  await connection();
  try { return Response.json(await connectChatGpt()); } catch (error) { return errorResponse(error); }
}
export async function DELETE() {
  await connection();
  try { await disconnectChatGpt(); return Response.json({ available: true, connected: false }); } catch (error) { return errorResponse(error); }
}
