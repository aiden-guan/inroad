import { z } from "zod";
import { undoImport } from "@/lib/network/import";
import { summarizeBatch, type UndoResponse } from "@/lib/network/types";
import { errorResponse, readJSON } from "@/lib/server/http";

/** Takes back exactly what one list import added, except records the founder has already worked on. */
export async function POST(request: Request) {
  try {
    const { batchId } = z.object({ batchId: z.string().min(1).max(64) }).parse(await readJSON(request));
    const { batch, message } = await undoImport(batchId);
    const res: UndoResponse = { batch: summarizeBatch(batch), message };
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
