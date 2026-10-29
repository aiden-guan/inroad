"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/client/cn";
import { useModKeys } from "@/lib/client/platform";

type Variant = "primary" | "secondary" | "ghost" | "agent" | "danger" | "link";
type Size = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  kbd?: string;
}

const variants: Record<Variant, string> = {
  // Ink button: the default commit action.
  primary: "bg-primary text-primary-fg shadow-btn hover:bg-primary-hover",
  secondary: "bg-surface text-fg shadow-xs ring-1 ring-inset ring-border-strong/80 hover:bg-surface-raised hover:ring-border-strong",
  ghost: "text-fg-2 hover:bg-bg-subtle hover:text-fg",
  // Blue pencil: actions that put the agent to work. They catch the light once on hover (fx-sheen).
  agent: "fx-sheen bg-accent text-accent-fg shadow-btn hover:bg-accent-hover",
  danger: "text-danger hover:bg-danger-subtle",
  link: "text-accent-text underline-offset-4 hover:underline px-0 h-auto",
};

const sizes: Record<Size, string> = {
  xs: "h-7 px-2 text-[12px] gap-1.5 rounded-sm",
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-md",
  lg: "h-11 px-5 text-[14px] gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, kbd, className, children, disabled, ...props },
  ref,
) {
  const keys = useModKeys();
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium",
        "transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out-quad",
        "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--ring)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        variant !== "link" && sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner className="size-3.5 shrink-0" /> : icon}
      {children}
      {kbd && (
        // A key hint means nothing on a phone or a touch screen: shown only with a keyboard-sized layout and a mouse.
        <kbd
          className={cn(
            "ml-0.5 hidden font-mono text-[11px] opacity-60 md:pointer-fine:inline",
            (variant === "primary" || variant === "agent") && "opacity-70",
          )}
        >
          {keys(kbd)}
        </kbd>
      )}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("animate-spin [animation-duration:800ms]", className)} aria-hidden>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-3 transition-[background-color,color,transform] duration-150 ease-out-quad",
        "hover:bg-bg-subtle hover:text-fg active:scale-[0.94] disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
