import type { Action } from "@/lib/domain/actions";
import { newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { ReviewProposal, Workspace } from "@/lib/domain/types";

/**
 * Turns a review proposal into the founder actions that apply it. The review never applies anything
 * itself; this runs only when the founder clicks Apply. Returns null when it can't apply cleanly.
 */
export function proposalActions(p: ReviewProposal, ws: Workspace, date: string): Action[] | null {
  const at = nowISO();
  const mark: Action = { type: "brief.setProposal", date, proposalId: p.id, status: "applied", at };
  switch (p.kind) {
    case "close_lost":
      if (!p.dealId || !ws.deals[p.dealId]) return null;
      return [{ type: "deal.setStage", id: p.dealId, stage: "lost", lossReason: p.lossReason ?? "went_dark", at }, mark];
    case "nurture":
      if (!p.dealId || !ws.deals[p.dealId]) return null;
      return [{ type: "deal.setStage", id: p.dealId, stage: "nurture", nurtureUntil: p.nurtureUntil, at }, mark];
    case "add_pov":
      if (!p.text) return null;
      return [{ type: "pov.upsert", pov: { id: newId("pov"), text: p.text, evidence: p.justification?.[0] ?? `From the ${date} learning review`, createdAt: at, uses: 0 } }, mark];
    case "add_objection":
      if (!p.text) return null;
      return [
        {
          type: "objection.upsert",
          objection: {
            id: newId("obj"),
            objection: p.text,
            category: p.objectionCategory ?? "priority",
            underlyingConcern: "",
            clarifyingQ: "",
            response: "",
            walkAwayIf: "",
            approved: false,
            timesHeard: 1,
            lastHeard: todayISO(),
          },
        },
        mark,
      ];
    case "add_customer_words": {
      const f = ws.foundation;
      if (!f || !p.text) return null;
      return [{ type: "foundation.set", path: ["messaging", "customerWords"], value: [...f.messaging.customerWords, { phrase: p.text, source: "call" }] }, mark];
    }
    case "add_anti_icp": {
      const f = ws.foundation;
      if (!f || !p.text) return null;
      return [{ type: "foundation.set", path: ["icp", "antiIcp"], value: [...f.icp.antiIcp, { text: p.text, reason: p.detail }] }, mark];
    }
    case "add_banned_word": {
      const f = ws.foundation;
      if (!f || !p.text) return null;
      return [{ type: "foundation.set", path: ["messaging", "bannedWords"], value: [...new Set([...f.messaging.bannedWords, p.text])] }, mark];
    }
    case "message_bet":
    case "note":
      return [mark];
  }
}

export function applyLabel(p: ReviewProposal): string {
  switch (p.kind) {
    case "close_lost":
      return "Close as lost";
    case "nurture":
      return "Move to nurture";
    case "add_pov":
      return "Add to POV bank";
    case "add_objection":
      return "Add to objections";
    case "add_customer_words":
      return "Add to customer words";
    case "add_anti_icp":
      return "Add to anti-ICP";
    case "add_banned_word":
      return "Ban the word";
    case "message_bet":
      return "Start this bet";
    case "note":
      return "Got it";
  }
}
