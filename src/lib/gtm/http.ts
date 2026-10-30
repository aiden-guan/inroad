import "server-only";
import { ZodError } from "zod";
import { InitiativeError } from "./initiatives";

export function initiativeFailure(error: unknown): Response {
  return Response.json({ error: error instanceof InitiativeError ? error.message : error instanceof ZodError ? error.issues.map((i) => `${i.path.join(".") || "Input"}: ${i.message}`).join("; ") : "Couldn't save this initiative. Try again." }, { status: error instanceof InitiativeError ? error.status : 400 });
}
