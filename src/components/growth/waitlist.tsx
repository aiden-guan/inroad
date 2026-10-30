"use client";

import { ArrowUpRight, Check, Database, RefreshCw, Users } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Ago } from "@/components/integrations/parts";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/field";
import { isConsumer } from "@/lib/consumer/market";
import { tableLabel, waitlistChange, type WaitlistTable, type WaitlistTracking } from "@/lib/waitlist/types";

const DATABASES = [
  { name: "Convex", provider: "convex", href: "https://dashboard.convex.dev", hint: "Copy the deploy key from your deployment's Settings → Deploy Key.", placeholder: "prod:your-deployment|…" },
  { name: "Supabase", provider: "postgres", href: "https://supabase.com/dashboard", hint: "Copy the PostgreSQL connection string from Connect. The session pooler works on most networks.", placeholder: "postgresql://user:password@host/postgres" },
  { name: "Neon", provider: "postgres", href: "https://console.neon.tech", hint: "Copy the connection string from your project's Connect panel.", placeholder: "postgresql://user:password@host/database" },
  { name: "Other Postgres", provider: "postgres", href: "https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING", hint: "Use a hosted PostgreSQL connection string, preferably for a login with read access to your waitlist.", placeholder: "postgresql://user:password@host/database" },
] as const;
type DatabaseChoice = typeof DATABASES[number];

