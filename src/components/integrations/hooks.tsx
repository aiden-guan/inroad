"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { inboundSourceName, type InboundSourceMeta } from "@/lib/connectors/catalog";
import type { HubStatus, InboundLogEntry } from "@/lib/hub/types";
import { ease } from "@/lib/motion";
import { Ago, Callout, CodeBlock, ConfirmButton, CopyField, Disclosure, ExternalLink, Steps, SubLabel } from "./parts";
import { useHubApi, usePolling } from "./use-hub";

/* ───────────── Where hooks point ───────────── */

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;

export function useHookBase(status: HubStatus | null) {
  const { ws } = useWorkspace();
  const publicUrl = typeof ws?.integrations.webhook_in?.config.publicUrl === "string" ? ws.integrations.webhook_in.config.publicUrl : "";
  const appUrl = status?.appUrl ?? "";
  const base = (publicUrl || appUrl).replace(/\/+$/, "");
  return { base, publicUrl, appUrl, isLocal: !publicUrl && (!appUrl || LOCAL.test(appUrl)) };
}

export function hookPath(source: string, secret: string) {
  return `/api/hooks/${source}/${secret}`;
}

/* ───────────── Public URL (tunnel) ───────────── */

/** Webhooks from cloud tools need a public https address; a local app doesn't have one without a tunnel. */
export function PublicUrlSetup({ status }: { status: HubStatus | null }) {
  const { dispatch } = useWorkspace();
  const { publicUrl, appUrl, isLocal } = useHookBase(status);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(publicUrl);
  const [error, setError] = useState<string | null>(null);
  const port = appUrl.match(/:(\d+)$/)?.[1] ?? "3000";

  async function save(next: string) {
    const v = next.trim().replace(/\/+$/, "");
    if (v && !/^https:\/\/[^\s/]+\.[^\s/]+$/i.test(v)) {
      setError("Paste the https address your tunnel printed, like https://quiet-river.trycloudflare.com");
      return;
    }
    setError(null);
    const ok = await dispatch({ type: "integration.update", id: "webhook_in", patch: { config: { publicUrl: v } } });
    if (ok) {
      setEditing(false);
      toast.success(v ? "Hook URLs now use your public address." : "Back to the local address.");
    }
  }

  if (!isLocal && !editing) {
    return (
      <p className="text-[12px] leading-[18px] text-fg-3">
        Using the public address <span className="break-all font-mono text-fg-2">{publicUrl || appUrl}</span>.{" "}
        <button
          type="button"
          className="font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:decoration-fg"
          onClick={() => {
            setValue(publicUrl);
            setEditing(true);
          }}
        >
          Change
        </button>
      </p>
    );
  }

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(value);
      }}
      className="mt-2.5 flex flex-col gap-2 sm:flex-row"
    >
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://your-tunnel.trycloudflare.com" aria-label="Public URL" spellCheck={false} className="font-mono text-[12px]" />
      <div className="flex shrink-0 gap-2">
        <Button type="submit" size="md">
          Use this address
        </Button>
        {publicUrl && (
          <Button type="button" variant="ghost" onClick={() => void save("")}>
            Clear
          </Button>
        )}
        {editing && (
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <Callout tone={isLocal ? "warning" : "neutral"}>
      {isLocal ? (
        <p>
          <span className="font-medium">This address only works on this computer.</span> Cloud tools can&apos;t reach it. Start a tunnel, then paste the https address it prints.
        </p>
      ) : (
        <p>Paste the https address your tunnel prints. Tunnel addresses change when you restart them.</p>
      )}
      <div className="mt-2.5 grid gap-1.5">
        <CopyField value={`cloudflared tunnel --url ${appUrl || `http://localhost:${port}`}`} />
        <p className="text-[12px] text-fg-3">
          or <code className="font-mono">ngrok http {port}</code>. Keep it running while tools send events.
        </p>
      </div>
      {form}
      <FieldError>{error}</FieldError>
    </Callout>
  );
}

/* ───────────── Recent inbound events ───────────── */

function EventLine({ e }: { e: InboundLogEntry }) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: ease.out }}
      className="px-3 py-2"
    >
      <div className="flex items-baseline gap-3 text-[13px]">
        <span className="w-14 shrink-0 font-mono text-[11px] text-fg-3">
          <Ago iso={e.at} />
        </span>
        <span className="shrink-0 font-medium text-fg-2">{inboundSourceName(e.source)}</span>
        <span className={cn("min-w-0 flex-1 truncate", e.status === "duplicate" ? "text-fg-3" : "text-fg-2")}>{e.summary}</span>
        {e.status === "duplicate" && <Badge>Duplicate</Badge>}
        {e.status === "unmapped" && <Badge tone="warning">Not mapped</Badge>}
      </div>
      {e.unmapped && e.unmapped.length > 0 && (
        <p className="mt-1 pl-[68px] text-[12px] leading-[18px] text-fg-3">
          Fields I didn&apos;t use: <span className="font-mono">{e.unmapped.join(", ")}</span>
        </p>
      )}
    </motion.li>
  );
}

