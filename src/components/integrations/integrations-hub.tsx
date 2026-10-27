"use client";

import { FileSpreadsheet, Star, Users, Webhook } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AgentsCard } from "@/components/agents/agents-card";
import { ImportFlow } from "@/components/import/import-flow";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/misc";
import { BOOKING_SOURCES, CONNECTORS, LEAD_SOURCES, NATIVE_IDS, isBooking, isCrm, isSequencer, type NativeConnectorId } from "@/lib/connectors/catalog";
import type { Workspace } from "@/lib/domain/types";
import type { InboundLogEntry } from "@/lib/hub/types";
import { BookingKey } from "./booking-key";
import { CrmPanel } from "./crm-panel";
import { FirecrawlPanel } from "./firecrawl-panel";
import { HookPanel } from "./hooks";
import { ConnectedFooter, KeyConnect } from "./key-connect";
import { OutboundPanel } from "./outbound-panel";
import { Ago } from "./parts";
import { Group, IntegrationRow, LinkRow, type RowStatus } from "./row";
import { SequencerPanel } from "./sequencer-panel";
import { SlackPanel } from "./slack-panel";
import { useHash, useHubStatus, useNow } from "./use-hub";

/* ───────────── Row statuses, all derived ───────────── */

function nativeStatus(id: NativeConnectorId, ws: Workspace): RowStatus {
  const st = ws.integrations[id];
  if (!st?.enabled) return { tone: "off", label: "Not connected" };
  if (st.lastError) return { tone: "error", label: "Needs attention" };
  return { tone: "on", label: st.config.accountLabel ? `Connected · ${String(st.config.accountLabel)}` : "Connected" };
}

function hookStatus(events: InboundLogEntry[], sources: string[]): RowStatus {
  const last = events.find((e) => sources.includes(e.source) && e.status !== "duplicate");
  if (!last) return { tone: "off", label: "Not set up" };
  return {
    tone: last.status === "unmapped" ? "error" : "on",
    label: (
      <>
        Last event <Ago iso={last.at} />
      </>
    ),
  };
}

const LEAD_HOOK_IDS = LEAD_SOURCES.map((s) => s.id);
const MORE_TOOL_IDS = new Set(["more-tools", "people", "firecrawl", "meetings", "alerts", "slack", "automation", "inbound", "webhooks", "agents", ...BOOKING_SOURCES.map((s) => s.id)]);

/* ───────────── Page ───────────── */

