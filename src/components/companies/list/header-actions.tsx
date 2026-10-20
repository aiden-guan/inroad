"use client";

import { Compass, Ellipsis, FileUp, Plus, RefreshCw, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button, IconButton, Spinner } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Input, Label } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator, Popover } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { normalizeDomainInput } from "./lib";

export interface LookupResult {
  domain: string;
  reachable: boolean;
  name: string | null;
  oneLiner: string | null;
  yc: { batch: string; teamSize: number | null; url: string; location: string | null } | null;
  existing: { name: string; status: string } | null;
}

export async function lookupDomain(domain: string, timeoutMs = 6000): Promise<LookupResult | null> {
  try {
    const res = await fetch(`/api/companies/lookup?domain=${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as LookupResult;
  } catch {
    return null;
  }
}

/* ─────────────────────────── Find companies ─────────────────────────── */

export function FindCompanies({
  running,
  disabledReason,
  onStart,
}: {
  running: boolean;
  disabledReason?: string;
  onStart: (opts: { brief?: string; count: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState<"5" | "10" | "25">("10");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onStart({ brief: brief.trim() || undefined, count: Number(count) });
    setOpen(false);
    setBrief("");
  };

  const button = (
    <Button variant="agent" icon={running ? <Spinner className="size-3.5" /> : <Compass className="size-3.5" />} disabled={running || !!disabledReason}>
      {running ? "Finding companies" : "Find companies"}
    </Button>
  );
  if (disabledReason || running) {
    return (
      <Tooltip content={running ? "Already looking. The log is below." : disabledReason}>
        <span tabIndex={0}>{button}</span>
      </Tooltip>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} align="end" className="w-[min(340px,calc(100vw-32px))] p-4" trigger={button}>
      <form onSubmit={submit}>
        <Label htmlFor="find-brief" hint="Optional">
          Anything specific?
        </Label>
        <Input id="find-brief" autoFocus value={brief} maxLength={200} onChange={(e) => setBrief(e.target.value)} placeholder="Only NYC, or companies like Ramp" />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-fg-2">How many, at most</span>
          <Segmented
            value={count}
            onChange={setCount}
            layoutId="find-count"
            className="h-7 [&_button]:h-6 [&_button]:px-2.5 [&_button]:text-[12px]"
            options={[
              { value: "5", label: "5" },
              { value: "10", label: "10" },
              { value: "25", label: "25" },
            ]}
          />
        </div>
        <p className="mt-3 text-[12px] leading-[17px] text-fg-3">
          I start with the YC directory, lookalikes of your users and competitors&rsquo; customer pages, then check each for a dated reason to talk now. Web
          search only if those come up thin.
        </p>
        <Button type="submit" variant="agent" className="mt-4 w-full" kbd="↵">
          Find companies
        </Button>
      </form>
    </Popover>
  );
}

/* ─────────────────────────── Add company ─────────────────────────── */

type Lookup = { domain: string; status: "loading" } | { domain: string; status: "done"; data: LookupResult | null };

export function AddCompany({
  onAdd,
  onOpenExisting,
}: {
  onAdd: (domain: string, info: LookupResult | null, research: boolean) => void;
  onOpenExisting: (domain: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const domain = normalizeDomainInput(value);
  const invalid = value.trim().length > 2 && !domain && !/^[a-z0-9-]+\.?$/i.test(value.trim());
  const current = lookup && lookup.domain === domain ? lookup : null;
  const data = current?.status === "done" ? current.data : null;
  const existing = data?.existing;

  const onChange = (next: string) => {
    setValue(next);
    clearTimeout(timer.current);
    const d = normalizeDomainInput(next);
    if (!d) return;
    setLookup({ domain: d, status: "loading" });
    timer.current = setTimeout(async () => {
      const result = await lookupDomain(d);
      setLookup((cur) => (cur?.domain === d ? { domain: d, status: "done", data: result } : cur));
    }, 350);
  };

  const reset = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setValue("");
      setLookup(null);
    }
  };

  const submit = (research: boolean) => {
    if (!domain) return;
    if (existing) {
      onOpenExisting(domain);
      reset(false);
      return;
    }
    onAdd(domain, data, research);
    reset(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit(true);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={reset}
      align="end"
      className="w-[min(360px,calc(100vw-32px))] p-4"
      trigger={
        <Button icon={<Plus className="size-3.5" />} aria-label="Add company">
          <span className="hidden sm:inline">Add company</span>
        </Button>
      }
    >
      <form
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <Label htmlFor="add-domain">Company website</Label>
        <Input id="add-domain" autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder="acme.com" autoComplete="off" spellCheck={false} className="font-mono" />
        <div className="mt-3 min-h-[52px]">
          {invalid ? (
            <p className="text-[12px] text-danger">That doesn&rsquo;t look like a website. Try something like acme.com.</p>
          ) : !domain ? (
            <p className="text-[12px] leading-[17px] text-fg-3">I&rsquo;ll check their job boards and news for free. Research writes a full dossier with sources (a few cents).</p>
          ) : (
            <div className="flex items-start gap-2.5">
              <Favicon domain={domain} name={data?.name ?? undefined} size={24} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                  <span className="truncate">{data?.name ?? domain}</span>
                  {current?.status === "loading" && <Spinner className="size-3 text-fg-3" />}
                </p>
                {existing ? (
                  <p className="text-[12px] text-fg-2">Already in your list.</p>
                ) : data && !data.reachable ? (
                  <p className="text-[12px] leading-[17px] text-warning">I couldn&rsquo;t reach {domain}. Check the address, or add it anyway.</p>
                ) : (
                  <p className="line-clamp-2 text-[12px] leading-[17px] text-fg-2">{data?.oneLiner ?? (current?.status === "loading" ? "Checking…" : "")}</p>
                )}
                {data?.yc && (
                  <p className="mt-0.5 font-mono text-[11px] text-fg-3">
                    YC {data.yc.batch}
                    {data.yc.teamSize ? ` · ${data.yc.teamSize} people` : ""}
                    {data.yc.location ? ` · ${data.yc.location}` : ""}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {existing ? (
            <Button type="button" variant="primary" onClick={() => submit(false)}>
              Open {existing.name}
            </Button>
          ) : (
            <>
              <Button type="submit" disabled={!domain} kbd="↵">
                Add
              </Button>
              <Button type="button" variant="agent" disabled={!domain} onClick={() => submit(true)} kbd="⌘↵">
                Add and research
              </Button>
            </>
          )}
        </div>
      </form>
    </Popover>
  );
}

/* ─────────────────────────── Overflow ─────────────────────────── */

export function MoreActions({ trackedCount, onRefresh }: { trackedCount: number; onRefresh: () => void }) {
  const router = useRouter();
  return (
    <Menu
      trigger={
        <IconButton label="More" className="size-8">
          <Ellipsis className="size-4" />
        </IconButton>
      }
    >
      <MenuItem icon={<RefreshCw className="size-3.5" />} onSelect={onRefresh} hint={trackedCount ? String(trackedCount) : undefined}>
        Check signals for tracked companies
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<FileUp className="size-3.5" />} onSelect={() => router.push("/integrations?import=csv")}>
        Import a CSV
      </MenuItem>
      <MenuItem icon={<Users className="size-3.5" />} onSelect={() => router.push("/integrations?import=linkedin")}>
        Import LinkedIn connections
      </MenuItem>
    </Menu>
  );
}

export function ImportLink({ className }: { className?: string }) {
  return (
    <Link
      href="/integrations?import=csv"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-medium text-fg-2 transition-[background-color,color] duration-150 hover:bg-bg-subtle hover:text-fg",
        className,
      )}
    >
      <Upload className="size-3.5" />
      Import CSV
    </Link>
  );
}