function WaitlistConnect({ choice, onDone }: { choice: DatabaseChoice; onDone: () => void }) {
  const [credential, setCredential] = useState("");
  const [tables, setTables] = useState<WaitlistTable[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function connect(value = credential, table?: WaitlistTable) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: choice.provider, credential: value, table }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Couldn't connect your waitlist.");
      if (body.status === "choose") setTables(body.tables);
      else { setCredential(""); toast.success("Waitlist connected."); onDone(); }
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn't reach Inroad. Try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="space-y-4 px-5 pb-5 pt-4">
    {tables ? <>
      <p className="text-[13px] leading-5 text-fg-2">Which table holds your waitlist? Each row will count as one signup.</p>
      {tables.length > 6 && <Input aria-label="Find a waitlist table" placeholder="Find a table" value={search} onChange={(e) => setSearch(e.target.value)} />}
      <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
        {tables.filter((t) => tableLabel(t).toLowerCase().includes(search.toLowerCase())).map((table) => <button key={tableLabel(table)} disabled={busy} onClick={() => void connect(credential, table)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[14px] ring-1 ring-inset ring-border hover:bg-bg-subtle disabled:opacity-50"><Database className="size-4 shrink-0 text-fg-3" /><span className="min-w-0 flex-1 break-all">{tableLabel(table)}</span><ArrowUpRight className="size-4 shrink-0 text-fg-3" /></button>)}
      </div>
      {busy && <p role="status" className="text-[13px] text-fg-3">Importing your waitlist…</p>}
    </> : <form onSubmit={(e) => { e.preventDefault(); void connect(); }} className="space-y-4">
      <div><Label htmlFor="waitlist-credential">{choice.provider === "convex" ? "Deploy key" : "Connection string"}</Label>
        <Input id="waitlist-credential" autoFocus type="password" autoComplete="off" spellCheck={false} value={credential} placeholder={choice.placeholder} onChange={(e) => setCredential(e.target.value)} disabled={busy} onPaste={(e) => {
          const value = e.clipboardData.getData("text/plain").trim();
          if (!value) return;
          e.preventDefault(); setCredential(value); void connect(value);
        }} />
        <p className="mt-2 text-[12px] leading-5 text-fg-3">{choice.hint} <a href={choice.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">Open {choice.name} <span aria-hidden>↗</span></a></p>
      </div>
      <Button type="submit" loading={busy} disabled={!credential.trim()} className="w-full">Connect waitlist</Button>
      <p className="text-[12px] leading-5 text-fg-3">Connects on paste and looks for your waitlist table automatically. Inroad only reads counts; your login stays on this Mac.</p>
    </form>}
    {error && <p role="alert" className="rounded-md bg-danger-subtle p-3 text-[13px] leading-5 text-danger">{error}</p>}
  </div>;
}

function WaitlistTrend({ state }: { state: WaitlistTracking }) {
  const points = state.history.filter((r) => r.sourceId === state.source.id).slice(-31);
  if (points.length < 2) return <p className="rounded-lg bg-bg-subtle px-4 py-5 text-[13px] leading-5 text-fg-3">Your history starts with this count. Inroad will build the trend as it syncs.</p>;
  const values = points.map((p) => p.total);
  const low = Math.min(...values); const span = Math.max(1, Math.max(...values) - low);
  const start = Date.parse(points[0].at); const duration = Math.max(1, Date.parse(points.at(-1)!.at) - start);
  const path = points.map((p, i) => `${i ? "L" : "M"}${8 + (Date.parse(p.at) - start) / duration * 584},${76 - (p.total - low) / span * 60}`).join(" ");
  const date = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return <div>
    <svg viewBox="0 0 600 92" preserveAspectRatio="none" className="h-24 w-full text-fg-2" role="img" aria-label={`Waitlist history: ${points[0].total.toLocaleString("en-US")} on ${date(points[0].at)} to ${points.at(-1)!.total.toLocaleString("en-US")} on ${date(points.at(-1)!.at)}`}><path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg>
    <div className="flex justify-between text-[11px] text-fg-3"><span>{date(points[0].at)}</span><span>{date(points.at(-1)!.at)}</span></div>
  </div>;
}

export function WaitlistCard() {
  const { ws, refresh } = useWorkspace();
  const [choice, setChoice] = useState<DatabaseChoice | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ws || !isConsumer(ws)) return null;
  const state = ws.waitlist;
  const change = state ? waitlistChange(state) : null;

  async function act(method: "POST" | "DELETE", endpoint = "/api/waitlist") {
    setBusy(true); setError(null);
    try {
      const response = await fetch(endpoint, { method });
      const body = await response.json();
      await refresh();
      if (!response.ok) throw new Error(body.error ?? "Couldn't update your waitlist.");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't reach Inroad. Try again."); }
    finally { setBusy(false); }
  }

  return <section id="waitlist" aria-labelledby="waitlist-title" className="mb-9 scroll-mt-24">
    <SectionLabel right={state?.enabled && <Button size="xs" variant="ghost" icon={<RefreshCw className="size-3" />} loading={busy} onClick={() => void act("POST", "/api/waitlist/sync")}>Sync waitlist</Button>}><span id="waitlist-title">Waitlist</span></SectionLabel>
    <Card className="overflow-hidden">
      {state ? <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[13px] text-fg-3">{state.enabled ? "On your waitlist" : "Last saved waitlist total"}</p><p className="mt-1 break-all font-mono text-[42px] leading-tight tracking-[-0.05em] text-fg" aria-label={`${state.current.total.toLocaleString("en-US")} waitlist signups`}>{state.current.total.toLocaleString("en-US")}</p></div>
          <div className="text-[12px] leading-5 text-fg-3"><p className="max-w-[32ch] break-all">{state.source.label}</p><p>{!state.enabled ? "Disconnected · " : state.lastError ? "Last successful sync " : "Synced "}<Ago iso={state.current.at} /></p></div>
        </div>
        {change && <p className="mt-3 text-[13px] text-fg-2"><span className="font-mono">{change.value > 0 ? "+" : ""}{change.value.toLocaleString("en-US")}</span> net since {new Date(change.since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>}
        {state.goal && <div className="mt-4"><div className="mb-2 flex items-center justify-between gap-2 text-[12px] text-fg-2"><span className="flex items-center gap-1.5">{state.current.total >= state.goal && <Check className="size-3.5" />}Goal: {state.goal.toLocaleString("en-US")}</span><span>{Math.min(100, Math.floor(state.current.total / state.goal * 100))}%</span></div><div role="progressbar" aria-label="Waitlist goal progress" aria-valuemin={0} aria-valuemax={state.goal} aria-valuenow={Math.min(state.goal, state.current.total)} className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle"><div className="h-full rounded-full bg-fg" style={{ width: `${Math.min(100, state.current.total / state.goal * 100)}%` }} /></div></div>}
        <div className="mt-5"><WaitlistTrend state={state} /></div>
        {(state.lastError || error) && <p role="alert" className="mt-4 rounded-md bg-danger-subtle p-3 text-[13px] leading-5 text-danger">{error ?? state.lastError} Showing your last successful count.</p>}
        {!state.enabled && <Button className="mt-4" size="sm" onClick={() => setPicking(true)}>Reconnect waitlist</Button>}
        <details className="mt-4 text-[12px] text-fg-3"><summary className="w-fit cursor-pointer py-1">Manage waitlist</summary><div className="mt-3 space-y-4">
          <WaitlistGoal key={`${state.source.id}:${state.goal}`} goal={state.goal} onSaved={refresh} />
          <p className="leading-5">Counts rows in {tableLabel(state.source.table)} visible to this connection. Each row should represent one signup. Net change includes additions and removals. Refreshes every 15 minutes while Inroad is open.</p>
          <div className="flex flex-wrap gap-2"><Button size="xs" onClick={() => setPicking(true)}>Change database</Button>{state.enabled && <Button size="xs" variant="ghost" loading={busy} onClick={() => void act("DELETE")}>Disconnect waitlist</Button>}</div>
        </div></details>
      </div> : <div className="p-5 sm:p-6"><div className="flex gap-3"><Users className="mt-0.5 size-5 shrink-0 text-fg-3" /><div><p className="text-[15px] font-medium text-fg">Your first users, before launch.</p><p className="mt-1 max-w-[60ch] text-[13px] leading-5 text-fg-3">Connect the database where your waitlist lives. Inroad keeps the total and growth history up to date automatically.</p></div></div><div className="mt-5 flex flex-wrap gap-2">{DATABASES.map((database) => <Button key={database.name} size="sm" icon={<Database className="size-3.5" />} onClick={() => setChoice(database)}>{database.name === "Convex" ? "Connect Convex" : database.name}</Button>)}</div></div>}
    </Card>
    {error && !state && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
    <Dialog open={!!choice || picking} onOpenChange={(open) => { if (!open) { setChoice(null); setPicking(false); } }} title={choice ? `Connect ${choice.name} waitlist` : "Connect your waitlist"} description="Import the count from your existing signup table.">
      {choice ? <WaitlistConnect key={choice.name} choice={choice} onDone={() => { setChoice(null); setPicking(false); void refresh(); }} /> : <div className="grid gap-2 p-5">{DATABASES.map((database) => <Button key={database.name} onClick={() => setChoice(database)}>{database.name}</Button>)}</div>}
    </Dialog>
  </section>;
}

function WaitlistGoal({ goal, onSaved }: { goal?: number; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState(goal?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const raw = value.trim().replace(/,/g, ""); const next = raw ? Number(raw) : null;
      if (next !== null && (!Number.isSafeInteger(next) || next <= 0)) throw new Error("Use a positive whole number for the target.");
      const response = await fetch("/api/waitlist", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal: next }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Couldn't save the target.");
      await onSaved(); toast.success("Waitlist target saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save the target."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="max-w-sm"><Label htmlFor="waitlist-goal">Waitlist target (optional)</Label><div className="flex gap-2"><Input id="waitlist-goal" inputMode="numeric" placeholder="e.g. 1,000" value={value} onChange={(e) => setValue(e.target.value)} /><Button type="submit" size="sm" loading={busy}>Save target</Button></div>{error && <p role="alert" className="mt-2 text-danger">{error}</p>}</form>;
}
