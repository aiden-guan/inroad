import "server-only";
import type { ID, Person, RunStep, Workspace } from "@/lib/domain/types";
import { mutateHub, readHub } from "@/lib/hub/store";
import { mutateNetwork, readConnections, readNetwork, updateConnections } from "@/lib/network/store";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { rewriteThreads } from "@/lib/store/threads";
import { connectionIdentity, connectionIsPerson, forgetInImports, forgetInThread, hubRefsOf, redactRunSteps, threadMentions, wasForgotten } from "./forget";

/**
 * The part of "Delete their details" that lives outside workspace.json: their row in the founder's
 * LinkedIn connections (a re-import brings it back from LinkedIn's file, but nothing here keeps it),
 * the import history in network.json, their name in the step logs of runs about them, the Ask
 * conversations that mention them (threads.json), and the links to their CRM records (hub.json).
 * Each file is only rewritten when something in it matches.
 */

export interface ForgottenPerson {
  person: Person;
  /** Their company's name, to match a connection row by name and company. */
  company?: string;
  /** Runs whose title named them (read before the workspace was scrubbed). */
  runIds: ID[];
}

// The same instance the run registry writes through (singletonDB is keyed by file name).
const stepsDB = () =>
  singletonDB<Record<string, RunStep[]>>("runs.json", () => new FileDB<Record<string, RunStep[]>>("runs.json", () => ({})));

export async function forgetInFiles({ person, company, runIds }: ForgottenPerson): Promise<{ connections: number; threads: number }> {
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
  if (runIds.length) {
    try {
      const steps = stepsDB().read();
      if (runIds.some((id) => steps[id]?.length)) await stepsDB().update((draft) => void redactRunSteps(draft, runIds, person));
    } catch {
      // The step log is a nicety (see the run registry); an unreadable one holds nothing to redact.
    }
  }
  const threads = await rewriteThreads(
    (t) => threadMentions(t, person),
    (t) => forgetInThread(t, person),
  );
  const refs = hubRefsOf(readHub().refs, person);
  if (refs.length) await mutateHub((h) => refs.forEach((k) => delete h.refs[k]));
  return { connections, threads };
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
