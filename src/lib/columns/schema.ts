import "server-only";
import { z } from "zod";
import { COLUMN_TYPES, LIMITS, type ColumnsOp } from "./types";

/** Shapes the browser may send to /api/columns. Semantic rules (limits, existence) live in ./ops.ts. */

const Id = z.string().regex(/^[a-z]+_[A-Za-z0-9_-]{4,40}$/, "is not an id");
const ISO = z.string().min(10).max(40);
const Domain = z.string().min(3).max(253);

const Options = z.array(z.string().trim().min(1).max(LIMITS.option)).min(2).max(LIMITS.options);

const ColumnShape = z
  .object({
    id: Id,
    question: z.string().trim().min(3).max(LIMITS.question),
    type: z.enum(COLUMN_TYPES),
    options: Options.optional(),
    instructions: z.string().trim().max(LIMITS.instructions).optional(),
    createdAt: ISO,
    updatedAt: ISO.optional(),
  })
  .refine((c) => c.type !== "pick_one" || (c.options && new Set(c.options.map((o) => o.toLowerCase())).size === c.options.length), {
    message: "Pick one needs 2 to 8 different options.",
  });

const Source = z.object({
  url: z.string().min(4).max(2000),
  quote: z.string().max(LIMITS.quote + 200),
  date: z.string().max(10).optional(),
  kind: z.enum(["site", "job_board", "dns", "evidence", "signal", "page", "search"]),
  checked: z.boolean(),
});

const Cell = z.object({
  columnId: Id,
  domain: Domain,
  value: z.union([z.boolean(), z.number(), z.string().max(400), z.null()]),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
  sources: z.array(Source).max(6),
  note: z.string().max(400).optional(),
  at: ISO,
  method: z.enum(["workspace", "reused", "model"]),
  runId: z.string().max(64).optional(),
  costUsd: z.number().min(0).optional(),
  unpriced: z.boolean().optional(),
  searches: z.number().int().min(0).optional(),
  pagesRead: z.number().int().min(0).optional(),
  error: z.string().max(400).optional(),
});

const Keys = z.array(z.string().max(80)).max(40);
const Filters = z.object({
  tiers: Keys,
  signals: Keys,
  statuses: Keys,
  sources: z.array(z.string().max(300)).max(40),
  answers: z.record(z.string().max(64), Keys),
});

const View = z.object({
  id: Id,
  name: z.string().trim().min(1).max(LIMITS.viewName),
  filters: Filters,
  sort: z.object({ key: z.string().max(80), dir: z.enum(["asc", "desc"]) }),
  columns: z.array(Id).max(LIMITS.columns),
  createdAt: ISO,
  updatedAt: ISO.optional(),
});

const Op = z.discriminatedUnion("type", [
  z.object({ type: z.literal("column.add"), column: ColumnShape, index: z.number().int().min(0).optional() }),
  z.object({
    type: z.literal("column.update"),
    id: Id,
    patch: z.object({
      question: z.string().trim().min(3).max(LIMITS.question).optional(),
      type: z.enum(COLUMN_TYPES).optional(),
      options: Options.optional(),
      instructions: z.string().trim().max(LIMITS.instructions).optional(),
    }),
    at: ISO,
  }),
  z.object({ type: z.literal("column.delete"), id: Id }),
  z.object({
    type: z.literal("column.restore"),
    column: ColumnShape,
    index: z.number().int().min(0),
    cells: z.record(Domain, Cell),
    hidden: z.boolean(),
    views: z.array(z.object({ id: Id, index: z.number().int().min(0) })).max(LIMITS.views),
  }),
  z.object({ type: z.literal("column.move"), id: Id, to: z.number().int().min(0) }),
  z.object({ type: z.literal("column.hide"), id: Id, hidden: z.boolean() }),
  z.object({ type: z.literal("cells.clear"), columnId: Id, domains: z.array(Domain).max(LIMITS.domains).optional() }),
  z.object({ type: z.literal("view.save"), view: View }),
  z.object({ type: z.literal("view.delete"), id: Id }),
  z.object({ type: z.literal("view.restore"), view: View, index: z.number().int().min(0) }),
]);

export const OpsBody = z.object({ ops: z.array(Op).min(1).max(50) });

export function parseOps(body: unknown): ColumnsOp[] {
  return OpsBody.parse(body).ops as ColumnsOp[];
}
