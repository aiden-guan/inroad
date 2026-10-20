"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, ChevronDown, KeyRound, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Favicon } from "@/components/ui/favicon";
import { Input, Label, FieldError } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { ACCESS, accessOf, CLIENTS, clientMeta, TOOL_VERBS, type AccessLevel, type AgentCall, type AgentClient, type ApiKeyPublic } from "@/lib/api-keys/types";
import { cn } from "@/lib/client/cn";
import { ease } from "@/lib/motion";
import { Ago, Callout, ConfirmButton, CopyField, LOCAL_ORIGIN, SubLabel, useNow, useOrigin } from "./bits";
import { Snippets } from "./snippets";
import { useAgentKeys } from "./use-keys";

/**
 * Lets the founder plug other agents (Meta Muse, Claude Code/Desktop, Cursor, ChatGPT, n8n, AI SDRs)
 * into Inroad over MCP or REST: generate a scoped key, copy a per-client snippet, see each key's
 * activity, revoke. Those agents pay for their own inference, so this traffic costs zero tokens.
 */

function ClientMark({ client, size = 20 }: { client: AgentClient; size?: number }) {
  const meta = clientMeta(client);
  if (!meta.domain) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center rounded-[5px] bg-surface text-fg-3 ring-1 ring-border" style={{ width: size, height: size }}>
        <Bot className="size-[60%]" aria-hidden />
      </span>
    );
  }
  return <Favicon domain={meta.domain} name={meta.name} size={size} />;
}

/** "Muse added 40 companies (12 new)". */
function callLine(call: AgentCall, keyName: string): string {
  if (!call.ok) return `${keyName} couldn't ${TOOL_VERBS[call.tool] ?? call.tool}: ${call.summary}`;
  const s = call.summary;
  return `${keyName} ${s.charAt(0).toLowerCase()}${s.slice(1)}`;
}

