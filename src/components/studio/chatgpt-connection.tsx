"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatGptStatus } from "@/lib/studio/chatgpt";

async function requestStatus(method = "GET"): Promise<ChatGptStatus> {
  const response = await fetch("/api/studio/chatgpt", { method, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Couldn't connect ChatGPT. Try again.");
  return result;
}

export function useChatGptConnection() {
  const [status, setStatus] = useState<ChatGptStatus>({ available: true, connected: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const update = useCallback(async (method = "GET") => {
    try {
      const result = await requestStatus(method);
      setError(undefined);
      setStatus(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn't connect ChatGPT. Try again."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    let cancelled = false;
    requestStatus().then((result) => { if (!cancelled) setStatus(result); })
      .catch((error: Error) => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!status.pending) return;
    const timer = setInterval(() => void update(), 2500);
    return () => clearInterval(timer);
  }, [status.pending, update]);
  const change = (method: string) => { setBusy(true); setError(undefined); void update(method); };
  return { status, busy, error, connect: () => change("POST"), disconnect: () => change("DELETE") };
}

export function ChatGptConnection({ connection }: { connection: ReturnType<typeof useChatGptConnection> }) {
  const { status, busy, error, connect, disconnect } = connection;
  return (
    <div className="mt-3 rounded-md bg-surface p-3 ring-1 ring-border" aria-label="ChatGPT connection" role="group">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-fg" role="status">
          {status.connected ? `ChatGPT connected${status.plan ? ` · ${status.plan}` : ""}` : status.pending ? "Finish signing in to ChatGPT" : "Use your ChatGPT plan"}
        </p>
        {status.connected || status.pending ? (
          <Button size="sm" variant="ghost" loading={busy} icon={<LogOut aria-hidden className="size-3.5" />} onClick={disconnect}>
            {status.pending ? "Cancel sign-in" : "Disconnect"}
          </Button>
        ) : (
          <Button size="sm" loading={busy} onClick={connect}>Connect ChatGPT</Button>
        )}
      </div>
      <p className="mt-1.5 text-[12px] leading-[18px] text-fg-2">
        Image generation uses your ChatGPT allowance through local Codex. No OpenAI API key or API image charges.
        Copy, layout and review use your Create with choice above. Availability and limits depend on your plan.
      </p>
      {!status.connected && !status.pending && (
        <p className="mt-1.5 text-[12px] leading-[18px] text-fg-3">
          {status.available ? "Uses an existing Codex ChatGPT sign-in, or opens an official browser sign-in. Inroad never asks for your password." : "Install the ChatGPT desktop app or Codex CLI on this computer, then connect. A recent version with image generation is required."}
        </p>
      )}
      {status.pending && status.authUrl && (
        <a href={status.authUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-text underline-offset-4 hover:underline">
          Continue to ChatGPT <ExternalLink aria-hidden className="size-3.5" />
        </a>
      )}
      {(error || status.error) && <p role="alert" className="mt-2 text-[12px] leading-[18px] text-danger">{error || status.error}</p>}
    </div>
  );
}
