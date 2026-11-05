"use client";
import { Button } from "@/components/ui/button";
import { outcomesLine } from "./outcomes-model";
import type { AutomationController } from "./use-automation";

export function OutcomesPanel({ automation }: { automation: AutomationController }) {
  const metrics = automation.data?.metrics ?? [];
  const line = outcomesLine(metrics);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="text-[18px] font-medium">What research led to</h2>
          <p className="mt-2 max-w-[70ch] text-[14px] leading-[22px] text-fg">
            {line ?? "Nothing yet. Search, scan for intent and track the companies worth a look; their replies, meetings and wins show up here."}
          </p>
          <p className="mt-2 max-w-[70ch] text-[12.5px] leading-[19px] text-fg-3">
            Counted from the last 90 days of requests, linked to replies, meetings and won deals in this workspace. A company found by two sources counts for both, so
            these show association, not cause.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void automation.reload()}>
          Refresh outcomes
        </Button>
      </div>
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
      <details className="group space-y-3">
        <summary className="cursor-pointer text-[14px] font-medium text-fg-2 hover:text-fg">
          Every request ({Math.min(30, automation.data?.receipts.length ?? 0)} most recent)
        </summary>
        {automation.data?.receipts.slice(0, 30).map((receipt) => (
          <article key={receipt.id} className="mt-3 rounded-lg p-3 ring-1 ring-inset ring-border">
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
      </details>
    </div>
  );
}
