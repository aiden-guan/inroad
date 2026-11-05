import type { Workspace } from "@/lib/domain/types";
import type { VoiceBattlecard } from "./types";

/**
 * The two founder actions Buyer voice adds to the reducer (src/lib/domain/actions.ts). Drafts and names are written
 * by the workflow on the server; the founder only marks a draft saved and sets one aside, each undoable. Unknown
 * keys are a no-op, since two tabs may act on the same draft.
 */

export function markBattlecardSaved(ws: Workspace, key: string, saved: VoiceBattlecard["saved"] | null): void {
  const card = ws.buyerVoice?.battlecards?.[key];
  if (!card) return;
  if (saved) card.saved = saved;
  else delete card.saved;
}

/** Sets a draft aside (or brings it back with null), so dismissing is undoable; a redraft replaces it. */
export function dismissBattlecard(ws: Workspace, key: string, at: string | null): void {
  const card = ws.buyerVoice?.battlecards?.[key];
  if (!card) return;
  if (at) card.dismissedAt = at;
  else delete card.dismissedAt;
}
