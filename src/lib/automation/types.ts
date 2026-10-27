import { z } from "zod";
import type { SearchHit } from "@/lib/search/quality";

export const Capability = z.enum(["search", "fetch", "records", "enrich"]);
export type Capability = z.infer<typeof Capability>;
export interface ExternalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  path?: string;
  parameters?: { name: string; in: "query" | "path"; required: boolean }[];
}
export const Binding = z.object({
  capability: Capability,
  tool: z.string().min(1).max(200),
  queryField: z.string().max(100).default("query"),
  limitField: z.string().max(100).default("limit"),
  resultPath: z.string().max(200).default("results"),
  fields: z.record(z.string().max(80), z.string().max(200)).default({}),
  defaults: z.record(z.string().max(100), z.unknown()).default({}),
});
export type Binding = z.infer<typeof Binding>;
export interface ToolConnection {
  id: string;
  name: string;
  kind: "mcp" | "openapi";
  endpoint: string;
  enabled: boolean;
  authHeader: string;
  authScheme: "bearer" | "raw";
  tools: ExternalTool[];
  bindings: Binding[];
  createdAt: string;
  checkedAt?: string;
  lastError?: string;
}
export interface OperationReceipt {
  id: string;
  at: string;
  kind: "search" | "fetch" | "connection" | "monitor" | "research";
  provider: string;
  query: string;
  durationMs: number;
  resultCount: number;
  requests?: number;
  cached: boolean;
  error?: string;
  costUsd: number | null;
  accountDomains?: string[];
  sourceUrls?: string[];
}
export const MonitorInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["topic", "page"]),
  query: z.string().trim().min(1).max(1000),
  intervalMinutes: z.number().int().min(60).max(43_200).default(1440),
  recipe: z.enum(["custom", "leadership", "revival", "meeting"]).default("custom"),
  keywords: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  enabled: z.boolean().default(true),
});
export type MonitorInput = z.infer<typeof MonitorInput>;
export interface Monitor extends MonitorInput {
  id: string;
  createdAt: string;
  nextRunAt: string;
  lastRunAt?: string;
  lastChangedAt?: string;
  lastError?: string;
  failures: number;
  leaseUntil?: string;
  fingerprint?: string;
  seen?: string[];
}
export interface MonitorObservation {
  id: string;
  monitorId: string;
  at: string;
  title: string;
  summary: string;
  urls: string[];
  read: boolean;
}
export interface AutomationData {
  version: 1;
  connections: ToolConnection[];
  monitors: Monitor[];
  observations: MonitorObservation[];
  receipts: OperationReceipt[];
  sessions: {
    id: string;
    at: string;
    query: string;
    includeDomains: string[];
    excludeDomains: string[];
    since?: string;
    provider: string;
    results: SearchHit[];
    queries: string[];
    warnings: string[];
    receiptId: string;
    durationMs: number;
  }[];
  imports: { id: string; name: string; fields: Record<string, string>; resultPath: string }[];
}
