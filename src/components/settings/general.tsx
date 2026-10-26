"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { setCompanyIcons } from "@/lib/client/icons";
import { AiProviderGroup } from "./ai-provider";
import { ChoiceList, Group, Row, SettingsSection } from "./parts";
import type { CompanyIcons, Geocoder, NewsSource } from "./types";
import { useThemePref, type ThemePref, type useSettingsStatus } from "./use-settings";

type Settings = ReturnType<typeof useSettingsStatus>;

export function GeneralSection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="general" title="General" description="The AI I run on, how the app looks, and what may leave this computer for news, places, icons and public records.">
      <AiProviderGroup settings={settings} />
      <Group title="Appearance">
        <ThemeRow />
      </Group>
      <NewsGroup settings={settings} />
      <PlacesGroup settings={settings} />
      <IconsGroup settings={settings} />
      <PublicDataGroup settings={settings} />
    </SettingsSection>
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
