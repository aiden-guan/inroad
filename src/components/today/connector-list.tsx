"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { gmailComposeUrl } from "@/components/compose/handoff";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { nowISO } from "@/lib/domain/ids";
import type { Account, Workspace } from "@/lib/domain/types";
import { listMessage, listTarget, type ListTarget } from "@/lib/intros/list";
import { first, plural } from "@/lib/moves/util";
import type { BodyProps } from "./move-body";

function targetsOf(ws: Workspace, domains: string[], today: string): ListTarget[] {
  return domains.map((d) => ws.accounts[d]).filter((a): a is Account => !!a).map((a) => listTarget(ws, a, today));
}

/** One row of the list, with a tick: the founder trims the list before sending, the connector's marks come back the same way. */
function TargetRow({ t, checked, onToggle }: { t: ListTarget; checked: boolean; onToggle: () => void }) {
  const who = t.name ? `${t.name}${t.title ? `, ${t.title}` : ""}` : t.title ? `the ${t.title}` : "";
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors duration-150 hover:bg-bg-subtle/60">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 accent-[var(--fg)]" />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[13.5px] leading-5", checked ? "text-fg" : "text-fg-3")}>
            <span className="font-medium">{t.company}</span>
            {who && <span className="text-fg-2"> · {who}</span>}
          </span>
          <span className="block truncate text-[12.5px] leading-[18px] text-fg-3">{t.why}</span>
        </span>
      </label>
    </li>
  );
}

/**
 * "Send Ivy your top 12 targets to mark": a copy-ready list built in code (no model). The founder trims it,
 * sends it from their own inbox, and records that it went. That one list is the ask.
 */
export function ConnectorListBody({ move, ws, today, onComplete }: BodyProps) {
  const { dispatch } = useWorkspace();
  const [id, ...domains] = move.subjectIds ?? [];
  const [dropped, setDropped] = useState<Set<string>>(() => new Set());
  const c = ws.connectors.find((x) => x.id === id);
  if (!c) return <p className="text-[13.5px] text-fg-2">This connector was removed.</p>;
  const targets = targetsOf(ws, domains, today);
  const chosen = targets.filter((t) => !dropped.has(t.domain));
  const msg = listMessage(ws, c, chosen);
  const url = gmailComposeUrl(ws, msg);
  const name = first(c.name);
  return (
    <div className="space-y-3">
      <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">
        Investors and advisors rarely browse their network for you, and a blind ask spends goodwill. Send {name} a short list and let them mark who they&apos;d be comfortable introducing. You
        write forwardables only for those.
      </p>
      <ul className="max-h-[360px] divide-y divide-border overflow-y-auto rounded-md ring-1 ring-border">
        {targets.map((t) => (
          <TargetRow
            key={t.domain}
            t={t}
            checked={!dropped.has(t.domain)}
            onToggle={() =>
              setDropped((s) => {
                const next = new Set(s);
                if (next.has(t.domain)) next.delete(t.domain);
                else next.add(t.domain);
                return next;
              })
            }
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {url && chosen.length > 0 && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn hover:bg-primary-hover active:scale-[0.97]"
          >
            Open in Gmail <ArrowUpRight className="size-3.5 opacity-70" />
          </a>
        )}
        <CopyButton text={msg.body} label="Copy the list" />
        <Button
          variant="ghost"
          disabled={!chosen.length}
          onClick={async () => {
            if (await dispatch({ type: "connector.sendList", id: c.id, domains: chosen.map((t) => t.domain), at: nowISO() })) {
              toast(`Noted. I'll ask tomorrow which ones ${name} marked.`);
              onComplete();
            }
          }}
        >
          I sent it to {name}
        </Button>
      </div>
    </div>
  );
}

/** The marks came back: tick them, and a forwardable is drafted for each (nothing for the rest). */
export function ConnectorMarksBody({ move, ws, today, onComplete, onChanged }: BodyProps) {
  const { dispatch } = useWorkspace();
  const { start } = useRuns();
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const c = ws.connectors.find((x) => x.id === move.subjectIds?.[0]);
  const list = c?.list;
  if (!c || !list) return <p className="text-[13.5px] text-fg-2">This list is no longer open.</p>;
  const name = first(c.name);
  const targets = targetsOf(ws, list.domains, today);

  const record = async (domains: string[]) => {
    setBusy(true);
    const ok = await dispatch({ type: "connector.markList", id: c.id, marked: domains, at: nowISO() });
    if (ok) {
      for (const t of targets.filter((x) => domains.includes(x.domain))) {
        await start("compose", { domain: t.domain, personId: t.personId, mode: "warm_intro", connectorId: c.id }, { notify: false });
      }
      onChanged();
      toast(domains.length ? `Drafting ${plural(domains.length, "forwardable")} for ${name}. They land on Today to send.` : `Noted. Thank ${name} for looking.`);
      onComplete();
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <p className="max-w-[62ch] text-[13.5px] leading-[21px] text-fg-2">
        Tick the ones {name} said they&apos;d be comfortable introducing. I&apos;ll draft a short note to {name} and a forwardable for each, and nothing for the rest.
      </p>
      <ul className="max-h-[360px] divide-y divide-border overflow-y-auto rounded-md ring-1 ring-border">
        {targets.map((t) => (
          <TargetRow
            key={t.domain}
            t={t}
            checked={marked.has(t.domain)}
            onToggle={() =>
              setMarked((s) => {
                const next = new Set(s);
                if (next.has(t.domain)) next.delete(t.domain);
                else next.add(t.domain);
                return next;
              })
            }
          />
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="agent" loading={busy} disabled={!marked.size} onClick={() => void record([...marked])}>
          {marked.size ? `Draft ${plural(marked.size, "forwardable")}` : "Tick what they marked"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void record([])}>
          They passed on all of them
        </Button>
      </div>
    </div>
  );
}
