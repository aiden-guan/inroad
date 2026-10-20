"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { AiBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Num } from "@/components/ui/misc";
import { Orb } from "@/components/ui/orb";
import type { NetworkCompany, Workspace } from "@/lib/domain/types";
import { normalizeDomain } from "@/lib/hub/records";
import { cn } from "@/lib/client/cn";
import { listItem } from "@/lib/motion";
import { postJson } from "./api";

/**
 * The network screen's result: the summary line (the agent speaking), the numbers, and the
 * approval point. The founder ticks which companies to track; nothing is added without that.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[18px] leading-6 tnum text-fg">
        <Num value={value} />
      </p>
      <p className="text-[12px] leading-4 text-fg-3">{label}</p>
    </div>
  );
}

function CompanyRow({
  c,
  i,
  checked,
  domain,
  onToggle,
  onDomain,
}: {
  c: NetworkCompany;
  i: number;
  checked: boolean;
  domain?: string;
  onToggle: (next: boolean) => void;
  onDomain: (d: string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  const meta = [plural(c.contacts, "connection"), c.buyerTitles ? plural(c.buyerTitles, "buyer title") : null, c.jobChanges ? plural(c.jobChanges, "job change") : null].filter(Boolean).join(" · ");
  const id = `net-co-${i}`;
  return (
    <motion.li variants={listItem} custom={i} initial="hidden" animate="show" className="flex items-start gap-3 px-3 py-2.5">
      <input
        id={id}
        type="checkbox"
        checked={c.tracked ? true : checked}
        disabled={c.tracked || !domain}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 size-3.5 shrink-0 accent-[var(--primary)] disabled:opacity-50"
        aria-describedby={`${id}-why`}
      />
      <Favicon domain={domain ?? ""} name={c.name} size={20} className="mt-px" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <label htmlFor={id} className="min-w-0 truncate text-[13.5px] font-medium text-fg">
            {c.name}
          </label>
          {domain ? (
            <span className="truncate font-mono text-[11.5px] text-fg-3">{domain}</span>
          ) : editing ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const d = normalizeDomain(value);
                if (!d) return setBad(true);
                onDomain(d);
                setEditing(false);
              }}
            >
              <input
                autoFocus
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setBad(false);
                }}
                onBlur={() => !value && setEditing(false)}
                placeholder="acme.com"
                aria-label={`Website for ${c.name}`}
                aria-invalid={bad}
                className={cn("h-6 w-36 rounded-xs bg-surface px-1.5 font-mono text-[11.5px] text-fg ring-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]", bad ? "ring-danger" : "ring-border-strong/70")}
              />
              <button type="submit" className="text-[12px] font-medium text-fg-2 hover:text-fg">
                Add
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-fg-3 underline decoration-border-strong underline-offset-2 hover:text-fg-2">
              Add website
            </button>
          )}
          {c.tracked && <Badge tone="outline">Tracked</Badge>}
        </div>
        <p id={`${id}-why`} className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">
          <span className="text-fg-2">{meta}</span>
          {c.reason ? ` · ${c.reason}` : ""}
        </p>
      </div>
      <Badge tone={c.fit === "likely" ? "neutral" : "outline"} className="mt-0.5 hidden sm:inline-flex">
        {c.fit === "likely" ? "Likely ICP" : "Unknown"}
      </Badge>
    </motion.li>
  );
}

export function NetworkResult({ network, onDone, onRescreen, rescreenBusy }: { network: NonNullable<Workspace["network"]>; onDone?: () => void; onRescreen?: () => void; rescreenBusy?: boolean }) {
  const { ws, refresh } = useWorkspace();
  const router = useRouter();
  const top = useMemo(() => network.topCompanies ?? [], [network]);
  const [domains, setDomains] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(() => new Set(top.filter((c) => c.fit === "likely" && c.domain && !c.tracked).slice(0, 10).map((c) => c.name)));
  const [busy, setBusy] = useState(false);

  const domainOf = (c: NetworkCompany) => c.domain ?? domains[c.name];
  const chosen = top.filter((c) => picked.has(c.name) && !c.tracked && domainOf(c));
  const screened = Boolean(network.screenedAt);
  const noIcp = !ws?.foundation;

  async function track() {
    setBusy(true);
    try {
      const r = await postJson<{ tracked: number; created: number; people: number; skipped: { name: string; reason: string }[] }>("/api/import/track", {
        companies: chosen.map((c) => ({ name: c.name, domain: domainOf(c)! })),
      });
      await refresh();
      toast(`Tracking ${plural(r.tracked, "company", "companies")}${r.people ? ` with ${plural(r.people, "warm contact")}` : ""}.${r.skipped.length ? ` Skipped ${r.skipped.map((s) => `${s.name} (${s.reason.toLowerCase()})`).join(", ")}.` : ""}`, {
        action: { label: "Open Companies", onClick: () => router.push("/companies?view=prospects") },
      });
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't track those companies.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        <Orb state="idle" size={18} className="mt-1" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] font-medium text-fg-3">Your Head of GTM</span>
            <AiBadge />
          </div>
          <p className="prose-agent text-pretty">{network.line ?? `${plural(network.total, "connection")} imported.`}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg bg-bg-subtle px-3.5 py-3 ring-1 ring-border sm:grid-cols-5">
        <Stat value={network.total} label="connections" />
        <Stat value={network.companies ?? 0} label="companies" />
        <Stat value={network.icpCompanies ?? 0} label="likely ICP" />
        <Stat value={network.buyerTitles} label="buyer titles" />
        <Stat value={network.jobChanges} label="job changes" />
      </div>

      {top.length ? (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-[12px] font-medium text-fg-3">Warmest companies first</p>
            {onRescreen && screened && (
              <Button size="xs" variant="ghost" onClick={onRescreen} loading={rescreenBusy}>
                Screen again
              </Button>
            )}
          </div>
          <motion.ul initial="hidden" animate="show" className="divide-y divide-border rounded-lg ring-1 ring-border">
            {top.map((c, i) => (
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
          </motion.ul>
        </div>
      ) : (
        <div className="rounded-lg bg-bg-subtle px-3.5 py-3 text-[13px] leading-[19px] text-fg-2">
          {noIcp
            ? "Once your playbook has an ICP, I'll screen these companies against it. Titles and companies are matched already."
            : !screened
              ? "I haven't screened these companies yet."
              : "No company stood out yet. Unknown isn't unlikely: I'll look again when you re-import or your ICP changes."}
        </div>
      )}

      {/* Sticks to the bottom of the dialog's scroll area so the one action stays in reach. */}
      <div className="sticky bottom-0 -mx-5 -mb-1 flex flex-wrap items-center gap-2 border-t border-border bg-surface-raised px-5 py-3">
        {top.length > 0 && (
          <Button variant="primary" onClick={() => void track()} loading={busy} disabled={!chosen.length}>
            {chosen.length ? `Track ${plural(chosen.length, "company", "companies")}` : "Pick companies to track"}
          </Button>
        )}
        {!screened && onRescreen && !noIcp && (
          <Button variant="agent" onClick={onRescreen} loading={rescreenBusy}>
            Screen them now
          </Button>
        )}
        <Button variant={top.length ? "ghost" : "secondary"} onClick={onDone}>
          {top.length ? "Not now" : "Done"}
        </Button>
        {top.length > 0 && <p className="hidden text-[12px] leading-[17px] text-fg-3 sm:block sm:flex-1">Tracked companies get warm paths through your connections.</p>}
      </div>
    </div>
  );
}
