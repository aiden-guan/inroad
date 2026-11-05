"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useAutomation } from "@/components/research/use-automation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SEARCH_PROVIDERS, type SearchChoice } from "@/lib/search/providers";
import { Group, Row } from "./parts";
import type { useSettingsStatus } from "./use-settings";

export function SearchProviderGroup({ settings }: { settings: ReturnType<typeof useSettingsStatus> }) {
  const id = useId();
  const automation = useAutomation();
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [dailyLimit, setDailyLimit] = useState<string | null>(null);
  const [browser, setBrowser] = useState<"off" | "tinyfish" | null>(null);
  const [browserKey, setBrowserKey] = useState("");
  const [pageConnectionId, setPageConnectionId] = useState<string | null>(null);
  const [browserLimit, setBrowserLimit] = useState<string | null>(null);
  const status = settings.status?.search;
  const [choice, setChoice] = useState<SearchChoice | null>(null);
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = choice ?? status?.chosen ?? "auto";
  const preset = SEARCH_PROVIDERS.find((p) => p.id === selected);
  const canTest =
    !!status?.active &&
    choice === null &&
    !key &&
    endpoint === null &&
    connectionId === null &&
    dailyLimit === null &&
    browser === null &&
    browserLimit === null &&
    pageConnectionId === null &&
    !browserKey;

  async function save(remove = false) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await settings.save({
      search: {
        provider: selected,
        ...(remove ? { key: null } : key.trim() ? { key: key.trim() } : {}),
        ...(endpoint !== null ? { endpoint } : {}),
        ...(connectionId !== null ? { connectionId } : {}),
        ...(dailyLimit !== null ? { dailyLimit: Number(dailyLimit) } : {}),
        ...(browser !== null ? { browser } : {}),
        ...(browserLimit !== null ? { browserDailyLimit: Number(browserLimit) } : {}),
        ...(pageConnectionId !== null ? { pageConnectionId } : {}),
        ...(browserKey.trim() ? { browserKey: browserKey.trim() } : {}),
      },
    });
    setBusy(false);
    if (result) return setError(result);
    setKey("");
    setBrowserKey("");
    setChoice(null);
    setEndpoint(null);
    setConnectionId(null);
    setDailyLimit(null);
    setBrowser(null);
    setBrowserLimit(null);
    setPageConnectionId(null);
    setMessage(
      remove
        ? "Saved search key removed. Other configured keys still apply."
        : selected === "off"
          ? "External search is off for models without built-in search."
          : "Search settings saved. Test a search below to check access.",
    );
  }

  async function test() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/search/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "Inroad go to market" }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "The search didn't finish. Try again.");
      else
        setMessage(
          `${data.provider} answered with ${data.results.length} search result${data.results.length === 1 ? "" : "s"}. Research uses this same connection.`,
        );
    } catch {
      setError("Couldn't reach the app to test search.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group
      id="web-search"
      title="Web search"
      hint="Choose search separately from your AI model. DeepSeek, GPT, Gemini and local models can all use the same search connection. Claude uses its built-in search."
    >
      <Row
        label="Search provider"
        htmlFor={`${id}-provider`}
        hint={
          status?.active
            ? `${status.active.name} is configured. Provider search charges are separate from model usage.`
            : "No external search is configured. Company sites and public records still work."
        }
      >
        <Select
          id={`${id}-provider`}
          value={selected}
          disabled={!status || busy}
          onChange={(e) => {
            setChoice(e.target.value as SearchChoice);
            setKey("");
            setEndpoint(null);
            setError(null);
            setMessage(null);
          }}
          className="w-full"
        >
          <option value="auto">Automatic (Firecrawl first, if you use it)</option>
          {SEARCH_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="off">Off for models without built-in search</option>
        </Select>
      </Row>
      {preset && preset.id !== "connected" && (
        <Row
          label={`${preset.name} key`}
          htmlFor={`${id}-key`}
          hint={
            <>
              {status?.saved[preset.id] ? `Saved ${status.saved[preset.id]}. ` : ""}
              {preset.id === "deepseek" ? "Leave blank to use the DeepSeek key you saved for AI. " : "Leave blank to use a key already set up on this computer. "}
              {preset.id === "firecrawl" && "An existing Firecrawl integration key also works. "}
              {preset.id === "custom" ? (
                "Optional for a local adapter. Keys stay on this computer and are excluded from exports."
              ) : (
                <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  Get an API key
                </a>
              )}
            </>
          }
        >
          <Input
            id={`${id}-key`}
            type="password"
            autoComplete="new-password"
            value={key}
            disabled={busy}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Leave blank to keep the current key"
          />
        </Row>
      )}
      {selected === "custom" && (
        <Row label="Search endpoint" htmlFor={`${id}-endpoint`} hint="The web address of another search service. Use https://, or http:// for one running on this computer.">
          <Input
            id={`${id}-endpoint`}
            type="url"
            value={endpoint ?? status?.endpoint ?? ""}
            disabled={busy}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://localhost:8080/search"
          />
        </Row>
      )}
      {selected === "connected" && (
        <Row
          label="Connected search tool"
          htmlFor={`${id}-connection`}
          hint={
            <Link href="/research?tab=tools" className="underline">
              Connect a tool and map its search capability
            </Link>
          }
        >
          <Select
            id={`${id}-connection`}
            value={connectionId ?? status?.connectionId ?? ""}
            onChange={(e) => setConnectionId(e.target.value)}
            className="w-full"
          >
            <option value="">Choose a connection</option>
            {automation.data?.connections
              .filter((c) => c.enabled && c.bindings.some((b) => b.capability === "search"))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Row>
      )}
      <Row
        label="Daily search request limit"
        htmlFor={`${id}-limit`}
        hint="Counts every search sent to your provider, from research, agents and monitors. Repeat searches answered from saved results don't count."
      >
        <Input
          id={`${id}-limit`}
          type="number"
          min={1}
          max={10000}
          value={dailyLimit ?? String(status?.dailyLimit ?? 100)}
          onChange={(e) => setDailyLimit(e.target.value)}
        />
      </Row>
      <details className="group/hard">
        <summary className="flex cursor-pointer list-none items-center gap-1 px-5 py-3 text-[12.5px] font-medium text-fg-3 transition-colors hover:text-fg-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-3.5 transition-transform duration-150 group-open/hard:rotate-90" />
          Advanced
        </summary>
        <div className="divide-y divide-border border-t border-border">
          <Row
            label="Connected page reader"
            htmlFor={`${id}-page-reader`}
            hint="When a page comes back nearly empty, read it through this connected tool first."
          >
            <Select
              id={`${id}-page-reader`}
              value={pageConnectionId ?? status?.pageConnectionId ?? ""}
              onChange={(e) => setPageConnectionId(e.target.value)}
              className="w-full"
            >
              <option value="">None</option>
              {automation.data?.connections
                .filter((c) => c.enabled && c.bindings.some((b) => b.capability === "fetch"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Row>
          <Row
            label="Optional browser extraction"
            htmlFor={`${id}-browser`}
            hint="For pages that only show their text in a browser. TinyFish opens them in a real browser when a normal read finds nothing. It uses your TinyFish key and may cost extra."
          >
            <Select
              id={`${id}-browser`}
              value={browser ?? status?.browser ?? "off"}
              onChange={(e) => setBrowser(e.target.value as "off" | "tinyfish")}
              className="w-full"
            >
              <option value="off">Off</option>
              <option value="tinyfish">TinyFish Browser</option>
            </Select>
          </Row>
          {(browser ?? status?.browser) === "tinyfish" && selected !== "tinyfish" && (
            <Row
              label="TinyFish browser key"
              htmlFor={`${id}-browser-key`}
              hint={
                status?.saved.tinyfish
                  ? `Saved ${status.saved.tinyfish}. Leave blank to keep it.`
                  : "Use a separate TinyFish key here while keeping your chosen search provider."
              }
            >
              <Input
                id={`${id}-browser-key`}
                type="password"
                autoComplete="new-password"
                value={browserKey}
                onChange={(e) => setBrowserKey(e.target.value)}
                placeholder="Leave blank to use the existing key"
              />
            </Row>
          )}
          <Row label="Daily browser request limit" htmlFor={`${id}-browser-limit`} hint="How many pages a day may open in a browser. Ten unless you change it.">
            <Input
              id={`${id}-browser-limit`}
              type="number"
              min={1}
              max={100}
              value={browserLimit ?? String(status?.browserDailyLimit ?? 10)}
              onChange={(e) => setBrowserLimit(e.target.value)}
            />
          </Row>
          <p className="px-5 py-3 text-[12.5px] leading-[18px] text-fg-3 text-pretty">
            Keys can also come from environment variables when nothing is saved here
            {preset && preset.id !== "connected" ? (
              <>
                {" "}
                (<span className="font-mono">{preset.env}</span> for {preset.name}, <span className="font-mono">TINYFISH_API_KEY</span> for the browser)
              </>
            ) : (
              <>
                {" "}
                (<span className="font-mono">TINYFISH_API_KEY</span> for the browser)
              </>
            )}
            .
          </p>
        </div>
      </details>
      <Row
        label="Check the connection"
        hint="Testing makes one search and may use provider credits. Save changes before testing. Keys stay local and are never included in workspace exports."
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!status || busy} loading={busy} onClick={() => void save()}>
            Save
          </Button>
          <Button size="sm" disabled={!canTest || busy} onClick={() => void test()}>
            Test search
          </Button>
          {preset && status?.saved[preset.id] && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(true)}>
              Remove saved key
            </Button>
          )}
        </div>
      </Row>
      {error && (
        <div className="px-4 py-3">
          <FieldError>{error}</FieldError>
        </div>
      )}
      {message && (
        <p role="status" className="px-4 py-3 text-[12.5px] text-fg-2">
          {message}
        </p>
      )}
    </Group>
  );
}
