import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { marketOf } from "@/lib/consumer/market";
import { addDays, todayISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { currentMetrics, metricDescriptor } from "./metrics";
import type { GtmInitiative, InitiativeMeasurement, MetricReading } from "./types";

export class InitiativeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const finite = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => Number.isFinite(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s, "Use a valid date.");
const fields = {
  title: z.string().trim().min(1).max(240), owner: z.string().trim().min(1).max(80),
  dueOn: date, metricId: z.string().max(6000).nullable(), target: finite.nullable(),
  direction: z.enum(["increase", "decrease"]), note: z.string().trim().max(2000),
};
export const CreateInitiative = z.object({ title: fields.title, owner: fields.owner.optional(), dueOn: fields.dueOn.optional(), metricId: fields.metricId.optional(), target: fields.target.optional(), direction: fields.direction.optional(), note: fields.note.optional(), requestId: z.uuid().optional() }).strict();
export const UpdateInitiative = z.object({ title: fields.title.optional(), owner: fields.owner.optional(), dueOn: fields.dueOn.optional(), metricId: fields.metricId.optional(), target: fields.target.optional(), direction: fields.direction.optional(), note: fields.note.optional(), status: z.enum(["active", "done", "parked"]).optional() }).strict().refine((v) => Object.keys(v).length > 0, "Choose something to update.");

function findMetric(ws: Workspace, id: string, now: Date): MetricReading {
  const reading = currentMetrics(ws, now).find((r) => r.id === id);
  if (!reading) throw new InitiativeError("That metric is no longer available. Choose a current source.");
  if (reading.problem) throw new InitiativeError("Sync this source successfully before using it as a baseline.");
  return reading;
}
function measurement(reading: MetricReading, direction: InitiativeMeasurement["direction"], target?: number | null): InitiativeMeasurement {
  if (reading.unit === "percent" && target != null && target > 100) throw new InitiativeError("A percentage target must be between 0 and 100.");
  return { metric: metricDescriptor(reading), baseline: { at: reading.at, value: reading.value, n: reading.n }, direction, ...(target !== undefined && target !== null ? { target } : {}) };
}

/** The server captures the baseline itself; clients can't submit fabricated progress or results. */
export function createInitiative(ws: Workspace, raw: unknown, now = new Date()): GtmInitiative {
  const input = CreateInitiative.parse(raw);
  const id = `gtm_${input.requestId ?? randomUUID()}`;
  const signature = createHash("sha256").update(JSON.stringify([input.title, input.owner ?? "Me", input.dueOn ?? addDays(todayISO(now), 7), input.metricId ?? null, input.target ?? null, input.direction ?? "increase", input.note ?? ""])).digest("hex");
  const saved = ws.gtmInitiatives?.[id];
  if (saved) {
    if (saved.market !== marketOf(ws) || saved.creationSignature !== signature) throw new InitiativeError("This request was already saved with different details. Refresh the plan before trying again.", 409);
    return saved;
  }
  const metric = input.metricId ? findMetric(ws, input.metricId, now) : undefined;
  if (!metric && input.target != null) throw new InitiativeError("Choose a metric before setting its target.");
  const at = now.toISOString();
  const item: GtmInitiative = {
    id, market: marketOf(ws), title: input.title, creationSignature: signature,
    owner: input.owner ?? "Me", dueOn: input.dueOn ?? addDays(todayISO(now), 7),
    status: "active", measurement: metric ? measurement(metric, input.direction ?? "increase", input.target) : undefined,
    revisions: [], outcomes: [], note: input.note, createdAt: at, updatedAt: at,
  };
  (ws.gtmInitiatives ??= {})[item.id] = item;
  return item;
}

export function updateInitiative(ws: Workspace, id: string, raw: unknown, now = new Date()): GtmInitiative {
  const input = UpdateInitiative.parse(raw);
  const item = Object.hasOwn(ws.gtmInitiatives ?? {}, id) ? ws.gtmInitiatives?.[id] : undefined;
  if (!item || item.market !== marketOf(ws)) throw new InitiativeError("That initiative isn't in this workspace's current market.", 404);
  if (item.status === "done" && input.status !== "active") {
    if (Object.keys(input).length === 1 && input.status === "done") return item;
    throw new InitiativeError("Reopen this initiative before editing it. Its saved result stays unchanged.");
  }
  const at = now.toISOString();
  const previous = item.measurement ? structuredClone(item.measurement) : undefined;
  if (input.metricId === null && input.target != null) throw new InitiativeError("Choose a metric before setting its target.");
  if (input.target != null && item.measurement?.metric.unit === "percent" && input.metricId === undefined && input.target > 100) throw new InitiativeError("A percentage target must be between 0 and 100.");
  if (input.metricId !== undefined) {
    // A deliberate rebind starts a new measurement and clears an old target unless one is explicitly supplied.
    item.measurement = input.metricId ? measurement(findMetric(ws, input.metricId, now), input.direction ?? item.measurement?.direction ?? "increase", input.target) : undefined;
  } else if (input.target !== undefined || input.direction !== undefined) {
    if (!item.measurement) throw new InitiativeError("Choose a metric before setting its target.");
    if (input.target === null) delete item.measurement.target;
    else if (input.target !== undefined) item.measurement.target = input.target;
    if (input.direction) item.measurement.direction = input.direction;
  }
  if (previous && JSON.stringify(previous) !== JSON.stringify(item.measurement)) item.revisions.push({ at, measurement: previous });
  for (const key of ["title", "owner", "dueOn", "note"] as const) if (input[key] !== undefined) item[key] = input[key];
  if (input.status === "done" && item.status !== "done") {
    const current = item.measurement ? currentMetrics(ws, now).find((r) => r.id === item.measurement!.metric.id) : undefined;
    const problem = item.measurement ? current?.problem ?? (!current ? "Source unavailable at readout." : undefined) : undefined;
    item.outcomes.push({ at, measurement: item.measurement ? structuredClone(item.measurement) : undefined, current: current ? { at: current.at, value: current.value, n: current.n } : undefined, problem, note: item.note });
  }
  if (input.status) item.status = input.status;
  item.updatedAt = at;
  return item;
}
