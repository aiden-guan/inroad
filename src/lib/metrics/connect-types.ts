import type { PostHogProject } from "./posthog-auth";

/** Public progress only; credentials and PKCE verifiers never leave the server. */
export interface PostHogConnection {
  flowId: string;
  status: "waiting" | "connecting" | "choose" | "done" | "error";
  projects?: PostHogProject[];
  error?: string;
  url?: string;
}
