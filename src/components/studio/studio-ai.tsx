"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ExternalLink, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import type { ClaudePlanStatus } from "@/lib/studio/claude-plan";

type Provider = "api" | "claude_plan";
const KEY = "inroad-studio-provider";
const CHANGE = "inroad-studio-provider-change";
function selected(): Provider { try { return localStorage.getItem(KEY) === "claude_plan" ? "claude_plan" : "api"; } catch { return "api"; } }
function subscribe(listener: () => void) { window.addEventListener("storage", listener); window.addEventListener(CHANGE, listener); return () => { window.removeEventListener("storage", listener); window.removeEventListener(CHANGE, listener); }; }
async function requestStatus(method = "GET"): Promise<ClaudePlanStatus> {
  const response = await fetch("/api/studio/claude", { method, cache: "no-store" });
  const status = await response.json();
  if (!response.ok) throw new Error(status.error ?? "Couldn't connect the Claude plan. Try again.");
  return status;
}
interface StudioAI {
  provider: Provider;
  setProvider: (provider: Provider) => void;
  claude: ClaudePlanStatus;
  ready: boolean;
  busy: boolean;
  error?: string;
  change: (method: "POST" | "DELETE") => void;
}
const Context = createContext<StudioAI | null>(null);

export function StudioAIProvider({ children }: { children: ReactNode }) {
  const provider = useSyncExternalStore(subscribe, selected, () => "api" as Provider);
  const [claude, setClaude] = useState<ClaudePlanStatus>({ available: true, connected: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const update = useCallback(async (method = "GET") => {
    try { const status = await requestStatus(method); setClaude(status); setError(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn't reach Claude."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    requestStatus().then((status) => { if (!cancelled) setClaude(status); }).catch((error: Error) => { if (!cancelled) setError(error.message); });
    const onFocus = () => void update(); window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, [update]);
  useEffect(() => { if (!claude.pending) return; const timer = setInterval(() => void update(), 2500); return () => clearInterval(timer); }, [claude.pending, update]);
  const setProvider = (value: Provider) => { try { localStorage.setItem(KEY, value); window.dispatchEvent(new Event(CHANGE)); } catch { setError("Allow local storage to save your Studio provider choice."); } };
  const change = (method: "POST" | "DELETE") => { setBusy(true); setError(undefined); void update(method); };
  return <Context.Provider value={{ provider, setProvider, claude, ready: provider === "api" || claude.connected, busy, error, change }}>{children}</Context.Provider>;
}

export function useStudioAI() { const context = useContext(Context); if (!context) throw new Error("Studio AI provider is missing."); return context; }

export function StudioAIChoice() {
  const { provider, setProvider, claude, busy, error, change } = useStudioAI();
  const plan = claude.plan ? claude.plan.charAt(0).toUpperCase() + claude.plan.slice(1) : "";
  return (
    <section aria-label="Studio AI choice" className="mt-5 rounded-lg bg-surface p-4 ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label htmlFor="studio-ai-provider" className="mb-0">Create with</Label>
        <select id="studio-ai-provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} className="h-9 max-w-full rounded-md bg-bg-subtle px-3 text-[13px] text-fg ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
          <option value="api">Configured AI provider</option>
          <option value="claude_plan">Claude plan</option>
        </select>
        {provider === "claude_plan" && (
          <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
            <span role="status" className="text-[12px] text-fg-2">{claude.connected ? `Claude connected${plan ? ` · ${plan}` : ""}` : claude.pending ? "Finish signing in to Claude" : "Connect your Claude plan"}</span>
            <Button size="sm" loading={busy} icon={claude.connected || claude.pending ? <LogOut aria-hidden className="size-3.5" /> : undefined} onClick={() => change(claude.connected || claude.pending ? "DELETE" : "POST")}>
              {claude.pending ? "Cancel sign-in" : claude.connected ? "Disconnect Claude" : "Connect Claude"}
            </Button>
          </div>
        )}
      </div>
      {provider === "claude_plan" && (
        <div className="mt-3 space-y-1.5 text-[12px] leading-[18px] text-fg-2">
          <p>Claude creates finished SVG and PNG graphics in code, writes copy, and reviews the renders. Uses your Claude plan and any enabled extra usage; no API-key fallback.</p>
          {!claude.available && <p>Install Claude Desktop with Claude Code, or the Claude Code CLI, on this computer to connect.</p>}
          {claude.pending && claude.authUrl && <a href={claude.authUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">Continue to Claude <ExternalLink aria-hidden className="size-3.5" /></a>}
          {(error || claude.error) && <p role="alert" className="text-danger">{error || claude.error}</p>}
        </div>
      )}
    </section>
  );
}
