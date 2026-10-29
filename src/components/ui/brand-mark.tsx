import { cn } from "@/lib/client/cn";

/** Two paths becoming one: the small, reusable Inroad signature. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn("size-7 shrink-0", className)}>
      <path d="M7 25V16a9 9 0 0 1 18 0v9M13 25v-9a3 3 0 0 1 6 0v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M16 4v3M4 16h3M25 16h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".4" />
    </svg>
  );
}
