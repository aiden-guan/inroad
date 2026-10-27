"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { AI_TASKS, type AiConnection, type AiRouting, type AiTask, type ModelTarget, type RoutingStatus } from "@/lib/ai/routing-types";
import { PROVIDERS, providerById, type ProviderId } from "@/lib/ai/providers";
import { forgetActiveProvider } from "@/lib/client/ai-provider";
import { Group, Row } from "./parts";

const selectClass = "w-full rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-fg disabled:opacity-50";

export function AiRoutingGroup({ reload, revision }: { reload: () => void; revision?: unknown }) {
  const [status, setStatus] = useState<RoutingStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AiConnection | "new">();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/connections", { cache: "no-store" }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (!cancelled) setStatus(data);
    }).catch(() => { if (!cancelled) setError("Couldn't read AI connections. Reload Settings to try again."); });
    return () => { cancelled = true; };
  }, [revision]);

  async function post(body: unknown): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/ai/connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't save AI connections.");
      setStatus(data); forgetActiveProvider(); reload(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't reach the app."); return false; }
    finally { setBusy(false); }
  }
  const routing = status?.routing;
  const updateRouting = (patch: Partial<AiRouting>) => routing && post({ action: "routing", routing: { ...routing, ...patch } });
  const setTask = (task: AiTask, target?: ModelTarget) => {
    if (!routing) return;
    const tasks = { ...routing.tasks };
    if (target) tasks[task] = target; else delete tasks[task];
    void updateRouting({ tasks });
  };
  return <Group id="ai-routing" title="AI connections and task routing"
    hint="Save any number of accounts, local servers, or gateways. Each keeps its own credentials and models. Task choices take priority over automatic routing."
    right={<Button size="sm" disabled={busy} onClick={() => setEditing("new")}>Add connection</Button>}>
    {error && <p className="px-4 py-3 text-[13px] text-danger" role="alert">{error}</p>}
    {!status && !error && <p className="px-4 py-3 text-[13px] text-fg-3">Loading connections…</p>}
    {status?.connections.map((c) => <Row key={c.id} label={c.name}
      hint={`${providerById(c.provider)?.name} · ${c.model} · ${status.ready[c.id] ? c.key ? `saved key ${c.key.hint}` : c.provider === "ollama" ? "local server" : "server credentials" : "disabled or missing credentials"}${c.auto ? " · eligible for automatic routing" : ""}`}>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy || !status.ready[c.id]} onClick={() => void updateRouting({ defaultConnectionId: c.id })}>
          {(routing?.defaultConnectionId ?? "legacy") === c.id ? "Default" : "Make default"}
        </Button>
        {c.id !== "legacy" && <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(c)}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void post({ action: "remove", id: c.id })}>Remove</Button>
        </>}
        {c.id === "legacy" && <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" disabled={busy} checked={c.auto} onChange={(e) => void updateRouting({ includeOriginal: e.target.checked })} />Allow automatic routing</label>}
      </div>
    </Row>)}
    {editing && <ConnectionEditor key={editing === "new" ? "new" : editing.id} connection={editing === "new" ? undefined : editing} busy={busy}
      cancel={() => { setEditing(undefined); setError(""); }} save={async (connection) => { if (await post({ action: "save", connection })) setEditing(undefined); }} />}
    {status && routing && <>
      <Row label="Routing mode" hint="Automatic routing uses enabled connections, task strengths, configured tier models, and known prices. It estimates fit; it does not run model benchmarks.">
        <select aria-label="AI routing mode" className={selectClass} value={routing.mode} disabled={busy} onChange={(e) => void updateRouting({ mode: e.target.value as AiRouting["mode"] })}>
          <option value="manual">Default and task selections</option><option value="auto">Automatic task routing</option>
        </select>
      </Row>
      {routing.mode === "auto" && <Row label="Routing preference" hint="Quality prefers task fit. Balanced breaks fit ties by price. Lowest cost prefers known prices; unknown prices are never treated as free.">
        <select aria-label="Routing preference" className={selectClass} value={routing.policy} disabled={busy} onChange={(e) => void updateRouting({ policy: e.target.value as AiRouting["policy"] })}>
          <option value="quality">Task fit</option><option value="balanced">Balanced</option><option value="cost">Lowest known cost</option>
        </select>
      </Row>}
      <details className="px-4 py-3">
        <summary className="cursor-pointer text-[13px] font-medium">Choose a model for each task</summary>
        <p className="mt-2 text-[12px] text-fg-3">Choices apply to future runs. Image generation keeps its separate image provider setting. Web-search sources stay in Search settings.</p>
        <div className="mt-3 space-y-3">{Object.entries(AI_TASKS).map(([id, label]) => {
          const task = id as AiTask;
          const target = routing.tasks[task];
          const connection = status.connections.find((c) => c.id === target?.connectionId);
          return <div key={task} className="grid items-start gap-2 sm:grid-cols-[160px_1fr]">
            <label htmlFor={`route-${task}`} className="pt-2 text-[13px]">{label}</label>
            <div className="space-y-2">
              <select id={`route-${task}`} className={selectClass} disabled={busy} value={target?.connectionId ?? ""} onChange={(e) => setTask(task, e.target.value ? { connectionId: e.target.value } : undefined)}>
                <option value="">Follow routing mode</option>
                {status.connections.map((c) => <option key={c.id} value={c.id} disabled={!status.ready[c.id]}>{c.name}</option>)}
              </select>
              {connection && <select aria-label={`${label} model`} className={selectClass} disabled={busy || Boolean(connection.cloudflare?.dynamicRoute)} value={target?.model ?? ""} onChange={(e) => setTask(task, { connectionId: connection.id, ...(e.target.value ? { model: e.target.value } : {}) })}>
                <option value="">Use this connection’s tier models</option>
                {[...new Set([connection.model, ...Object.values(connection.models), ...connection.available])].map((model) => <option key={model} value={model}>{model}</option>)}
              </select>}
            </div>
          </div>;
        })}</div>
      </details>
    </>}
  </Group>;
}

