import type {
  StudioAudience,
  StudioFormatId,
  StudioOccasion,
} from "@/lib/domain/types";

export type CampaignEvidence = "results" | "reach" | "reference";
export const EVIDENCE_LABELS: Record<CampaignEvidence, string> = {
  results: "Reported results",
  reach: "Reported reach",
  reference: "Creative study",
};

export const PLAYBOOKS = {
  demonstration: "Demonstrate value",
  participation: "Invite participation",
  proof: "Build trust",
  positioning: "Change the frame",
  story: "Tell a story",
} as const;
export type CampaignPlaybook = keyof typeof PLAYBOOKS;
export interface StudyStep {
  title: string;
  detail: string;
}
export interface CampaignStudy {
  year: number | null;
  market: string;
  playbooks: CampaignPlaybook[];
  objective: string;
  audience: string;
  setup: string;
  execution: StudyStep[];
  mechanisms: StudyStep[];
  lookFor: string;
  blueprint: StudyStep[];
  useWhen: string;
  avoidWhen: string;
  measure: string;
  resultScope: string;
  sources: { label: string; url: string; note: string }[];
}

export interface Campaign {
  id: string;
  brand: string;
  title: string;
  period: string;
  channel: string;
  audiences: StudioAudience[];
  formats: StudioFormatId[];
  preferredFormat: StudioFormatId;
  occasions?: StudioOccasion[];
  approach: string;
  adaptation: string;
  moveIds: string[];
  evidence: CampaignEvidence;
  result: { value: string; label: string; detail: string };
  caveat: string;
  source: { label: string; url: string };
  creativeUrl?: string;
  reviewedAt: string;
  /** Absent only on archived records retained for previously saved pieces. */
  study?: CampaignStudy;
}
