import "server-only";
import type { Action } from "@/lib/domain/actions";
import type { HubEventType, Workspace } from "@/lib/domain/types";
import { readWorkspace } from "@/lib/store/workspace";
import { emitHubEvent } from "./events";
import { accountData, activityData, dealData, draftData, personData } from "./payloads";

/**
 * Side effects after founder actions (POST /api/workspace/actions): map each action to hub events
 * and deliver them to outbound webhooks, CRM write-back and Slack. `ws` is the state after all
 * actions applied. Called fire-and-forget; never throws.
 */

type Emit = { type: HubEventType; data: Record<string, unknown> };
type Approval = Extract<Action, { type: "outreach.approveStep" }>;

const UNDO_WINDOW_MS = 11_000; // the composer's Undo toast lasts 10s
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toEvents(action: Action, ws: Workspace): Emit[] {
  switch (action.type) {
    case "outreach.approveStep": {
      const pkg = ws.outreach[action.packageId];
      const step = pkg?.steps.find((s) => s.step === action.step);
      if (!pkg || !step) return [];
      const base = { person: personData(ws, pkg.personId), account: accountData(ws, pkg.accountDomain) };
      const activity = ws.activities.find((a) => a.id === action.activityId);
      return [
        { type: "draft.approved", data: { draft: draftData(pkg, step), ...base } },
        ...(activity ? [{ type: "touch.sent" as const, data: { activity: activityData(activity), draft: draftData(pkg, step), ...base } }] : []),
      ];
    }
    case "activity.log": {
      const a = action.activity;
      const base = { activity: activityData(a), person: personData(ws, a.personId), account: accountData(ws, a.accountDomain), deal: dealData(ws, a.dealId) };
      if (a.kind === "reply_received") return [{ type: "reply.logged", data: { ...base, __activity: a } }];
      if (a.kind === "touch_sent" || a.kind === "linkedin_dm" || a.kind === "intro_requested") return [{ type: "touch.sent", data: base }];
      return [];
    }
    case "deal.create": {
      const d = ws.deals[action.deal.id];
      if (!d) return [];
      return [{ type: "deal.created", data: { deal: dealData(ws, d.id), account: accountData(ws, d.accountDomain) } }];
    }
    case "deal.setStage": {
      const d = ws.deals[action.id];
      if (!d) return [];
      const from = d.stageHistory.length > 1 ? d.stageHistory[d.stageHistory.length - 2].stage : null;
      if (from === action.stage) return [];
      return [
        {
          type: "deal.stage_changed",
          data: { deal: dealData(ws, d.id), from, to: action.stage, loss_reason: d.lossReason ?? null, account: accountData(ws, d.accountDomain) },
        },
      ];
    }
    case "account.add":
      return ws.accounts[action.account.domain] ? [{ type: "account.added", data: { account: accountData(ws, action.account.domain) } }] : [];
    case "account.track":
      return action.watch ? [{ type: "account.tracked", data: { account: accountData(ws, action.domain) } }] : [];
    default:
      return [];
  }
}

const emitAll = (events: Emit[]) => Promise.allSettled(events.map((e) => emitHubEvent(e.type, e.data, { origin: "founder" })));

/** "Mark as sent" can be undone for 10s, so its events wait that out and go only if the approval stands. */
async function emitApprovalsAfterUndo(approvals: Approval[]): Promise<void> {
  await sleep(UNDO_WINDOW_MS);
  const fresh = readWorkspace();
  // Undo removes the approval's activity.
  const kept = approvals.filter((a) => fresh.activities.some((x) => x.id === a.activityId));
  await emitAll(kept.flatMap((a) => toEvents(a, fresh)));
}

export async function afterActions(actions: Action[], ws: Workspace): Promise<void> {
  try {
    const approvals = actions.filter((a): a is Approval => a.type === "outreach.approveStep");
    const events = actions.filter((a) => a.type !== "outreach.approveStep").flatMap((a) => toEvents(a, ws));
    if (!events.length && !approvals.length) return;
    // In parallel: a slow webhook must not hold back the others. CRM syncs serialize themselves.
    await Promise.allSettled([emitAll(events), ...(approvals.length ? [emitApprovalsAfterUndo(approvals)] : [])]);
  } catch (err) {
    console.error("[hub] afterActions", err);
  }
}
