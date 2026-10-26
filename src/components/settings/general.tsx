"use client";

import { ArrowUpRight, KeyRound } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { CONSUMER_MODEL_LABELS, MARKET_LABELS } from "@/lib/consumer/market";
import type { ConsumerModel, Market } from "@/lib/domain/types";
import { ChoiceList, Group, Row, SettingsSection } from "./parts";
import type { Geocoder, NewsSource } from "./types";
import { useThemePref, type ThemePref, type useSettingsStatus } from "./use-settings";

type Settings = ReturnType<typeof useSettingsStatus>;

export function GeneralSection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="general" title="General" description="The key I run on, who you sell to, how the app looks, and where news signals come from.">
      <ApiKeyGroup settings={settings} />
      <MarketGroup />
      <Group title="Appearance">
        <ThemeRow />
      </Group>
      <NewsGroup settings={settings} />
      <PlacesGroup settings={settings} />
    </SettingsSection>
  );
}

/* ───────────── Who you sell to ───────────── */

/** Businesses or consumers: which playbook, moves and drafting rules apply. Switching keeps everything; the playbook is rewritten on request. */
function MarketGroup() {
  const { ws, dispatch } = useWorkspace();
  const { start } = useRuns();
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ws?.company) return null;
  const market: Market = ws.company.market ?? "b2b";
  const model: ConsumerModel = ws.company.consumerModel ?? "app";
  const set = async (next: Market, nextModel?: ConsumerModel) => {
    if (await dispatch({ type: "company.setMarket", market: next, consumerModel: nextModel })) setChanged(true);
  };
  const rewrite = async () => {
    setBusy(true);
    const run = await start("foundation", { url: ws.company?.domain || undefined, note: ws.company?.founderNote, mode: "refresh", market, consumerModel: market === "consumer" ? model : undefined });
    setBusy(false);
    if (run) {
      setChanged(false);
      toast("Rewriting your playbook. Everything you approved stays.");
    }
  };
  return (
    <Group
      id="market"
      title="Who you sell to"
      hint="This sets the playbook I write, the moves on Today and the rules your drafts follow."
      right={
        changed && ws.foundation ? (
          <Button size="sm" variant="agent" loading={busy} onClick={() => void rewrite()}>
            Rewrite my playbook for this
          </Button>
        ) : undefined
      }
    >
      <ChoiceList<Market>
        name="market"
        label="Who you sell to"
        value={market}
        onChange={(v) => void set(v, v === "consumer" ? model : undefined)}
        options={[
          { value: "b2b", label: MARKET_LABELS.b2b, hint: "Founder-led sales: accounts, warm intros, signal-based outreach, deals and pilots." },
          { value: "consumer", label: MARKET_LABELS.consumer, hint: "Growth: retention first, creators and communities, weekly numbers, experiments." },
        ]}
      />
      {market === "consumer" && (
        <div className="border-t border-border">
          <p className="bg-bg-subtle/60 px-4 py-2 text-[12px] font-medium text-fg-2">What kind of consumer company</p>
          <ChoiceList<ConsumerModel>
            name="consumer-model"
            label="What kind of consumer company"
            value={model}
            onChange={(v) => void set("consumer", v)}
            options={(Object.keys(CONSUMER_MODEL_LABELS) as ConsumerModel[]).map((k) => ({ value: k, label: CONSUMER_MODEL_LABELS[k].label, hint: CONSUMER_MODEL_LABELS[k].hint }))}
          />
        </div>
      )}
    </Group>
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

/* ───────────── Places (the lead map) ───────────── */

function PlacesGroup({ settings }: { settings: Settings }) {
  const { status, save } = settings;
  const [pending, setPending] = useState<Geocoder | null>(null);
  const value = pending ?? status?.geocoder ?? "osm";

  const choose = async (next: Geocoder) => {
    if (next === value) return;
    setPending(next);
    const problem = await save({ geocoder: next });
    setPending(null);
    if (problem) toast.error(problem);
  };

  return (
    <Group id="places" title="Places on the map" hint="About 200 startup cities are built in and need no network. Map tiles come from OpenFreeMap; your leads never leave this computer.">
      {status ? (
        <ChoiceList<Geocoder>
          name="geocoder"
          label="Places outside the built-in list"
          value={value}
          onChange={(v) => void choose(v)}
          options={[
            {
              value: "osm",
              label: "Look them up on OpenStreetMap",
              badge: <Badge tone="outline">Default</Badge>,
              hint: "Only the place text is sent (“Boise, ID”, a venue address), never a name or company. Cached, one lookup a second.",
            },
            { value: "off", label: "Built-in cities only", hint: "Nothing is sent. Leads in other places stay off the map." },
          ]}
        />
      ) : (
        <div className="space-y-3 px-4 py-3.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}
    </Group>
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
