"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { todayISO } from "@/lib/domain/ids";
import type { IntegrationState } from "@/lib/domain/types";
import type { HubStatus } from "@/lib/hub/types";
import { ToggleRow } from "./parts";
import { useHubApi, useNow } from "./use-hub";

export function SlackPanel({ state, status, onRefresh }: { state: IntegrationState; status: HubStatus | null; onRefresh: () => void }) {
  const { dispatch } = useWorkspace();
  const api = useHubApi();
  const [busy, setBusy] = useState<"brief" | "ping" | null>(null);
  const set = (patch: Record<string, boolean>) => dispatch({ type: "integration.update", id: "slack", patch: { config: patch } });
  const now = useNow();
  const sentToday = now > 0 && status?.slack.briefSentOn === todayISO(new Date(now));

  async function send(what: "brief" | "ping") {
    setBusy(what);
    const r = await api<{ message?: string }>("/api/integrations/test", { target: "slack", what });
    setBusy(null);
    if (r?.message) {
      toast.success(r.message);
      onRefresh();
    }
  }

  return (
    <div className="space-y-5">
      <ToggleRow title="Daily brief" checked={state.config.dailyBrief !== false} onChange={(v) => void set({ dailyBrief: v })}>
        Once a day, when your day is prepared: your top moves, replies and pipeline numbers. Built from numbers I already have, so it costs no AI tokens.
      </ToggleRow>
      <ToggleRow title="Interested-reply alerts" checked={state.config.replyAlerts !== false} onChange={(v) => void set({ replyAlerts: v })}>
        The moment Instantly, Smartlead, lemlist or a webhook reports an interested reply or a referral.
      </ToggleRow>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={busy === "brief"} disabled={busy !== null} onClick={() => send("brief")}>
          {sentToday ? "Send today's brief again" : "Send today's brief now"}
        </Button>
        <Button size="sm" variant="ghost" loading={busy === "ping"} disabled={busy !== null} onClick={() => send("ping")}>
          Send a test message
        </Button>
      </div>
    </div>
  );
}
