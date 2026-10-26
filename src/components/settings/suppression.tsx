"use client";

import { ChevronDown, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ForgetPerson } from "@/components/people/forget-person";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { Menu, MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import { shortDate } from "@/lib/client/format";
import type { Action } from "@/lib/domain/actions";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Person, Suppression, Workspace } from "@/lib/domain/types";
import { emailsOf } from "@/lib/people/forget";
import { Group } from "./parts";
import { normalizeDomain } from "./validate";

type Dispatch = (actions: Action | Action[]) => Promise<boolean>;
type Reason = Suppression["reason"];

const REASONS: Record<Reason, string> = {
  unsubscribe: "Asked to stop",
  bounce: "Bounced",
  requested_delete: "Asked to be deleted",
  customer: "Customer",
  competitor: "Competitor",
  manual: "Added by you",
};

/** They asked: removing them takes a second, deliberate click. */
const PROTECTED: Reason[] = ["unsubscribe", "requested_delete"];
const PAGE = 8;

function parseEntry(raw: string): { email?: string; domain?: string } | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? { email: v } : null;
  const domain = normalizeDomain(v);
  return domain ? { domain } : null;
}

/** The person on file with this address, if any. */
function personByEmail(ws: Workspace, email: string): Person | undefined {
  const e = email.toLowerCase();
  return Object.values(ws.people).find((p) => emailsOf(p).includes(e));
}

