"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, SectionLabel } from "@/components/ui/card";
import { cn } from "@/lib/client/cn";
import { ease } from "@/lib/motion";
import { StatusDot, ToolMark, type Tone } from "./parts";

export interface RowStatus {
  tone: Tone;
  label: ReactNode;
}

const rowBase =
  "group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-bg-subtle/60 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]";

function RowFace({ name, blurb, domain, icon, status, badge, trailing }: { name: string; blurb: ReactNode; domain?: string; icon?: ReactNode; status: RowStatus; badge?: ReactNode; trailing: ReactNode }) {
  return (
    <>
      <ToolMark domain={domain} name={name} icon={icon} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium text-fg">{name}</span>
          <StatusDot tone={status.tone} className="sm:hidden" />
          {badge}
        </span>
        <span className="mt-0.5 block text-[13px] leading-[18px] text-fg-3 sm:truncate">{blurb}</span>
        <span className={cn("mt-1 block text-[12px] sm:hidden", status.tone === "error" ? "text-danger" : "text-fg-3")}>{status.label}</span>
      </span>
      <span className={cn("hidden max-w-[45%] shrink-0 items-center gap-1.5 text-[12px] sm:flex", status.tone === "error" ? "text-danger" : status.tone === "off" ? "text-fg-3" : "text-fg-2")}>
        <StatusDot tone={status.tone} />
        <span className="truncate">{status.label}</span>
      </span>
      {trailing}
    </>
  );
}

/** One tool in a group. Expands in place; never opens a modal. */
export function IntegrationRow({
  id,
  name,
  blurb,
  domain,
  icon,
  status,
  badge,
  open,
  onToggle,
  children,
}: {
  id: string;
  name: string;
  blurb: ReactNode;
  domain?: string;
  icon?: ReactNode;
  status: RowStatus;
  badge?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `integration-${id}`;
  return (
    <li id={id} className="scroll-mt-24">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className={rowBase}>
        <RowFace
          name={name}
          blurb={blurb}
          domain={domain}
          icon={icon}
          status={status}
          badge={badge}
          trailing={<ChevronDown className={cn("size-4 shrink-0 text-fg-4 transition-transform duration-200 ease-out-quad group-hover:text-fg-3", open && "rotate-180")} aria-hidden />}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            id={panelId}
            role="region"
            aria-label={name}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: ease.out } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="px-4 pb-5 pt-1 sm:pl-[60px] sm:pr-6"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** A row that goes somewhere else (the import flow) instead of expanding. */
export function LinkRow({ id, href, name, blurb, domain, icon, status, badge }: { id: string; href: string; name: string; blurb: ReactNode; domain?: string; icon?: ReactNode; status: RowStatus; badge?: ReactNode }) {
  return (
    <li id={id} className="scroll-mt-24">
      <Link href={href} scroll={false} className={rowBase}>
        <RowFace
          name={name}
          blurb={blurb}
          domain={domain}
          icon={icon}
          status={status}
          badge={badge}
          trailing={<ChevronRight className="size-4 shrink-0 text-fg-4 transition-transform duration-150 ease-out-quad group-hover:translate-x-0.5 group-hover:text-fg-3" aria-hidden />}
        />
      </Link>
    </li>
  );
}

export function Group({ id, question, note, children }: { id: string; question: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-label`} className="mt-10 first:mt-0">
      <SectionLabel>
        <span id={`${id}-label`}>{question}</span>
      </SectionLabel>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">{children}</ul>
      </Card>
      {note && <p className="mt-2 px-1 text-[12px] leading-[18px] text-fg-3">{note}</p>}
    </section>
  );
}
