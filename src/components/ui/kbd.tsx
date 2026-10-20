import { cn } from "@/lib/client/cn";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs bg-bg-subtle px-1 font-mono text-[11px] leading-none text-fg-3 ring-1 ring-border",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
