"use client";

import { ArrowUpRight, Check, KeyRound } from "lucide-react";
import { forwardRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";

export interface KeyStatus {
  hasKey: boolean;
  keyHint: string | null;
}

/** Saves the key through /api/settings, which validates it with Anthropic. Returns an error message or null. */
export async function saveKey(key: string): Promise<{ error: string } | { status: KeyStatus }> {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anthropicApiKey: key.trim() }),
    });
    const body = await res.json();
    if (!res.ok) return { error: body?.error ?? "That key didn't save. Try again." };
    return { status: body as KeyStatus };
  } catch {
    return { error: "Couldn't reach the app to save the key. Is it still running?" };
  }
}

/**
 * The calm inline block that appears only when no Anthropic key is configured. Never a separate wizard: it sits
 * above the website field, and Start saves the key first.
 */
export const KeyBlock = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (v: string) => void;
    error?: string | null;
    saved?: KeyStatus | null;
    title?: string;
    /** Shows its own Save button (used after a run failed on the key). */
    onSave?: () => void;
    saving?: boolean;
    autoFocus?: boolean;
  }
>(function KeyBlock({ value, onChange, error, saved, title = "I run on your Anthropic API key.", onSave, saving, autoFocus }, ref) {
  if (saved?.hasKey) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-fg-2">
        <Check className="size-3.5 text-fg-3" aria-hidden />
        Key saved{saved.keyHint && <span className="font-mono text-[12px] text-fg-3">{saved.keyHint}</span>}
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-surface p-4 shadow-xs ring-1 ring-border">
      <div className="flex items-start gap-2.5">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
        <label htmlFor="anthropic-key" className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-fg">
          {title}
        </label>
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-0.5 rounded-xs text-[12px] text-accent-text underline-offset-4 hover:underline"
        >
          Get a key <ArrowUpRight className="size-3" aria-hidden />
        </a>
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          ref={ref}
          id="anthropic-key"
          type="password"
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={value}
          aria-invalid={!!error}
          aria-describedby="anthropic-key-help"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onSave && e.key === "Enter") {
              e.preventDefault();
              onSave();
            }
          }}
          className="h-9 font-mono text-[13px]"
        />
        {onSave && (
          <Button variant="primary" size="md" className="h-9" loading={saving} disabled={!value.trim()} onClick={onSave}>
            Save
          </Button>
        )}
      </div>
      <p id="anthropic-key-help" className="mt-1.5 text-[12px] text-fg-3">
        Stored only on this computer, never sent anywhere but Anthropic.
      </p>
      <FieldError>{error}</FieldError>
    </div>
  );
});

/** Save-then-continue state for the key block. */
export function useKeyForm() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<KeyStatus | null>(null);
  const submit = async (): Promise<boolean> => {
    if (!key.trim()) {
      setError("Paste your key first. It starts with sk-ant-.");
      return false;
    }
    setSaving(true);
    setError(null);
    const out = await saveKey(key);
    setSaving(false);
    if ("error" in out) {
      setError(out.error);
      return false;
    }
    setSaved(out.status);
    setKey("");
    return true;
  };
  return { key, setKey, error, setError, saving, saved, submit };
}
