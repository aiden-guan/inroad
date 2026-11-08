import { z } from "zod";

const country = z.string().trim().regex(/^[a-zA-Z]{2}$/).transform((s) => s.toUpperCase());
export const ResearchInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("creators"), query: z.string().trim().min(2).max(160), country, limit: z.number().int().min(1).max(25).default(10) }),
  z.object({ kind: z.literal("citations"), domain: z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/), country }),
]);
export type ResearchInput = z.infer<typeof ResearchInput>;
export interface MonidPrice { type: string; amount?: { value: number; currency: "USD" }; flatFee?: { value: number; currency: "USD" }; [key: string]: unknown }
export interface CreatorResult { handle: string; name?: string; profileUrl: string; postUrl?: string; caption?: string; followers?: number; views?: number; likes?: number }
export interface CitationResult { platform: string; citations: number; pages: number }
export interface MonidReport {
  id: string;
  workspaceId: string;
  input: ResearchInput;
  createdAt: string;
  reportDate: string;
  runId?: string;
  status: "SUBMITTING" | "UNKNOWN" | "READY" | "RUNNING" | "STOPPING" | "COMPLETED" | "FAILED" | "BLOCKED" | "STOPPED" | "TIMED_OUT";
  price?: MonidPrice;
  costUsd?: number;
  error?: string;
  creators?: CreatorResult[];
  citations?: CitationResult[];
}
export const CITATION_PLATFORMS = ["chatgpt", "copilot", "gemini", "google_ai_mode", "google_ai_overviews", "grok", "perplexity"] as const;
export const PLATFORM_NAMES: Record<string, string> = { chatgpt: "ChatGPT", copilot: "Microsoft Copilot", gemini: "Gemini", google_ai_mode: "Google AI Mode", google_ai_overviews: "Google AI Overviews", grok: "Grok", perplexity: "Perplexity" };
export const isResearchPending = (status: MonidReport["status"]) => ["READY", "RUNNING", "STOPPING"].includes(status);
