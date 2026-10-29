"use client";

import { LoadingSignal } from "@/components/ui/loading";
import { PageHeader } from "@/components/ui/page-header";
import { ArrowLeftRight, Handshake, NotebookPen, Plus, UserPlus } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useToday } from "@/components/companies/list/lib";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { addDays } from "@/lib/domain/ids";
import type { Connector, Intro } from "@/lib/domain/types";
import { isOpenIntro, nextStep } from "@/lib/intros/rules";
import { listItem } from "@/lib/motion";
import { ConnectorDialog, ConnectorList } from "./connectors";
import { IntroCard } from "./intro-card";
import { LogAskDialog, MakeIntroDialog } from "./intro-dialogs";

/**
 * Intros: every one the founder asked for or made, from the first ask to the thank-you. Grouped by
 * whose move it is, because that's the only question that matters on a given morning. Below them,
 * the people who introduce you and how much you've leaned on each.
 */
export function IntrosPage() {
  const { ws } = useWorkspace();
  const today = useToday();
  const params = useSearchParams();
  const router = useRouter();
  const focus = params.get("i");
  const [dialog, setDialog] = useState<"give" | "ask" | "connector" | null>(() => {
    const n = params.get("new");
    return n === "give" || n === "ask" || n === "connector" ? n : null;
  });
  const [editing, setEditing] = useState<Connector | undefined>(undefined);
  const [showClosed, setShowClosed] = useState(false);

  const groups = useMemo(() => {
    if (!ws || !today) return null;
    const all = Object.values(ws.intros ?? {}).map((intro) => ({ intro, next: nextStep(intro, ws, today) }));
    const yours = all.filter((x) => x.next.owner === "you" && x.next.action).sort((a, b) => (b.next.overdueDays ?? 0) - (a.next.overdueDays ?? 0));
    const waiting = all.filter((x) => !yours.includes(x) && (isOpenIntro(x.intro) || (x.intro.kind === "give" && x.intro.stage === "introduced"))).sort((a, b) => (a.next.due ?? "9999").localeCompare(b.next.due ?? "9999"));
    const closed = all.filter((x) => !yours.includes(x) && !waiting.includes(x)).sort((a, b) => b.intro.updatedAt.localeCompare(a.intro.updatedAt));
    const since = addDays(today, -90);
    const made = all.filter((x) => (x.intro.introducedOn ?? "") >= since).length;
    const asks = all.filter((x) => x.intro.kind === "ask" && x.intro.askedOn >= since && x.intro.askedOn <= addDays(today, -7));
    const answered = asks.filter((x) => x.intro.stage !== "asked" && x.intro.stage !== "no_answer").length;
    return { yours, waiting, closed, made, answerRate: asks.length >= 3 ? Math.round((answered / asks.length) * 100) : null };
  }, [ws, today]);

  // Arriving from Today or a sheet with ?i=: bring that intro into view.
  useEffect(() => {
    if (!focus || !groups) return;
    const el = document.getElementById(`intro-${focus}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, groups]);

  const closeDialog = () => {
    setDialog(null);
    setEditing(undefined);
    if (params.get("new")) router.replace("/intros", { scroll: false });
  };

  if (!ws || !groups || !today) return <PageSkeleton />;
  const empty = !Object.keys(ws.intros ?? {}).length;

  return (
    <div className="page-shell max-w-[1000px]">
      <PageHeader
        title="Intros"
        eyebrow="Better through people"
        description="Every intro you ask for or make, from the ask to the thank-you. Double opt-in, always."
        actions={<>
          <Button variant="secondary" icon={<NotebookPen className="size-4" />} onClick={() => setDialog("ask")}>Log an ask</Button>
          <Button variant="primary" icon={<ArrowLeftRight className="size-4" />} onClick={() => setDialog("give")}>Make an intro</Button>
        </>}
      >
          {!empty && (
            <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-fg-3">
              <span>
                <span className="font-mono tnum text-fg-2">{groups.yours.length}</span> your move
              </span>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tnum text-fg-2">{groups.waiting.length}</span> waiting on others
              </span>
              <span aria-hidden>·</span>
              <span>
                <span className="font-mono tnum text-fg-2">{groups.made}</span> intro{groups.made === 1 ? "" : "s"} made in 90 days
              </span>
              {groups.answerRate !== null && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    <span className="font-mono tnum text-fg-2">{groups.answerRate}%</span> of asks answered
                  </span>
                </>
              )}
            </p>
          )}
      </PageHeader>

      {empty ? (
        <div className="mt-10 rounded-lg bg-surface px-6 py-10 text-center ring-1 ring-border">
          <Handshake className="mx-auto size-6 text-fg-4" aria-hidden />
          <p className="mt-3 font-serif text-[24px] leading-[30px] tracking-[-0.01em] text-fg">Warm intros reply far more often than cold email.</p>
          <p className="mx-auto mt-2 max-w-[52ch] text-[14px] leading-[21px] text-fg-2">
            Add the people who vouch for you and who they can reach. Every company then shows its ways in, and each ask you send is tracked here until the thank-you.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setDialog("connector")}>
              Add someone who introduces you
            </Button>
            {!ws.network && (
              <Link href="/integrations?import=linkedin" className="inline-flex h-8 items-center rounded-sm px-3 text-[13px] font-medium text-fg-2 ring-1 ring-border hover:bg-bg-subtle">
                Import LinkedIn connections
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          <Group title="Your move" count={groups.yours.length} empty="Nothing waiting on you.">
            {groups.yours.map(({ intro }, i) => (
              <Row key={intro.id} i={i} intro={intro} ws={ws} today={today} open={focus ? focus === intro.id : i === 0} highlight={focus === intro.id} />
            ))}
          </Group>
          <Group title="Waiting on others" count={groups.waiting.length} empty="No asks out right now.">
            {groups.waiting.map(({ intro }, i) => (
              <Row key={intro.id} i={i} intro={intro} ws={ws} today={today} open={focus === intro.id} highlight={focus === intro.id} />
            ))}
          </Group>
        </>
      )}

      <section className="mt-10" aria-labelledby="connectors-label">
        <SectionLabel
          right={
            <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setDialog("connector")}>
              Add
            </Button>
          }
        >
          <span id="connectors-label">People who introduce you</span>
        </SectionLabel>
        {ws.connectors.length ? (
          <>
            <ConnectorList
              ws={ws}
              today={today}
              onEdit={(c) => {
                setEditing(c);
                setDialog("connector");
              }}
            />
            <p className="mt-2 px-1 text-[12px] leading-[18px] text-fg-3">One open ask per person, two weeks between asks, and something given back before a fourth ask in 90 days. Investors are exempt from the last rule; it&apos;s their job.</p>
          </>
        ) : (
          <p className="rounded-lg bg-surface px-4 py-5 text-[13.5px] text-fg-3 ring-1 ring-border">Nobody yet. Investors, advisors, customers and former colleagues are the usual first five.</p>
        )}
      </section>

      {groups.closed.length > 0 && (
        <section className="mt-10">
          <button type="button" onClick={() => setShowClosed((s) => !s)} className="px-1 text-[12px] font-medium text-fg-3 hover:text-fg-2" aria-expanded={showClosed}>
            {showClosed ? "Hide" : "Show"} closed · {groups.closed.length}
          </button>
          {showClosed && (
            <ul className="mt-2 space-y-2">
              {groups.closed.slice(0, 30).map(({ intro }, i) => (
                <Row key={intro.id} i={i} intro={intro} ws={ws} today={today} open={focus === intro.id} highlight={focus === intro.id} />
              ))}
            </ul>
          )}
        </section>
      )}

      <MakeIntroDialog open={dialog === "give"} onOpenChange={(o) => (o ? setDialog("give") : closeDialog())} />
      <LogAskDialog open={dialog === "ask"} onOpenChange={(o) => (o ? setDialog("ask") : closeDialog())} />
      <ConnectorDialog open={dialog === "connector"} onOpenChange={(o) => (o ? setDialog("connector") : closeDialog())} connector={editing} />
    </div>
  );
}

function Group({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <SectionLabel>
        {title}
        {count > 0 && <span className="ml-1.5 font-mono text-[11px] tnum text-fg-3">{count}</span>}
      </SectionLabel>
      {count ? <ul className="space-y-2">{children}</ul> : <p className="px-1 text-[13px] text-fg-3">{empty}</p>}
    </section>
  );
}

function Row({ i, intro, ws, today, open, highlight }: { i: number; intro: Intro; ws: NonNullable<ReturnType<typeof useWorkspace>["ws"]>; today: string; open: boolean; highlight: boolean }) {
  return (
    <motion.li variants={listItem} initial="hidden" animate="show" custom={i}>
      <IntroCard intro={intro} ws={ws} today={today} defaultOpen={open} highlight={highlight} />
    </motion.li>
  );
}

function PageSkeleton() {
  return (
    <div className="page-shell max-w-[1000px]" aria-busy="true">
      <LoadingSignal label="Loading introductions" className="mb-7" />
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-3 h-4 w-full max-w-[480px]" />
      {[2, 3].map((n, g) => (
        <div key={g} className="mt-10 space-y-2">
          <Skeleton className="mb-3 h-3 w-28" />
          {Array.from({ length: n }, (_, k) => (
            <Skeleton key={k} className="h-[68px] w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}
