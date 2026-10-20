import "server-only";
import type { WorkflowId } from "@/lib/domain/types";
import type { WorkflowDef } from "./types";
import foundation from "./foundation";
import brief from "./brief";
import discovery from "./discovery";
import dossier from "./dossier";
import compose from "./compose";
import prep from "./prep";
import debrief from "./debrief";
import review from "./review";
import dinnerplan from "./dinner-plan";
import ask from "./ask";
import enrich from "./enrich";
import asset from "./asset";
import network from "./network";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WORKFLOWS: Record<WorkflowId, WorkflowDef<any>> = {
  foundation: foundation,
  brief: brief,
  discovery: discovery,
  dossier: dossier,
  compose: compose,
  prep: prep,
  debrief: debrief,
  review: review,
  dinner_plan: dinnerplan,
  ask: ask,
  enrich: enrich,
  asset: asset,
  network: network,
};

export function getWorkflow(id: string): WorkflowDef<unknown> | undefined {
  return (WORKFLOWS as Record<string, WorkflowDef<unknown>>)[id];
}
