import "server-only";
import path from "node:path";
import { readDataFile, writeDataFile } from "./data-file";
import { FileDB, singletonDB } from "./file-db";
import { DATA_DIR } from "./settings";
import { addDays, nowISO, todayISO } from "@/lib/domain/ids";
import type { IntegrationId, Workspace } from "@/lib/domain/types";

export function emptyWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    rev: 0,
    createdAt: nowISO(),
    onboarding: { status: "new" },
    founder: { name: "" },
    company: null,
    foundation: null,
    claims: [],
    objections: [],
    povs: [],
    assets: [],
    voice: null,
    sender: null,
    goal: {
      target: 5,
      targetLabel: "paid pilots or design partners",
      byDate: addDays(todayISO(), 12 * 7),
      longArcCustomers: 20,
      winRate: 0.25,
      discoveryToQualified: 0.5,
      meetingRate: 0.04,
      conversationsPerWeek: 10,
    },
    caps: { firstTouchesPerWeek: 25, firstTouchesPerDayMax: 20, contactsPerAccountPerWeek: 2, monthlyBudgetUsd: 100 },
    connectors: [],
    intros: {},
    evidence: {},
    accounts: {},
    people: {},
    deals: {},
    meetings: {},
    outreach: {},
    activities: [],
    moves: {},
    briefs: {},
    events: {},
    integrations: {},
    webhooks: [],
    suppression: [],
    runs: [],
    usage: {},
  };
}

/** Fills in fields added after a workspace was created, so older files (and restored backups) keep loading. */
export function migrateWorkspace(raw: unknown): Workspace {
  const base = emptyWorkspace();
  const ws = { ...base, ...(raw as Partial<Workspace>) } as Workspace;
  ws.goal = { ...base.goal, ...ws.goal };
  ws.caps = { ...base.caps, ...ws.caps };
  return ws;
}

const db = () => singletonDB<Workspace>("workspace.json", () => new FileDB("workspace.json", emptyWorkspace, migrateWorkspace));

export function readWorkspace(): Workspace {
  return db().read();
}

/** Serialized, atomic mutation. Bumps `rev` so clients can tell they're stale. */
export async function mutateWorkspace<R = void>(fn: (ws: Workspace) => R): Promise<{ ws: Workspace; value: R }> {
  const { state, value } = await db().update((draft) => {
    const value = fn(draft);
    draft.rev += 1;
    return value;
  });
  return { ws: state, value };
}

/** True when the workspace holds the founder's own work (not the sample, past the empty first run). */
export function holdsRealWork(ws: Workspace = readWorkspace()): boolean {
  if (ws.sample) return false;
  return ws.onboarding.status !== "new" || ws.company !== null || Object.keys(ws.accounts).length > 0;
}

export async function replaceWorkspace(ws: Workspace): Promise<Workspace> {
  return db().replace({ ...ws, rev: (readWorkspace().rev ?? 0) + 1 });
}

/** What the browser receives: everything except bulky internals. */
export function publicWorkspace(ws: Workspace): Workspace {
  return ws;
}

/* ───────────── Integration secrets: kept out of workspace.json and never sent to the browser ───────────── */

const SECRETS_FILE = path.join(DATA_DIR, "secrets.json");
type Secrets = Partial<Record<IntegrationId | "hub", Record<string, string>>>;

/** Missing file → {}. A corrupt one throws, so setSecrets can't save over the other keys. */
export function readSecrets(): Secrets {
  return readDataFile<Secrets>(SECRETS_FILE, () => ({}));
}

export function getSecret(id: IntegrationId | "hub", key: string): string | undefined {
  return readSecrets()[id]?.[key];
}

export function setSecrets(id: IntegrationId | "hub", values: Record<string, string | null>) {
  const all = readSecrets();
  const current = { ...(all[id] ?? {}) };
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === "") delete current[k];
    else current[k] = v;
  }
  all[id] = current;
  writeDataFile(SECRETS_FILE, all);
}

/** Which secret keys are set, for showing "Connected" without exposing values. */
export function secretKeysSet(id: IntegrationId | "hub"): string[] {
  return Object.keys(readSecrets()[id] ?? {});
}
