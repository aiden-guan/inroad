"use client";

import { ArrowUpRight, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import type { PostHogConnection } from "@/lib/metrics/connect-types";
import { ExternalLink } from "./parts";

export function PostHogConnect({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { ws, refresh } = useWorkspace();
  const [flow, setFlow] = useState<PostHogConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [selected, setSelected] = useState("");
  const flowId = flow?.flowId;
  const flowStatus = flow?.status;

  function focusDesktop() {
    const bridge = (window as unknown as { inroadDesktop?: { focus?: () => Promise<void> } }).inroadDesktop;
    void bridge?.focus?.().catch(() => undefined);
  }

  async function accept(next: PostHogConnection) {
    setFlow(next);
    if (next.status === "error") setError(next.error ?? "Couldn't connect. Try again.");
    if (next.status === "done") {
      focusDesktop();
      await refresh();
      toast.success("PostHog connected. Your metrics are ready.");
      onDone();
    }
  }

  useEffect(() => {
    if (!flowId || !flowStatus || !["waiting", "connecting"].includes(flowStatus)) return;
    let stopped = false;
    let reading = false;
    const check = async () => {
      if (reading) return;
      reading = true;
      try {
        const response = await fetch(`/api/metrics/posthog/oauth?flowId=${encodeURIComponent(flowId)}`, { cache: "no-store" });
        const next = await response.json();
        if (stopped) return;
        if (!response.ok) { setError(next.error ?? "Sign-in expired. Try again."); setFlow(null); return; }
        if (next.status === "done") { focusDesktop(); toast.success("PostHog connected. Your metrics are ready."); onDone(); await refresh(); return; }
        setFlow((current) => ({ ...current, ...next }));
        if (next.status === "error") setError(next.error ?? "Couldn't connect. Try again.");
      } catch { /* A short network interruption is retried without restarting sign-in. */ }
      finally { reading = false; }
    };
    const timer = setInterval(() => void check(), 1000);
    return () => { stopped = true; clearInterval(timer); };
  }, [flowId, flowStatus, refresh, onDone]);

  async function start() {
    setBusy(true); setError(null);
    // Open synchronously in browsers to preserve the click's popup permission. The Mac shell opens
    // the final external URL itself, and must never navigate its window to a placeholder page.
    const desktop = "inroadDesktop" in window;
    const popup = desktop ? null : window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const response = await fetch("/api/metrics/posthog/oauth", { method: "POST" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error ?? "Couldn't open PostHog sign-in.");
      const url = new URL(next.url);
      if (url.origin !== "https://oauth.posthog.com" || url.pathname !== "/oauth/authorize/") throw new Error("Couldn't open PostHog sign-in.");
      setFlow(next);
      if (popup) popup.location.replace(url.href);
      else if (desktop) window.open(url.href, "_blank", "noopener,noreferrer");
    } catch (e) { popup?.close(); setError(e instanceof Error ? e.message : "Couldn't open PostHog. Try again."); }
    finally { setBusy(false); }
  }

  async function withKey(value: string) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/metrics/posthog/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: value.trim() }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error ?? "Couldn't connect. Try again.");
      setKey(""); await accept(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't connect. Try again."); }
    finally { setBusy(false); }
  }

  async function select(projectId: string, region: string) {
    setSelected(`${region}:${projectId}`);
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/metrics/posthog/connect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flowId: flow?.flowId, projectId, region }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error ?? "Couldn't import this project.");
      await accept(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't connect. Try again."); }
    finally { setBusy(false); }
  }

  function cancel() {
    if (flow) void fetch(`/api/metrics/posthog/oauth?flowId=${encodeURIComponent(flow.flowId)}`, { method: "DELETE" });
    setFlow(null); setError(null); onCancel?.();
  }

  const pending = flow && ["waiting", "connecting"].includes(flow.status);
  return (
    <div className="space-y-3 py-1">
      {flow?.status === "choose" ? <>
        <p className="text-[14px] font-medium text-fg">Which project should Inroad track?</p>
        <div className="grid max-h-72 gap-2 overflow-y-auto">
          {flow.projects?.map((project) => <Button key={`${project.region}:${project.id}`} loading={busy && selected === `${project.region}:${project.id}`} disabled={busy} className="h-auto min-h-10 justify-between whitespace-normal py-2 text-left" onClick={() => void select(project.id, project.region)}><span>{project.name}</span><ChevronRight className="size-3.5 shrink-0" /></Button>)}
        </div>
      </> : pending ? <>
        <p role="status" className="text-[14px] font-medium text-fg">{flow.status === "connecting" ? "Bringing in your metrics…" : "Finish connecting in your browser"}</p>
        <p className="text-[13px] text-fg-3">{flow.status === "connecting" ? "Inroad is finding your project and importing its numbers." : "Approve read-only access in PostHog. Inroad will take care of the rest."}</p>
        {flow.url && <ExternalLink href={flow.url}>Open PostHog again</ExternalLink>}
      </> : <>
        <p className="max-w-[56ch] text-[13px] leading-5 text-fg-2">Sign in to PostHog. Inroad finds your project and brings in your active users automatically.</p>
        <Button variant="primary" loading={busy} disabled={Boolean(ws?.sample)} icon={<ArrowUpRight className="size-4" />} onClick={() => void start()}>Connect PostHog</Button>
        <p className="text-[12px] text-fg-3">Read-only access. No project IDs, keys or analytics setup to fill in.</p>
        <details className="pt-1 text-[12px] text-fg-3">
          <summary className="w-fit cursor-pointer rounded-sm py-1">Use an API key instead</summary>
          <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void withKey(key); }}>
            <Label htmlFor="posthog-fallback-key">Personal API key</Label>
            <Input id="posthog-fallback-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} onPaste={(e) => { const value = e.clipboardData.getData("text").trim(); if (value.startsWith("phx_") && value.length >= 8 && !ws?.sample) { e.preventDefault(); setKey(value); void withKey(value); } }} placeholder="Paste your key to connect" required minLength={8} maxLength={4000} autoComplete="off" disabled={busy || Boolean(ws?.sample)} />
            <div className="flex flex-wrap items-center gap-3"><Button type="submit" size="sm" loading={busy} disabled={Boolean(ws?.sample)}>Connect</Button><ExternalLink href="https://app.posthog.com/settings/user-api-keys">Get a read-only key</ExternalLink></div>
            <p>Projects: Read and Query: Read. Region and project are detected for you.</p>
          </form>
        </details>
      </>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {ws?.sample && <p className="text-[12px] text-fg-3">Leave the sample workspace to connect your account.</p>}
      {(pending || flow?.status === "choose" || onCancel) && <Button size="xs" variant="ghost" onClick={cancel}>Cancel</Button>}
    </div>
  );
}
