"use client";

import { motion } from "motion/react";
import { Phone, X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { IconButton } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/client/cn";
import { STAGE_LABELS, OPEN_STAGES, type Workspace } from "@/lib/domain/types";
import { ease } from "@/lib/motion";

/**
 * "Log a call": pick the deal (or the prospect it was with), then the company sheet opens with
 * the log-call intent. Inline under the header, never a modal.
 */
export function LogPicker({ ws, onPick, onClose }: { ws: Workspace; onPick: (domain: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const deals = Object.values(ws.deals)
      .filter((d) => OPEN_STAGES.includes(d.stage))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((d) => ({ domain: d.accountDomain, name: ws.accounts[d.accountDomain]?.name || d.name || d.accountDomain, meta: STAGE_LABELS[d.stage], group: "Open deals" }));
    const inDeal = new Set(deals.map((d) => d.domain));
    const prospects = Object.values(ws.accounts)
      .filter((a) => !inDeal.has(a.domain) && (a.status === "tracked" || a.status === "new") && (a.watch || a.status === "tracked"))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ domain: a.domain, name: a.name, meta: "First call", group: "Tracked prospects" }));
    const all = [...deals, ...prospects];
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((i) => i.name.toLowerCase().includes(needle) || i.domain.includes(needle)) : all;
  }, [ws.deals, ws.accounts, q]);

  const current = Math.min(active, Math.max(0, items.length - 1));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(items.length - 1, current + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, current - 1));
    } else if (e.key === "Enter" && items[current]) {
      e.preventDefault();
      onPick(items[current].domain);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: ease.out }}
      className="mt-5 overflow-hidden rounded-lg bg-surface shadow-sm ring-1 ring-border"
    >
      <div className="flex items-center gap-2.5 border-b border-border px-3">
        <Phone className="size-4 shrink-0 text-fg-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Log a call. Who was it with?"
          aria-label="Find the company you spoke with"
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3"
        />
        <Kbd className="hidden sm:inline-flex">esc</Kbd>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <ul role="listbox" aria-label="Companies" className="max-h-[300px] overflow-y-auto p-1">
        {items.length === 0 && (
          <li className="px-3 py-6 text-center text-[13px] text-fg-3">
            {q ? "No match. Add the company first, then log the call from its sheet." : "No open deals or tracked prospects yet. Track a company first."}
          </li>
        )}
        {items.map((it, i) => (
          <li key={it.domain} role="option" aria-selected={i === current}>
            {(i === 0 || items[i - 1].group !== it.group) && <p className="px-2 pb-1 pt-2 text-[11px] font-medium text-fg-3">{it.group}</p>}
            <button
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => onPick(it.domain)}
              className={cn("flex h-9 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[13px] outline-none", i === current ? "bg-bg-subtle text-fg" : "text-fg-2")}
            >
              <Favicon domain={it.domain} name={it.name} size={16} />
              <span className="min-w-0 flex-1 truncate">{it.name}</span>
              <span className="shrink-0 text-[12px] text-fg-3">{it.meta}</span>
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
