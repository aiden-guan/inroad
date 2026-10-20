import { cn } from "@/lib/client/cn";

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg bg-surface shadow-sm ring-1 ring-border", className)} {...props}>
      {children}
    </div>
  );
}

export function SectionLabel({ children, className, right }: { children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-3", className)}>
      <h3 className="text-[12px] font-medium tracking-[0.01em] text-fg-3">{children}</h3>
      {right}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-border", className)} />;
}