function ConnectionEditor({ connection, busy, cancel, save }: { connection?: AiConnection; busy: boolean; cancel: () => void; save: (input: unknown) => Promise<void> }) {
  const id = useId();
  const [provider, setProvider] = useState<ProviderId>(connection?.provider ?? "vercel");
  const [name, setName] = useState(connection?.name ?? "");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "");
  const [model, setModel] = useState(connection?.model ?? "");
  const [models, setModels] = useState(connection?.models ?? {});
  const [accountId, setAccountId] = useState(connection?.cloudflare?.accountId ?? "");
  const [gatewayId, setGatewayId] = useState(connection?.cloudflare?.gatewayId ?? "default");
  const [dynamicRoute, setDynamicRoute] = useState(connection?.cloudflare?.dynamicRoute ?? "");
  const [collectLogs, setCollectLogs] = useState(connection?.cloudflare?.collectLogs ?? false);
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [auto, setAuto] = useState(connection?.auto ?? true);
  const [strengths, setStrengths] = useState<AiConnection["strengths"]>(connection?.strengths ?? []);
  const [contextWindow, setContextWindow] = useState(String(connection?.contextWindow ?? ""));
  const [inputPrice, setInputPrice] = useState(String(connection?.prices[model]?.input ?? ""));
  const [outputPrice, setOutputPrice] = useState(String(connection?.prices[model]?.output ?? ""));
  const preset = providerById(provider)!;
  const field = (label: string, value: string, change: (value: string) => void, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label className="block space-y-1 text-[12px] text-fg-2">
    <span>{label}</span><Input value={value} onChange={(e) => change(e.target.value)} {...props} />
  </label>;
  return <form className="space-y-3 bg-bg-subtle/40 px-4 py-4" onSubmit={(e) => {
    e.preventDefault();
    const prices = { ...connection?.prices };
    if (model && inputPrice !== "" && outputPrice !== "") prices[model] = { input: Number(inputPrice), output: Number(outputPrice) };
    void save({ id: connection?.id, name: name.trim() || preset.name, provider, key: key.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined, model: model.trim() || undefined, models, prices, enabled, auto, strengths,
      contextWindow: contextWindow ? Number(contextWindow) : undefined,
      cloudflare: provider === "cloudflare" ? { accountId: accountId.trim(), gatewayId: gatewayId.trim(), dynamicRoute: dynamicRoute.trim() || undefined, collectLogs } : undefined });
  }}>
    <p className="text-[13px] font-medium">{connection ? `Edit ${connection.name}` : "Add an AI connection"}</p>
    <label className="block space-y-1 text-[12px] text-fg-2"><span>Provider</span>
      <select aria-label="Connection provider" className={selectClass} disabled={Boolean(connection) || busy} value={provider} onChange={(e) => { setProvider(e.target.value as ProviderId); setModel(""); setModels({}); setInputPrice(""); setOutputPrice(""); }}>
        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
    {field("Connection name", name, setName, { placeholder: `${preset.name} · work account`, maxLength: 100 })}
    {preset.needsKey && field("API key", key, setKey, { type: "password", autoComplete: "new-password", placeholder: connection?.key ? `Keep saved key ${connection.key.hint}` : preset.placeholder })}
    {(provider === "custom" || provider === "ollama") && field("API base URL", baseUrl, setBaseUrl, { placeholder: preset.baseUrl || "https://api.example.com/v1" })}
    {provider === "vercel" && <p className="text-[12px] text-fg-3">Uses Vercel’s Chat Completions API and provider/model IDs. Save to load the current model catalog. Configure upstream keys and provider policies in your Vercel gateway. <a href="https://vercel.com/docs/ai-gateway" target="_blank" rel="noreferrer" className="underline">Gateway guide</a></p>}
    {provider === "cloudflare" && <>
      {field("Cloudflare account ID", accountId, setAccountId, { required: true, placeholder: "32-character account ID" })}
      {field("Gateway ID", gatewayId, setGatewayId, { required: true, placeholder: "default" })}
      <p className="text-[12px] text-fg-3">Uses the current account REST API. Your token needs Account → Workers AI → Read, even for third-party models. Enable billing or configure upstream keys in Cloudflare. Model IDs come from the <a className="underline" href="https://developers.cloudflare.com/ai/models/" target="_blank" rel="noreferrer">Cloudflare catalog</a>. Saving does not run paid inference or verify this token.</p>
      <details><summary className="cursor-pointer text-[12px]">Cloudflare dynamic route</summary>
        <div className="mt-2">{field("Dynamic route name (optional)", dynamicRoute, setDynamicRoute, { placeholder: "my-route" })}</div>
        <p className="mt-1 text-[12px] text-fg-3">Use an existing gateway route. This mode uses the account REST endpoint and dynamic/route-name. Enable gateway authentication and store upstream keys with Cloudflare BYOK. Leave blank for the current REST API.</p>
      </details>
      <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={collectLogs} onChange={(e) => setCollectLogs(e.target.checked)} />Allow Cloudflare to collect request logs</label>
    </>}
    {field("Default model ID", model, (value) => {
      setModel(value);
      setInputPrice(String(connection?.prices[value]?.input ?? ""));
      setOutputPrice(String(connection?.prices[value]?.output ?? ""));
    }, { list: `${id}-models`, placeholder: provider === "vercel" || provider === "cloudflare" ? "provider/model" : "Enter a tool-capable chat model ID", disabled: Boolean(dynamicRoute) && provider === "cloudflare" })}
    <datalist id={`${id}-models`}>{connection?.available.map((m) => <option key={m} value={m} />)}</datalist>
    <details><summary className="cursor-pointer text-[12px]">Tier models, prices, and context limit</summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {(["strategist", "operator", "fast"] as const).map((tier) => <div key={tier}>{field(`${tier === "strategist" ? "Reasoning" : tier === "operator" ? "Research and writing" : "Fast tasks"} model`, models[tier] ?? "", (value) => setModels((prev) => {
          const next = { ...prev }; if (value.trim()) next[tier] = value.trim(); else delete next[tier]; return next;
        }), { list: `${id}-models`, placeholder: "Use default model", disabled: Boolean(dynamicRoute) && provider === "cloudflare" })}</div>)}
        {field("Context window (tokens, optional)", contextWindow, setContextWindow, { type: "number", min: 1024, placeholder: "Unknown" })}
        {field("Default model input $ / million tokens", inputPrice, setInputPrice, { type: "number", min: 0, step: "any", required: outputPrice !== "", placeholder: "Use published price, if available" })}
        {field("Default model output $ / million tokens", outputPrice, setOutputPrice, { type: "number", min: 0, step: "any", required: inputPrice !== "", placeholder: "Use published price, if available" })}
      </div>
      <p className="mt-2 text-[12px] text-fg-3">Models must support chat and tools. Leave prices blank when unknown. Save again to refresh the catalog. Context limits are estimates and apply when routing automatically.</p>
    </details>
    <fieldset><legend className="mb-1 text-[12px] text-fg-2">Prefer this connection for</legend>
      <div className="flex flex-wrap gap-3">{(["reasoning", "writing", "research", "fast"] as const).map((strength) => <label key={strength} className="flex items-center gap-1.5 text-[12px]">
        <input type="checkbox" checked={strengths.includes(strength)} onChange={(e) => setStrengths(e.target.checked ? [...strengths, strength] : strengths.filter((s) => s !== strength))} />{strength === "fast" ? "Fast tasks" : strength[0].toUpperCase() + strength.slice(1)}
      </label>)}</div>
    </fieldset>
    <div className="flex flex-wrap gap-4 text-[12px]">
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Enabled</label>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />Allow automatic routing</label>
    </div>
    <div className="flex gap-2"><Button type="submit" size="sm" loading={busy}>Save connection</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancel}>Cancel</Button></div>
  </form>;
}
