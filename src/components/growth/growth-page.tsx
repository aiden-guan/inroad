"use client";

import { FileUp } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { BusinessMetrics } from "@/components/revenue/business-metrics";
import { ReviewBody } from "@/components/today/review-panel";
import { useClock } from "@/components/today/use-today";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { LoadingSignal } from "@/components/ui/loading";
import { PageHeader } from "@/components/ui/page-header";
import { shortDate } from "@/lib/client/format";
import { goalPace, hasLoggedLastWeek, readGrowth } from "@/lib/consumer/growth";
import { isConsumer } from "@/lib/consumer/market";
import { consumerChannelPlan } from "@/lib/consumer/plan";
import { todayISO, weekOf } from "@/lib/domain/ids";
import { localDate } from "@/lib/moves/util";
import { GrowthHero } from "./growth-hero";
import { Numbers } from "./numbers";
import { WhatItTakes, Working } from "./plan";

/**
 * Growth: the number a consumer company is measured on, read the way its Monday growth meeting reads it. The consumer
 * counterpart of Revenue. Everything is computed in code from the weeks the founder logs (zero tokens): where the goal
 * stands, the pace to its date, what the numbers say, what it takes and what's working. The only model call is the
 * growth review, and only when asked.
 */
export function GrowthPage() {
  const { ws } = useWorkspace();
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

  // Nothing logged yet: the form is the page's first job.
  const empty = !!data && !data.g.latest;
  // Opening the form (the header button, `?log=1`) brings it into view once, not on every workspace refresh after.
  const ready = !!data;
  useEffect(() => {
    if (!logging || !ready) return;
    const frame = requestAnimationFrame(() => document.getElementById("numbers")?.scrollIntoView({ block: "start", behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [logging, ready]);

  if (!ws || !data) return <LoadingSignal label="Reading your numbers" className="min-h-[60dvh]" />;
  const { g, pace, funnel, talks, weekStart } = data;
  const logged = hasLoggedLastWeek(ws, today);

  return (
    <div className="page-shell max-w-[1080px]">
      <PageHeader
        title="Growth"
        eyebrow="The number"
        description={
          g.goal.current !== null ? (
            <>
              {ws.goal.target.toLocaleString("en-US")} {ws.goal.targetLabel} by {shortDate(ws.goal.byDate)}; <span className="font-mono tnum text-fg">{g.goal.current.toLocaleString("en-US")}</span> last week. Every
              weekly number is counted from the weeks you log. Connected sources keep your active users and revenue up to date.
            </>
          ) : (
            "Your active users and revenue from connected sources, alongside your weekly growth goal, pace and retention readings."
          )
        }
        actions={
          <Button variant={logged ? "secondary" : "primary"} icon={<FileUp className="size-4" />} onClick={() => setLogging(true)}>
            {logged ? "Edit last week" : "Log last week"}
          </Button>
        }
      />

      {!isConsumer(ws) && (
        <p className="mt-6 rounded-md bg-bg-subtle px-3 py-2.5 text-[13px] leading-5 text-fg-2">
          Growth reads a consumer company&apos;s weekly numbers. You&apos;re set up as a business, so your number lives on{" "}
          <Link href="/revenue" className="text-fg underline underline-offset-2">
            Revenue
          </Link>
          .
        </p>
      )}

      <BusinessMetrics mode="growth" />
      <GrowthHero goal={ws.goal} g={g} pace={pace} signupsPerWeek={funnel.signupsPerWeek} today={today} />
      <Numbers ws={ws} today={today} g={g} logging={logging || empty} onLogging={setLogging} />
      <WhatItTakes ws={ws} g={g} pace={pace} funnel={funnel} talks={talks} />
      <Working ws={ws} g={g} />

      <section className="mt-12" aria-labelledby="review-label">
        <SectionLabel>
          <span id="review-label">Monday growth review</span>
        </SectionLabel>
        <div className="rounded-xl bg-surface px-5 py-5 shadow-sm ring-1 ring-inset ring-border sm:px-7">
          <ReviewBody ws={ws} kind="growth" weekStart={weekStart} />
        </div>
      </section>
    </div>
  );
}
