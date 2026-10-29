import { cn } from "@/lib/client/cn";
import { BrandMark } from "./brand-mark";

/** An indeterminate signal, never a simulated percentage or a made-up task. */
export function LoadingSignal({ label = "Opening your workspace", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("loading-signal flex items-center gap-3", className)}>
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-subtle text-accent-text ring-1 ring-inset ring-accent/15" aria-hidden>
        <BrandMark draw="loop" className="size-6" />
      </span>
      <span className="text-[12px] font-medium text-fg-3">{label}<span className="loading-dots" aria-hidden><i /><i /><i /></span></span>
    </div>
  );
}

/** Route-level fallback; client data loaders retain their own layout-shaped skeletons. */
export function WorkspaceLoading() {
  return (
    <div className="page-shell" aria-busy="true">
      <LoadingSignal />
      <div aria-hidden className="mt-9 max-w-[760px]">
        <div className="skeleton h-11 w-64 max-w-full rounded-lg" />
        <div className="skeleton mt-4 h-4 w-96 max-w-full rounded-sm" />
        <div className="mt-10 grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5">
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
