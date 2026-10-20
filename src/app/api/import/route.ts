import { connection } from "next/server";
import { z } from "zod";
import { applyListImport } from "@/lib/network/import";
import { FIELDS, PRESETS, type FieldKey, type Mapping, type PresetId } from "@/lib/network/presets";
import { readNetwork } from "@/lib/network/store";
import { summarizeBatch, type ImportResponse } from "@/lib/network/types";
import { errorResponse, readJSON } from "@/lib/server/http";

/** Recent imports, newest first (for history and undo). */
export async function GET() {
  await connection();
  try {
    return Response.json({ imports: readNetwork().imports.slice(0, 20).map(summarizeBatch) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

const Body = z.object({
  fileName: z.string().max(200),
  text: z.string().min(1).max(8_000_000),
  preset: z.enum(PRESETS.map((p) => p.id) as [string, ...string[]]),
  mapping: z.object(Object.fromEntries(FIELDS.map((f) => [f.key, z.number().int().min(0).max(500).nullable()])) as Record<FieldKey, z.ZodNullable<z.ZodNumber>>),
});

/** A list of companies and people (Apollo, Clay, Sales Navigator, HubSpot, Instantly, Smartlead, Muse, Stripe, signups). Zero tokens. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    const batch = await applyListImport({ fileName: body.fileName, text: body.text, preset: body.preset as PresetId, mapping: body.mapping as Mapping });
    const res: ImportResponse = { batch: summarizeBatch(batch) };
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
