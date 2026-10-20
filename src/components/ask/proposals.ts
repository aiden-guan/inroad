import type { Action } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Account, AskProposal, Deal, ObjectionCard, Person, Stage, WorkflowId, Workspace } from "@/lib/domain/types";

/**
 * Turns an Ask proposal into the founder actions that apply it. Runs only when the founder clicks Apply.
 * Payloads were validated on the server; this re-checks against the current workspace, which may have moved on.
 * Returns null when the proposal no longer applies cleanly.
 */

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function newAccount(domain: string, name?: string): Account {
  return {
    domain,
    name: name ?? domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
    status: "new",
    source: "manual",
    sourceDetail: "Ask",
    addedAt: nowISO(),
    fitScore: 0,
    tier: "C",
    criteria: [],
    signals: [],
    whyNow: null,
    whyNowScore: 0,
    peopleIds: [],
    warmPathCount: 0,
    watch: false,
  };
}

function openDeal(ws: Workspace, domain: string): Deal | undefined {
  return Object.values(ws.deals).find((d) => d.accountDomain === domain && ["talking", "qualified", "pilot", "proposal"].includes(d.stage));
}

export function proposalActions(p: AskProposal, ws: Workspace): Action[] | null {
  const at = nowISO();
  const x = p.payload;
  switch (p.kind) {
    case "track_account": {
      const domain = str(x.domain);
      if (!domain) return null;
      const acc = ws.accounts[domain];
      return [...(acc ? [] : [{ type: "account.add", account: newAccount(domain, str(x.name)) } as Action]), { type: "account.track", domain, watch: true }];
    }
    case "create_deal": {
      const domain = str(x.domain);
      if (!domain || openDeal(ws, domain)) return null;
      const acc = ws.accounts[domain];
      const stage: Stage = x.stage === "qualified" ? "qualified" : "talking";
      const deal: Deal = {
        id: newId("deal"),
        accountDomain: domain,
        name: str(x.name) ?? acc?.name ?? domain,
        stage,
        stageHistory: [{ stage, at }],
        source: (str(x.source) as Deal["source"]) ?? "network",
        contacts: (acc?.peopleIds ?? []).slice(0, 6).map((personId) => ({ personId, role: ws.people[personId]?.role })),
        meetingIds: [],
        createdAt: at,
        updatedAt: at,
        lastActivityAt: at,
      };
      return [...(acc ? [] : [{ type: "account.add", account: newAccount(domain) } as Action]), { type: "deal.create", deal }];
    }
    case "set_next_step": {
      const deal = ws.deals[str(x.dealId) ?? ""];
      const what = str(x.what);
      const date = str(x.date);
      if (!deal || !what || !date) return null;
      return [{ type: "deal.setNextStep", id: deal.id, nextStep: { what, date, buyerAgreed: x.buyerAgreed === true }, at }];
    }
    case "change_stage": {
      const deal = ws.deals[str(x.dealId) ?? ""];
      const stage = str(x.stage) as Stage | undefined;
      if (!deal || !stage || deal.stage === stage) return null;
      return [{ type: "deal.setStage", id: deal.id, stage, at, lossReason: str(x.lossReason) as Deal["lossReason"], nurtureUntil: str(x.nurtureUntil) }];
    }
    case "add_task": {
      const deal = ws.deals[str(x.dealId) ?? ""];
      const what = str(x.what);
      if (!deal || !what) return null;
      const task = { id: newId("task"), what, due: str(x.due), owner: x.owner === "buyer" ? ("buyer" as const) : ("founder" as const), done: false };
      return [{ type: "deal.update", id: deal.id, patch: { tasks: [...(deal.tasks ?? []), task] }, at }];
    }
    case "add_person": {
      const domain = str(x.domain);
      const name = str(x.name);
      const title = str(x.title);
      if (!domain || !name || !title) return null;
      if (Object.values(ws.people).some((p) => p.accountDomain === domain && p.name.toLowerCase() === name.toLowerCase())) return null;
      const email = str(x.email);
      const linkedinUrl = str(x.linkedinUrl);
      // Set by the server for people found by web search, so the founder can open the page they came from.
      const sourceUrl = str(x.sourceUrl);
      const person: Person = {
        id: newId("per"),
        accountDomain: domain,
        name,
        title,
        role: str(x.role) as Person["role"],
        email,
        linkedinUrl,
        evidenceIds: [],
        confidence: x.sourced === "web" ? "low" : "medium",
        mayHaveLeft: false,
        contactPaths: [
          ...(email ? [{ kind: "published_email" as const, value: email, verified: false, founderConfirmed: true }] : []),
          ...(linkedinUrl ? [{ kind: "linkedin" as const, value: linkedinUrl, verified: false, founderConfirmed: true }] : []),
        ],
        jurisdiction: "unknown",
        doNotContact: false,
        source: "manual",
        notes: sourceUrl ? `Found on the web: ${sourceUrl}` : undefined,
      };
      const actions: Action[] = [];
      if (!ws.accounts[domain]) actions.push({ type: "account.add", account: newAccount(domain) });
      actions.push({ type: "person.upsert", person });
      const deal = openDeal(ws, domain);
      if (deal) actions.push({ type: "deal.update", id: deal.id, patch: { contacts: [...deal.contacts, { personId: person.id, role: person.role }] }, at });
      return actions;
    }
    case "add_pov": {
      const text = str(x.text);
      if (!text) return null;
      return [{ type: "pov.upsert", pov: { id: newId("pov"), text, evidence: str(x.basis) ?? "From an Ask conversation", createdAt: at, uses: 0 } }];
    }
    case "add_claim": {
      const text = str(x.text);
      if (!text) return null;
      // Saved unapproved: outbound can't use it until the founder approves it in Playbook.
      return [{ type: "claim.upsert", claim: { id: newId("cl"), text, kind: (str(x.claimKind) as never) ?? "capability", evidenceIds: [], approved: false, permission: "public", createdAt: at } }];
    }
    case "add_objection": {
      const objection = str(x.objection);
      if (!objection) return null;
      const card: ObjectionCard = {
        id: newId("obj"),
        objection,
        category: (str(x.category) as ObjectionCard["category"]) ?? "priority",
        underlyingConcern: "",
        clarifyingQ: "",
        response: str(x.response) ?? "",
        walkAwayIf: "",
        approved: false,
        timesHeard: 1,
        lastHeard: todayISO(),
      };
      return [{ type: "objection.upsert", objection: card }];
    }
    case "suppress": {
      const email = str(x.email);
      const domain = str(x.domain);
      if (!email && !domain) return null;
      return [{ type: "suppression.add", entry: { id: newId("sup"), email, domain, reason: (str(x.reason) as never) ?? "manual", at } }];
    }
    case "start_workflow":
      return null;
  }
}

