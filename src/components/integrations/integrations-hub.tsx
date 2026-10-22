"use client";

import { FileSpreadsheet, Star, Users, Webhook } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
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

  const anyNative = NATIVE_IDS.some((id) => ws.integrations[id]?.enabled);
  const startHere: string | null = !ws.network ? "linkedin" : !anyNative ? "slack" : null;
  const startBadge = (id: string) => (startHere === id ? <Badge tone="outline">Start here</Badge> : undefined);
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
        <h1 className="font-serif text-[32px] leading-[36px] tracking-[-0.015em] text-fg">What&apos;s in your stack?</h1>
        <p className="mt-3 max-w-[60ch] text-[14px] leading-[21px] text-fg-2 text-pretty">
          Plug in the tools your team already uses. Leads come in, approved drafts go out through your sequencer, and deals stay in step with your CRM. Syncing is plain code, so it never
          spends AI tokens.
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

      <Group id="leads" question="Where do leads come from?" note="Imports and webhooks are matched and deduplicated in code. Existing records only get empty fields filled.">
        <LinkRow
          id="linkedin"
          href="/integrations?import=linkedin"
          name="LinkedIn connections"
          blurb="Your warmest leads. I screen your Connections.csv for buyers at companies that fit."
          icon={<Users className="size-4" />}
          status={ws.network ? { tone: "on", label: <>{ws.network.total.toLocaleString("en-US")} imported · <Ago iso={ws.network.importedAt} /></> } : { tone: "off", label: "Not imported" }}
          badge={startBadge("linkedin")}
        />
        <LinkRow
          id="csv"
          href="/integrations?import=csv"
          name="A CSV list"
          blurb="From Apollo, Clay, Sales Navigator, your CRM or a spreadsheet. Columns map themselves."
          icon={<FileSpreadsheet className="size-4" />}
          status={csvCount ? { tone: "on", label: `${csvCount.toLocaleString("en-US")} compan${csvCount === 1 ? "y" : "ies"} imported` } : { tone: "off", label: "Drop in a file" }}
        />
        <LinkRow
          id="github"
          href="/integrations?import=github"
          name="GitHub stargazers"
          blurb="For developer tools: people who starred your repo, placed at the companies their profiles name."
          icon={<Star className="size-4" />}
          status={starCount ? { tone: "on", label: `${starCount.toLocaleString("en-US")} stargazer${starCount === 1 ? "" : "s"} placed` } : { tone: "off", label: "Not imported" }}
        />
        <IntegrationRow
          id="inbound"
          name="Clay, Zapier, n8n, Make or an AI SDR"
          blurb="They post accounts, people and activity to one URL. No code on your side."
          icon={<Webhook className="size-4" />}
          status={hookStatus(events, LEAD_HOOK_IDS)}
          open={current === "inbound"}
          onToggle={() => toggle("inbound")}
        >
          <HookPanel sources={LEAD_SOURCES} status={status} onRefresh={refresh} />
        </IntegrationRow>
      </Group>

      <Group id="people" question="Where do you look people up?" note="Searching is free. Adding someone or finding an email spends Firecrawl credits, only when it finds something.">
        {native("firecrawl")}
      </Group>

      <Group id="outreach" question="What sends your outreach?" note="Or send from your own inbox: approved drafts open in Gmail, with nothing to connect.">
        {native("instantly")}
        {native("smartlead")}
        {native("lemlist")}
      </Group>

      <Group id="deals" question="Where do deals live?" note="Your CRM keeps owning contacts and deals. I only write to it when you turn write-back on.">
        {native("hubspot")}
        {native("attio")}
      </Group>

      <Group id="meetings" question="Where do meetings get booked?">
        {BOOKING_SOURCES.map((s) => {
          const id = isBooking(s.id) ? s.id : null;
          const keyed = id ? ws.integrations[id] : undefined;
          return (
            <IntegrationRow
              key={s.id}
              id={s.id}
              name={s.name}
              blurb="New bookings become a meeting on the deal and a prep move on the day."
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

      <Group id="alerts" question="Where should alerts go?">
        {native("slack")}
      </Group>

      <Group id="automation" question="What else should hear about it?">
        <IntegrationRow
          id="webhooks"
          name="Outbound webhooks"
          blurb="Approvals, replies, deal moves and finished research, sent to Zapier, n8n, Make or your own code."
          icon={<Webhook className="size-4" />}
          status={outboundStatus(ws)}
          open={current === "webhooks"}
          onToggle={() => toggle("webhooks")}
        >
          <OutboundPanel status={status} onRefresh={refresh} />
        </IntegrationRow>
      </Group>

      <section aria-labelledby="agents-label" className="mt-10">
        <SectionLabel>
          <span id="agents-label">Which AI agents do you use?</span>
        </SectionLabel>
        <p className="mb-3 max-w-[60ch] px-1 text-[13px] leading-[19px] text-fg-3">
          Muse, Claude, Cursor, n8n and AI SDRs can read your playbook and add leads through Inroad. They run on their own tokens, and anything they send waits for your approval.
        </p>
        <AgentsCard />
      </section>

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

