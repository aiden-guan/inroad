import "server-only";
import { updateAutomation } from "@/lib/automation/store";
import { clearSearchCache } from "@/lib/search/search";
import type { ID, Person, RunStep, Workspace } from "@/lib/domain/types";
import { mutateHub, readHub } from "@/lib/hub/store";
import { mutateNetwork, readConnections, readNetwork, updateConnections } from "@/lib/network/store";
import { invalidate } from "@/lib/signals/cache";
import { githubOwnerKey } from "@/lib/signals/github";
import { personPodcastKeys } from "@/lib/signals/podcasts";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { rewriteThreads } from "@/lib/store/threads";
import { connectionIdentity, connectionIsPerson, forgetInImports, forgetInThread, hubRefsOf, namesPerson, redactRunSteps, threadMentions, wasForgotten } from "./forget";

/**
 * The part of "Delete their details" that lives outside workspace.json: their row in the founder's
 * LinkedIn connections (a re-import brings it back from LinkedIn's file, but nothing here keeps it),
 * the import history in network.json, their name in the step logs of runs about them (and their full
 * name in any other run's log, such as an Ask question that named them), the Ask
 * conversations that mention them (threads.json), the links to their CRM records (hub.json), and the
 * public lookups cached about them (podcast searches by their name, their GitHub profile).
 * Each file is only rewritten when something in it matches.
 */

export interface ForgottenPerson {
  person: Person;
  /** Their company's name, to match a connection row by name and company. */
  company?: string;
  /** Runs whose title named them (read before the workspace was scrubbed). */
  runIds: ID[];
  /** Someone else in the workspace has the same full name, so their name alone doesn't point at them. */
  namesake?: boolean;
}

// The same instance the run registry writes through (singletonDB is keyed by file name).
const stepsDB = () =>
  singletonDB<Record<string, RunStep[]>>("runs.json", () => new FileDB<Record<string, RunStep[]>>("runs.json", () => ({})));

export async function forgetInFiles({ person, company, runIds, namesake }: ForgottenPerson): Promise<{ connections: number; threads: number }> {
  let connections = 0;
  if (readConnections().some((r) => connectionIsPerson(r, person, company))) {
    connections = await updateConnections((rows) => {
      const before = rows.length;
      const kept = rows.filter((r) => !connectionIsPerson(r, person, company));
      rows.splice(0, rows.length, ...kept);
      return before - kept.length;
    });
  }
  const network = readNetwork();
  if (network.imports.some((b) => b.created.people.includes(person.id) || b.filled.some((f) => f.kind === "person" && f.id === person.id))) {
    await mutateNetwork((n) => void forgetInImports(n.imports, person.id));
  }
  try {
    // Runs about them, and (when the name is theirs alone) any other run whose log spells out their full name.
    const steps = stepsDB().read();
    const everywhere = !namesake;
    const hit = runIds.some((id) => steps[id]?.length) || (everywhere && Object.values(steps).some((list) => list.some((s) => namesPerson(s.text, person))));
    if (hit) await stepsDB().update((draft) => void redactRunSteps(draft, runIds, person, { everywhere }));
  } catch {
    // The step log is a nicety (see the run registry); an unreadable one holds nothing to redact.
  }
  const threads = await rewriteThreads(
    (t) => threadMentions(t, person, !namesake),
    (t) => forgetInThread(t, person, !namesake),
  );
  const refs = hubRefsOf(readHub().refs, person);
  if (refs.length) await mutateHub((h) => refs.forEach((k) => delete h.refs[k]));
  await updateAutomation((data) => {
    const mentions = (value: unknown) => {
      const text = JSON.stringify(value).toLowerCase();
      return (!namesake && namesPerson(text, person)) || (!!person.email && text.includes(person.email.toLowerCase())) || (!!person.linkedinUrl && text.includes(person.linkedinUrl.toLowerCase()));
    };
    const removed = new Set(data.monitors.filter(mentions).map((m) => m.id));
    data.monitors = data.monitors.filter((m) => !removed.has(m.id));
    data.observations = data.observations.filter((o) => !removed.has(o.monitorId) && !mentions(o));
    data.receipts = data.receipts.filter((r) => !mentions(r));
    data.sessions = data.sessions.filter((session) => !mentions(session));
  });
  clearSearchCache();
  forgetCachedLookups(person, company);
  return { connections, threads };
}

/** Public lookups made about them: podcast searches by their name, and their GitHub profile (a stargazer's notes link it). */
function forgetCachedLookups(person: Person, company: string | undefined) {
  for (const key of personPodcastKeys(person.name, company)) invalidate(key);
  const logins = new Set([...JSON.stringify(person).matchAll(/github\.com\/([A-Za-z0-9-]{1,39})(?![A-Za-z0-9-])/g)].map((m) => m[1]));
  for (const login of logins) invalidate(githubOwnerKey(login));
}

/** Drops LinkedIn connection rows of anyone who asked to be deleted (by address or fingerprint). Returns how many went. */
export async function forgetConnections(ws: Pick<Workspace, "suppression" | "forgotten">): Promise<number> {
  if (!readConnections().some((r) => wasForgotten(ws, connectionIdentity(r)))) return 0;
  return updateConnections((rows) => {
    const before = rows.length;
    const kept = rows.filter((r) => !wasForgotten(ws, connectionIdentity(r)));
    rows.splice(0, rows.length, ...kept);
    return before - kept.length;
  });
}
