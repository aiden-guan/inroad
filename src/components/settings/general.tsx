"use client";

import { ArrowUpRight, ImageIcon, KeyRound } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { ChoiceList, Group, Row, SettingsSection } from "./parts";
import { IMAGE_MODELS } from "@/lib/studio/visuals";
import type { Geocoder, NewsSource } from "./types";
import { useThemePref, type ThemePref, type useSettingsStatus } from "./use-settings";

type Settings = ReturnType<typeof useSettingsStatus>;

export function GeneralSection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="general" title="General" description="The keys I run on, how the app looks, and where news signals come from.">
      <ApiKeyGroup settings={settings} />
      <ImagesGroup settings={settings} />
      <Group title="Appearance">
        <ThemeRow />
      </Group>
      <NewsGroup settings={settings} />
      <PlacesGroup settings={settings} />
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

/* ───────────── OpenAI (images for Studio graphics) ───────────── */

function ImagesGroup({ settings }: { settings: Settings }) {
  const { status, save } = settings;
  const openai = status?.openai;
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "remove" | "model" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!key.trim()) return;
    setBusy("save");
    setError(null);
    const problem = await save({ openaiApiKey: key.trim() });
    setBusy(null);
    if (problem) {
      setError(problem);
      input.current?.focus();
      return;
    }
    setKey("");
    setOpen(false);
    toast("OpenAI key saved.");
  };

  const remove = async () => {
    setBusy("remove");
    const problem = await save({ openaiApiKey: null });
    setBusy(null);
    if (problem) toast.error(problem);
    else toast("OpenAI key removed from this machine.");
  };

  const chooseModel = async (id: string) => {
    if (id === openai?.imageModel) return;
    setBusy("model");
    const problem = await save({ imageModel: id });
    setBusy(null);
    if (problem) toast.error(problem);
  };

  const summary = !openai ? (
    <Skeleton className="mt-1 h-4 w-48" />
  ) : openai.keySource === "settings" ? (
    <>
      Saved on this machine <span className="font-mono text-[12px] text-fg-2">{openai.keyHint}</span>. Images bill to your OpenAI account.
    </>
  ) : openai.keySource === "env" ? (
    <>
      Using <span className="font-mono text-[12px]">OPENAI_API_KEY</span> from your environment. Images bill to that OpenAI account.
    </>
  ) : (
    "Optional. Without a key, Studio writes the image prompt for you to paste into ChatGPT, and you upload the result."
  );

  return (
    <Group
      id="images"
      title="Images for Studio graphics"
      hint="Claude designs every graphic and sets every word itself. An OpenAI key adds photos and illustrations behind the words, painted by GPT Image."
      right={
        <a
          href="https://platform.openai.com/api-keys"
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
            <ImageIcon className="size-3.5 text-fg-3" aria-hidden />
            OpenAI {openai?.hasKey ? <Badge tone="success">Active</Badge> : openai ? <Badge tone="outline">Off</Badge> : null}
          </span>
        }
        hint={summary}
      >
        {openai && !open && (
          <div className="flex justify-start gap-1.5 sm:justify-end">
            <Button
              size="sm"
              onClick={() => {
                setOpen(true);
                requestAnimationFrame(() => input.current?.focus());
              }}
            >
              {openai.keySource === "settings" ? "Replace" : openai.keySource === "env" ? "Save a key here" : "Add key"}
            </Button>
            {openai.keySource === "settings" && (
              <Button size="sm" variant="ghost" loading={busy === "remove"} onClick={() => void remove()}>
                Remove
              </Button>
            )}
          </div>
        )}
      </Row>
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
              placeholder="sk-…"
              aria-label="OpenAI API key"
              aria-invalid={!!error}
              aria-describedby="openai-key-help"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  setKey("");
                  setError(null);
                }
              }}
              className="h-8 font-mono text-[12.5px] sm:flex-1"
            />
            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" loading={busy === "save"} disabled={!key.trim()}>
                {busy === "save" ? "Checking with OpenAI" : "Save key"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setKey("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
          <FieldError>{error}</FieldError>
          <p id="openai-key-help" className="mt-2 text-[12px] leading-[18px] text-fg-3">
            Kept only in <span className="font-mono">settings.json</span> on this machine and sent only to OpenAI. OpenAI may ask you to verify your organization before its image
            models work.
          </p>
        </div>
      )}
      {openai?.hasKey && (
        <ChoiceList<string>
          name="image-model"
          label="Image model"
          value={openai.imageModel}
          onChange={(v) => void chooseModel(v)}
          options={IMAGE_MODELS.map((m, i) => ({ value: m.id, label: m.label, hint: m.note, badge: i === 0 ? <Badge tone="outline">Default</Badge> : undefined }))}
        />
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
