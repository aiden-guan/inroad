"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { CONNECTORS, MAPPED_STAGES, stageConfigKey, type CrmId } from "@/lib/connectors/catalog";
import type { Pipeline } from "@/lib/connectors/types";
import { OPEN_STAGES, type IntegrationState, type Stage } from "@/lib/domain/types";
import type { HubStatus } from "@/lib/hub/types";
import { SyncLog } from "./sync-log";
import { Select, SubLabel, ToggleRow } from "./parts";
import { useHubApi } from "./use-hub";

type PipelineWithSuggestion = Pipeline & { suggested: Partial<Record<Stage, string>> };

function usePipelines(id: CrmId, enabled: boolean) {
  const [state, setState] = useState<{ pipelines: PipelineWithSuggestion[] | null; error: string | null; nonce: number }>({ pipelines: null, error: null, nonce: 0 });
  const nonce = state.nonce;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/integrations/${id}/pipelines`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setState((s) => ({ ...s, error: body?.error ?? "Couldn't load your pipelines.", pipelines: null }));
        else setState((s) => ({ ...s, error: null, pipelines: body.pipelines ?? [] }));
      })
      .catch(() => !cancelled && setState((s) => ({ ...s, error: "Couldn't load your pipelines." })));
    return () => {
      cancelled = true;
    };
  }, [id, enabled, nonce]);
  return { ...state, retry: () => setState((s) => ({ ...s, error: null, pipelines: null, nonce: s.nonce + 1 })) };
}

/** Our six stages → the CRM's stages. Unset rows show the code-made suggestion, which is also what sync uses. */
function StageMap({ id, state }: { id: CrmId; state: IntegrationState }) {
  const { dispatch } = useWorkspace();
  const { pipelines, error, retry } = usePipelines(id, true);
  const cfg = state.config;
  const name = CONNECTORS[id].name;

  if (error) {
    return (
      <div>
        <FieldError>{error}</FieldError>
        <Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }
  if (!pipelines) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    );
  }
  if (!pipelines.length || !pipelines.some((p) => p.stages.length)) {
    return (
      <p className="text-[13px] leading-[19px] text-fg-3">
        {id === "attio"
          ? "This Attio workspace has no Deals object, so I'll record each deal and stage change as a note on the company instead."
          : `${name} didn't return any deal pipelines.`}
      </p>
    );
  }

  const pipeline = pipelines.find((p) => p.id === cfg.pipelineId) ?? pipelines[0];
  const set = (patch: Record<string, string>) => dispatch({ type: "integration.update", id, patch: { config: patch } });

  return (
    <div className="space-y-3">
      {pipelines.length > 1 && (
        <div className="grid gap-1.5 sm:grid-cols-[120px_1fr] sm:items-center sm:gap-3">
          <span className="text-[13px] text-fg-2">Pipeline</span>
          <Select
            label="Pipeline"
            value={pipeline.id}
            onChange={(v) => set({ pipelineId: v, ...Object.fromEntries(MAPPED_STAGES.map((m) => [stageConfigKey(m.stage), ""])) })}
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[120px_1fr] sm:items-center">
        {MAPPED_STAGES.map(({ stage, label }) => {
          const chosen = typeof cfg[stageConfigKey(stage)] === "string" ? String(cfg[stageConfigKey(stage)]) : "";
          const value = chosen || pipeline.suggested[stage] || "";
          return (
            <div key={stage} className="contents">
              <span className="pt-1 text-[13px] text-fg-2 sm:pt-0">{label}</span>
              <Select label={`${name} stage for ${label}`} value={value} onChange={(v) => set({ [stageConfigKey(stage)]: v })}>
                {pipeline.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                    {!chosen && s.id === pipeline.suggested[stage] ? " (suggested)" : ""}
                  </option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CrmPanel({ id, state, status }: { id: CrmId; state: IntegrationState; status: HubStatus | null }) {
  const { ws, dispatch } = useWorkspace();
  const api = useHubApi();
  const name = CONNECTORS[id].name;
  const writeBack = state.config.writeBack === true;
  const [busy, setBusy] = useState<"push" | "pull" | null>(null);
  const deals = useMemo(() => Object.values(ws?.deals ?? {}).filter((d) => OPEN_STAGES.includes(d.stage) || d.stage === "won").length, [ws]);

  async function run(op: "push_deals" | "pull_companies") {
    setBusy(op === "push_deals" ? "push" : "pull");
    const r = await api<{ message?: string }>(`/api/integrations/${id}/sync`, { op });
    setBusy(null);
    if (r?.message) toast.success(r.message);
  }

  return (
    <div className="space-y-6">
      <ToggleRow
        title={`Write deals back to ${name}`}
        checked={writeBack}
        onChange={(next) => {
          void dispatch({ type: "integration.update", id, patch: { config: { writeBack: next } } });
          if (next) toast(`From now on, deals you start or move here show up in ${name}.`);
        }}
      >
        When you start a deal or move its stage here, I create or update it in {name}, with its company and contacts. I never delete anything or touch other records.
      </ToggleRow>

      {writeBack && (
        <div className="animate-[rise-in_180ms_var(--ease-out)]">
          <SubLabel>Your stages in {name}</SubLabel>
          <StageMap id={id} state={state} />
        </div>
      )}

      <div>
        <SubLabel>Sync now</SubLabel>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy === "push"} disabled={!deals || busy !== null} onClick={() => run("push_deals")}>
            {deals ? `Push ${deals} deal${deals === 1 ? "" : "s"} to ${name}` : "No deals to push yet"}
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "pull"} disabled={busy !== null} onClick={() => run("pull_companies")}>
            Import companies from {name}
          </Button>
        </div>
        <p className="mt-2 text-[12px] leading-[18px] text-fg-3">
          Importing brings in up to 200 of your most recently updated {name} companies, so I don&apos;t suggest ones you already know.
        </p>
      </div>

      <SyncLog id={id} status={status} />
    </div>
  );
}