function Feed({ calls, keyName }: { calls: AgentCall[]; keyName: string }) {
  if (!calls.length) {
    return (
      <div className="flex items-center gap-2.5 rounded-md bg-bg-subtle px-3 py-2.5 text-[13px]" aria-live="polite">
        <span aria-hidden className="size-2 shrink-0 rounded-full ring-1 ring-fg-4" />
        <span className="shimmer-text">Waiting for the first call…</span>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md ring-1 ring-border" aria-live="polite">
      <AnimatePresence initial={false}>
        {calls.slice(0, 12).map((c) => (
          <motion.li key={c.id} layout="position" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: ease.out }} className="flex items-baseline gap-3 px-3 py-2 text-[13px]">
            <span className="w-14 shrink-0 font-mono text-[11px] text-fg-3">
              <Ago iso={c.at} />
            </span>
            <span className={cn("min-w-0 flex-1 text-pretty", c.ok ? "text-fg-2" : "text-danger")}>{callLine(c, keyName)}</span>
            <span className="hidden shrink-0 font-mono text-[10.5px] uppercase tracking-wide text-fg-4 sm:inline">{c.via}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/* ───────────── Create a key ───────────── */

function CreateKey({ onCreated, onCancel, create }: { onCreated: (key: ApiKeyPublic, token: string) => void; onCancel: () => void; create: ReturnType<typeof useAgentKeys>["create"] }) {
  const [client, setClient] = useState<AgentClient>("muse");
  const [access, setAccess] = useState<AccessLevel>(clientMeta("muse").access);
  const [name, setName] = useState("Muse");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickClient = (c: AgentClient) => {
    setClient(c);
    setAccess(clientMeta(c).access);
    if (!nameTouched) setName(c === "other" ? "" : clientMeta(c).name.replace(/^Meta /, ""));
  };

  async function submit() {
    if (!name.trim()) {
      setError("Name the key so you can tell agents apart in the activity feed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await create({ name: name.trim(), client, access });
      onCreated(r.key, r.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="grid grid-cols-[minmax(0,1fr)] gap-4 border-b border-border px-4 py-4 animate-[rise-in_180ms_var(--ease-out)]"
    >
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-fg">Which agent is this for?</legend>
        <div className="flex flex-wrap gap-1.5">
          {CLIENTS.map((c) => (
            <label key={c.id} className="relative">
              <input type="radio" name="agent-client" value={c.id} checked={client === c.id} onChange={() => pickClient(c.id)} className="peer sr-only" />
              <span
                className={cn(
                  "inline-flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-sm px-2.5 text-[13px] ring-1 transition-[background-color,box-shadow,color,transform] duration-150 active:scale-[0.97]",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)]",
                  client === c.id ? "bg-surface font-medium text-fg shadow-xs ring-border-strong" : "text-fg-2 ring-border hover:bg-bg-subtle",
                )}
              >
                <ClientMark client={c.id} size={16} />
                {c.name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-fg">What can it do?</legend>
        <div className="grid gap-1.5">
          {ACCESS.map((a) => (
            <label key={a.id} className="relative block">
              <input type="radio" name="agent-access" value={a.id} checked={access === a.id} onChange={() => setAccess(a.id)} className="peer sr-only" />
              <span
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 ring-1 transition-[background-color,box-shadow] duration-150",
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)]",
                  access === a.id ? "bg-surface shadow-xs ring-border-strong" : "ring-border hover:bg-bg-subtle",
                )}
              >
                <span aria-hidden className={cn("mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full ring-1", access === a.id ? "bg-primary ring-primary" : "ring-border-strong")}>
                  {access === a.id && <span className="size-1.5 rounded-full bg-primary-fg" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-fg">{a.label}</span>
                  <span className="block text-[12.5px] leading-[18px] text-fg-3">{a.blurb}</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="max-w-[320px]">
        <Label htmlFor="agent-key-name" hint="Shown in the activity feed">
          Name
        </Label>
        <Input
          id="agent-key-name"
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          placeholder="Muse"
        />
        <FieldError>{error}</FieldError>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" icon={<KeyRound className="size-3.5" />} loading={busy}>
          Create key
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Shown once, right after creation: the token, the snippet for this client, and a live first-call check. */
function Reveal({ keyRow, token, base, localBase, isLocal, onDone }: { keyRow: ApiKeyPublic; token: string; base: string; localBase: string; isLocal: boolean; onDone: () => void }) {
  const connected = Boolean(keyRow.lastUsedAt);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-b border-border px-4 py-4 animate-[rise-in_180ms_var(--ease-out)]">
      <div>
        <p className="flex items-center gap-2 text-[14px] font-medium text-fg">
          <Check className="size-4 text-success" aria-hidden /> Key for {keyRow.name} created
        </p>
        <p className="mt-1 text-[13px] text-fg-3">Copy it now. It&apos;s shown once; I only keep a fingerprint of it.</p>
        <CopyField value={token} className="mt-2.5" label="Copy key" />
      </div>
      <Snippets token={token} base={base} localBase={localBase} isLocal={isLocal} initial={clientMeta(keyRow.client).snippet} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px]" aria-live="polite">
          {connected ? (
            <>
              <span aria-hidden className="size-2 rounded-full bg-success" />
              <span className="text-fg-2">
                Connected{keyRow.lastClient ? ` from ${keyRow.lastClient}` : ""} · first call <Ago iso={keyRow.lastUsedAt} />
              </span>
            </>
          ) : (
            <>
              <span aria-hidden className="size-2 rounded-full ring-1 ring-fg-4" />
              <span className="shimmer-text">Waiting for {keyRow.name}&apos;s first call…</span>
            </>
          )}
        </p>
        <Button variant={connected ? "primary" : "secondary"} size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/* ───────────── One key ───────────── */

function KeyRow({
  k,
  calls,
  open,
  onToggle,
  onRevoke,
  base,
  localBase,
  isLocal,
}: {
  k: ApiKeyPublic;
  calls: AgentCall[];
  open: boolean;
  onToggle: () => void;
  onRevoke: () => void;
  base: string;
  localBase: string;
  isLocal: boolean;
}) {
  const now = useNow();
  const access = ACCESS.find((a) => a.id === accessOf(k.scopes))!;
  const live = Boolean(k.lastUsedAt && now && now - Date.parse(k.lastUsedAt) < 10 * 60_000);
  return (
    <motion.li layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.24, ease: ease.out }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-bg-subtle/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
      >
        <ClientMark client={k.client} size={24} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-[14px] font-medium text-fg">{k.name}</span>
            <Badge tone="outline">{access.label}</Badge>
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-fg-3">
            {k.lastUsedAt ? (
              <>
                Last call <Ago iso={k.lastUsedAt} /> · <span className="tnum">{k.calls.toLocaleString("en-US")}</span> call{k.calls === 1 ? "" : "s"}
              </>
            ) : (
              "No calls yet"
            )}
            <span className="hidden sm:inline">
              {" · "}
              <span className="font-mono text-[11.5px]">{k.preview}</span>
            </span>
          </span>
        </span>
        {live && <span aria-label="Active in the last 10 minutes" className="size-1.5 shrink-0 rounded-full bg-success" />}
        <ChevronDown className={cn("size-4 shrink-0 text-fg-3 transition-transform duration-200 ease-out-quad", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-4 pb-4 pt-1 animate-[rise-in_180ms_var(--ease-out)]">
          <div>
            <SubLabel>Activity</SubLabel>
            <Feed calls={calls} keyName={k.name} />
          </div>
          <div>
            <SubLabel>Set it up</SubLabel>
            <Snippets base={base} localBase={localBase} isLocal={isLocal} initial={clientMeta(k.client).snippet} />
            <p className="mt-2 text-[12px] leading-[18px] text-fg-3">Use the key you copied when you created it. Lost it? Revoke this one and create a new key.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[12px] text-fg-3">
              {access.blurb} <span className="font-mono sm:hidden">{k.preview}</span>
            </p>
            <ConfirmButton confirmLabel="Click again to revoke" onConfirm={onRevoke}>
              Revoke key
            </ConfirmButton>
          </div>
        </div>
      )}
    </motion.li>
  );
}

/* ───────────── Public address (shared with inbound webhooks) ───────────── */

function PublicAddress({ origin, publicUrl }: { origin: string; publicUrl: string }) {
  const { dispatch } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(publicUrl);
  const [error, setError] = useState<string | null>(null);
  const isLocal = !publicUrl && LOCAL_ORIGIN.test(origin);

  async function save(next: string) {
    const v = next.trim().replace(/\/+$/, "");
    if (v && !/^https:\/\/[^\s/]+\.[^\s/]+$/i.test(v)) {
      setError("Paste the https address your tunnel printed, like https://quiet-river.trycloudflare.com");
      return;
    }
    setError(null);
    // One public address for the whole app: hook URLs and agent snippets both use it.
    const ok = await dispatch({ type: "integration.update", id: "webhook_in", patch: { config: { publicUrl: v, publicUrlTunnel: false } } });
    if (ok) {
      setEditing(false);
      toast.success(v ? "Muse and cloud tools now use your public address." : "Back to the local address.");
    }
  }

  if (isLocal && !editing) {
    return (
      <p className="text-[12px] leading-[18px] text-fg-3">
        Muse, ChatGPT and Zapier run in the cloud and need a public https address.{" "}
        <button
          type="button"
          className="font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:decoration-fg"
          onClick={() => setEditing(true)}
        >
          Set one up
        </button>
      </p>
    );
  }

  if (!isLocal && !editing) {
    return (
      <p className="text-[12px] leading-[18px] text-fg-3">
        {publicUrl ? "Public address" : "Address"} <span className="break-all font-mono text-fg-2">{publicUrl || origin}</span>
        {" · "}
        <button
          type="button"
          className="font-medium text-fg-2 underline decoration-border-strong underline-offset-2 hover:decoration-fg"
          onClick={() => {
            setValue(publicUrl);
            setEditing(true);
          }}
        >
          {publicUrl ? "Change" : "Use a public address"}
        </button>
      </p>
    );
  }

  return (
    <Callout>
      <p>
        {isLocal ? (
          <>
            <span className="font-medium">Cloud agents can&apos;t reach this computer.</span> Muse, ChatGPT and Zapier need a public https address. Start a tunnel and paste the address it prints.
            Claude Code, Cursor and Claude Desktop work as is.
          </>
        ) : (
          "Paste the https address your tunnel prints. Tunnel addresses change when you restart them."
        )}
      </p>
      <CopyField value={`cloudflared tunnel --url ${origin || "http://localhost:3000"}`} className="mt-2.5" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
        className="mt-2.5 flex flex-col gap-2 sm:flex-row"
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://your-tunnel.trycloudflare.com" aria-label="Public address" spellCheck={false} className="font-mono text-[12px]" />
        <div className="flex shrink-0 gap-2">
          <Button type="submit">Use this address</Button>
          {publicUrl && (
            <Button type="button" variant="ghost" onClick={() => void save("")}>
              Clear
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
      <FieldError>{error}</FieldError>
    </Callout>
  );
}

/* ───────────── The card ───────────── */

export function AgentsCard() {
  const { ws } = useWorkspace();
  const origin = useOrigin();
  const [mode, setMode] = useState<"idle" | "create">("idle");
  const [fresh, setFresh] = useState<{ id: string; token: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, refresh, create, revoke } = useAgentKeys(Boolean(fresh));

  const publicUrl = typeof ws?.integrations.webhook_in?.config.publicUrl === "string" ? ws.integrations.webhook_in.config.publicUrl : "";
  const base = (publicUrl || origin).replace(/\/+$/, "");
  const localBase = origin.replace(/\/+$/, "");
  const isLocal = !publicUrl && LOCAL_ORIGIN.test(origin);

  const keys = useMemo(() => [...(data?.keys ?? [])].sort((a, b) => (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt)), [data]);
  const callsByKey = useMemo(() => {
    const m = new Map<string, AgentCall[]>();
    for (const c of data?.calls ?? []) m.set(c.keyId, [...(m.get(c.keyId) ?? []), c]);
    return m;
  }, [data]);
  const freshKey = fresh ? data?.keys.find((k) => k.id === fresh.id) : undefined;
  const listed = keys.filter((k) => k.id !== fresh?.id);

  const onRevoke = async (k: ApiKeyPublic) => {
    try {
      await revoke(k.id);
      toast(`Revoked ${k.name}'s key. Calls with it fail from now on.`);
      if (openId === k.id) setOpenId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke that key.");
    }
  };

  const startCreate = () => {
    setFresh(null);
    setMode("create");
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface text-fg-3 shadow-xs ring-1 ring-border" aria-hidden>
          <Bot className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-fg">Agent keys</p>
          <p className="truncate text-[12.5px] text-fg-3">
            {keys.length ? `${keys.length} key${keys.length === 1 ? "" : "s"} · MCP and REST` : "MCP and REST, on the agent's own AI credits"}
          </p>
        </div>
        {mode !== "create" && !fresh && keys.length > 0 && (
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={startCreate}>
            <span className="hidden sm:inline">Generate agent key</span>
            <span className="sm:hidden">New key</span>
          </Button>
        )}
      </div>

      {mode === "create" && (
        <CreateKey
          create={create}
          onCancel={() => setMode("idle")}
          onCreated={(k, token) => {
            setMode("idle");
            setFresh({ id: k.id, token });
          }}
        />
      )}
      {fresh && freshKey && (
        <Reveal
          keyRow={freshKey}
          token={fresh.token}
          base={base}
          localBase={localBase}
          isLocal={isLocal}
          onDone={() => {
            setFresh(null);
            setOpenId(freshKey.id);
            void refresh();
          }}
        />
      )}

      {error && !data ? (
        <div className="flex flex-wrap items-center gap-2 px-4 py-4 text-[13px] text-danger">
          {error}
          <Button size="xs" variant="ghost" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <div className="divide-y divide-border" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-6 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-52 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : !keys.length && mode !== "create" ? (
        <div className="px-4 py-7 text-center sm:px-8">
          <p className="font-serif text-[20px] leading-[26px] tracking-[-0.01em] text-fg">No agents connected yet</p>
          <p className="mx-auto mt-2 max-w-[46ch] text-[13.5px] leading-[20px] text-fg-2 text-pretty">
            Generate a key, paste one line into Claude Code or a prompt into Muse, and its first call shows up here. Every call is logged under the key that made it.
          </p>
          <Button className="mt-4" variant="primary" icon={<Plus className="size-3.5" />} onClick={startCreate}>
            Generate agent key
          </Button>
        </div>
      ) : listed.length ? (
        <ul className="divide-y divide-border">
          <AnimatePresence initial={false}>
            {listed.map((k) => (
              <KeyRow
                key={k.id}
                k={k}
                calls={callsByKey.get(k.id) ?? []}
                open={openId === k.id}
                onToggle={() => setOpenId(openId === k.id ? null : k.id)}
                onRevoke={() => void onRevoke(k)}
                base={base}
                localBase={localBase}
                isLocal={isLocal}
              />
            ))}
          </AnimatePresence>
        </ul>
      ) : null}

      <div className="grid gap-3 border-t border-border bg-bg-subtle/40 px-4 py-3.5">
        <div className="grid items-center gap-x-3 gap-y-1.5 sm:grid-cols-[88px_1fr]">
          <span className="text-[12px] text-fg-3">MCP server</span>
          <CopyField value={`${base}/api/mcp`} />
          <span className="text-[12px] text-fg-3">REST API</span>
          <div className="flex min-w-0 items-center gap-2">
            <CopyField value={`${base}/api/v1`} className="min-w-0 flex-1" />
            <a
              href="/api/v1/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[12px] font-medium text-fg-2 underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-fg"
            >
              OpenAPI
            </a>
          </div>
        </div>
        {origin && <PublicAddress key={publicUrl} origin={origin} publicUrl={publicUrl} />}
      </div>
    </Card>
  );
}
