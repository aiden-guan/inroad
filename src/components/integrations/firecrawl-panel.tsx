"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { credits, usePeopleData } from "@/components/people/use-people-data";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { PEOPLE_DATA_PRICE } from "@/lib/connectors/catalog";
import { SubLabel } from "./parts";
import { useHubApi } from "./use-hub";

const USES = [
  { what: "Find people at a company", where: "Apollo", cost: "Free" },
  { what: "Add someone: full name, LinkedIn, work email", where: "Apollo", cost: `Up to ${credits(PEOPLE_DATA_PRICE.add)}` },
  { what: "Find a work email for someone on file", where: "FullEnrich", cost: `Up to ${credits(PEOPLE_DATA_PRICE.workEmail)}` },
];

/** What Firecrawl is used for, what it cost this month, and the monthly credit limit. */
export function FirecrawlPanel() {
  const { dispatch } = useWorkspace();
  const pd = usePeopleData();
  const api = useHubApi();
  const id = useId();
  const [limit, setLimit] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const draft = limit ?? String(pd.limit);
  const valid = /^\d{1,7}$/.test(draft.trim());

  const save = async () => {
    if (!valid) return;
    await dispatch({ type: "integration.update", id: "firecrawl", patch: { config: { monthlyCredits: Number(draft.trim()) } } });
    setLimit(null);
    toast(`Monthly limit set to ${credits(Number(draft.trim()))}`);
  };

  const checkBalance = async () => {
    setChecking(true);
    const r = await api<{ remaining: number }>("/api/people/credits");
    setChecking(false);
    if (r) toast(`${credits(r.remaining)} left on your Firecrawl team`);
  };

  const share = pd.limit > 0 ? Math.min(1, pd.used / pd.limit) : 1;

  return (
    <div className="space-y-5">
      <div>
        <SubLabel>What I use it for</SubLabel>
        <ul className="divide-y divide-border rounded-md ring-1 ring-border">
          {USES.map((u) => (
            <li key={u.what} className="flex items-baseline gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1 text-fg">{u.what}</span>
              <span className="hidden text-[12px] text-fg-3 sm:inline">{u.where}</span>
              <span className="shrink-0 whitespace-nowrap text-right font-mono text-[12px] tnum text-fg-2">{u.cost}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-[18px] text-fg-3">
          Each paid lookup is one click you make, and a miss costs nothing. I never request personal emails or phone numbers. Find people on any company&apos;s People section.
        </p>
      </div>

      <div>
        <SubLabel
          right={
            <Button size="xs" variant="ghost" loading={checking} onClick={() => void checkBalance()}>
              Check balance
            </Button>
          }
        >
          This month
        </SubLabel>
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle ring-1 ring-border" role="progressbar" aria-valuemin={0} aria-valuemax={pd.limit} aria-valuenow={pd.used} aria-label="Firecrawl credits used this month">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${share * 100}%` }} />
        </div>
        <p className="mt-1.5 text-[12px] text-fg-3">
          <span className="font-mono tnum text-fg-2">{pd.used.toLocaleString("en-US")}</span> of <span className="font-mono tnum">{pd.limit.toLocaleString("en-US")}</span> credits used through Inroad
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <label htmlFor={id} className="mb-1 block text-[12px] font-medium text-fg-2">
            Monthly limit
          </label>
          <Input id={id} inputMode="numeric" value={draft} onChange={(e) => setLimit(e.target.value)} className="w-32 font-mono text-[12.5px]" aria-invalid={!valid} />
        </div>
        {limit !== null && limit !== String(pd.limit) && (
          <Button type="submit" size="sm" variant="primary" disabled={!valid}>
            Save
          </Button>
        )}
        <p className="basis-full text-[12px] text-fg-3">Lookups that could pass it are refused, so a busy week can&apos;t drain your Firecrawl plan.</p>
      </form>
    </div>
  );
}
