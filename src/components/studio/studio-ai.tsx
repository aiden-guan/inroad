"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ExternalLink, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
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

/**
 * Who does the writing and designing: the configured AI provider or the founder's Claude plan. A compact control that
 * sits beside the button it affects (Write options, Design graphics, Write more), so each view leads with the task.
 * Render one at a time: the select's id is fixed and the label is what tests and screen readers find.
 */
export function StudioAIChoice({ className }: { className?: string }) {
  const { provider, setProvider, claude, busy, error, change } = useStudioAI();
  const plan = claude.plan ? claude.plan.charAt(0).toUpperCase() + claude.plan.slice(1) : "";
  const claudePlan = provider === "claude_plan";
  const problem = error || claude.error;
  return (
    <div role="group" aria-label="Studio AI choice" className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Label htmlFor="studio-ai-provider" className="mb-0 font-normal text-fg-3">
          Create with
        </Label>
        <Select id="studio-ai-provider" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} className="max-w-full">
          <option value="api">Configured AI provider</option>
          <option value="claude_plan">Claude plan</option>
        </Select>
        {claudePlan && (
          <>
            <span role="status" className="text-[12px] text-fg-2">
              {claude.connected ? `Claude connected${plan ? ` · ${plan}` : ""}` : claude.pending ? "Finish signing in to Claude" : "Connect your Claude plan"}
            </span>
            <Button
              size="sm"
              variant={claude.connected ? "ghost" : "secondary"}
              loading={busy}
              icon={claude.connected || claude.pending ? <LogOut aria-hidden className="size-3.5" /> : undefined}
              onClick={() => change(claude.connected || claude.pending ? "DELETE" : "POST")}
            >
              {claude.pending ? "Cancel sign-in" : claude.connected ? "Disconnect Claude" : "Connect Claude"}
            </Button>
          </>
        )}
      </div>
      {claudePlan && (!claude.connected || problem) && (
        <div className="mt-1.5 max-w-[60ch] space-y-1 text-[12px] leading-[18px] text-fg-3">
          {!claude.connected && <p>Claude writes the copy and makes finished graphics on your plan&apos;s allowance, including any extra usage you turned on. It never falls back to an API key.</p>}
          {!claude.available && <p>Install Claude Desktop with Claude Code, or the Claude Code CLI, on this computer to connect.</p>}
          {claude.pending && claude.authUrl && (
            <a href={claude.authUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
              Continue to Claude <ExternalLink aria-hidden className="size-3.5" />
            </a>
          )}
          {problem && (
            <p role="alert" className="text-danger">
              {problem}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
