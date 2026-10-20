"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { relativeTime } from "@/lib/client/format";
import type { Workspace } from "@/lib/domain/types";
import { ease, listItem } from "@/lib/motion";
import { Callout, Group, StatusIcon } from "./parts";
import type { CheckStatus, DomainCheck, DomainHealthReport } from "./types";
import { domainOf, normalizeDomain } from "./validate";

const STEPS = ["Reading mail servers (MX)", "Reading SPF", "Looking for DKIM keys", "Reading DMARC"];

function headline(checks: DomainCheck[]): { text: string; tone: CheckStatus } {
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  if (fails) return { text: `${fails === 1 ? "One thing" : `${fails} things`} to fix before you send cold email.`, tone: "fail" };
  if (warns) return { text: `Ready to send. ${warns === 1 ? "One thing is" : `${warns} things are`} worth a look.`, tone: "warn" };
  return { text: "All four pass. Your domain is ready for cold email.", tone: "pass" };
}

export function DomainHealth({ ws, refresh, now }: { ws: Workspace; refresh: () => Promise<void>; now: number }) {
  const sender = ws.sender;
  const senderEmail = sender?.email || ws.founder.email;
  const suggested = sender?.sendingDomain ?? domainOf(senderEmail) ?? ws.company?.domain ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [report, setReport] = useState<DomainHealthReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? suggested;

  const check = async () => {
    const domain = normalizeDomain(value);
    if (!domain) {
      setError("Enter the domain you send from, like acme.com.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/domain-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "The check didn't finish. Try again.");
      setReport(body as DomainHealthReport);
      setDraft(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check didn't finish. Try again.");
    } finally {
      setChecking(false);
    }
  };

  const checkedDomain = report?.domain ?? sender?.sendingDomain;
  const fromDomain = domainOf(senderEmail);
  const mismatch = Boolean(checkedDomain && fromDomain && fromDomain !== checkedDomain && !fromDomain.endsWith(`.${checkedDomain}`));
  const saved = sender?.domainHealth;

  return (
    <Group
      id="domain"
      title="Sending domain"
      hint="Gmail, Yahoo and Microsoft look for these DNS records before they trust mail from you. I read them from public DNS, which is free."
    >
      <div className="px-4 py-3.5">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <label htmlFor="sending-domain" className="sr-only">
            Sending domain
          </label>
          <Input
            id="sending-domain"
            value={value}
            placeholder="acme.com"
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            aria-invalid={!!error}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            className="font-mono text-[12.5px] sm:flex-1"
          />
          <Button type="submit" variant="primary" loading={checking}>
            {checking ? "Checking" : report || saved ? "Check again" : "Check domain health"}
          </Button>
        </form>
        <FieldError>{error}</FieldError>
        {!report && !checking && saved && (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
            <span>
              Last checked <span className="font-mono">{sender?.sendingDomain}</span> {relativeTime(saved.checkedAt, now)}
            </span>
            <Mini label="SPF" status={saved.spf ? "pass" : "fail"} />
            <Mini label="DKIM" status={saved.dkim ? "pass" : "warn"} />
            <Mini label="DMARC" status={saved.dmarc ? "pass" : "fail"} />
            <Mini label="MX" status={saved.mx ? "pass" : "fail"} />
          </p>
        )}
      </div>

      {checking && (
        <ul className="px-4 py-3" aria-live="polite" aria-busy="true">
          {STEPS.map((s, i) => (
            <motion.li key={s} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.12, duration: 0.2 }} className="flex h-7 items-center gap-2.5 text-[13px]">
              <span className="size-3 animate-spin rounded-full border-[1.5px] border-fg-4/40 border-t-fg-3" aria-hidden />
              <span className="shimmer-text">{s}</span>
            </motion.li>
          ))}
        </ul>
      )}

      <AnimatePresence initial={false}>
        {report && !checking && (
          <motion.div key={report.checkedAt} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            <Headline checks={report.checks} />
            <ul className="divide-y divide-border">
              {report.checks.map((c, i) => (
                <motion.li key={c.id} variants={listItem} initial="hidden" animate="show" custom={i}>
                  <CheckRow check={c} />
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {mismatch && (
        <div className="px-4 py-3">
          <Callout tone="warning" title={`Your sender email is on ${fromDomain}, not ${checkedDomain}.`}>
            DMARC passes only when the From address matches the domain you authenticate. Check {fromDomain}, or change your sender email below.
          </Callout>
        </div>
      )}

      <p className="px-4 py-3 text-[12px] leading-[18px] text-fg-3 text-pretty">
        Keep spam complaints under 0.3%, Google&apos;s limit, and aim for 0.1%. At founder volume your main domain is fine; if you scale cold email through a sequencer, send from a
        separate domain so this one stays clean.{" "}
        <a href="https://support.google.com/a/answer/81126" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-fg-2 underline underline-offset-2 hover:text-fg">
          Google&apos;s sender rules <ArrowUpRight className="size-3" aria-hidden />
        </a>
      </p>
    </Group>
  );
}

function Mini({ label, status }: { label: string; status: CheckStatus }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusIcon status={status} className="size-4 [&_svg]:size-2.5" />
      {label}
    </span>
  );
}

function Headline({ checks }: { checks: DomainCheck[] }) {
  const h = headline(checks);
  return (
    <motion.p
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: ease.out }}
      className={cn("border-t border-border px-4 pt-3 text-[13px] font-medium", h.tone === "fail" ? "text-danger" : h.tone === "warn" ? "text-warning" : "text-success")}
    >
      {h.text}
    </motion.p>
  );
}

function CheckRow({ check }: { check: DomainCheck }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <StatusIcon status={check.status} className="mt-px" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{check.label}</p>
        <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-2 text-pretty">{check.summary}</p>
        {check.fix && <p className="mt-1.5 text-[12.5px] leading-[18px] text-fg text-pretty">{check.fix}</p>}
        {check.record && (
          <div className="mt-2 rounded-md bg-sunken p-2.5 ring-1 ring-inset ring-border">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[11px] text-fg-3">
                {check.record.type} · host <span className="text-fg-2">{check.record.host}</span>
              </p>
              <CopyButton text={check.record.value} label="Copy record" className="h-6" />
            </div>
            <p className="mt-1.5 break-all font-mono text-[12px] leading-[18px] text-fg">{check.record.value}</p>
          </div>
        )}
        {check.found && !check.record && (
          <p className="mt-1.5 line-clamp-3 whitespace-pre-line break-all font-mono text-[11.5px] leading-[17px] text-fg-3" title={check.found}>
            {check.found}
          </p>
        )}
      </div>
    </div>
  );
}
