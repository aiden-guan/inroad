/**
 * The shared connector interface. Every connector is plain HTTP and costs zero Claude tokens:
 * `validate()` is one cheap "who am I" call, `push*` writes, `pull*`/`list*` reads.
 * A connector implements only the adapter that matches its job.
 */
import type { IntegrationState } from "@/lib/domain/types";
import type { NativeConnectorId } from "./catalog";

export type ConnectorErrorCode =
  | "auth"
  | "forbidden"
  | "plan"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "upstream"
  | "network";

export interface ConnectorError {
  code: ConnectorErrorCode;
  /** Plain sentence the UI can show as-is: what happened and what to do. Secrets are redacted. */
  message: string;
  status?: number;
}

export type Result<T> = { ok: true; value: T; warnings?: string[] } | { ok: false; error: ConnectorError };

export const ok = <T>(value: T, warnings?: string[]): Result<T> => ({ ok: true, value, ...(warnings?.length ? { warnings } : {}) });
export const fail = (code: ConnectorErrorCode, message: string, status?: number): { ok: false; error: ConnectorError } => ({
  ok: false,
  error: { code, message, status },
});

export type ConnectorConfig = IntegrationState["config"];

/** A record on the other side. `url` deep-links to it when the tool has stable record URLs. */
export interface ExternalRef {
  externalId: string;
  url?: string;
}

export interface CompanyInput {
  domain: string;
  name?: string;
  city?: string;
}

export interface PersonInput {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  linkedinUrl?: string;
  companyDomain?: string;
  companyName?: string;
}

export interface DealInput {
  name: string;
  /** The CRM's own stage id (HubSpot internal id, Attio status title). */
  stageId?: string;
  pipelineId?: string;
  amountUsd?: number;
  closeDate?: string;
}

export interface Pipeline {
  id: string;
  label: string;
  stages: { id: string; label: string; closed?: "won" | "lost" }[];
}

export interface Campaign {
  id: string;
  name: string;
  status: "active" | "paused" | "draft" | "completed" | "other";
}

export interface LeadInput extends PersonInput {
  website?: string;
  firstLine?: string;
  /** Custom variables: subject/body/first line of the approved draft. */
  vars: Record<string, string>;
}

/** Where a change feed left off, per connector. Plain strings so it can live in hub.json. */
export type PollCursor = Record<string, string>;

/**
 * A polled change feed for when no public URL reaches us. Items are shaped like the vendor's own
 * webhook payload, so they go through the same inbound parser, dedupe and moves as a webhook.
 */
export interface SequencerPoll {
  events: Record<string, unknown>[];
  cursor: PollCursor;
  warnings?: string[];
}

/** A deal the CRM changed, in the CRM's own terms (stage id as stored in our stage map). */
export interface CrmDealChange {
  externalId: string;
  name?: string;
  stageId?: string;
  amountUsd?: number;
  closeDate?: string;
}

export interface CrmChanges {
  companies: CompanyInput[];
  people: PersonInput[];
  deals: CrmDealChange[];
  cursor: PollCursor;
  warnings?: string[];
}

export interface CrmAdapter {
  upsertCompany(company: CompanyInput, knownId?: string): Promise<Result<ExternalRef>>;
  upsertPerson(person: PersonInput, company?: ExternalRef, knownId?: string): Promise<Result<ExternalRef>>;
  upsertDeal(deal: DealInput, company: ExternalRef, people: ExternalRef[], knownId?: string): Promise<Result<ExternalRef>>;
  addNote?(parent: ExternalRef, title: string, markdown: string): Promise<Result<ExternalRef>>;
  listPipelines(): Promise<Result<Pipeline[]>>;
  /** Most recently updated companies that have a domain. */
  pullCompanies(limit: number): Promise<Result<CompanyInput[]>>;
  /** Companies and people changed since the cursor, plus the current state of the deals we mirror. */
  pullChanges?(cursor: PollCursor, dealIds: string[]): Promise<Result<CrmChanges>>;
}

export interface SequencerAdapter {
  listCampaigns(): Promise<Result<Campaign[]>>;
  pushLead(campaignId: string, lead: LeadInput): Promise<Result<{ externalId?: string }>>;
  /** Registers our inbound URL for reply events, where the tool's API allows it. */
  registerReplyWebhook?(url: string): Promise<Result<{ webhookId: string }>>;
  /** Replies, labels, bounces and unsubscribes since the cursor, for when webhooks can't reach us. */
  pollEvents?(cursor: PollCursor): Promise<Result<SequencerPoll>>;
}

export interface NotifyAdapter {
  post(message: { text: string; blocks?: unknown[] }): Promise<Result<void>>;
}

export interface Connector {
  id: NativeConnectorId;
  name: string;
  /** One cheap read that proves the key works. `config` holds non-secret facts worth keeping (portal id, ui domain). */
  validate(): Promise<Result<{ accountLabel: string; config?: Record<string, string | number> }>>;
  crm?: CrmAdapter;
  sequencer?: SequencerAdapter;
  notify?: NotifyAdapter;
}

export type ConnectorFactory = (secret: string, config: ConnectorConfig) => Connector;
