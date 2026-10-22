import "server-only";
import type { ID, Person, RunStep } from "@/lib/domain/types";
import { mutateNetwork, readConnections, readNetwork, updateConnections } from "@/lib/network/store";
import { FileDB, singletonDB } from "@/lib/store/file-db";
import { connectionIsPerson, forgetInImports, redactRunSteps } from "./forget";

/**
 * The part of "Delete their details" that lives outside workspace.json: their row in the founder's
 * LinkedIn connections (a re-import brings it back from LinkedIn's file, but nothing here keeps it),
 * the import history in network.json, and their name in the step logs of runs about them.
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

export async function forgetInFiles({ person, company, runIds }: ForgottenPerson): Promise<{ connections: number }> {
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
  return { connections };
}
