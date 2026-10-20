import { z } from "zod";
import { trackCompanies } from "@/lib/network/import";
import { errorResponse, readJSON } from "@/lib/server/http";

const Body = z.object({ companies: z.array(z.object({ name: z.string().min(1).max(160), domain: z.string().min(3).max(253) })).min(1).max(50) });

/** The approval point of the network screen: ticked companies become tracked accounts with warm paths. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    return Response.json(await trackCompanies(body.companies));
  } catch (err) {
    return errorResponse(err);
  }
}
