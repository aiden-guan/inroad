"use client";

import { ArrowUpRight, KeyRound, RotateCw } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useKeyForm } from "@/components/onboarding/key-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import type { ModelTier } from "@/lib/ai/models";
import { providerById, PROVIDERS, type ProviderId } from "@/lib/ai/providers";
import { forgetActiveProvider } from "@/lib/client/ai-provider";
import { Group, Row } from "./parts";
import type { AiStatus } from "./types";
import type { SettingsUpdate, useSettingsStatus } from "./use-settings";

type Settings = ReturnType<typeof useSettingsStatus>;

const selectClass =
  "h-8 w-full min-w-0 rounded-sm bg-surface px-2 text-[13px] text-fg ring-1 ring-border-strong/70 transition-shadow hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-60";

const short = (id: ProviderId) => providerById(id)!.name.replace(/ \(.*\)$/, "");

function keptIn(ai: AiStatus, id: ProviderId): string {
  const s = ai.saved[id];
  if (!s) return "";
  return s.store === "keychain" ? `kept in ${ai.keychain}` : "kept in an encrypted file only your account can read";
}

const TIERS: { tier: ModelTier; label: string }[] = [
  { tier: "strategist", label: "Strategy and positioning" },
  { tier: "operator", label: "Research, drafts and Ask" },
  { tier: "fast", label: "Quick sorting and short rewrites" },
];

/* ───────────── AI provider ───────────── */

