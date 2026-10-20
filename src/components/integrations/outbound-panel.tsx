"use client";

import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { hostOf } from "@/lib/client/format";
import { HUB_EVENTS } from "@/lib/connectors/catalog";
import { newId, nowISO } from "@/lib/domain/ids";
import type { HubEventType, OutboundWebhook } from "@/lib/domain/types";
import type { HubStatus } from "@/lib/hub/types";
import { ease } from "@/lib/motion";
import { Ago, CodeBlock, ConfirmButton, CopyField, Disclosure, StatusDot, SubLabel } from "./parts";
import { useHubApi } from "./use-hub";

const EXAMPLE = `POST https://hooks.zapier.com/hooks/catch/…
content-type: application/json
webhook-id: msg_8f1c…            (same on every retry)
webhook-timestamp: 1792512191
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=

{
  "id": "msg_8f1c…",
  "type": "deal.stage_changed",
  "at": "2026-10-20T14:03:11.000Z",
  "data": {
    "deal": { "id": "deal_…", "name": "Acme", "stage": "pilot", "stage_label": "Pilot",
              "amount_usd": 12000, "url": "http://localhost:3000/companies?c=acme.com" },
    "from": "qualified", "to": "pilot",
    "account": { "domain": "acme.com", "name": "Acme", "tier": "A" }
  }
}`;

const VERIFY = `// Any Standard Webhooks library works (e.g. npm i standard-webhooks)
import { Webhook } from "standard-webhooks";
const wh = new Webhook(process.env.INROAD_SIGNING_SECRET); // whsec_…
const event = wh.verify(rawBody, headers); // throws if the signature is wrong`;

const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

function deliveryTone(w: OutboundWebhook) {
  if (w.paused) return "error" as const;
  if (!w.lastDelivery) return "waiting" as const;
  const s = w.lastDelivery.status;
  return typeof s === "number" && s >= 200 && s < 300 ? ("on" as const) : ("error" as const);
}

