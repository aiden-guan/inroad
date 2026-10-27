"use client";
import { Button } from "@/components/ui/button";
import type { AutomationController } from "./use-automation";

export function OutcomesPanel({ automation }: { automation: AutomationController }) {
  const metrics = automation.data?.metrics ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-medium">Research cost and outcomes</h2>
          <p className="mt-2 max-w-[70ch] text-[13px] leading-6 text-fg-2">
            Requests, failures and accepted websites from the last 90 days, linked to replies, meetings and won deals in this workspace. An account can be
            associated with multiple providers; these counts show association.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void automation.reload()}>
          Refresh outcomes
        </Button>
      </div>
      {!metrics.length && (
        <p className="rounded-lg bg-bg-subtle p-5 text-[13px] text-fg-3">
          Search, read sources, and track useful company websites to start collecting evidence.
        </p>
      )}
      {metrics.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-[12px]">
            <caption className="sr-only">Research provider requests, costs, and associated outcomes</caption>
            <thead className="bg-bg-subtle">
              <tr>
                {["Provider", "Requests", "Cached", "Failed", "Accepted accounts", "Replies", "Meetings", "Won", "Recorded cost"].map((label) => (
                  <th key={label} scope="col" className="whitespace-nowrap p-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((row) => (
                <tr key={row.provider} className="border-t border-border">
                  <th scope="row" className="p-3 font-medium">
                    {row.provider}
                  </th>
                  <td className="p-3">{row.requests}</td>
                  <td className="p-3">{row.cached}</td>
                  <td className="p-3">{row.failures}</td>
                  <td className="p-3">{row.acceptedAccounts}</td>
                  <td className="p-3">{row.replies}</td>
                  <td className="p-3">{row.meetings}</td>
                  <td className="p-3">{row.won}</td>
                  <td className="p-3">
                    {row.unknownCost ? `$${row.knownCostUsd.toFixed(4)} + ${row.unknownCost} unknown` : `$${row.knownCostUsd.toFixed(4)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[12px] leading-5 text-fg-3">
        Unknown provider charges remain unknown. Claude native cost includes its model tokens and search; external search and browser charges are separate
        from model usage. Small samples cannot establish that a provider or signal improves win rates.
      </p>
      <section className="space-y-3">
        <h3 className="text-[15px] font-medium">Recent operations</h3>
        {automation.data?.receipts.slice(0, 30).map((receipt) => (
          <article key={receipt.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="text-[12px] font-medium">
                {receipt.provider} · {receipt.kind}
                {receipt.cached ? " · cached" : ""}
              </p>
              <p className="text-[11px] text-fg-3">
                {new Date(receipt.at).toLocaleString()} · {receipt.durationMs}ms
              </p>
            </div>
            <p className="mt-1 break-words text-[12px] text-fg-2">{receipt.query}</p>
            <p className="mt-1 text-[11px] text-fg-3">
              {receipt.resultCount} results{receipt.accountDomains?.length ? ` · tracked ${receipt.accountDomains.join(", ")}` : ""}
            </p>
            {receipt.error && <p className="mt-1 text-[12px] text-danger">{receipt.error}</p>}
          </article>
        ))}
      </section>
    </div>
  );
}