export function AiProviderGroup({ settings }: { settings: Settings }) {
  const { status, error: loadError, save } = settings;
  const ai = status?.ai;
  const active = ai?.active ?? null;
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const open = editing || (status !== null && !status.hasKey);
  const shownProvider = providerById(active?.id ?? ai?.chosen ?? "anthropic")!;

  const run = async (label: string, body: SettingsUpdate, done?: string): Promise<boolean> => {
    setBusy(label);
    const problem = await save(body);
    setBusy(null);
    forgetActiveProvider();
    if (problem) {
      toast.error(problem);
      return false;
    }
    if (done) toast(done);
    return true;
  };

  let summary: ReactNode;
  if (!status || !ai) {
    summary = loadError ? <span className="text-danger">{loadError}</span> : <Skeleton className="mt-1 h-4 w-48" />;
  } else if (active?.connectionId) {
    summary = `${active.models.operator}. Manage this account and its credentials under AI connections and task routing.`;
  } else if (active && status.keySource === "settings") {
    summary = (
      <>
        {active.kind === "openai" ? `${active.models.operator} with your key` : "Your key"} <span className="font-mono text-[12px] text-fg-2">{status.keyHint}</span>, {keptIn(ai, active.id)}.
      </>
    );
  } else if (active && status.keySource === "env") {
    summary = active.id === "ollama" ? `${active.models.operator}, running on this computer.` : `Using the ${short(active.id)} key from your environment variables. A key saved here takes priority.`;
  } else if (ai.chosen && ai.saved[ai.chosen] && !active) {
    summary = `${short(ai.chosen)} needs a model picked before it can work.`;
  } else {
    summary = "No provider yet. Research and drafting wait for one; free signals and syncing your tools work without it.";
  }

  const others = (Object.keys(ai?.saved ?? {}) as ProviderId[]).filter((id) => id !== active?.id);

  return (
    <Group
      id="api-key"
      title="AI provider"
      hint="Bring a key from any provider: Anthropic, OpenAI, Google, xAI, Groq, OpenRouter and more, or models running on this computer with Ollama."
      right={
        shownProvider.keyUrl ? (
          <a href={shownProvider.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded-xs text-[12px] text-fg-3 underline-offset-4 transition-colors hover:text-fg hover:underline">
            {shownProvider.needsKey ? `Get ${/^[AEIOU]/.test(short(shownProvider.id)) ? "an" : "a"} ${short(shownProvider.id)} key` : "Get Ollama"} <ArrowUpRight className="size-3" aria-hidden />
          </a>
        ) : undefined
      }
    >
      <Row
        label={
          <span className="flex items-center gap-2">
            <KeyRound className="size-3.5 text-fg-3" aria-hidden />
            {active ? `Connected · ${active.name}` : status ? "Not connected" : "Checking…"}
            {active && <Badge tone="success">Active</Badge>}
          </span>
        }
        hint={summary}
      >
        {active?.connectionId && <a className="text-[13px] text-accent-text underline" href="#ai-routing">Manage connection</a>}
        {active && !active.connectionId && !open && (
          <div className="flex justify-start gap-1.5 sm:justify-end">
            {confirmRemove ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Keep it
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className="ring-1 ring-inset ring-danger/30"
                  loading={busy === "remove"}
                  onClick={async () => {
                    if (await run("remove", { removeKey: active.id }, "Key removed from this computer.")) setConfirmRemove(false);
                  }}
                >
                  Remove key
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>
                  Change
                </Button>
                {status?.keySource === "settings" && (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                    Remove
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </Row>
      {confirmRemove && <p className="px-4 py-2.5 text-[12.5px] text-fg-2">Without a key, research and drafting stop until you add one again. Runs already going will finish.</p>}
      {open && ai && (
        <ConnectForm
          ai={ai}
          save={save}
          canCancel={editing}
          onCancel={() => setEditing(false)}
          onSaved={(name) => {
            setEditing(false);
            forgetActiveProvider();
            settings.reload();
            toast(`${name} connected. Your key checked out.`);
          }}
        />
      )}
      {!open && active?.kind === "openai" && !active.connectionId && ai && <ModelRows ai={ai} run={run} busy={busy} />}
      {!open && active && active.kind === "openai" && ai && (
        <Row
          label="Web research"
          hint={
            ai.webSearch !== "none" ? (
              "Searches use the provider selected under Web search below; pages are read by this app."
            ) : (
              <>
                Choose a provider under Web search below. Until then I read company sites, filings and public records, but can&apos;t search.
              </>
            )
          }
        />
      )}
      {!open && others.length > 0 && ai && (
        <Row label="Also saved" hint="Switch any time; each key stays where it is until you remove it.">
          <div className="flex flex-col gap-1.5 sm:items-end">
            {others.map((id) => (
              <div key={id} className="flex items-center gap-1.5">
                <span className="text-[12.5px] text-fg-2">
                  {short(id)} <span className="font-mono text-[12px] text-fg-3">{ai.saved[id]?.hint}</span>
                </span>
                <Button size="sm" loading={busy === `use-${id}`} onClick={() => void run(`use-${id}`, { ai: { provider: id } }, `Switched to ${short(id)}.`)}>
                  Use
                </Button>
                <Button size="sm" variant="ghost" loading={busy === `remove-${id}`} onClick={() => void run(`remove-${id}`, { removeKey: id }, `${short(id)} key removed.`)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </Row>
      )}
    </Group>
  );
}

/** Pick a provider, paste its key (or an address), and connect. The provider follows a pasted key until one is picked. */
function ConnectForm({ ai, save, canCancel, onCancel, onSaved }: { ai: AiStatus; save: Settings["save"]; canCancel: boolean; onCancel: () => void; onSaved: (name: string) => void }) {
  const form = useKeyForm();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const preset = providerById(form.provider)!;
  const needsAddress = form.provider === "custom" || form.provider === "ollama";
  const saved = ai.saved[form.provider];
  // A key already in this computer's environment works without pasting one.
  const fromEnv = ai.env.includes(form.provider);

  const submit = async () => {
    if (preset.needsKey && !form.key.trim() && (saved || fromEnv)) {
      // Switching back to a provider whose key is saved: nothing to paste.
      const problem = await save({ ai: { provider: form.provider } });
      if (problem) return form.setError(problem);
    } else if (!(await form.submit())) {
      input.current?.focus();
      return;
    }
    onSaved(short(form.provider));
  };

  return (
    <form
      className="px-4 py-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <select id={`${id}-p`} aria-label="AI provider" value={form.provider} onChange={(e) => form.setProvider(e.target.value as ProviderId)} className={selectClass}>
          {PROVIDERS.filter((p) => p.id !== "cloudflare" && p.id !== "vercel").map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {ai.saved[p.id] ? ` · saved ${ai.saved[p.id]!.hint}` : ""}
            </option>
          ))}
        </select>
        {preset.needsKey && (
          <Input
            ref={input}
            autoFocus
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={saved ? `Saved ${saved.hint}. Paste a new key to replace it` : fromEnv ? "Using the key from your environment. Paste one to save it here" : preset.placeholder}
            aria-label={`${short(form.provider)} API key`}
            aria-invalid={!!form.error}
            aria-describedby={`${id}-help`}
            value={form.key}
            onChange={(e) => form.setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && canCancel) {
                e.preventDefault();
                onCancel();
              }
            }}
            className="h-8 font-mono text-[12.5px]"
          />
        )}
        {needsAddress && (
          <Input
            aria-label="API base URL"
            type="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={form.provider === "ollama" ? preset.baseUrl : "https://api.example.com/v1"}
            value={form.baseUrl}
            onChange={(e) => form.setBaseUrl(e.target.value)}
            className="h-8 font-mono text-[12.5px] sm:col-start-2"
          />
        )}
      </div>
      <FieldError>{form.error}</FieldError>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Button type="submit" variant="primary" loading={form.saving} disabled={preset.needsKey && !form.key.trim() && !saved && !fromEnv}>
          {form.saving ? `Checking with ${short(form.provider)}` : "Connect"}
        </Button>
        {canCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <p id={`${id}-help`} className="mt-2 max-w-[62ch] text-pretty text-[12px] leading-[18px] text-fg-3">
        {preset.blurb}{" "}
        {preset.needsKey
          ? `I check the key with ${short(form.provider)}, then keep it in ${ai.keychain} (or, where there's none, an encrypted file only your account can read). It's never shown again, never exported, and sent only to ${short(form.provider)}.`
          : "Nothing leaves this computer."}
      </p>
    </form>
  );
}

/** The model that runs everything, per-task overrides, and optional prices for counting spend. */
function ModelRows({ ai, run, busy }: { ai: AiStatus; run: (label: string, body: SettingsUpdate, done?: string) => Promise<boolean>; busy: string | null }) {
  const active = ai.active!;
  const id = useId();
  const [perTask, setPerTask] = useState(Object.values(ai.models).some(Boolean));
  const main = ai.model ?? active.models.operator;
  const options = ai.available.includes(main) ? ai.available : [main, ...ai.available];
  const price = ai.prices[main];
  const [input, setInput] = useState(price ? String(price.input) : "");
  const [output, setOutput] = useState(price ? String(price.output) : "");
  const dirty = input !== (price ? String(price.input) : "") || output !== (price ? String(price.output) : "");

  return (
    <>
      <Row label="Model" htmlFor={`${id}-m`} hint={ai.available.length ? `Runs everything unless you split it by task. ${ai.available.length} chat models are open to your key.` : "Type the model's name as your provider writes it."} align="start">
        <div className="flex gap-1.5">
          {ai.available.length ? (
            <select id={`${id}-m`} value={main} disabled={busy === "model"} onChange={(e) => void run("model", { ai: { provider: active.id, model: e.target.value } }, `Using ${e.target.value}.`)} className={selectClass}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${id}-m`}
              defaultValue={main}
              spellCheck={false}
              className="h-8 font-mono text-[12.5px]"
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== main && void run("model", { ai: { provider: active.id, model: e.target.value.trim() } }, `Using ${e.target.value.trim()}.`)}
            />
          )}
          <Button size="sm" variant="ghost" aria-label="Read the model list again" loading={busy === "refresh"} onClick={() => void run("refresh", { ai: { provider: active.id, refresh: true } }, "Model list updated.")}>
            <RotateCw className="size-3.5" aria-hidden />
          </Button>
        </div>
      </Row>
      <Row label="Different models per task" hint="A bigger model for strategy, a quicker one for sorting. Optional." align="start">
        {perTask ? (
          <div className="flex flex-col gap-2">
            {TIERS.map(({ tier, label }) => (
              <label key={tier} className="flex flex-col gap-1 text-[12px] text-fg-2">
                {label}
                <select
                  value={ai.models[tier] ?? ""}
                  disabled={busy === `tier-${tier}`}
                  onChange={(e) => void run(`tier-${tier}`, { ai: { provider: active.id, models: { [tier]: e.target.value || null } } })}
                  className={selectClass}
                >
                  <option value="">Same as above ({tier === "fast" ? active.models.fast : main})</option>
                  {options.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : (
          <div className="flex sm:justify-end">
            <Button size="sm" onClick={() => setPerTask(true)}>
              Split by task
            </Button>
          </div>
        )}
      </Row>
      <Row
        label="Prices"
        hint={price ? `Per million tokens for ${main}, so receipts and your monthly budget count real money.` : `Optional. I don't know ${main}'s price, so spend shows as unknown and the monthly budget can't hold. Copy it from your provider's pricing page (per million tokens).`}
        align="start"
      >
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const i = Number(input);
            const o = Number(output);
            if (!input.trim() && !output.trim()) void run("price", { ai: { provider: active.id, prices: { [main]: null } } }, "Price cleared.");
            else if (Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0) void run("price", { ai: { provider: active.id, prices: { [main]: { input: i, output: o } } } }, "Price saved.");
            else toast.error("Use plain numbers, like 1.25 and 10.");
          }}
        >
          <label className="flex items-center gap-1 text-[12px] text-fg-3">
            In $
            <Input inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0.00" className="h-8 w-20 font-mono text-[12.5px]" />
          </label>
          <label className="flex items-center gap-1 text-[12px] text-fg-3">
            Out $
            <Input inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} placeholder="0.00" className="h-8 w-20 font-mono text-[12.5px]" />
          </label>
          {dirty && (
            <Button type="submit" size="sm" variant="primary" loading={busy === "price"}>
              Save
            </Button>
          )}
        </form>
      </Row>
    </>
  );
}
