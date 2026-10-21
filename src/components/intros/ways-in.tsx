"use client";

import { AlertTriangle, ArrowUpRight, Building2, GraduationCap, Handshake, Landmark, Star, User } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ComposeButton } from "@/components/compose/composer";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Section, useToday } from "@/components/companies/sheet/shared";
import { Skeleton } from "@/components/ui/misc";
import { newId } from "@/lib/domain/ids";
import type { Account } from "@/lib/domain/types";
import { openIntroFor, type WayIn, type WayInKind } from "@/lib/intros/rules";
import { listItem } from "@/lib/motion";
import { first } from "@/lib/moves/util";
import { IntroCard } from "./intro-card";

const KIND: Record<WayInKind, { label: string; icon: typeof User }> = {
  direct: { label: "You know them", icon: User },
  inside: { label: "Works there", icon: Building2 },
  connector: { label: "Can reach them", icon: Handshake },
  alumni: { label: "Used to work there", icon: GraduationCap },
  customer: { label: "Customer peer", icon: Star },
  investor: { label: "Investor", icon: Landmark },
};

/**
 * "Who can get me in?" for one company: every path the founder has, ranked in code, each with why
 * it might work and what to watch for. One ask per company at a time, so an ask in flight replaces
 * the list with its status.
 */
export function WaysIn({ account }: { account: Account }) {
  const { ws, dispatch } = useWorkspace();
  const today = useToday();
  const [ways, setWays] = useState<WayIn[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  // Re-rank when connectors or intros change (a new connector, an ask sent), not on every write.
  const key = ws ? JSON.stringify([ws.connectors.map((c) => [c.id, c.reach, c.company, c.lastAskedOn]), Object.values(ws.intros ?? {}).map((i) => [i.id, i.stage]), ws.network?.importedAt]) : "";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/intros/paths?domain=${encodeURIComponent(account.domain)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { ways: WayIn[] }) => {
        if (cancelled) return;
        setWays(body.ways);
        setFailed(false);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [account.domain, key]);

  if (!ws) return null;
  const open = openIntroFor(ws, account.domain);
  if (open) {
    return (
      <Section label="Ways in">
        <IntroCard intro={open} ws={ws} today={today} />
        <p className="mt-2 text-[12px] text-fg-3">One ask per company at a time. Other paths come back if this one closes.</p>
      </Section>
    );
  }
  if (failed) return null;
  if (!ways) {
    return (
      <Section label="Ways in">
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </Section>
    );
  }
  if (!ways.length) {
    return (
      <Section label="Ways in">
        <p className="text-[13px] leading-[19px] text-fg-3">
          No warm path yet.{" "}
          <Link href="/intros?new=connector" className="font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
            Add who your investors and advisors can reach
          </Link>
          {!ws.network && (
            <>
              {" "}or{" "}
              <Link href="/integrations?import=linkedin" className="font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
                import your LinkedIn connections
              </Link>
            </>
          )}
          .
        </p>
      </Section>
    );
  }

  const shown = more ? ways : ways.slice(0, 3);
  const best = ways.find((w) => w.ready && w.kind !== "direct");
  return (
    <Section label="Ways in">
      <ul className="space-y-2">
        {shown.map((w, i) => {
          const Icon = KIND[w.kind].icon;
          const name = first(w.via.name);
          return (
            <motion.li key={w.id} variants={listItem} initial="hidden" animate="show" custom={i} className="rounded-md bg-surface px-3 py-2.5 ring-1 ring-border">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <span aria-hidden className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-fg-3 ring-1 ring-border">
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px]">
                    <span className="font-medium text-fg">{w.via.name}</span>
                    {(w.via.title || w.via.company) && <span className="text-fg-3">{[w.via.title, w.kind === "inside" ? null : w.via.company].filter(Boolean).join(" · ")}</span>}
                    <span className="text-[11.5px] text-fg-3">{KIND[w.kind].label}</span>
                    {w.via.linkedinUrl && /^https:\/\/([a-z]+\.)?linkedin\.com\//.test(w.via.linkedinUrl) && (
                      <a href={w.via.linkedinUrl} target="_blank" rel="noreferrer" aria-label={`${w.via.name} on LinkedIn`} className="text-fg-3 hover:text-fg">
                        <ArrowUpRight className="size-3.5" />
                      </a>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-2">{w.why}</p>
                  {w.concerns.map((c) => (
                    <p key={c} className="mt-1 flex items-start gap-1.5 text-[12px] leading-[17px] text-warning">
                      <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                      {c}
                    </p>
                  ))}
                </div>
                {w.kind === "direct" ? (
                  <ComposeButton domain={account.domain} personId={w.via.personId} mode="linkedin" label={`Message ${name}`} variant="secondary" />
                ) : (
                  <ComposeButton
                    domain={account.domain}
                    personId={w.target?.personId}
                    mode="warm_intro"
                    label={`Ask ${name}`}
                    variant={w === best ? "agent" : "secondary"}
                    connectorId={w.via.connectorId}
                    ensureConnector={
                      w.via.connectorId
                        ? undefined
                        : async () => {
                            const id = newId("con");
                            const ok = await dispatch({
                              type: "connector.upsert",
                              connector: { id, name: w.via.name, relationship: "connection", ...(w.via.linkedinUrl ? { linkedinUrl: w.via.linkedinUrl } : {}), ...(w.via.company ? { company: w.via.company } : {}), introsMade: 0 },
                            });
                            return ok ? id : undefined;
                          }
                    }
                  />
                )}
              </div>
            </motion.li>
          );
        })}
      </ul>
      {ways.length > 3 && (
        <button type="button" onClick={() => setMore((m) => !m)} className="mt-2 text-[12px] font-medium text-fg-3 hover:text-fg-2">
          {more ? "Fewer" : `${ways.length - 3} more`}
        </button>
      )}
    </Section>
  );
}
