import type { ReactNode } from "react";
import { cn } from "@/lib/client/cn";

export function PageHeader({ title, eyebrow, description, actions, children, className }: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("page-header", className)}>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 flex-1 basis-64">
          {eyebrow && <p className="page-eyebrow mb-3">{eyebrow}</p>}
          <h1 className="page-heading">{title}</h1>
          {description && <div className="mt-3 max-w-[60ch] text-pretty text-[14px] leading-[22px] text-fg-2">{description}</div>}
        </div>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2 pb-0.5">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
