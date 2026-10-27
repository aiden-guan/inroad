"use client";

import { ArrowUpRight, Check, KeyRound } from "lucide-react";
import { forwardRef, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import type { SettingsStatus } from "@/components/settings/types";
import { cleanBaseUrl, detectProvider, providerById, PROVIDERS, type ProviderId } from "@/lib/ai/providers";

export interface KeyStatus {
  hasKey: boolean;
  keyHint: string | null;
  /** "OpenAI", "Claude": who does the work. */
  providerName?: string;
  /** The model in use, for providers other than Anthropic. */
  model?: string | null;
}

/** Saves the provider and key through /api/settings, which checks the key with the provider first. */
export async function saveProvider(body: { provider: ProviderId; key?: string; baseUrl?: string }): Promise<{ error: string } | { status: KeyStatus }> {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai: { ...body, key: body.key?.trim() || undefined } }),
    });
    const json = await res.json();
    if (!res.ok) return { error: json?.error ?? "That key didn't save. Try again." };
    const s = json as SettingsStatus;
    return { status: { hasKey: s.hasKey, keyHint: s.keyHint, providerName: s.ai.active?.name, model: s.ai.active?.kind === "openai" ? s.ai.active.models.operator : null } };
  } catch {
    return { error: "Couldn't reach the app to save the key. Is it still running?" };
  }
}

/** Save-then-continue state for the key block: which provider, its key, and (Ollama, custom) its address. */
export function useKeyForm() {
  const [provider, setProviderState] = useState<ProviderId>("anthropic");
  // Once the founder picks a provider, a pasted key no longer switches it.
  const [picked, setPicked] = useState(false);
  const [key, setKeyState] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<KeyStatus | null>(null);
  const preset = providerById(provider)!;

  const setProvider = (id: ProviderId) => {
    setProviderState(id);
    setPicked(true);
    setBaseUrl(id === "ollama" ? providerById("ollama")!.baseUrl : "");
    setError(null);
  };
  const setKey = (value: string) => {
    setKeyState(value);
    if (error) setError(null);
    const detected = picked ? null : detectProvider(value);
    if (detected) setProviderState(detected);
  };

  const submit = async (): Promise<boolean> => {
    if (preset.needsKey && !key.trim()) {
      setError(`Paste your ${preset.name.replace(/ \(.*\)$/, "")} key first.`);
      return false;
    }
    if ((provider === "custom" || provider === "ollama") && !cleanBaseUrl(baseUrl || preset.baseUrl)) {
      setError(provider === "custom" ? "Paste the API's base URL, like https://api.example.com/v1." : "That address doesn't work. Ollama is usually at http://localhost:11434/v1.");
      return false;
    }
    setSaving(true);
    setError(null);
    const out = await saveProvider({ provider, key: preset.needsKey ? key : undefined, baseUrl: provider === "custom" || provider === "ollama" ? baseUrl || preset.baseUrl : undefined });
    setSaving(false);
    if ("error" in out) {
      setError(out.error);
      return false;
    }
    setSaved(out.status);
    setKeyState("");
    return true;
  };
  return { provider, setProvider, key, setKey, baseUrl, setBaseUrl, error, setError, saving, saved, submit };
}

export type KeyForm = ReturnType<typeof useKeyForm>;

const selectClass =
  "h-9 w-full rounded-sm bg-surface px-2 text-[13px] text-fg ring-1 ring-border-strong/70 transition-shadow hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:w-auto";

/**
 * The calm inline block that appears only when no AI provider is set up. Never a separate wizard: it sits
 * above the website field, and Start saves the key first. Paste any key and the provider follows it.
 */
export const KeyBlock = forwardRef<
  HTMLInputElement,
  {
    form: KeyForm;
    title?: string;
    /** Shows its own Save button (used after a run failed on the key). */
    onSave?: () => void;
    autoFocus?: boolean;
  }
>(function KeyBlock({ form, title = "Connect your AI provider", onSave, autoFocus }, ref) {
  const id = useId();
  const preset = providerById(form.provider)!;
  if (form.saved?.hasKey) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-fg-2">
        <Check className="size-3.5 text-fg-3" aria-hidden />
        {form.saved.providerName ? `${form.saved.providerName} connected` : "Key saved"}
        {form.saved.keyHint && <span className="font-mono text-[12px] text-fg-3">{form.saved.keyHint}</span>}
        {form.saved.model && <span className="text-[12px] text-fg-3">· {form.saved.model}, change it in Settings</span>}
      </p>
    );
  }
  const custom = form.provider === "custom" || form.provider === "ollama";
  return (
    <div className="rounded-lg bg-surface p-4 shadow-xs ring-1 ring-border">
      <div className="flex items-start gap-2.5">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
        <p className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-fg">
          {title}
        </p>
        {preset.keyUrl && (
          <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 rounded-xs text-[12px] text-accent-text underline-offset-4 hover:underline">
            {preset.needsKey ? "Get a key" : "Get Ollama"} <ArrowUpRight className="size-3" aria-hidden />
          </a>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <select id={`${id}-provider`} aria-label="AI provider" value={form.provider} onChange={(e) => form.setProvider(e.target.value as ProviderId)} className={selectClass}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {preset.needsKey && (
          <Input
            ref={ref}
            id="anthropic-key"
            aria-label={`${preset.name.replace(/ \(.*\)$/, "")} API key`}
            type="password"
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            placeholder={preset.placeholder}
            value={form.key}
            aria-invalid={!!form.error}
            aria-describedby={`anthropic-key-help${form.error ? " anthropic-key-error" : ""}`}
            onChange={(e) => form.setKey(e.target.value)}
            onKeyDown={(e) => {
              if (onSave && e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
            }}
            className="h-9 font-mono text-[13px] sm:flex-1"
          />
        )}
        {onSave && (
          <Button variant="primary" size="md" className="h-9" loading={form.saving} disabled={preset.needsKey && !form.key.trim()} onClick={onSave}>
            {preset.needsKey ? "Save" : "Connect"}
          </Button>
        )}
      </div>
      {custom && (
        <Input
          aria-label="API base URL"
          type="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={form.provider === "ollama" ? preset.baseUrl : "https://api.example.com/v1"}
          value={form.baseUrl}
          onChange={(e) => form.setBaseUrl(e.target.value)}
          className="mt-2 h-9 font-mono text-[13px]"
        />
      )}
      <p id="anthropic-key-help" className="mt-1.5 text-pretty text-[12px] text-fg-3">
        {preset.needsKey
          ? "Uses your provider’s API credits. Your key is stored securely on this computer."
          : preset.blurb}
      </p>
      <div id="anthropic-key-error" role="alert"><FieldError>{form.error}</FieldError></div>
    </div>
  );
});
