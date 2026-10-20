import { cn } from "@/lib/client/cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "agent" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-bg-subtle text-fg-2 ring-border",
  outline: "bg-transparent text-fg-2 ring-border-strong/70",
  success: "bg-success-subtle text-success ring-transparent",
  warning: "bg-warning-subtle text-warning ring-transparent",
  danger: "bg-danger-subtle text-danger ring-transparent",
  info: "bg-info-subtle text-info ring-transparent",
  agent: "bg-accent-subtle text-accent-text ring-transparent",
};

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-xs px-1.5 text-[11px] font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** The permanent "AI" marker next to anything the agent says, per agent-interaction guidelines. */
export function AiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 items-center rounded-[3px] px-1 font-mono text-[9.5px] font-medium tracking-wide text-accent-text ring-1 ring-inset ring-accent/30",
        className,
      )}
    >
      AI
    </span>
  );
}
