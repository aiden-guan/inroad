"use client";

import { ArrowUpRight, KeyRound } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { ChoiceList, Group, Row, SettingsSection } from "./parts";
import type { NewsSource } from "./types";
import { useThemePref, type ThemePref, type useSettingsStatus } from "./use-settings";

type Settings = ReturnType<typeof useSettingsStatus>;

export function GeneralSection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="general" title="General" description="The key I run on, how the app looks, and where news signals come from.">
      <ApiKeyGroup settings={settings} />
      <Group title="Appearance">
        <ThemeRow />
      </Group>
      <NewsGroup settings={settings} />
    </SettingsSection>
  );
}

/* ───────────── Anthropic API key ───────────── */

function ApiKeyGroup({ settings }: { settings: Settings }) {
  const { status, error: loadError, save } = settings;
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const open = editing || (status !== null && !status.hasKey);

  const submit = async () => {
    if (!key.trim()) {
      setError("Paste your key first. It starts with sk-ant-.");
      input.current?.focus();
      return;
    }
    setBusy("save");
    setError(null);
    const problem = await save({ anthropicApiKey: key.trim() });
    setBusy(null);
    if (problem) {
      setError(problem);
      input.current?.focus();
      return;
    }
    setKey("");
    setEditing(false);
    toast("Key saved. Anthropic accepted it.");
  };

  const remove = async () => {
    setBusy("remove");
    const problem = await save({ anthropicApiKey: null });
    setBusy(null);
    setConfirmRemove(false);
    if (problem) toast.error(problem);
    else toast("Key removed from this machine.");
  };

  let summary: ReactNode;
  if (!status) {
    summary = loadError ? <span className="text-danger">{loadError}</span> : <Skeleton className="mt-1 h-4 w-48" />;
  } else if (status.keySource === "settings") {
    summary = (
      <>
        Saved on this machine <span className="font-mono text-[12px] text-fg-2">{status.keyHint}</span>
      </>
    );
  } else if (status.keySource === "env") {
    summary = (
      <>
        Using the key from your environment (<span className="font-mono text-[12px]">ANTHROPIC_API_KEY</span>). A key saved here takes priority.
      </>
    );
  } else {
    summary = "No key yet. Research and drafting wait for one; free signals and syncing your tools work without it.";
  }

  return (
    <Group
      id="api-key"
      title="Anthropic API key"
      right={
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 rounded-xs text-[12px] text-fg-3 underline-offset-4 transition-colors hover:text-fg hover:underline"
        >
          Get a key <ArrowUpRight className="size-3" aria-hidden />
        </a>
      }
    >
      <Row
        label={
          <span className="flex items-center gap-2">
            <KeyRound className="size-3.5 text-fg-3" aria-hidden />
            {status?.hasKey ? "Connected" : status ? "Not connected" : "Checking…"}
            {status?.hasKey && <Badge tone="success">Active</Badge>}
          </span>
        }
        hint={summary}
      >
        {status?.hasKey && !open && (
          <div className="flex justify-start gap-1.5 sm:justify-end">
            {confirmRemove ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                  Keep it
                </Button>
                <Button size="sm" variant="danger" className="ring-1 ring-inset ring-danger/30" loading={busy === "remove"} onClick={() => void remove()}>
                  Remove key
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditing(true);
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                >
                  {status.keySource === "env" ? "Save a key here" : "Replace"}
                </Button>
                {status.keySource === "settings" && (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                    Remove
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </Row>
      {confirmRemove && (
        <p className="px-4 py-2.5 text-[12.5px] text-fg-2">
          Without a key, research and drafting stop until you add one again. Runs already going will finish.
        </p>
      )}
      {open && (
        <div className="px-4 py-3.5">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              ref={input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              aria-label="Anthropic API key"
              aria-invalid={!!error}
              aria-describedby="key-help"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && editing) {
                  e.preventDefault();
                  setEditing(false);
                  setKey("");
                  setError(null);
                }
              }}
              className="h-8 font-mono text-[12.5px] sm:flex-1"
            />
            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" loading={busy === "save"} disabled={!key.trim()}>
                {busy === "save" ? "Checking with Anthropic" : "Save key"}
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setKey("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
          <FieldError>{error}</FieldError>
          <p id="key-help" className="mt-2 text-[12px] leading-[18px] text-fg-3">
            I check it with Anthropic, then keep it only in <span className="font-mono">settings.json</span> on this machine, readable by you alone. It never goes into exports.
          </p>
        </div>
      )}
    </Group>
  );
}

/* ───────────── Theme ───────────── */

function ThemeRow() {
  const { pref, setPref } = useThemePref();
  return (
    <Row label="Theme" hint="System follows your computer's light or dark setting.">
      <div className="flex sm:justify-end">
        <Segmented<ThemePref>
          layoutId="settings-theme"
          value={pref ?? "system"}
          onChange={setPref}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
    </Row>
  );
}

/* ───────────── News source ───────────── */

function NewsGroup({ settings }: { settings: Settings }) {
  const { status, save } = settings;
  const [pending, setPending] = useState<NewsSource | null>(null);
  const value = pending ?? status?.newsSource ?? "gdelt";

  const choose = async (next: NewsSource) => {
    if (next === value) return;
    setPending(next);
    const problem = await save({ newsSource: next });
    setPending(null);
    if (problem) toast.error(problem);
  };

  return (
    <Group
      id="news"
      title="News signals"
      hint="Funding, launches and leadership news are why-now signals. I fetch them in code, so they cost no tokens either way."
    >
      {status ? (
        <ChoiceList<NewsSource>
          name="news-source"
          label="News source"
          value={value}
          onChange={(v) => void choose(v)}
          options={[
            { value: "gdelt", label: "GDELT", badge: <Badge tone="outline">Default</Badge>, hint: "An open global news index. Free, no account, a little noisier." },
            {
              value: "google_news",
              label: "Google News RSS",
              hint: "Sharper results. Its feed terms allow personal, non-commercial use only, so it stays off unless you choose it.",
            },
            { value: "off", label: "Off", hint: "No news. Job boards, website changes and Hacker News still count as signals." },
          ]}
        />
      ) : (
        <div className="space-y-3 px-4 py-3.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-32" />
        </div>
      )}
    </Group>
  );
}
