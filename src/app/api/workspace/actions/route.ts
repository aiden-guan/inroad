import { applyAction, type Action } from "@/lib/domain/actions";
import { afterActions } from "@/lib/hub/after-actions";
import { namesakesOf, runsAbout } from "@/lib/people/forget";
import { forgetInFiles, type ForgottenPerson } from "@/lib/people/forget-files";
import { errorResponse, readJSON } from "@/lib/server/http";
import { mutateWorkspace, publicWorkspace } from "@/lib/store/workspace";

/** Applies founder actions atomically, in order. Returns the new workspace. */
export async function POST(request: Request) {
  try {
    const body = await readJSON<{ actions?: Action[] }>(request);
    const actions = Array.isArray(body.actions) ? body.actions : [];
    if (!actions.length) return Response.json({ error: "No actions." }, { status: 400 });
    // "Delete their details" also reaches files outside the workspace; note who, before the reducer scrubs them.
    const forgotten: ForgottenPerson[] = [];
    const { ws } = await mutateWorkspace((draft) => {
      for (const action of actions) {
        const person = action.type === "person.forget" ? draft.people[action.id] : undefined;
        if (person) forgotten.push({ person: structuredClone(person), company: draft.accounts[person.accountDomain]?.name, runIds: runsAbout(draft, person), namesake: namesakesOf(draft, person).length > 0 });
        applyAction(draft, action);
      }
    });
    for (const f of forgotten) await forgetInFiles(f);
    void afterActions(actions, ws);
    return Response.json(publicWorkspace(ws));
  } catch (err) {
    return errorResponse(err);
  }
}
