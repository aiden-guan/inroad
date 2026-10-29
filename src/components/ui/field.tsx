"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";

const base =
  "min-w-0 w-full rounded-md bg-surface px-3 text-[13px] text-fg shadow-xs ring-1 ring-inset ring-border-strong/70 placeholder:text-fg-3 " +
  "transition-[box-shadow,background-color] duration-150 ease-out-quad hover:ring-border-strong " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] aria-invalid:ring-danger/60 disabled:cursor-not-allowed disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(base, "h-9", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(base, "min-h-24 resize-none py-2.5 leading-[22px]", className)} {...props} />;
});

/** Native semantics with a consistent arrow and room for the complete selected label. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return <select ref={ref} className={cn(base, "h-9 w-auto", className, "field-select pr-9")} {...props}>{children}</select>;
});

export function Label({ children, hint, htmlFor, className }: { children: ReactNode; hint?: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1.5 flex items-baseline justify-between gap-3 text-[12px] font-medium text-fg-2", className)}>
      <span>{children}</span>
      {hint && <span className="font-normal text-fg-3">{hint}</span>}
    </label>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1.5 text-[12px] text-danger">{children}</p>;
}