function EndpointRow({ w, onRefresh }: { w: OutboundWebhook; onRefresh: () => void }) {
  const { dispatch } = useWorkspace();
  const api = useHubApi();
  const [testing, setTesting] = useState(false);
  const tone = deliveryTone(w);
  const last = w.lastDelivery;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.2, ease: ease.out }}
      className="px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot tone={tone} />
            <span className="truncate text-[13px] font-medium text-fg">{w.label || hostOf(w.url)}</span>
            {w.paused && <Badge tone="danger">Paused</Badge>}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-fg-3" title={w.url}>
            {w.url.replace(/^https?:\/\//, "")}
          </p>
          <p className="mt-0.5 text-[12px] text-fg-3">
            {w.events.length === HUB_EVENTS.length ? "All events" : `${w.events.length} event${w.events.length === 1 ? "" : "s"}`}
            {last && (
              <>
                {" · last "}
                {typeof last.status === "number" ? <span className="font-mono">{last.status}</span> : "failed"} <Ago iso={last.at} />
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {w.paused ? (
            <Button size="xs" onClick={() => void dispatch({ type: "webhook.update", id: w.id, patch: { paused: false } })}>
              Resume
            </Button>
          ) : (
            <Button
              size="xs"
              loading={testing}
              onClick={async () => {
                setTesting(true);
                const r = await api<{ ok?: boolean }>("/api/integrations/test", { target: "webhook", id: w.id });
                setTesting(false);
                onRefresh();
                if (r?.ok) toast.success(`${w.label || hostOf(w.url)} accepted the test event.`);
              }}
            >
              Send test
            </Button>
          )}
          <ConfirmButton confirmLabel="Remove?" onConfirm={() => void dispatch({ type: "webhook.remove", id: w.id })}>
            Remove
          </ConfirmButton>
        </div>
      </div>
    </motion.li>
  );
}

function AddEndpoint({ onDone }: { onDone: () => void }) {
  const { dispatch } = useWorkspace();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [events, setEvents] = useState<HubEventType[]>(HUB_EVENTS.map((e) => e.type));
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const u = url.trim();
    let parsed: URL | null = null;
    try {
      parsed = new URL(u);
    } catch {
      parsed = null;
    }
    if (!parsed || !(parsed.protocol === "https:" || LOCAL_HTTP.test(u))) {
      setError("Use an https URL (http is fine only for localhost).");
      return;
    }
    if (!events.length) {
      setError("Pick at least one event.");
      return;
    }
    const ok = await dispatch({
      type: "webhook.add",
      webhook: { id: newId("whk"), url: u, label: label.trim() || hostOf(u), events, createdAt: nowISO() },
    });
    if (ok) {
      toast.success("Endpoint added. Send a test to check it.");
      onDone();
    }
  }

  const toggle = (t: HubEventType) => setEvents((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <form onSubmit={save} className="space-y-4 rounded-md bg-bg-subtle p-3 ring-1 ring-border animate-[rise-in_180ms_var(--ease-out)]">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div>
          <Label htmlFor="whk-url">Endpoint URL</Label>
          <Input
            id="whk-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="https://hooks.zapier.com/hooks/catch/…"
            spellCheck={false}
            className="font-mono text-[12px]"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="whk-label" hint="Optional">
            Name
          </Label>
          <Input id="whk-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Zapier: deals to Sheets" />
        </div>
      </div>
      <fieldset>
        <legend className="mb-1.5 flex w-full items-center justify-between text-[12px] font-medium text-fg-2">
          <span>Events</span>
          <button
            type="button"
            className="font-normal text-fg-3 hover:text-fg-2"
            onClick={() => setEvents(events.length === HUB_EVENTS.length ? [] : HUB_EVENTS.map((x) => x.type))}
          >
            {events.length === HUB_EVENTS.length ? "Clear all" : "Select all"}
          </button>
        </legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {HUB_EVENTS.map((ev) => {
            const on = events.includes(ev.type);
            return (
              <label key={ev.type} className={cn("flex cursor-pointer items-start gap-2.5 rounded-sm px-2 py-1.5 transition-colors duration-150 hover:bg-surface", on && "bg-surface")}>
                <input type="checkbox" checked={on} onChange={() => toggle(ev.type)} className="mt-0.5 size-3.5 accent-[var(--primary)]" />
                <span className="min-w-0">
                  <span className="block font-mono text-[12px] text-fg">{ev.type}</span>
                  <span className="block text-[12px] leading-[16px] text-fg-3">{ev.when}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <FieldError>{error}</FieldError>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          Add endpoint
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Outbound webhooks: what happens here, signed, to Zapier, n8n, Make or your own service. */
export function OutboundPanel({ status, onRefresh }: { status: HubStatus | null; onRefresh: () => void }) {
  const { ws } = useWorkspace();
  const api = useHubApi();
  const [adding, setAdding] = useState(false);
  const hooks = ws?.webhooks ?? [];
  const secret = status?.signing.secret;
  const deliveries = status?.deliveries ?? [];

  return (
    <div className="space-y-6">
      <p className="text-[13px] leading-[19px] text-fg-2">
        I send each event as one signed JSON POST, and retry three times if your endpoint is down. Things other tools push in never trigger these, so nothing loops.
      </p>

      <div>
        {hooks.length > 0 && (
          <ul className="mb-3 divide-y divide-border rounded-md ring-1 ring-border">
            <AnimatePresence initial={false}>
              {hooks.map((w) => (
                <EndpointRow key={w.id} w={w} onRefresh={onRefresh} />
              ))}
            </AnimatePresence>
          </ul>
        )}
        {adding ? (
          <AddEndpoint onDone={() => setAdding(false)} />
        ) : (
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
            {hooks.length ? "Add another endpoint" : "Add an endpoint"}
          </Button>
        )}
      </div>

      <div>
        <SubLabel
          right={
            <ConfirmButton
              confirmLabel="Receivers must update. Rotate?"
              className="-mr-2"
              onConfirm={async () => {
                if (await api("/api/integrations/rotate", { which: "signing" })) {
                  onRefresh();
                  toast("New signing secret ready. Update it wherever you verify.");
                }
              }}
            >
              Rotate
            </ConfirmButton>
          }
        >
          Signing secret
        </SubLabel>
        {secret ? <CopyField value={secret} display={`${secret.slice(0, 10)}${"•".repeat(18)}${secret.slice(-4)}`} label="Copy" /> : <Skeleton className="h-8" />}
        <p className="mt-1.5 text-[12px] leading-[18px] text-fg-3">
          Every request carries <code className="font-mono">webhook-id</code>, <code className="font-mono">webhook-timestamp</code> and{" "}
          <code className="font-mono">webhook-signature</code> (Standard Webhooks, HMAC-SHA256). Zapier can&apos;t check signatures; there the URL itself is the secret.
        </p>
      </div>

      <div className="space-y-3">
        <Disclosure title="What a request looks like">
          <CodeBlock code={EXAMPLE} />
        </Disclosure>
        <Disclosure title="How to verify the signature">
          <CodeBlock code={VERIFY} />
        </Disclosure>
      </div>

      {deliveries.length > 0 && (
        <div>
          <SubLabel>Recent deliveries</SubLabel>
          <ul className="space-y-1.5">
            {deliveries.slice(0, 6).map((d) => {
              const okd = typeof d.status === "number" && d.status >= 200 && d.status < 300;
              const hook = hooks.find((h) => h.id === d.webhookId);
              return (
                <li key={d.id} className="flex items-baseline gap-2.5 text-[13px] leading-[19px]">
                  <StatusDot tone={okd ? "on" : "error"} className="relative -top-px" />
                  <span className="shrink-0 font-mono text-[12px] text-fg-2">{d.type}</span>
                  <span className={cn("min-w-0 flex-1 truncate", okd ? "text-fg-3" : "text-danger")}>
                    {hook ? hook.label || hostOf(hook.url) : "Removed endpoint"} · {typeof d.status === "number" ? d.status : "failed"}
                    {d.attempts > 1 ? ` after ${d.attempts} tries` : ""}
                    {d.test ? " · test" : ""}
                    {!okd && d.error ? ` · ${d.error}` : ""}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-fg-3">
                    <Ago iso={d.at} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