export function workflowOf(p: AskProposal): { workflow: WorkflowId; args: Record<string, unknown> } | null {
  if (p.kind !== "start_workflow") return null;
  const workflow = str(p.payload.workflow) as WorkflowId | undefined;
  const args = p.payload.args;
  if (!workflow || !args || typeof args !== "object") return null;
  return { workflow, args: args as Record<string, unknown> };
}

/** Where to look after applying, when it's somewhere else. */
export function hrefAfter(p: AskProposal, ws: Workspace): string | undefined {
  const x = p.payload;
  const domain = str(x.domain) ?? (str(x.dealId) ? ws.deals[str(x.dealId)!]?.accountDomain : undefined);
  switch (p.kind) {
    case "track_account":
    case "create_deal":
    case "add_person":
    case "set_next_step":
    case "change_stage":
    case "add_task":
      return domain ? `/companies?c=${encodeURIComponent(domain)}` : undefined;
    case "add_pov":
    case "add_claim":
    case "add_objection":
      return "/playbook";
    case "start_workflow": {
      const w = workflowOf(p);
      if (w?.workflow === "dinner_plan" && typeof w.args.eventId === "string") return `/events/${w.args.eventId}`;
      const d = typeof w?.args.domain === "string" ? w.args.domain : typeof w?.args.dealId === "string" ? ws.deals[w.args.dealId]?.accountDomain : undefined;
      return d ? `/companies?c=${encodeURIComponent(d)}` : w?.workflow === "discovery" ? "/companies?view=prospects" : w?.workflow === "review" ? "/today" : undefined;
    }
    default:
      return undefined;
  }
}

/** Typical cost of a workflow from this workspace's own receipts (needs two or more). */
export function typicalCost(ws: Workspace, workflow: WorkflowId): number | null {
  const costs = ws.runs.filter((r) => r.workflow === workflow && r.status === "done" && r.receipt).slice(0, 10).map((r) => r.receipt!.costUsd);
  if (costs.length < 2) return null;
  costs.sort((a, b) => a - b);
  return costs[Math.floor(costs.length / 2)];
}
