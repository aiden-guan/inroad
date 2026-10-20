"use client";

import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { CONNECTORS, REPLY_SOURCES, TEMPLATE_VARS, type SequencerId } from "@/lib/connectors/catalog";
import type { Campaign } from "@/lib/connectors/types";
import type { IntegrationState } from "@/lib/domain/types";
import type { HubStatus } from "@/lib/hub/types";
import { HookPanel, useHookBase } from "./hooks";
import { Ago, Disclosure, Select, SubLabel } from "./parts";
import { SyncLog } from "./sync-log";
import { useHubApi } from "./use-hub";

function useCampaigns(id: SequencerId) {
  const [state, setState] = useState<{ campaigns: Campaign[] | null; error: string | null; nonce: number; fresh: boolean }>({ campaigns: null, error: null, nonce: 0, fresh: false });
  const { nonce, fresh } = state;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/integrations/${id}/campaigns${fresh ? "?fresh=1" : ""}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        setState((s) => (res.ok ? { ...s, campaigns: body.campaigns ?? [], error: null } : { ...s, campaigns: null, error: body?.error ?? "Couldn't load campaigns." }));
      })
      .catch(() => !cancelled && setState((s) => ({ ...s, error: "Couldn't load campaigns." })));
    return () => {
      cancelled = true;
    };
  }, [id, nonce, fresh]);
  return { ...state, reload: () => setState((s) => ({ ...s, campaigns: null, error: null, nonce: s.nonce + 1, fresh: true })) };
}

const STATUS_LABEL: Record<Campaign["status"], string> = { active: "active", paused: "paused", draft: "draft", completed: "completed", other: "" };

function CampaignPicker({ id, state }: { id: SequencerId; state: IntegrationState }) {
  const { dispatch } = useWorkspace();
  const { campaigns, error, reload } = useCampaigns(id);
  const name = CONNECTORS[id].name;
  const current = typeof state.config.defaultCampaignId === "string" ? state.config.defaultCampaignId : "";

  let body: React.ReactNode;
  if (error) body = <FieldError>{error}</FieldError>;
  else if (!campaigns) body = <Skeleton className="h-8" />;
  else if (!campaigns.length) body = <p className="text-[13px] text-fg-3">No campaigns yet. Create one in {name}, then refresh.</p>;
  else {
    const sorted = [...campaigns].sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));
    body = (
      <Select
        label="Default campaign"
        value={current}
        onChange={(v) => {
          const c = campaigns.find((x) => x.id === v);
          void dispatch({ type: "integration.update", id, patch: { config: { defaultCampaignId: v, defaultCampaignName: c?.name ?? "" } } });
          if (c) toast.success(`Approved drafts will go to “${c.name}”.`);
        }}
      >
        {!current && <option value="">Pick a campaign…</option>}
        {current && !campaigns.some((c) => c.id === current) && <option value={current}>{String(state.config.defaultCampaignName || "Saved campaign")} (not found)</option>}
        {sorted.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {STATUS_LABEL[c.status] ? ` · ${STATUS_LABEL[c.status]}` : ""}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <div>
      <SubLabel
        right={
          <IconButton label="Refresh campaigns" onClick={reload} className="-my-1 size-6">
            <RotateCw className="size-3.5" />
          </IconButton>
        }
      >
        Push approved drafts to
      </SubLabel>
      {body}
    </div>
  );
}

function TemplateVars({ id }: { id: SequencerId }) {
  const name = CONNECTORS[id].name;
  return (
    <div>
      <SubLabel>Set up that campaign once</SubLabel>
      <p className="text-[13px] leading-[19px] text-fg-2">
        In its first step, use these as the subject and body. Each pushed lead carries its own approved copy, so {name} sends exactly what you approved.
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {TEMPLATE_VARS.map((v) => (
          <li key={v.name} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <VarChip name={v.name} />
            <span className="text-[12px] text-fg-3">{v.what}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[12px] leading-[18px] text-fg-3">
        Write your follow-ups as the campaign&apos;s later steps. {name} sends them and stops when someone replies, so I don&apos;t draft follow-ups for leads pushed there.
      </p>
    </div>
  );
}

function VarChip({ name }: { name: string }) {
  const token = `{{${name}}}`;
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(token);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="Copy"
      className="rounded-xs bg-bg-subtle px-1.5 py-0.5 font-mono text-[12px] text-fg ring-1 ring-border transition-[background-color,transform] duration-150 hover:bg-sunken active:scale-[0.97]"
    >
      {copied ? "Copied" : token}
    </button>
  );
}

function RepliesBack({ id, status, onRefresh }: { id: SequencerId; status: HubStatus | null; onRefresh: () => void }) {
  const api = useHubApi();
  const { publicUrl } = useHookBase(status);
  const [busy, setBusy] = useState(false);
  const canRegister = id === "instantly" && publicUrl.startsWith("https://");
  return (
    <Disclosure title={`Send replies back from ${CONNECTORS[id].name}`}>
      <p className="mb-4 text-[13px] leading-[19px] text-fg-2">
        Replies become moves on Today, labelled by {CONNECTORS[id].name}&apos;s own interest tags, so sorting them costs no AI tokens. A reply also stops the rest of that person&apos;s sequence here.
      </p>
      <HookPanel
        sources={[REPLY_SOURCES[id]]}
        status={status}
        onRefresh={onRefresh}
        showExample={false}
        extra={
          canRegister ? (
            <Button
              size="sm"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                const r = await api<{ message?: string }>(`/api/integrations/${id}/sync`, { op: "register_replies", publicUrl });
                setBusy(false);
                if (r?.message) toast.success(r.message);
              }}
            >
              Set it up in Instantly for me
            </Button>
          ) : undefined
        }
      />
    </Disclosure>
  );
}

export function SequencerPanel({ id, state, status, onRefresh }: { id: SequencerId; state: IntegrationState; status: HubStatus | null; onRefresh: () => void }) {
  const pushed = state.stats?.pushed ?? 0;
  return (
    <div className="space-y-6">
      <CampaignPicker id={id} state={state} />
      <TemplateVars id={id} />
      {pushed > 0 && (
        <p className="text-[12px] text-fg-3">
          <span className="font-mono tnum text-fg-2">{pushed}</span> draft{pushed === 1 ? "" : "s"} pushed
          {state.lastSyncAt && (
            <>
              {" · last "}
              <Ago iso={state.lastSyncAt} />
            </>
          )}
        </p>
      )}
      <SyncLog id={id} status={status} max={3} />
      <RepliesBack id={id} status={status} onRefresh={onRefresh} />
    </div>
  );
}
