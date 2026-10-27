"use client";
import { useNow } from "@/components/integrations/use-hub";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { useWorkspace } from "@/components/providers/workspace-provider";
import type { Monitor } from "@/lib/automation/types";
import { controlClass, type AutomationController } from "./use-automation";

export function MonitorsPanel({ automation, initialQuery }: { automation: AutomationController; initialQuery: string }) {
  const { ws } = useWorkspace();
  const now = useNow();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"topic" | "page">("topic");
  const [recipe, setRecipe] = useState<Monitor["recipe"]>("custom");
  const [query, setQuery] = useState(initialQuery);
  const [keywords, setKeywords] = useState("");
  const [interval, setInterval] = useState("1440");
  const [editing, setEditing] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reload = automation.reload;
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The monitor didn't save.");
    } finally {
      setBusy(false);
    }
  }
  function chooseRecipe(value: Monitor["recipe"]) {
    setRecipe(value);
    setKind("topic");
    setEditing(undefined);
    const account = Object.values(ws?.accounts ?? {}).find((a) => a.watch)?.domain ?? "";
    const dormant = Object.values(ws?.deals ?? {}).find((d) => d.stage === "lost" || d.stage === "nurture")?.accountDomain ?? account;
    if (value === "leadership") {
      setName("Leadership changes");
      setQuery(`${account} new head of sales appointed`.trim());
      setKeywords("appointed, joins, head of sales");
    }
    if (value === "revival") {
      setName("Dormant account signals");
      setQuery(`${dormant} funding launch expansion`.trim());
      setKeywords("funding, launched, expansion");
    }
    if (value === "meeting") {
      const meeting = Object.values(ws?.meetings ?? {})
        .filter((m) => Date.parse(m.startsAt) >= Date.now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
      const domain = (meeting && ws?.deals[meeting.dealId]?.accountDomain) || account;
      setName("Meeting preparation signals");
      setQuery(`${domain} company news product announcements`.trim());
      setKeywords("");
    }
  }
  function edit(monitor: Monitor) {
    setEditing(monitor.id);
    setName(monitor.name);
    setKind(monitor.kind);
    setRecipe(monitor.recipe);
    setQuery(monitor.query);
    setKeywords(monitor.keywords.join(", "));
    setInterval(String(monitor.intervalMinutes));
  }
  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-bg-subtle p-4 text-[13px] leading-6 text-fg-2">
        Monitors run while Inroad and this computer are awake. After a restart, each overdue monitor catches up once. The first successful check records a
        baseline; later meaningful changes appear here. No outreach is sent.
      </p>
      {ws?.sample && <p className="text-[12px] text-fg-3">Automatic checks pause in the sample workspace.</p>}
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-[17px] font-medium">{editing ? "Edit monitor" : "Create a monitor"}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] text-fg-2">
            Recipe
            <select aria-label="Monitor recipe" className={controlClass} value={recipe} onChange={(e) => chooseRecipe(e.target.value as Monitor["recipe"])}>
              <option value="custom">Custom monitor</option>
              <option value="leadership">Leadership changes</option>
              <option value="revival">Dormant-deal revival</option>
              <option value="meeting">Meeting preparation</option>
            </select>
          </label>
          <label className="text-[12px] text-fg-2">
            Monitor name
            <Input aria-label="Monitor name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-[12px] text-fg-2">
            Watch
            <select aria-label="Monitor type" className={controlClass} value={kind} onChange={(e) => setKind(e.target.value as "topic" | "page")}>
              <option value="topic">Web search topic</option>
              <option value="page">One public page</option>
            </select>
          </label>
          <label className="text-[12px] text-fg-2">
            Check every
            <select aria-label="Monitor schedule" className={controlClass} value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="60">Hour</option>
              <option value="360">6 hours</option>
              <option value="1440">Day</option>
              <option value="10080">Week</option>
            </select>
          </label>
          <label className="text-[12px] text-fg-2 sm:col-span-2">
            {kind === "topic" ? "Search topic" : "Public page URL"}
            <Input aria-label="Monitor query or URL" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="text-[12px] text-fg-2 sm:col-span-2">
            Watch for these terms (optional)
            <Input aria-label="Monitor keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="funding, expansion, new leader" />
          </label>
        </div>
        <p className="text-[12px] text-fg-3">
          Topic checks use your search connection and its request limits. Page checks use ordinary HTTP. Keywords narrow the changes that matter.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || !name.trim() || !query.trim()}
            loading={busy}
            onClick={() =>
              void run(async () => {
                await automation.run({
                  action: "save_monitor",
                  ...(editing ? { id: editing } : {}),
                  input: {
                    name,
                    kind,
                    query,
                    recipe,
                    intervalMinutes: Number(interval),
                    enabled: editing ? (automation.data?.monitors.find((m) => m.id === editing)?.enabled ?? true) : true,
                    keywords: keywords
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  },
                });
                setEditing(undefined);
                setMessage(editing ? "Monitor updated." : "Monitor saved. The first check establishes its baseline.");
              })
            }
          >
            Save monitor
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(undefined)}>
              Cancel edit
            </Button>
          )}
        </div>
        {error && <FieldError>{error}</FieldError>}
        {message && (
          <p role="status" className="text-[12px] text-fg-2">
            {message}
          </p>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-[16px] font-medium">Your monitors</h2>
        {!automation.data?.monitors.length && <p className="text-[13px] text-fg-3">No monitors yet. Save a topic or page above.</p>}
        {automation.data?.monitors.map((monitor) => (
          <article key={monitor.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-medium">
                  {monitor.name} · {monitor.enabled ? "Active" : "Paused"}
                </h3>
                <p className="mt-1 break-all text-[12px] text-fg-2">{monitor.query}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => edit(monitor)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !monitor.enabled || !!ws?.sample}
                  onClick={() =>
                    void run(async () => {
                      const checked = await automation.run<{ checked: number }>({ action: "check_monitor", id: monitor.id });
                      setMessage(
                        checked.checked
                          ? "Monitor checked. See its latest status below."
                          : "This monitor is already checking. Its status will refresh shortly.",
                      );
                    })
                  }
                >
                  Check now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await automation.run({ action: "toggle_monitor", id: monitor.id, enabled: !monitor.enabled });
                    })
                  }
                >
                  {monitor.enabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await automation.run({ action: "remove_monitor", id: monitor.id });
                    })
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-fg-3">
              {monitor.lastRunAt ? `Last checked ${new Date(monitor.lastRunAt).toLocaleString()}` : "Waiting for the first check"} ·{" "}
              {monitor.enabled ? `Next ${new Date(monitor.nextRunAt).toLocaleString()}` : "Schedule paused"}
              {monitor.leaseUntil && now !== null && Date.parse(monitor.leaseUntil) > now ? " · Checking…" : ""}
            </p>
            {monitor.lastError && (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                Check failed: {monitor.lastError}
              </p>
            )}
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h2 className="text-[16px] font-medium">Changes to review</h2>
        {!automation.data?.observations.length && <p className="text-[13px] text-fg-3">Changes will appear after a monitor has established its baseline.</p>}
        {automation.data?.observations.map((observation) => (
          <article key={observation.id} className={`rounded-lg border border-border p-4 ${observation.read ? "bg-bg-subtle" : "bg-surface"}`}>
            <h3 className="text-[14px] font-medium">{observation.title}</h3>
            <p className="mt-1 text-[11px] text-fg-3">{new Date(observation.at).toLocaleString()}</p>
            <p className="mt-2 text-[13px] leading-6 text-fg-2">{observation.summary}</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {observation.urls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="max-w-full break-all text-[12px] underline">
                  {new URL(url).hostname}
                </a>
              ))}
              <a href={`/research?query=${encodeURIComponent(observation.summary.slice(0, 200))}`} className="text-[12px] underline">
                Research this signal
              </a>
              {!observation.read && (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await automation.run({ action: "read_observation", id: observation.id });
                    })
                  }
                >
                  Mark reviewed
                </Button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
