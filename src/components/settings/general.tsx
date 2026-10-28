"use client";

import { ArrowUpRight, ImageIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { setCompanyIcons } from "@/lib/client/icons";
import { AiProviderGroup } from "./ai-provider";
import { SearchProviderGroup } from "./search-provider";
import { AiRoutingGroup } from "./ai-routing";
import { CONSUMER_MODEL_LABELS, MARKET_LABELS } from "@/lib/consumer/market";
import type { ConsumerModel, Market } from "@/lib/domain/types";
import { UpdatesGroup } from "@/components/updates/updates-group";
import { ChoiceList, Group, Row, SettingsSection } from "./parts";
import { IMAGE_MODELS } from "@/lib/studio/visuals";
import type { CompanyIcons, Geocoder, NewsSource } from "./types";
import { useThemePref, type ThemePref, type useSettingsStatus } from "./use-settings";

type Settings = ReturnType<typeof useSettingsStatus>;

export function GeneralSection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="general" title="General" description="Make Inroad feel at home on your computer.">
      <Group id="appearance" title="Appearance"><ThemeRow /></Group>
      <IconsGroup settings={settings} />
      <UpdatesGroup />
    </SettingsSection>
  );
}

export function CompanySection() {
  return <SettingsSection id="company" title="Company" description="The market and business model your playbook is built around."><MarketGroup /></SettingsSection>;
}

export function AiSection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="ai" title="AI & models" description="Choose who powers your AI work and which models handle each task.">
      <AiProviderGroup settings={settings} />
      <AiRoutingGroup reload={settings.reload} revision={settings.status?.ai} />
    </SettingsSection>
  );
}

export function SearchSection({ settings }: { settings: Settings }) {
  return <SettingsSection id="search" title="Web search" description="Control how Inroad searches and reads the web."><SearchProviderGroup settings={settings} /></SettingsSection>;
}

export function ImagesSection({ settings }: { settings: Settings }) {
  return <SettingsSection id="image-settings" title="Images" description="Optional image generation for your Studio graphics."><ImagesGroup settings={settings} /></SettingsSection>;
}

export function SourcesSection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="sources" title="Data sources" description="Choose the public information Inroad can look up.">
      <NewsGroup settings={settings} />
      <PlacesGroup settings={settings} />
      <PublicDataGroup settings={settings} />
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

/* ───────────── Company icons ───────────── */

function IconsGroup({ settings }: { settings: Settings }) {
  const { status, save } = settings;
  const [pending, setPending] = useState<CompanyIcons | null>(null);
  const value = pending ?? status?.companyIcons ?? "letters";

  const choose = async (next: CompanyIcons) => {
    if (next === value) return;
    setPending(next);
    const problem = await save({ companyIcons: next });
    setPending(null);
    if (problem) toast.error(problem);
    else setCompanyIcons(next);
  };

  return (
    <Group id="icons" title="Company icons" hint="A favicon service would see every company on your list, so none is used. Tool logos on Integrations always load.">
      {status ? (
        <ChoiceList<CompanyIcons>
          name="company-icons"
          label="Company icons"
          value={value}
          onChange={(v) => void choose(v)}
          options={[
            {
              value: "letters",
              label: "First letters",
              badge: <Badge tone="outline">Default</Badge>,
              hint: "Each company shows its initial. Nothing is sent anywhere.",
            },
            {
              value: "site",
              label: "Each company's own icon",
              hint: "Inroad asks each company's website for its icon once, the way research already reads it, and keeps it on this computer for a month.",
            },
          ]}
        />
      ) : (
        <div className="space-y-3 px-4 py-3.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-52" />
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

/* ───────────── Public data: GitHub token, SEC contact ───────────── */

function PublicDataGroup({ settings }: { settings: Settings }) {
  const { status } = settings;
  return (
    <Group
      id="public-data"
      title="Public records"
      hint="SEC Form D filings, Hacker News hiring threads, GitHub and podcasts are read in code, for free. Both of these are optional."
    >
      {status ? (
        <>
          <GithubTokenRow settings={settings} />
          <SecContactRow settings={settings} />
        </>
      ) : (
        <div className="space-y-3 px-4 py-3.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      )}
    </Group>
  );
}

function GithubTokenRow({ settings }: { settings: Settings }) {
  const { status, save } = settings;
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = status?.githubTokenHint ?? null;

  const submit = async (value: string | null) => {
    setBusy(true);
    setError(null);
    const problem = await save({ githubToken: value });
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setToken("");
    setOpen(false);
    toast(value ? "GitHub token saved. GitHub accepted it." : "GitHub token removed from this machine.");
  };

  return (
    <div>
      <Row
        label="GitHub token"
        hint={
          hint ? (
            <>
              Saved on this machine <span className="font-mono text-[12px] text-fg-2">{hint}</span>. 5,000 lookups an hour, so up to 300 stargazers at once.
            </>
          ) : (
            "Without one GitHub allows 60 lookups an hour, about 50 stargazer profiles. A fine-grained token with no permissions is enough."
          )
        }
      >
        {!open && (
          <div className="flex justify-start gap-1.5 sm:justify-end">
            <Button size="sm" onClick={() => setOpen(true)}>
              {hint ? "Replace" : "Add a token"}
            </Button>
            {hint && (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void submit(null)}>
                Remove
              </Button>
            )}
          </div>
        )}
      </Row>
      {open && (
        <form
          className="px-4 pb-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) void submit(token.trim());
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              autoFocus
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_…"
              aria-label="GitHub token"
              aria-invalid={!!error}
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  setToken("");
                  setError(null);
                }
              }}
              className="h-8 font-mono text-[12.5px] sm:flex-1"
            />
            <div className="flex gap-1.5">
              <Button type="submit" variant="primary" loading={busy} disabled={!token.trim()}>
                {busy ? "Checking with GitHub" : "Save token"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setToken("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
          <FieldError>{error}</FieldError>
          <p className="mt-2 text-[12px] leading-[18px] text-fg-3">
            Make one at{" "}
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-fg-2 hover:underline">
              github.com/settings/personal-access-tokens <ArrowUpRight className="size-3" aria-hidden />
            </a>
            . It stays on this computer and goes only to GitHub.
          </p>
        </form>
      )}
    </div>
  );
}

function SecContactRow({ settings }: { settings: Settings }) {
  const { status, save } = settings;
  const saved = status?.secContact ?? "";
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = value ?? saved;
  const dirty = current.trim() !== saved;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const problem = await save({ secContact: current.trim() || null });
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setValue(null);
    toast(current.trim() ? "Saved. Form D lookups name you as the contact." : "Contact removed.");
  };

  return (
    <Row label="Contact for SEC lookups" htmlFor="sec-contact" hint="The SEC asks tools that read EDGAR to name a contact. Sent only to sec.gov, with Form D lookups." align="start">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void submit();
        }}
      >
        <div className="min-w-0 flex-1">
          <Input
            id="sec-contact"
            type="email"
            autoComplete="email"
            placeholder="you@yourcompany.com"
            aria-invalid={!!error}
            value={current}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            className="h-8 text-[16px] sm:text-[13px]"
          />
          <FieldError>{error}</FieldError>
        </div>
        {dirty && (
          <Button type="submit" size="sm" variant="primary" loading={busy}>
            Save
          </Button>
        )}
      </form>
    </Row>
  );
}
