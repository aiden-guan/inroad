import { z } from "zod";
import { importStargazers } from "@/lib/network/stargazers";
import { summarizeBatch, type ImportResponse } from "@/lib/network/types";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.object({ repo: z.string().min(3).max(200) });

/** A public repo's stargazers, placed at their companies (W2). Zero tokens; GitHub's rate limit applies. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const batch = await importStargazers({ repo: body.repo });
    const res: ImportResponse = { batch: summarizeBatch(batch) };
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