export function RecentEvents({ events, waitingLabel = "Waiting for the first event…", max = 6 }: { events: InboundLogEntry[]; waitingLabel?: string; max?: number }) {
  if (!events.length) {
    return (
      <div className="flex items-center gap-2.5 rounded-md bg-bg-subtle px-3 py-2.5 text-[13px]" aria-live="polite">
        <span aria-hidden className="size-2 shrink-0 rounded-full ring-1 ring-fg-4" />
        <span className="shimmer-text">{waitingLabel}</span>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md ring-1 ring-border" aria-live="polite">
      <AnimatePresence initial={false}>
        {events.slice(0, max).map((e) => (
          <EventLine key={e.id} e={e} />
        ))}
      </AnimatePresence>
    </ul>
  );
}

/* ───────────── The hook card body ───────────── */

const GENERIC_EXAMPLE = `{
  "accounts": [{ "domain": "acme.com", "name": "Acme" }],
  "people": [{
    "email": "jane@acme.com", "first_name": "Jane", "last_name": "Doe",
    "title": "VP Engineering", "linkedin_url": "https://www.linkedin.com/in/janedoe"
  }],
  "activities": [{
    "type": "reply", "email": "jane@acme.com", "sentiment": "interested",
    "body": "Worth a look. Does Tuesday work?",
    "occurred_at": "2026-10-20T14:03:11Z", "external_id": "msg_123"
  }]
}`;

/**
 * Card type B from research 07: a copyable URL, three tool-specific steps, and a live
 * "Waiting for first event…" that turns into the event list the moment something arrives.
 */
export function HookPanel({
  sources,
  status,
  onRefresh,
  showExample = true,
  extra,
}: {
  sources: InboundSourceMeta[];
  status: HubStatus | null;
  onRefresh: () => void;
  showExample?: boolean;
  extra?: React.ReactNode;
}) {
  const [picked, setPicked] = useState(sources[0].id);
  const source = sources.find((s) => s.id === picked) ?? sources[0];
  const { base } = useHookBase(status);
  const api = useHubApi();
  const ids = new Set(sources.map((s) => s.id));
  const events = (status?.inbound.events ?? []).filter((e) => ids.has(e.source as InboundSourceMeta["id"]));
  const [pinging, setPinging] = useState(false);
  usePolling(Boolean(status) && events.length === 0, onRefresh, 4000);

  if (!status) {
    return <Skeleton className="h-40 rounded-md" />;
  }
  const path = hookPath(source.id, status.inbound.secret);
  const url = `${base}${path}`;

  async function ping() {
    setPinging(true);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ping: true }) });
      if (!res.ok) throw new Error();
      onRefresh();
    } catch {
      toast.error("The test ping didn't arrive. Is the app still running?");
    } finally {
      setPinging(false);
    }
  }

  return (
    <div className="space-y-5">
      {sources.length > 1 && (
        <div role="radiogroup" aria-label="Which tool" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 scrollbar-none">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === source.id}
              onClick={() => setPicked(s.id)}
              className={cn(
                "inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[12px] font-medium ring-1 transition-[background-color,color,box-shadow] duration-150",
                s.id === source.id ? "bg-primary text-primary-fg ring-primary" : "bg-surface text-fg-2 ring-border hover:ring-border-strong",
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <Steps steps={source.steps} />

      <div>
        <SubLabel right={source.docs ? <ExternalLink href={source.docs} className="text-[12px]">Docs</ExternalLink> : undefined}>
          {sources.length > 1 ? `URL for ${source.name}` : "Webhook URL"}
        </SubLabel>
        <CopyField value={url} label="Copy URL" />
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-[12px] leading-[18px] text-fg-3">
          <p>Anyone with this URL can send data in, so treat it like a password.</p>
          <ConfirmButton
            confirmLabel="Old URLs stop working. Rotate?"
            className="-mr-2"
            onConfirm={async () => {
              if (await api("/api/integrations/rotate", { which: "inbound" })) {
                onRefresh();
                toast("New URL ready. Paste it into your tools again.");
              }
            }}
          >
            Rotate URL
          </ConfirmButton>
        </div>
      </div>

      <PublicUrlSetup status={status} />

      {extra}

      {showExample && (
        <Disclosure title="What to send">
          <div className="space-y-2.5">
            <p className="text-[13px] leading-[19px] text-fg-2">
              A JSON object with any of <code className="font-mono text-[12px]">accounts</code>, <code className="font-mono text-[12px]">people</code> and{" "}
              <code className="font-mono text-[12px]">activities</code>, or a flat row like Clay sends. Common column names (Email, Company Domain, Job Title, LinkedIn URL…) map
              automatically. Existing records only get empty fields filled.
            </p>
            <CodeBlock code={GENERIC_EXAMPLE} />
          </div>
        </Disclosure>
      )}

      <div>
        <SubLabel
          right={
            <Button size="xs" variant="ghost" loading={pinging} onClick={ping}>
              Send a test ping
            </Button>
          }
        >
          Recent events
        </SubLabel>
        <RecentEvents events={events} />
      </div>
    </div>
  );
}
