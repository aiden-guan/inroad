"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { Button } from "./button";
import { LoadingSignal } from "./loading";
import { EmptyState } from "./misc";

/**
 * A page's loading, error and empty states, said the same way on every page:
 *  - loading: the agent's signal over a page-shaped skeleton; past `slowAfterMs` it says it's slow, with a retry.
 *  - error: what happened in plain words, and Try again (busy while it retries).
 *  - empty: what will be here, and the one action that fills it.
 * It fills the content area; put it inside <PageContainer> when it stands in for a whole page.
 */
export type PageStateProps =
  | { kind: "loading"; label?: string; slowAfterMs?: number; onRetry?: () => unknown; className?: string }
  | { kind: "error"; title?: string; body?: ReactNode; detail?: string; onRetry?: () => unknown; action?: ReactNode; className?: string }
  | { kind: "empty"; title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string };

export function PageState(props: PageStateProps) {
  if (props.kind === "loading") return <Loading {...props} />;
  if (props.kind === "error") return <Failed {...props} />;
  return (
    <div className={props.className}>
      <EmptyState title={props.title} body={props.body} action={props.action} icon={props.icon} />
    </div>
  );
}

/** "Try again", busy until the retry settles. */
function RetryButton({ onRetry, label = "Try again" }: { onRetry: () => unknown; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      loading={busy}
      icon={<RotateCw className="size-3.5" aria-hidden />}
      onClick={async () => {
        setBusy(true);
        try {
          await onRetry();
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

function Loading({ label, slowAfterMs = 8000, onRetry, className }: Extract<PageStateProps, { kind: "loading" }>) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(t);
  }, [slowAfterMs]);
  return (
    <div aria-busy="true" className={cn("[animation:fade-in_200ms_var(--ease-out)_150ms_both]", className)}>
      <LoadingSignal label={label} />
      {slow && (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-fg-2">
          <span>This is taking longer than usual.</span>
          {onRetry && <RetryButton onRetry={onRetry} />}
        </div>
      )}
      <div aria-hidden className="mt-9 max-w-[760px]">
        <div className="skeleton h-3 w-28 rounded-sm" />
        <div className="skeleton mt-4 h-9 w-72 max-w-full rounded-md" />
        <div className="skeleton mt-4 h-3.5 w-[26rem] max-w-full rounded-sm" />
        <div className="mt-10 grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl bg-surface p-5 ring-1 ring-inset ring-border">
              <div className="skeleton size-10 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-3">
                <div className="skeleton h-3.5 w-2/5 rounded-sm" />
                <div className="skeleton h-3 w-4/5 rounded-sm" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Failed({ title = "Couldn't load this page", body, detail, onRetry, action, className }: Extract<PageStateProps, { kind: "error" }>) {
  return (
    <div role="alert" className={cn("max-w-[640px] rounded-xl bg-surface px-5 py-5 shadow-xs ring-1 ring-inset ring-border sm:px-6", className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-px grid size-8 shrink-0 place-items-center rounded-lg bg-danger-subtle text-danger">
          <TriangleAlert className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium leading-6 text-fg">{title}</h2>
          {body && <p className="mt-1 text-pretty text-[13.5px] leading-[21px] text-fg-2">{body}</p>}
          {detail && <p className="mt-2 break-words font-mono text-[12px] leading-[18px] text-fg-3">{detail}</p>}
          {(onRetry || action) && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {onRetry && <RetryButton onRetry={onRetry} />}
              {action}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