export function SuppressionList({ ws, dispatch }: { ws: Workspace; dispatch: Dispatch }) {
  const [entry, setEntry] = useState("");
  const [reason, setReason] = useState<Reason>("manual");
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [forgetFor, setForgetFor] = useState<string | null>(null);

  const list = useMemo(() => [...ws.suppression].sort((a, b) => b.at.localeCompare(a.at)), [ws.suppression]);
  const q = query.trim().toLowerCase();
  const filtered = q ? list.filter((s) => (s.email ?? s.domain ?? "").includes(q) || REASONS[s.reason].toLowerCase().includes(q)) : list;
  const shown = showAll || q ? filtered : filtered.slice(0, PAGE);

  // "Asked to be deleted" for someone on file deletes them, not just labels the address.
  const parsedNow = parseEntry(entry);
  const onFile = reason === "requested_delete" && parsedNow?.email ? personByEmail(ws, parsedNow.email) : undefined;

  const add = async () => {
    const parsed = parseEntry(entry);
    if (!parsed) {
      setError("Enter an email address or a domain, like jo@acme.com or acme.com.");
      return;
    }
    if (reason === "requested_delete" && !parsed.email) {
      setError("Deleting is per person. Enter their email address.");
      return;
    }
    if (onFile) return; // the hold-to-delete below handles it
    const dupe = ws.suppression.some((s) => (parsed.email && s.email?.toLowerCase() === parsed.email) || (parsed.domain && !s.email && s.domain?.toLowerCase() === parsed.domain));
    if (dupe) {
      setError("Already on your list.");
      return;
    }
    const ok = await dispatch({ type: "suppression.add", entry: { id: newId("sup"), ...parsed, reason, at: nowISO() } });
    if (ok) {
      setEntry("");
      setReason("manual");
      toast(`${parsed.email ?? `Everyone at ${parsed.domain}`} won't get drafts from me.`);
    }
  };

  const remove = (s: Suppression) => {
    if (PROTECTED.includes(s.reason) && armed !== s.id) {
      setArmed(s.id);
      return;
    }
    setArmed(null);
    void dispatch({ type: "suppression.remove", id: s.id }).then((ok) => {
      if (!ok) return;
      toast(`Removed ${s.email ?? s.domain}.`, { action: { label: "Undo", onClick: () => void dispatch({ type: "suppression.add", entry: s }) } });
    });
  };

  return (
    <Group
      id="suppression"
      title="Suppression list"
      hint="I never draft to anyone here, on any channel. People who reply “stop”, bounces and unsubscribes from your connected tools land here on their own."
      right={list.length > 0 ? <span className="font-mono text-[11.5px] tnum text-fg-3">{list.length}</span> : undefined}
    >
      <div className="px-4 py-3.5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label htmlFor="suppress-entry" className="sr-only">
            Email or domain to suppress
          </label>
          <Input
            id="suppress-entry"
            value={entry}
            placeholder="jo@acme.com or acme.com"
            spellCheck={false}
            autoComplete="off"
            inputMode="email"
            aria-invalid={!!error}
            onChange={(e) => {
              setEntry(e.target.value);
              if (error) setError(null);
            }}
            className="font-mono text-[12.5px] sm:flex-1"
          />
          <div className="flex gap-2">
            <Menu
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label={`Reason: ${REASONS[reason]}`}
                  className="inline-flex h-8 flex-1 items-center justify-between gap-1.5 rounded-sm bg-surface px-2.5 text-[13px] text-fg-2 ring-1 ring-border-strong/70 transition-colors duration-150 hover:bg-bg-subtle hover:text-fg sm:flex-none"
                >
                  {REASONS[reason]}
                  <ChevronDown className="size-3.5 text-fg-3" aria-hidden />
                </button>
              }
            >
              {(Object.keys(REASONS) as Reason[]).map((r) => (
                <MenuItem key={r} onSelect={() => setReason(r)}>
                  {REASONS[r]}
                </MenuItem>
              ))}
            </Menu>
            <Button type="submit" disabled={!entry.trim() || !!onFile}>
              Add
            </Button>
          </div>
        </form>
        <FieldError>{error}</FieldError>
        {onFile && (
          <div className="mt-3 rounded-md bg-bg-subtle p-3 animate-[fade-in_150ms_var(--ease-out)]">
            <p className="mb-1.5 text-[13px] text-fg">
              {onFile.name} is on file{ws.accounts[onFile.accountDomain] ? ` at ${ws.accounts[onFile.accountDomain].name}` : ""}.
            </p>
            <ForgetPerson
              person={onFile}
              onDone={() => {
                setEntry("");
                setReason("manual");
              }}
            />
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-fg-3">No one yet. Add a competitor&apos;s domain or a customer here to keep them out of outreach.</p>
      ) : (
        <div>
          {list.length > PAGE && (
            <div className="relative border-b border-border">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${list.length} entries`}
                aria-label="Search the suppression list"
                className="h-9 w-full bg-transparent pl-10 pr-4 text-[13px] text-fg outline-none placeholder:text-fg-3 focus-visible:bg-bg-subtle/50"
              />
            </div>
          )}
          <ul className="divide-y divide-border">
            {shown.map((s) => {
              const isArmed = armed === s.id;
              // Marked "asked to be deleted" before deleting was real: they're still on file.
              const stillOnFile = s.reason === "requested_delete" && s.email ? personByEmail(ws, s.email) : undefined;
              return (
                <li key={s.id} className="group/row flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg" title={s.email ?? s.domain}>
                    {s.email ?? (
                      <>
                        <span className="text-fg-3">*@</span>
                        {s.domain}
                      </>
                    )}
                  </span>
                  {stillOnFile && forgetFor !== s.id && (
                    <button type="button" onClick={() => setForgetFor(s.id)} className="h-6 rounded-xs px-1.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger-subtle">
                      Still on file · delete
                    </button>
                  )}
                  <Badge tone={s.reason === "bounce" ? "warning" : "neutral"} className="hidden sm:inline-flex">
                    {REASONS[s.reason]}
                  </Badge>
                  <span className="hidden w-14 text-right font-mono text-[11.5px] text-fg-3 sm:inline">{shortDate(s.at)}</span>
                  {isArmed ? (
                    <span className="flex items-center gap-1">
                      <button type="button" onClick={() => setArmed(null)} className="h-6 rounded-xs px-1.5 text-[12px] text-fg-3 hover:text-fg">
                        Keep
                      </button>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => remove(s)}
                        className="h-6 rounded-xs bg-danger-subtle px-1.5 text-[12px] font-medium text-danger transition-transform duration-150 active:scale-[0.97]"
                      >
                        They asked. Remove?
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove ${s.email ?? s.domain}`}
                      title="Remove"
                      onClick={() => remove(s)}
                      className={cn(
                        "inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-4 opacity-0 transition-[opacity,color,background-color] duration-150",
                        "hover:bg-bg-subtle hover:text-fg-2 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100",
                      )}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                  {stillOnFile && forgetFor === s.id && (
                    <ForgetPerson person={stillOnFile} onDone={() => setForgetFor(null)} onCancel={() => setForgetFor(null)} className="w-full pb-1 animate-[fade-in_150ms_var(--ease-out)]" />
                  )}
                </li>
              );
            })}
            {q && filtered.length === 0 && <li className="px-4 py-4 text-[13px] text-fg-3">Nothing matches “{query.trim()}”.</li>}
          </ul>
          {!q && filtered.length > PAGE && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="flex h-9 w-full items-center justify-center border-t border-border text-[12.5px] text-fg-2 transition-colors hover:bg-bg-subtle/60 hover:text-fg"
            >
              {showAll ? "Show fewer" : `Show all ${filtered.length}`}
            </button>
          )}
        </div>
      )}
    </Group>
  );
}