export function IntegrationsHub() {
  const { ws } = useWorkspace();
  const { status, error, refresh } = useHubStatus();
  const router = useRouter();
  const params = useSearchParams();
  const hash = useHash();
  const now = useNow();
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [replacing, setReplacing] = useState<NativeConnectorId | null>(null);
  const moreTools = useRef<HTMLDetailsElement>(null);
  const ready = !!ws;

  // Saved links still open their tool even when it lives in the optional section.
  useEffect(() => {
    if (!ready || !MORE_TOOL_IDS.has(hash) || !moreTools.current) return;
    moreTools.current.open = true;
    const frame = requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [hash, ready]);

  const current = openId === undefined ? hash || null : openId;
  const toggle = (id: string) => {
    setOpenId(current === id ? null : id);
    setReplacing(null);
  };

  const importParam = params.get("import");
  const importKind = importParam === "csv" || importParam === "linkedin" || importParam === "github" ? importParam : null;
  const closeImport = () => router.replace("/integrations", { scroll: false });

  const events = useMemo(() => status?.inbound.events ?? [], [status]);
  const summary = useMemo(() => {
    if (!ws) return null;
    const native = NATIVE_IDS.filter((id) => ws.integrations[id]?.enabled).length;
    const hooks = new Set(events.filter((e) => e.status !== "duplicate").map((e) => e.source)).size;
    const week = now ? events.filter((e) => e.status !== "duplicate" && now - Date.parse(e.at) < 7 * 86_400_000).length : 0;
    return { connected: native + hooks + (ws.webhooks.length ? 1 : 0), week };
  }, [ws, events, now]);

  if (!ws) return <HubSkeleton />;

  const startBadge = (id: string) => (id === "linkedin" && !ws.network ? <Badge tone="outline">Warm leads</Badge> : undefined);
  const moreNeedsAttention = ["firecrawl", "slack", ...BOOKING_SOURCES.map((s) => s.id)].some((id) => {
    const st = ws.integrations[id as NativeConnectorId];
    return st?.enabled && st.lastError;
  }) || outboundStatus(ws).tone === "error";
  const csvCount = Object.values(ws.accounts).filter((a) => a.source === "csv_import").length;
  const starCount = Object.values(ws.people).filter((p) => p.source === "stargazers").length;

  const native = (id: NativeConnectorId) => {
    const meta = CONNECTORS[id];
    const st = ws.integrations[id];
    let body: ReactNode;
    if (!st?.enabled || replacing === id) {
      body = (
        <KeyConnect
          id={id}
          onConnected={() => {
            setReplacing(null);
            void refresh();
          }}
          onCancel={replacing === id ? () => setReplacing(null) : undefined}
        />
      );
    } else {
      body = (
        <>
          {isCrm(id) ? (
            <CrmPanel id={id} state={st} status={status} />
          ) : isSequencer(id) ? (
            <SequencerPanel id={id} state={st} status={status} onRefresh={refresh} />
          ) : id === "firecrawl" ? (
            <FirecrawlPanel />
          ) : (
            <SlackPanel state={st} status={status} onRefresh={refresh} />
          )}
          <ConnectedFooter id={id} state={st} onReplace={() => setReplacing(id)} />
        </>
      );
    }
    return (
      <IntegrationRow key={id} id={id} name={meta.name} blurb={meta.blurb} domain={meta.domain} status={nativeStatus(id, ws)} badge={startBadge(id)} open={current === id} onToggle={() => toggle(id)}>
        {body}
      </IntegrationRow>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pb-28 pt-8 md:px-10 md:pt-12">
      <header className="mb-2">
        <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.015em] text-fg">Integrations</h1>
        <p className="mt-3 max-w-[60ch] text-[14px] leading-[21px] text-fg-2 text-pretty">
          Connect the tools you already use. Every connection here is optional.
        </p>
        {summary && (
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
            <span>
              <span className="font-mono tnum text-fg-2">{summary.connected}</span> connected
            </span>
            {summary.week > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  <span className="font-mono tnum text-fg-2">{summary.week}</span> event{summary.week === 1 ? "" : "s"} in this week
                </span>
              </>
            )}
          </p>
        )}
        {error && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-danger">
            {error}
            <Button size="xs" variant="ghost" onClick={() => void refresh()}>
              Try again
            </Button>
          </p>
        )}
      </header>

      <div className="mt-6 rounded-lg bg-surface p-4 ring-1 ring-border">
        <p className="text-[14px] font-medium text-fg">Start with your own inbox</p>
        <p className="mt-1 text-pretty text-[13px] leading-5 text-fg-2">Find prospects, review drafts, then open them in Gmail or copy them to your email app.</p>
        <Link href="/today" className="mt-3 inline-flex min-h-9 items-center rounded-sm px-3 text-[13px] font-medium text-fg ring-1 ring-border-strong transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">Go to Today →</Link>
      </div>

      <Group id="leads" question="Import leads" note="Already have a list? Import it here. Inroad handles duplicates.">
        <LinkRow
          id="linkedin"
          href="/integrations?import=linkedin"
          name="LinkedIn connections"
          blurb="Find potential customers among people you already know."
          icon={<Users className="size-4" />}
          status={ws.network ? { tone: "on", label: <>{ws.network.total.toLocaleString("en-US")} imported · <Ago iso={ws.network.importedAt} /></> } : { tone: "off", label: "Not imported" }}
          badge={startBadge("linkedin")}
        />
        <LinkRow
          id="csv"
          href="/integrations?import=csv"
          name="CSV list"
          blurb="Import companies and contacts. Columns are matched automatically."
          icon={<FileSpreadsheet className="size-4" />}
          status={csvCount ? { tone: "on", label: `${csvCount.toLocaleString("en-US")} compan${csvCount === 1 ? "y" : "ies"} imported` } : { tone: "off", label: "Drop in a file" }}
        />
        <LinkRow
          id="github"
          href="/integrations?import=github"
          name="GitHub stargazers"
          blurb="Find prospects who starred your developer tool."
          icon={<Star className="size-4" />}
          status={starCount ? { tone: "on", label: `${starCount.toLocaleString("en-US")} stargazer${starCount === 1 ? "" : "s"} placed` } : { tone: "off", label: "Not imported" }}
        />
      </Group>

      <Group id="outreach" question="Send through an outreach tool" note="Choose one if you use email campaigns. Otherwise, send from your own inbox.">
        {native("instantly")}
        {native("smartlead")}
        {native("lemlist")}
      </Group>

      <Group id="deals" question="Sync your CRM" note="Choose your CRM. Enable write-back when you want Inroad to update it.">
        {native("hubspot")}
        {native("attio")}
      </Group>

      <details ref={moreTools} id="more-tools" className="mt-8 scroll-mt-24 border-t border-border pt-5">
        <summary className="cursor-pointer rounded-sm text-[14px] font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
          More tools
          {moreNeedsAttention && <Badge tone="warning" className="ml-2">Needs attention</Badge>}
          <span className="mt-1 block text-[12px] font-normal text-fg-3">People lookup, meetings, alerts and automation</span>
        </summary>

      <Group id="people" question="Find people and email addresses" note="Search is free. Adding contacts and finding emails uses Firecrawl credits.">
        {native("firecrawl")}
      </Group>

      <Group id="meetings" question="Meeting bookings">
        {BOOKING_SOURCES.map((s) => {
          const id = isBooking(s.id) ? s.id : null;
          const keyed = id ? ws.integrations[id] : undefined;
          return (
            <IntegrationRow
              key={s.id}
              id={s.id}
              name={s.name}
              blurb="Turn new bookings into meetings and call prep."
              domain={s.domain}
              status={id && keyed?.enabled ? nativeStatus(id, ws) : hookStatus(events, [s.id])}
              open={current === s.id}
              onToggle={() => toggle(s.id)}
            >
              <HookPanel
                sources={[s]}
                status={status}
                onRefresh={refresh}
                showExample={false}
                extra={
                  id ? (
                    <BookingKey
                      id={id}
                      state={keyed}
                      replacing={replacing === id}
                      onReplace={() => setReplacing(id)}
                      onDone={() => {
                        setReplacing(null);
                        void refresh();
                      }}
                    />
                  ) : undefined
                }
              />
            </IntegrationRow>
          );
        })}
      </Group>

      <Group id="alerts" question="Alerts">
        {native("slack")}
      </Group>

      <Group id="automation" question="Automation">
        <IntegrationRow
          id="inbound"
          name="Import from Clay, Zapier, n8n or Make"
          blurb="Bring in leads and activity automatically."
          icon={<Webhook className="size-4" />}
          status={hookStatus(events, LEAD_HOOK_IDS)}
          open={current === "inbound"}
          onToggle={() => toggle("inbound")}
        >
          <HookPanel sources={LEAD_SOURCES} status={status} onRefresh={refresh} />
        </IntegrationRow>
        <IntegrationRow
          id="webhooks"
          name="Outbound webhooks"
          blurb="Send approvals, replies and deal updates to your other tools."
          icon={<Webhook className="size-4" />}
          status={outboundStatus(ws)}
          open={current === "webhooks"}
          onToggle={() => toggle("webhooks")}
        >
          <OutboundPanel status={status} onRefresh={refresh} />
        </IntegrationRow>
      </Group>

      <section id="agents" aria-labelledby="agents-label" className="mt-10 scroll-mt-24">
        <SectionLabel>
          <span id="agents-label">Connect AI agents</span>
        </SectionLabel>
        <p className="mb-3 max-w-[60ch] px-1 text-[13px] leading-[19px] text-fg-3">
          Let Claude, Cursor, ChatGPT or another agent read your playbook and add leads. You approve outbound messages.
        </p>
        <AgentsCard />
      </section>
      </details>

      <Dialog
        open={importKind !== null}
        onOpenChange={(o) => !o && closeImport()}
        title={importKind === "linkedin" ? "Import your LinkedIn connections" : importKind === "github" ? "Import your GitHub stargazers" : "Import a list"}
        className="max-w-[640px]"
      >
        <div className="px-5 pb-5 pt-3">{importKind && <ImportFlow kind={importKind} onDone={closeImport} />}</div>
      </Dialog>
    </div>
  );
}

function outboundStatus(ws: Workspace): RowStatus {
  const n = ws.webhooks.length;
  if (!n) return { tone: "off", label: "None yet" };
  const failing = ws.webhooks.filter((w) => w.paused || (w.lastDelivery && (typeof w.lastDelivery.status !== "number" || w.lastDelivery.status >= 300))).length;
  if (failing) return { tone: "error", label: `${failing} of ${n} failing` };
  return { tone: "on", label: `${n} endpoint${n === 1 ? "" : "s"}` };
}

function HubSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pb-28 pt-8 md:px-10 md:pt-12" aria-busy="true">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-4 h-4 w-full max-w-[520px]" />
      <Skeleton className="mt-2 h-4 w-80" />
      {[3, 3, 2].map((rows, g) => (
        <div key={g} className="mt-10">
          <Skeleton className="mb-3 h-3 w-40" />
          <Card className="divide-y divide-border">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="size-7 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  );
}

