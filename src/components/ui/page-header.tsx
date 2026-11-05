import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/client/cn";

/**
 * The page frame (globals.css `.page-shell`): one width, one side padding and one space above the title on every
 * page, so titles share a left edge. `wide` is for pages with a rail beside the text (Playbook, Studio): the same
 * left edge, more room on the right. Don't narrow it with max-w-* on a page; narrow the content inside instead.
 */
export function PageContainer({ wide, className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { wide?: boolean }) {
  return (
    <div className={cn("page-shell", wide && "page-shell-wide", className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * Every page's header: an eyebrow, the serif title with the page's actions on its right, and a summary of one line
 * (say it in one sentence). On a phone the actions wrap under the title, left-aligned. `children` go under the
 * summary: a line of counts, tabs.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  eyebrow?: string;
  /** The one-line summary. */
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("page-header", className)}>
      {eyebrow && <p className="page-eyebrow mb-2.5">{eyebrow}</p>}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="page-heading">{title}</h1>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <div className="page-summary">{description}</div>}
      {children}
    </header>
  );
}
