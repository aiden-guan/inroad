"use client";

import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import type { IntegrationState } from "@/lib/domain/types";
import type { PostHogProject } from "@/lib/metrics/posthog-auth";

/** Uses the existing connection: switching projects never requires another key or an OAuth grant. */
export function PostHogProjectPicker({ state }: { state: IntegrationState }) {
  const { refresh } = useWorkspace();
  const [projects, setProjects] = useState<PostHogProject[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/metrics/posthog/projects", { cache: "no-store" }); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Couldn't find your projects.");
      setProjects(body.projects);
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn't reach PostHog."); }
    finally { setBusy(false); }
  }
  async function select(project: PostHogProject) {
    setBusy(true); setSelected(project.id); setError(null);
    try {
      const response = await fetch("/api/metrics/posthog", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, region: project.region }) }); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Couldn't import this project.");
      await refresh(); setProjects(null); toast.success(`Now tracking ${project.name}.`);
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn't reach PostHog."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 rounded-lg bg-bg-subtle/60 p-3 text-[12px] text-fg-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><a href={`https://${state.config.region === "eu" ? "eu" : "us"}.posthog.com/project/${state.config.projectId}`} target="_blank" rel="noreferrer" className="underline underline-offset-4">Project {String(state.config.projectId)} · {String(state.config.region ?? "us").toUpperCase()} ↗</a><Button size="xs" variant="ghost" loading={busy && !projects} onClick={() => projects ? setProjects(null) : void load()}>{projects ? "Cancel" : "Change project"}</Button></div>
    {projects && <div className="mt-3 space-y-1"><p className="mb-2 leading-5">Choose the project that tracks your product. Its history starts separately.</p>{projects.map((project) => { const current = project.id === state.config.projectId && project.region === state.config.region; return <Button key={`${project.region}:${project.id}`} className="h-auto w-full justify-between py-2 text-left" loading={busy && selected === project.id} disabled={busy || current} onClick={() => void select(project)}><span className="min-w-0 break-words">{project.name}{" "}<span className="ml-2 font-mono text-[12px] text-fg-3">{project.id} · {project.region.toUpperCase()}</span></span>{current ? <Check className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button>; })}</div>}
    {error && <p role="alert" className="mt-2 leading-5 text-danger">{error}</p>}
  </div>;
}
