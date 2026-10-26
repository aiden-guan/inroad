"use client";

import { createContext, useContext } from "react";
import type { RunState } from "@/components/providers/runs-provider";
import type { Action } from "@/lib/domain/actions";
import type { Foundation, Workspace } from "@/lib/domain/types";
import type { AssetKind, parts } from "./model";

export interface AssetRunArgs {
  kind: AssetKind;
  title?: string;
  brief?: string;
  dealId?: string;
  /** creator_brief: the creator it's for. */
  partnerId?: string;
  assetId: string;
}

export interface PlaybookContextValue {
  ws: Workspace;
  f: Foundation;
  p: ReturnType<typeof parts>;
  /** Local date, fixed for the session (render stays pure). */
  today: string;
  dispatch: (actions: Action | Action[]) => Promise<boolean>;
  /** Shorthand for `foundation.set`. */
  set: (path: (string | number)[], value: unknown) => void;
  /** Asset runs this session (live or just finished), newest first. */
  assetRuns: RunState[];
  draftAsset: (args: AssetRunArgs) => Promise<boolean>;
  openAsk: (section: string) => void;
  /** The asset expanded in the library (also driven by `?asset=`). */
  openAsset: string | null;
  setOpenAsset: (id: string | null) => void;
  /** The "new asset" panel (also driven by `?new=<kind>&deal=<id>`). */
  composer: { kind: AssetKind; dealId?: string; partnerId?: string } | null;
  setComposer: (next: { kind: AssetKind; dealId?: string; partnerId?: string } | null) => void;
}

export const PlaybookContext = createContext<PlaybookContextValue | null>(null);

export function usePlaybook(): PlaybookContextValue {
  const ctx = useContext(PlaybookContext);
  if (!ctx) throw new Error("usePlaybook must be used inside the Playbook");
  return ctx;
}
