"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { CONNECTORS, type NativeConnectorId } from "@/lib/connectors/catalog";
import type { IntegrationState } from "@/lib/domain/types";
import { Ago, ConfirmButton, ExternalLink, Step } from "./parts";
import { useHubApi } from "./use-hub";

/**
 * Card type A from research 07: deep link to where the key lives + required scopes, a paste field
 * validated live with one cheap "who am I" call, then "Connected · <workspace>".
 */
export function KeyConnect({ id, onConnected, onCancel }: { id: NativeConnectorId; onConnected?: () => void; onCancel?: () => void }) {
  const meta = CONNECTORS[id];
  const { refresh } = useWorkspace();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = key.trim();
    if (!value) {
      setError(`Paste your ${meta.name} ${meta.secretLabel.toLowerCase()} first.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: value }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? `${meta.name} didn't accept that.`);
        return;
      }
      setKey("");
      toast.success(`${meta.name} connected${body.accountLabel ? ` · ${body.accountLabel}` : ""}`);
      await refresh();
      onConnected?.();
    } catch {
      setError(`Couldn't reach ${meta.name}. Check your connection and try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Step n={1} title={id === "slack" ? "Create an incoming webhook" : "Get a key"}>
        <p className="text-[13px] leading-[19px] text-fg-2">{meta.where.path}</p>
        <div className="mt-1.5">
          <ExternalLink href={meta.where.href}>{meta.where.linkLabel}</ExternalLink>
        </div>
        {meta.scopes.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-[12px] text-fg-3">Scopes it needs</p>
            <div className="flex flex-wrap gap-1.5">
              {meta.scopes.map((s) => (
                <code key={s} className="rounded-xs bg-bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg-2 ring-1 ring-border">
                  {s}
                </code>
              ))}
            </div>
          </div>
        )}
        {meta.note && <p className="mt-2.5 text-[12px] leading-[18px] text-fg-3">{meta.note}</p>}
      </Step>
      <Step n={2} title="Paste it here">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="password"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (error) setError(null);
            }}
            placeholder={meta.placeholder}
            aria-label={`${meta.name} ${meta.secretLabel}`}
            aria-invalid={Boolean(error)}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            className="font-mono text-[12px]"
          />
          <div className="flex shrink-0 gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              {id === "slack" ? "Connect and send a test" : "Connect"}
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </form>
        {busy ? (
          <p className="mt-2 text-[12px]" aria-live="polite">
            <span className="shimmer-text">Checking with {meta.name}…</span>
          </p>
        ) : (
          <FieldError>{error}</FieldError>
        )}
        {!busy && !error && (
          <p className="mt-2 text-[12px] leading-[18px] text-fg-3">
            {id === "slack"
              ? "I post one short test message to that channel. The URL stays on this computer."
              : "I check it with one read-only call. It stays on this computer, outside your workspace file."}
          </p>
        )}
      </Step>
    </div>
  );
}

/** "Connected 3d ago · Replace key · Disconnect", plus the last error if there is one. */
export function ConnectedFooter({ id, state, onReplace }: { id: NativeConnectorId; state: IntegrationState; onReplace: () => void }) {
  const meta = CONNECTORS[id];
  const api = useHubApi();
  return (
    <div className="mt-6 border-t border-border pt-3">
      {state.lastError && (
        <p className="mb-3 rounded-md bg-danger-subtle px-3 py-2 text-[13px] leading-[19px] text-danger">
          {state.lastError.message} <Ago iso={state.lastError.at} className="text-[12px] opacity-80" />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[12px] text-fg-3">
        <span className="mr-2">
          {state.config.accountLabel ? <span className="text-fg-2">{String(state.config.accountLabel)}</span> : meta.name}
          {state.connectedAt && (
            <>
              {" · connected "}
              <Ago iso={state.connectedAt} />
            </>
          )}
        </span>
        <button type="button" onClick={onReplace} className="inline-flex h-7 items-center rounded-sm px-2 font-medium text-fg-3 transition-colors duration-150 hover:bg-bg-subtle hover:text-fg-2">
          Replace {id === "slack" ? "URL" : "key"}
        </button>
        <ConfirmButton
          confirmLabel={`Disconnect ${meta.name}?`}
          onConfirm={async () => {
            const r = await api(`/api/integrations/${id}`, undefined, { method: "DELETE" });
            if (r) toast(`${meta.name} disconnected. Your settings are kept if you reconnect.`);
          }}
        >
          Disconnect
        </ConfirmButton>
      </div>
    </div>
  );
}
