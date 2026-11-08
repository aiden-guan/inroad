"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { formatMetric } from "@/lib/metrics/catalog";
import { isResearchPending, PLATFORM_NAMES, type MonidPrice, type MonidReport, type ResearchInput } from "@/lib/monid/types";
import { ExternalLink } from "./parts";

const API = "/api/integrations/monid/research";
async function call(body: unknown) {
  const response = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Monid couldn't complete that request.");
  return data.value;
}
const message = (error: unknown) => error instanceof Error ? error.message : "Couldn't reach Monid. Try again.";
const priceText = (price: MonidPrice) => price.amount ? `$${price.amount.value} ${price.type === "PER_RESULT" ? "per result" : price.type === "PER_CALL" ? "per call" : price.type.toLowerCase().replaceAll("_", " ")}${price.flatFee ? ` + $${price.flatFee.value} base fee` : ""}` : "See the current provider price card below.";

export function MonidPanel({ initialKind = "creators" }: { initialKind?: ResearchInput["kind"] }) {
  const { ws } = useWorkspace();
  const [kind, setKind] = useState<ResearchInput["kind"]>(initialKind);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("US");
  const [limit, setLimit] = useState(10);
  const [maxCost, setMaxCost] = useState("1");
  const [price, setPrice] = useState<MonidPrice | null>(null);
  const [reports, setReports] = useState<MonidReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const pending = reports.filter((r) => isResearchPending(r.status));
  const pendingKey = pending.map((r) => r.id).join(",");

  async function history() {
    const response = await fetch(API, { cache: "no-store" });
    if (!response.ok) throw new Error("Couldn't load your Monid research history.");
    const data = await response.json();
    setReports(data.reports);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch(API, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Couldn't load your Monid research history.");
      const data = await response.json();
      if (!controller.signal.aborted) setReports(data.reports);
    }).catch((e) => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!pendingKey) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        for (const id of pendingKey.split(",")) {
          const report: MonidReport = await call({ action: "refresh", id });
          if (!stopped) setReports((rows) => rows.map((r) => r.id === report.id ? report : r));
        }
        if (!stopped) timer = setTimeout(() => void poll(), 5000);
      } catch (e) { if (!stopped) setError(message(e)); }
    };
    timer = setTimeout(() => void poll(), 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [pendingKey]);

  function changed() { setPrice(null); requestId.current = null; setError(null); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const input: ResearchInput = kind === "creators" ? { kind, query: query.trim(), country, limit } : { kind, domain: query.trim(), country };
    setBusy(true); setError(null);
    try {
      if (!price) {
        const preview = await call({ action: "preview", input });
        setPrice(preview.price);
      } else {
        requestId.current ??= crypto.randomUUID();
        const report: MonidReport = await call({ action: "run", input, requestId: requestId.current, maxCost: Number(maxCost), price });
        setReports((rows) => [report, ...rows.filter((r) => r.id !== report.id)]);
        setPrice(null); requestId.current = null;
      }
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5">
    <p className="max-w-[72ch] text-[13px] leading-5 text-fg-2">Find creators through public TikTok posts, or save an Ahrefs snapshot of your domain’s AI citations. Runs are on demand and spend your Monid balance. A price preview starts no paid work.</p>
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy || Boolean(ws?.sample)} className="space-y-4 disabled:opacity-60">
        <div><Label htmlFor="monid-kind">Research</Label><Select id="monid-kind" className="w-full" value={kind} onChange={(e) => { setKind(e.target.value as ResearchInput["kind"]); setQuery(""); changed(); }}><option value="creators">TikTok creator discovery</option><option value="citations">AI citation snapshot · Ahrefs</option></Select></div>
        <div><Label htmlFor="monid-query">{kind === "creators" ? "Niche or keyword" : "Your domain"}</Label><Input id="monid-query" value={query} onChange={(e) => { setQuery(e.target.value); changed(); }} required minLength={2} maxLength={160} placeholder={kind === "creators" ? "skincare UGC creator" : "example.com"} /></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="monid-country">Country code</Label><Input id="monid-country" value={country} onChange={(e) => { setCountry(e.target.value.toUpperCase()); changed(); }} required pattern="[A-Za-z]{2}" maxLength={2} placeholder="US" /></div>{kind === "creators" && <div><Label htmlFor="monid-limit">Maximum posts</Label><Input id="monid-limit" type="number" min={1} max={25} value={limit} onChange={(e) => { setLimit(Number(e.target.value)); changed(); }} required /></div>}</div>
        <p className="text-[12px] leading-5 text-fg-3">{kind === "creators" ? "One keyword per run, up to 25 public posts. Creators are deduplicated and shown with their strongest returned post. This is a research shortlist; availability for UGC work and performance are not verified." : "Whole domain including subdomains, both protocols, selected country, today's UTC date. Counts come from Ahrefs' monitored answers; they do not measure every answer or prove that an optimization caused a change."}</p>
        {price && <div className="space-y-3 rounded-lg bg-bg-subtle p-4 ring-1 ring-border"><p className="text-[13px] font-medium">Current price: {priceText(price)}</p><details className="text-[12px]"><summary className="cursor-pointer text-fg-2">Full provider price card</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-fg-3">{JSON.stringify(price, null, 2)}</pre></details><div className="max-w-xs"><Label htmlFor="monid-cost">Estimated cost threshold · USD</Label><Input id="monid-cost" type="number" min="0.01" max="5" step="0.01" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} required /></div><p className="text-[12px] leading-5 text-fg-3">Monid rejects estimates above this amount. Actual per-result or metered charges can exceed the estimate. Review the price card and configure budget controls in Monid before running.</p></div>}
        <Button type="submit" variant="primary" loading={busy}>{price ? "Run paid research" : "Preview current price"}</Button>
      </fieldset>
    </form>
    {ws?.sample && <p className="text-[12px] text-fg-3">Leave the sample workspace before running paid research.</p>}
    {error && <p role="alert" className="text-[13px] text-danger">{error} <button type="button" className="underline" onClick={() => void history().catch((e) => setError(message(e)))}>Reload run history</button></p>}
    <ExternalLink href="https://app.monid.ai">Open Monid dashboard and run history</ExternalLink>
    {reports.length > 0 && <div className="space-y-4 border-t border-border pt-5"><h3 className="text-[13px] font-medium">Saved research</h3>{reports.slice(0, 20).map((report) => <ResearchResult key={report.id} report={report} previous={reports.find((r) => r.id !== report.id && r.createdAt < report.createdAt && r.citations && r.input.kind === "citations" && report.input.kind === "citations" && r.input.domain === report.input.domain && r.input.country === report.input.country)} />)}</div>}
  </div>;
}

function ResearchResult({ report, previous }: { report: MonidReport; previous?: MonidReport }) {
  const title = report.input.kind === "creators" ? report.input.query : report.input.domain;
  return <details className="rounded-lg p-4 ring-1 ring-border" open={isResearchPending(report.status) || undefined}>
    <summary className="cursor-pointer text-[13px] font-medium"><span className="break-words">{title} · {report.input.country}</span><span className="ml-2 text-[12px] font-normal text-fg-3">{report.reportDate} · {report.status.toLowerCase().replaceAll("_", " ")}{report.costUsd !== undefined && ` · $${report.costUsd.toFixed(6)}`}</span></summary>
    {isResearchPending(report.status) && <p role="status" className="mt-3 text-[12px] text-fg-3">Checking this existing run every 5 seconds while this panel is open. Leaving the page does not stop the run.</p>}
    {report.error && <p role="alert" className="mt-3 text-[12px] leading-5 text-danger">{report.error}</p>}
    {report.status === "SUBMITTING" && <p className="mt-3 text-[12px] text-fg-3">Submission is recorded. If this persists after reloading, check Monid’s run history before submitting again.</p>}
    {report.runId && <p className="mt-3 break-all font-mono text-[11px] text-fg-3">Monid run {report.runId}</p>}
    {report.creators && <div className="mt-4 space-y-3">{report.creators.length === 0 && <p className="text-[13px] text-fg-3">No public creator posts were returned for this query.</p>}{report.creators.map((creator) => <article key={creator.handle} className="border-t border-border pt-3"><a href={creator.profileUrl} target="_blank" rel="noreferrer" className="text-[13px] font-medium underline underline-offset-4">{creator.name ?? creator.handle} · @{creator.handle} ↗</a><p className="mt-1 text-[12px] text-fg-3">{creator.followers !== undefined && `${formatMetric(creator.followers)} followers · `}{creator.views !== undefined && `${formatMetric(creator.views)} post views`}{creator.likes !== undefined && ` · ${formatMetric(creator.likes)} likes`}</p>{creator.caption && <p className="mt-1 break-words text-[12px] leading-5 text-fg-2">{creator.caption}</p>}{creator.postUrl && <a href={creator.postUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] underline">View source post ↗</a>}</article>)}</div>}
    {report.citations && <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[400px] text-left text-[12px] [&_th]:px-2 [&_td]:px-2"><caption className="pb-3 text-left text-fg-3">Ahrefs citation links and distinct cited pages. {previous ? `Previous matched snapshot: ${previous.reportDate}.` : "Save another snapshot with the same domain and country to compare."}</caption><thead><tr className="border-b border-border"><th scope="col" className="py-2">Platform</th><th scope="col" className="py-2 text-right">Citations</th><th scope="col" className="py-2 text-right">Pages</th>{previous && <th scope="col" className="py-2 text-right">Previous citations</th>}</tr></thead><tbody>{report.citations.map((row) => <tr key={row.platform} className="border-b border-border/50"><th scope="row" className="py-2 font-normal">{PLATFORM_NAMES[row.platform]}</th><td className="py-2 text-right font-mono">{formatMetric(row.citations)}</td><td className="py-2 text-right font-mono">{formatMetric(row.pages)}</td>{previous && <td className="py-2 text-right font-mono">{formatMetric(previous.citations?.find((r) => r.platform === row.platform)?.citations ?? null)}</td>}</tr>)}</tbody></table></div>}
  </details>;
}
