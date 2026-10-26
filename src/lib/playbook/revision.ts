import type { Foundation, FoundationRevision, FoundationVersion, ICPCriterion, ID, RevisionTarget, Workspace } from "@/lib/domain/types";

/**
 * Tracked changes to the playbook (SPEC W1c refresh, W9 monthly). A refresh proposes each change as a revision with
 * its before and after; nothing applies until the founder accepts it. The first accepted change from a refresh keeps
 * the version it replaces in `foundationHistory` (the last 10), so a whole refresh can be undone with one restore.
 * Pure: the reducer runs it in the browser and on the server.
 */

export const HISTORY_MAX = 10;

const SECTION: Record<RevisionTarget, FoundationRevision["section"]> = {
  "positioning.category": "positioning",
  "positioning.bestFit": "positioning",
  "icp.sentence": "icp",
  "icp.segment": "icp",
  "icp.criterion": "icp",
  "icp.antiIcp": "icp",
  "persona.line": "personas",
  "persona.pain": "personas",
  "messaging.oneLiner": "messaging",
  "messaging.customerWords": "messaging",
};

/** Which operations make sense on each target. Anything else is dropped before it reaches the founder. */
const OPS: Record<RevisionTarget, FoundationRevision["op"][]> = {
  "positioning.category": ["set"],
  "positioning.bestFit": ["add", "remove"],
  "icp.sentence": ["set"],
  "icp.segment": ["set"],
  "icp.criterion": ["add", "remove", "validate"],
  "icp.antiIcp": ["add"],
  "persona.line": ["set"],
  "persona.pain": ["add"],
  "messaging.oneLiner": ["set"],
  "messaging.customerWords": ["add"],
};

