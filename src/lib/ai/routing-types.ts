import type { ModelTier } from "./models";
import type { ProviderId } from "./providers";
import type { ModelPrice } from "@/components/settings/types";

export const AI_TASKS = {
  foundation: "Company playbook", brief: "Daily brief", discovery: "Find companies",
  dossier: "Company research", compose: "Write outreach", prep: "Meeting preparation",
  debrief: "Meeting follow-up", review: "Strategy review", dinner_plan: "Event planning",
  ask: "Ask Inroad", enrich: "Enrichment", asset: "Content", network: "Network research",
  partners: "Partner research", studio: "Studio writing", visual: "Visual planning",
} as const;
export type AiTask = keyof typeof AI_TASKS;
export interface ModelTarget { connectionId: string; model?: string }
export interface AiConnection {
  id: string;
  name: string;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  models: Partial<Record<ModelTier, string>>;
  available: string[];
  prices: Record<string, ModelPrice>;
  enabled: boolean;
  auto: boolean;
  /** Explicit fit preferences; automatic routing never searches the entire catalog. */
  strengths: ("reasoning" | "writing" | "research" | "fast")[];
  contextWindow?: number;
  key?: { hint: string; store: "keychain" | "file"; savedAt: string };
  cloudflare?: { accountId: string; gatewayId: string; collectLogs: boolean; dynamicRoute?: string };
}
export interface AiRouting {
  includeOriginal?: boolean;
  mode: "manual" | "auto";
  policy: "quality" | "balanced" | "cost";
  defaultConnectionId?: string;
  tasks: Partial<Record<AiTask, ModelTarget>>;
}
export interface RoutingStatus {
  connections: AiConnection[];
  routing: AiRouting;
  ready: Record<string, boolean>;
}
