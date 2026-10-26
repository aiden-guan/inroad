"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { postJson } from "@/components/import/api";
import { CompanyRow } from "@/components/import/network-result";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { addDays } from "@/lib/domain/ids";
import type { NetworkCompany } from "@/lib/domain/types";
import { plural, untrackedNetworkCompanies } from "@/lib/moves/util";
import type { BodyProps } from "./move-body";

/**
 * "Track 3 companies where you know someone": the network screen's approval point, on Today. A list dropped
 * while onboarding read the site is screened in the background, and nothing is tracked until the founder ticks it.
 */
export function NetworkCompaniesBody({ ws, move, today, onComplete, onSnooze, onChanged }: BodyProps) {
  const { refresh, dispatch } = useWorkspace();
  const router = useRouter();
  const [known] = useState(() => untrackedNetworkCompanies(ws));
  const [domains, setDomains] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(() => new Set(known.filter((c) => c.domain).map((c) => c.name)));
  const [busy, setBusy] = useState(false);
  const domainOf = (c: NetworkCompany) => c.domain ?? domains[c.name];
  const chosen = known.filter((c) => picked.has(c.name) && domainOf(c));

  async function track() {
    setBusy(true);
    try {
      const r = await postJson<{ tracked: number; people: number; skipped: { name: string; reason: string }[] }>("/api/import/track", {
        companies: chosen.map((c) => ({ name: c.name, domain: domainOf(c)! })),
      });
      await refresh();
      toast(`Tracking ${plural(r.tracked, "company", "companies")}${r.people ? ` with ${plural(r.people, "warm contact")}` : ""}.${r.skipped.length ? ` Skipped ${r.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(", ")}.` : ""}`, {
        action: { label: "Open Companies", onClick: () => router.push("/companies?view=prospects") },
      });
      onChanged();
      onComplete();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't track those companies.");
    } finally {
      setBusy(false);
    }
  }

  // "Not now" means later, not never: the card sleeps a week, then comes back with whatever is still untracked.
  const later = async () => {
    const until = addDays(today, 7);
    if (onSnooze) onSnooze(until);
    else if (!(await dispatch({ type: "move.snooze", id: move.id, until }))) return;
    toast("I'll bring these back next week.", { action: { label: "Undo", onClick: () => void dispatch({ type: "move.reopen", id: move.id }) } });
  };

  return (
    <div className="space-y-3">
      <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">
        Your LinkedIn connections work at these companies, and they look like your buyers. Tracked, each gets its warm path, and I&apos;ll suggest who to ask before anyone writes cold.
      </p>
      <ul className="divide-y divide-border rounded-md ring-1 ring-border">
        {known.map((c, i) => (
          <CompanyRow
            key={c.name}
            c={c}
            i={i}
            checked={picked.has(c.name)}
            domain={domainOf(c)}
            onToggle={(next) => {
              const s = new Set(picked);
              if (next) s.add(c.name);
              else s.delete(c.name);
              setPicked(s);
            }}
            onDomain={(d) => {
              setDomains({ ...domains, [c.name]: d ?? "" });
              if (d) setPicked(new Set([...picked, c.name]));
            }}
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void track()} loading={busy} disabled={!chosen.length}>
          {chosen.length ? `Track ${plural(chosen.length, "company", "companies")}` : "Pick companies to track"}
        </Button>
        <Button variant="ghost" onClick={() => void later()}>
          Not now
        </Button>
      </div>
    </div>
  );
}