const LABEL: Record<RevisionTarget, string> = {
  "positioning.category": "Category",
  "positioning.bestFit": "Best-fit customers",
  "icp.sentence": "The ICP bet",
  "icp.segment": "Segment",
  "icp.criterion": "ICP criteria",
  "icp.antiIcp": "Not a fit",
  "persona.line": "How to talk to",
  "persona.pain": "Pains",
  "messaging.oneLiner": "One-liner",
  "messaging.customerWords": "Customer words",
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => norm(a).toLowerCase() === norm(b).toLowerCase();

function persona(f: Foundation, id: ID | undefined) {
  return id ? f.personas.find((p) => p.id === id) : undefined;
}
function criterion(f: Foundation, id: ID | undefined) {
  return id ? f.icp.criteria.find((c) => c.id === id) : undefined;
}

/** What the playbook says now at a revision's target, as text. Undefined when the target is gone. */
export function currentText(f: Foundation, r: Pick<FoundationRevision, "target" | "op" | "refId" | "text">): string | undefined {
  switch (r.target) {
    case "positioning.category":
      return f.positioning.category.name;
    case "positioning.bestFit":
      return r.op === "remove" ? f.positioning.bestFit.find((b) => same(b, r.text ?? "")) : "";
    case "icp.sentence":
      return f.icp.hypothesis.sentence;
    case "icp.segment":
      return f.icp.primarySegment;
    case "icp.criterion": {
      if (r.op === "add") return "";
      const c = criterion(f, r.refId);
      return c ? (r.op === "validate" ? `${c.text} (${c.status})` : c.text) : undefined;
    }
    case "icp.antiIcp":
    case "messaging.customerWords":
      return "";
    case "persona.line":
      return persona(f, r.refId)?.line;
    case "persona.pain":
      return persona(f, r.refId) ? "" : undefined;
    case "messaging.oneLiner":
      return f.messaging.oneLiner;
  }
}

/** The label a revision shows: "The ICP bet", "How to talk to: Controller". */
export function revisionLabel(f: Foundation | null, r: FoundationRevision): string {
  if ((r.target === "persona.line" || r.target === "persona.pain") && f) {
    const p = persona(f, r.refId);
    if (p) return `${LABEL[r.target]}: ${p.titles[0] ?? p.role.replace(/_/g, " ")}`;
  }
  if (r.target === "icp.criterion") return r.op === "add" ? "New ICP criterion" : r.op === "remove" ? "Drop an ICP criterion" : "Mark a criterion validated";
  if (r.target === "positioning.bestFit") return r.op === "add" ? "Add to best-fit customers" : "Drop from best-fit customers";
  return LABEL[r.target];
}

/**
 * A proposed change, checked against today's playbook: the target and operation must make sense, a referenced
 * persona or criterion must exist, and the change must change something. Returns null otherwise.
 */
export function buildRevision(
  f: Foundation,
  c: { target: RevisionTarget; op: FoundationRevision["op"]; refId?: ID; text?: string | null; reason?: string | null; criterion?: FoundationRevision["criterion"] },
): FoundationRevision | null {
  if (!OPS[c.target]?.includes(c.op)) return null;
  const text = c.text ? norm(c.text) : "";
  const needsText = c.op === "set" || c.op === "add" || (c.target === "positioning.bestFit" && c.op === "remove");
  if (needsText && !text) return null;
  const before = currentText(f, { ...c, text });
  if (before === undefined) return null;
  let after = text;
  switch (c.target) {
    case "positioning.bestFit":
      if (c.op === "add" && f.positioning.bestFit.some((b) => same(b, text))) return null;
      if (c.op === "remove") after = "";
      break;
    case "icp.criterion": {
      const existing = criterion(f, c.refId);
      if (c.op === "add") {
        if (!c.criterion || f.icp.criteria.some((x) => same(x.text, text))) return null;
      } else if (c.op === "validate") {
        if (!existing || existing.status === "validated") return null;
        after = `${existing.text} (validated)`;
      } else {
        after = "";
      }
      break;
    }
    case "icp.antiIcp":
      if (f.icp.antiIcp.some((a) => same(a.text, text))) return null;
      break;
    case "messaging.customerWords":
      if (f.messaging.customerWords.some((w) => same(w.phrase, text))) return null;
      break;
    case "persona.pain":
      if (persona(f, c.refId)?.pains.some((p) => same(p, text))) return null;
      break;
    default:
      if (same(before, text)) return null;
  }
  return {
    target: c.target,
    op: c.op,
    ...(c.refId ? { refId: c.refId } : {}),
    ...(text ? { text } : {}),
    ...(c.target === "icp.antiIcp" ? { reason: norm(c.reason ?? "") || "Seen in recent calls" } : {}),
    ...(c.target === "icp.criterion" && c.op === "add" ? { criterion: c.criterion } : {}),
    section: SECTION[c.target],
    before,
    after,
  };
}

/** True when the playbook moved on since the revision was written (the founder edited that part, or it's gone). */
export function revisionStale(f: Foundation | null, r: FoundationRevision): boolean {
  if (!f) return true;
  const now = currentText(f, r);
  return now === undefined || !same(now, r.before);
}

/** Criterion ids must match on both sides of the reducer, so they're derived from the text, not random. */
function criterionId(f: Foundation, text: string): ID {
  const base = `icp_r_${text.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24).replace(/^_|_$/g, "") || "criterion"}`;
  let id = base;
  for (let n = 2; f.icp.criteria.some((c) => c.id === id); n++) id = `${base}_${n}`;
  return id;
}

/** Applies one revision to the playbook. Throws when it no longer fits (the caller checks staleness first). */
export function applyRevision(f: Foundation, r: FoundationRevision): void {
  const text = r.text ?? "";
  switch (r.target) {
    case "positioning.category":
      f.positioning.category = { ...f.positioning.category, name: text };
      return;
    case "positioning.bestFit":
      f.positioning.bestFit = r.op === "add" ? [...f.positioning.bestFit, text] : f.positioning.bestFit.filter((b) => !same(b, text));
      return;
    case "icp.sentence":
      f.icp.hypothesis = { ...f.icp.hypothesis, sentence: text };
      return;
    case "icp.segment":
      f.icp.primarySegment = text;
      return;
    case "icp.criterion": {
      if (r.op === "add") {
        const c: ICPCriterion = {
          id: criterionId(f, text),
          text,
          kind: r.criterion?.kind ?? "situational",
          mustHave: r.criterion?.mustHave ?? false,
          detection: r.criterion?.detection ?? "founder_knowledge",
          status: "hypothesis",
          howToTest: r.criterion?.howToTest ?? "Check it on the next 25 touches and 5 calls.",
        };
        f.icp.criteria = [...f.icp.criteria, c];
        return;
      }
      const c = criterion(f, r.refId);
      if (!c) throw new Error("That criterion is gone");
      if (r.op === "remove") f.icp.criteria = f.icp.criteria.filter((x) => x.id !== c.id);
      else Object.assign(c, { status: "validated", howToTest: undefined });
      return;
    }
    case "icp.antiIcp":
      f.icp.antiIcp = [...f.icp.antiIcp, { text, reason: r.reason ?? "" }];
      return;
    case "persona.line":
    case "persona.pain": {
      const p = persona(f, r.refId);
      if (!p) throw new Error("That persona is gone");
      if (r.target === "persona.line") p.line = text;
      else p.pains = [...p.pains, text];
      return;
    }
    case "messaging.oneLiner":
      f.messaging = { ...f.messaging, oneLiner: text };
      return;
    case "messaging.customerWords":
      f.messaging = { ...f.messaging, customerWords: [...f.messaging.customerWords, { phrase: text, source: "call" }] };
      return;
  }
}

/** One line for the version history: "The ICP bet: 'Seed-stage fintechs…'". */
export function changeLine(f: Foundation | null, r: FoundationRevision): string {
  const label = revisionLabel(f, r);
  if (r.op === "remove") return `${label}: removed “${r.before || r.text}”`;
  if (r.op === "validate") return `${label}: “${r.before.replace(/ \((hypothesis|validated)\)$/, "")}”`;
  return `${label}: “${r.after}”`;
}

/** Keeps the playbook as it is now in the history, oldest first, capped at 10. */
export function keepVersion(ws: Workspace, entry: Omit<FoundationVersion, "snapshot">) {
  const f = ws.foundation!;
  ws.foundationHistory = [...(ws.foundationHistory ?? []), { ...entry, snapshot: structuredClone(f) }].slice(-HISTORY_MAX);
}

/**
 * Applies an accepted revision. The first change a refresh run makes starts a new version (the old one goes into
 * the history); later changes from the same run join that version, so one restore undoes the whole refresh.
 */
export function reviseFoundation(ws: Workspace, a: { revision: FoundationRevision; source: FoundationVersion["source"]; runId?: ID; at: string }): void {
  const f = ws.foundation;
  if (!f) throw new Error("Playbook not found");
  const last = ws.foundationHistory?.at(-1);
  const sameRun = !!a.runId && last?.runId === a.runId && last.version === f.version - 1;
  if (!sameRun) {
    keepVersion(ws, { version: f.version, at: a.at, changes: [], source: a.source, runId: a.runId });
    f.version += 1;
  }
  applyRevision(f, a.revision);
  f.revisedAt = a.at;
  ws.foundationHistory!.at(-1)!.changes.push(changeLine(f, a.revision));
}

/**
 * Brings back an earlier version as a new one (the current version goes into the history first, so a restore can be
 * undone too). What happened since stays: the segment-bet record and the founder's answers aren't part of the bet.
 */
export function restoreFoundation(ws: Workspace, version: number, at: string): void {
  const f = ws.foundation;
  const old = ws.foundationHistory?.find((v) => v.version === version);
  if (!f || !old) throw new Error("Version not found");
  keepVersion(ws, { version: f.version, at, changes: [`Restored v${version}`], source: "restore" });
  const next = structuredClone(old.snapshot);
  next.version = f.version + 1;
  next.revisedAt = at;
  next.icp.betHistory = f.icp.betHistory;
  next.icp.segmentLockedAt = f.icp.segmentLockedAt;
  const answered = new Map(f.founderQuestions.filter((q) => q.answer).map((q) => [q.id, q]));
  next.founderQuestions = [...next.founderQuestions.map((q) => answered.get(q.id) ?? q), ...[...answered.values()].filter((q) => !next.founderQuestions.some((x) => x.id === q.id))];
  ws.foundation = next;
}
