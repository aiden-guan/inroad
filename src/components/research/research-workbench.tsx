"use client";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { FieldError } from "@/components/ui/field";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { isConsumer } from "@/lib/consumer/market";
import type { Workspace } from "@/lib/domain/types";
import { ConnectionsPanel } from "./connections-panel";
import { IntentPanel } from "./intent-panel";
import { MonitorsPanel } from "./monitors-panel";
import { OutcomesPanel } from "./outcomes-panel";
import { SearchPanel } from "./search-panel";
import { useAutomation } from "./use-automation";
import { useUrlParams } from "./use-intent";

const TABS = ["intent", "search", "monitors", "connections", "outcomes"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { intent: "Intent", search: "Search", monitors: "Monitors", connections: "Connections", outcomes: "Outcomes" };

/** Intent leads once it has something to show; until then, Search. `?tab=` always wins (and the old `tools`). */
function landing(ws: Workspace): Tab {
  return ws.intent?.items.length || ws.intent?.radar?.companies.length ? "intent" : "search";
}

function tabFrom(raw: string | null): Tab | null {
  if (raw === "tools") return "connections";
  return (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : null;
}

export function ResearchWorkbench() {
  const params = useSearchParams();
  const setParams = useUrlParams();
  const { ws } = useWorkspace();
  const automation = useAutomation();
  const [monitorQuery, setMonitorQuery] = useState(params.get("query") ?? "");
  const consumer = !!ws && isConsumer(ws);
  // A link that carries a search (?query=) opens Search, whatever the landing tab would be.
  const tab = tabFrom(params.get("tab")) ?? (params.get("query") ? "search" : ws ? landing(ws) : null);
  const unread = automation.data?.observations.filter((o) => !o.read).length ?? 0;
  const live = (ws?.intent?.items ?? []).length;

  // The search box already holds ?query= once mounted, so switching tabs drops it with the other views' filters.
  const go = (next: Tab) => setParams({ tab: ws && next === landing(ws) ? null : next, query: null, intent: null, radar: null, when: null, source: null, match: null, sort: null });

  return (
    <PageContainer>
      <PageHeader
        title="Research"
        eyebrow="Evidence from the web"
        description={
          consumer
            ? "Find people asking for what you make, where your users gather, and changes worth acting on. Every result keeps its source and date."
            : "Find people asking for what you sell, companies worth a look, and changes worth acting on. Every result keeps its source and date."
        }
        className="mb-6"
      />
      <div className="mb-6">
        {tab ? (
          <Segmented
            layoutId="research-tab"
            value={tab}
            onChange={go}
            options={TABS.map((t) => ({
              value: t,
              label: LABEL[t],
              ...(t === "intent" && live ? { count: live } : {}),
              ...(t === "monitors" && unread ? { count: unread } : {}),
            }))}
          />
        ) : (
          <Skeleton className="h-10 w-full max-w-[460px] rounded-lg" />
        )}
      </div>
      {automation.error && <FieldError>{automation.error}</FieldError>}
      {!ws || !tab ? (
        <div className="space-y-3" aria-busy>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : (
        <section role="tabpanel" aria-label={LABEL[tab]}>
          {tab === "intent" && <IntentPanel ws={ws} consumer={consumer} automation={automation} />}
          {/* Search stays mounted, so its results survive a look at another tab. */}
          <div hidden={tab !== "search"}>
            <SearchPanel
              automation={automation}
              consumer={consumer}
              onMonitor={(q) => {
                setMonitorQuery(q);
                go("monitors");
              }}
            />
          </div>
          {tab === "monitors" && <MonitorsPanel automation={automation} initialQuery={monitorQuery} onIntent={() => go("intent")} />}
          {tab === "connections" && <ConnectionsPanel automation={automation} />}
          {tab === "outcomes" && <OutcomesPanel automation={automation} />}
        </section>
      )}
    </PageContainer>
  );
}
