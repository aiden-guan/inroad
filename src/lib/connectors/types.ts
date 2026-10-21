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
  /** Where the founder fixes it, when the tool says (e.g. a page to accept a data provider's terms). */
  fixUrl?: string;
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

export interface CrmAdapter {
  upsertCompany(company: CompanyInput, knownId?: string): Promise<Result<ExternalRef>>;
  upsertPerson(person: PersonInput, company?: ExternalRef, knownId?: string): Promise<Result<ExternalRef>>;
  upsertDeal(deal: DealInput, company: ExternalRef, people: ExternalRef[], knownId?: string): Promise<Result<ExternalRef>>;
  addNote?(parent: ExternalRef, title: string, markdown: string): Promise<Result<ExternalRef>>;
  listPipelines(): Promise<Result<Pipeline[]>>;
  /** Most recently updated companies that have a domain. */
  pullCompanies(limit: number): Promise<Result<CompanyInput[]>>;
}

export interface SequencerAdapter {
  listCampaigns(): Promise<Result<Campaign[]>>;
  pushLead(campaignId: string, lead: LeadInput): Promise<Result<{ externalId?: string }>>;
  /** Registers our inbound URL for reply events, where the tool's API allows it. */
  registerReplyWebhook?(url: string): Promise<Result<{ webhookId: string }>>;
}

export interface NotifyAdapter {
  post(message: { text: string; blocks?: unknown[] }): Promise<Result<void>>;
}

/** A search hit before anything is paid for: first name and a masked surname. */
export interface PersonPreview {
  /** The provider's id, which `add` takes. */
  id: string;
  firstName: string;
  /** Masked by the provider ("S•••") until the person is added. */
  lastName: string;
  title: string;
  companyName?: string;
  hasEmail: boolean;
}

export interface FoundEmail {
  address: string;
  /** The provider checked the mailbox (Apollo "verified", FullEnrich "DELIVERABLE"). Anything less is a guess. */
  verified: boolean;
  /** The provider's own word for it, kept for the record. */
  status: string;
}

export interface FoundPerson {
  id: string;
  name: string;
  title: string;
  linkedinUrl?: string;
  location?: string;
  /** The employer the provider has on file, to catch people who moved on. */
  companyDomain?: string;
  email?: FoundEmail;
}

/** Paid calls report what they cost; a miss costs nothing. */
export interface Billed<T> {
  value: T;
  credits: number;
}

export interface PeopleAdapter {
  /** Free. People at a company whose title matches any of `titles`. */
  search(q: { domain: string; titles: string[]; perPage?: number }): Promise<Result<Billed<{ people: PersonPreview[]; total?: number }>>>;
  /** Paid on a match: full name, LinkedIn and a work email from a search hit. Never personal email or phone. */
  add(id: string): Promise<Result<Billed<FoundPerson | null>>>;
  /** Paid only when found: a work email from a LinkedIn URL, or a name plus employer. */
  workEmail(q: { linkedinUrl?: string; firstName?: string; lastName?: string; domain?: string; companyName?: string }): Promise<Result<Billed<FoundEmail | null>>>;
  /** Credits left on the Firecrawl team this billing period. */
  credits(): Promise<Result<{ remaining: number; plan?: number }>>;
}

export interface Connector {
  id: NativeConnectorId;
  name: string;
  /** One cheap read that proves the key works. `config` holds non-secret facts worth keeping (portal id, ui domain). */
  validate(): Promise<Result<{ accountLabel: string; config?: Record<string, string | number> }>>;
  crm?: CrmAdapter;
  sequencer?: SequencerAdapter;
  notify?: NotifyAdapter;
  people?: PeopleAdapter;
}

export type ConnectorFactory = (secret: string, config: ConnectorConfig) => Connector;
