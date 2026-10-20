"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { EntityRef } from "@/lib/domain/types";

interface AskState {
  open: boolean;
  context?: EntityRef;
  prefill?: string;
  threadId?: string;
}

interface AskContextValue extends AskState {
  openAsk: (opts?: { context?: EntityRef; prefill?: string; threadId?: string }) => void;
  closeAsk: () => void;
}

const AskContext = createContext<AskContextValue | null>(null);

/** Global "Ask" window state, so any surface can open a conversation about what's on screen. */
export function AskProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AskState>({ open: false });
  const openAsk = useCallback((opts: { context?: EntityRef; prefill?: string; threadId?: string } = {}) => {
    // Never stack Ask on top of an open company sheet: hand the question to the sheet's Ask tab.
    const sheetOpen = typeof window !== "undefined" && window.location.pathname.startsWith("/companies") && new URLSearchParams(window.location.search).has("c");
    if (sheetOpen && !opts.threadId) {
      window.dispatchEvent(new CustomEvent("inroad:sheet-ask", { detail: { prefill: opts.prefill } }));
      return;
    }
    setState({ open: true, ...opts });
  }, []);
  const closeAsk = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const value = useMemo(() => ({ ...state, openAsk, closeAsk }), [state, openAsk, closeAsk]);
  return <AskContext.Provider value={value}>{children}</AskContext.Provider>;
}

export function useAsk(): AskContextValue {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useAsk must be used inside AskProvider");
  return ctx;
}
