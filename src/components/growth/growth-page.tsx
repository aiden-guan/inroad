"use client";

import { FileUp } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { ReviewBody } from "@/components/today/review-panel";
import { useClock } from "@/components/today/use-today";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { useSwitchMarket } from "@/components/shell/market-switch";
import { PageContainer, PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { goalPace, hasLoggedLastWeek, readGrowth } from "@/lib/consumer/growth";
import { isConsumer } from "@/lib/consumer/market";
import { consumerChannelPlan } from "@/lib/consumer/plan";
import { todayISO, weekOf } from "@/lib/domain/ids";
import { localDate } from "@/lib/moves/util";
import { GrowthHero } from "./growth-hero";
import { Numbers } from "./numbers";
import { WhatItTakes, Working } from "./plan";
import { GrowthDashboard } from "./dashboard";
import { GtmInitiatives } from "@/components/gtm/initiatives";

/**
 * Growth: the number a consumer company is measured on, read the way its Monday growth meeting reads it. The consumer
 * counterpart of Revenue. Everything is computed in code from the weeks the founder logs (zero tokens): where the goal
 * stands, the pace to its date, what the numbers say, what it takes and what's working. The only model call is the
 * growth review, and only when asked.
 */
export function GrowthPage() {
  const { ws, error, refresh } = useWorkspace();
  const switchTo = useSwitchMarket();
  const now = useClock(60_000);
  const params = useSearchParams();
  const today = todayISO(new Date(now));
  const [logging, setLogging] = useState(params.get("log") === "1");

  const data = useMemo(() => {
    if (!ws) return null;
    const g = readGrowth(ws, today);
    const funnel = consumerChannelPlan(ws, { today, retentionHolds: g.retentionHolds }).funnel.consumer!;
    const weekStart = weekOf(today);
    const talks = ws.activities.filter((a) => a.kind === "user_conversation" && localDate(a.at) >= weekStart).length;
    return { g, pace: goalPace(ws, today), funnel, talks, weekStart };
  }, [ws, today]);

  // Opening the form (the header button, `?log=1`) brings it into view once, not on every workspace refresh after.
  const ready = !!data;
  useEffect(() => {
    if (!logging || !ready) return;
    const frame = requestAnimationFrame(() => document.getElementById("numbers")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [logging, ready]);

  if (!ws || !data) {
    return (
      <PageContainer>
        {error ? (
          <PageState kind="error" title="Couldn't load your workspace" body="Your data is still on this machine." detail={error} onRetry={refresh} />
        ) : (
          <PageState kind="loading" label="Reading your numbers" onRetry={refresh} />
        )}
      </PageContainer>
    );
  }

  // A business's number is on Revenue. Growth says so, says how to switch, and shows nothing else.
  if (!isConsumer(ws)) {
    return (
      <PageContainer>
        <PageHeader title="Growth" eyebrow="The number" description="Growth reads a consumer company's weekly numbers: active users, retention and the pace to its goal." />
        <section aria-labelledby="growth-business-title" className="mt-8 max-w-[720px] rounded-xl bg-surface px-5 py-6 shadow-sm ring-1 ring-inset ring-border sm:px-7">
          <h2 id="growth-business-title" className="text-balance font-serif text-[21px] leading-[30px] text-fg">
            You sell to businesses, so your number is on Revenue.
          </h2>
          <p className="mt-1.5 text-pretty text-[13.5px] leading-[21px] text-fg-2">There the forecast is called from your deals: commit, best case and pipeline, what needs fixing, and what it takes to close the gap.</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href="/revenue" className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-fg shadow-btn transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.97]">
              Open Revenue
            </Link>
            {ws.company && (
              <Button variant="ghost" onClick={() => void switchTo("consumer")}>
                I sell to consumers
              </Button>
            )}
          </div>
          <p className="mt-4 text-pretty text-[12.5px] leading-[18px] text-fg-3">
            You can switch who you sell to any time from your company name at the top of the sidebar, the command menu, or{" "}
            <Link href="/settings#market" className="text-fg-2 underline underline-offset-2 hover:text-fg">
              Settings
            </Link>
            . Switching keeps everything; it only changes what Inroad shows and writes.
          </p>
        </section>
      </PageContainer>
    );
  }
  const { g, pace, funnel, talks, weekStart } = data;
  const logged = hasLoggedLastWeek(ws, today);
  function startLogging() {
    setLogging(true);
    // Also brings an already open form back into view on a subsequent header click.
    requestAnimationFrame(() => document.getElementById("numbers")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  function renderSection(id: string) {
    switch (id) {
      case "goal": return <GrowthHero goal={ws!.goal} g={g} pace={pace} signupsPerWeek={funnel.signupsPerWeek} today={today} />;
      case "weekly": return <Numbers ws={ws!} today={today} g={g} logging={logging} onLogging={setLogging} />;
      case "priorities": return <GtmInitiatives />;
      case "plan": return <WhatItTakes ws={ws!} g={g} pace={pace} funnel={funnel} talks={talks} />;
      case "channels": return <Working ws={ws!} g={g} />;
      case "review": return <section aria-labelledby="review-label">
        <SectionLabel>
          <span id="review-label">Monday growth review</span>
        </SectionLabel>
        <div className="rounded-xl bg-surface px-5 py-5 shadow-sm ring-1 ring-inset ring-border sm:px-7">
          <ReviewBody ws={ws!} kind="growth" weekStart={weekStart} />
        </div>
      </section>;
      default: return null;
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Growth"
        eyebrow="The number"
        description="Waitlist to active users to paying customers. Choose what matters, and keep it in view."
        actions={
          <Button variant={logged ? "secondary" : "primary"} icon={<FileUp className="size-4" />} onClick={startLogging}>
            {logged ? "Edit last week" : "Log last week"}
          </Button>
        }
      />

      <GrowthDashboard now={now} logging={logging} renderSection={renderSection} />

    </PageContainer>
  );
}
