"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/brand-mark";
import { FieldError, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import type { Market, Workspace } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { shouldMoveFocus, startFocus, wantId } from "./focus";
import { KeyBlock, useKeyForm, type KeyStatus } from "./key-block";
import { domainOf } from "./shared";

export interface StartArgs {
  url?: string;
  note?: string;
  /** "Who buys from you?" Unset lets the site decide. */
  market?: Market;
}

const NOTE_PLACEHOLDER: Record<Market | "auto", string> = {
  auto: "e.g. We sell to heads of platform at Series B fintechs. Two design partners, no paid customers yet.",
  b2b: "e.g. We sell to heads of platform at Series B fintechs. Two design partners, no paid customers yet.",
  consumer: "e.g. A sleep app for new parents. 400 beta users, most from one subreddit, no paid plan yet.",
};

const SUBTITLE: Record<Market | "auto", string> = {
  auto: "Add your website. Get a GTM plan and your first prospects in about two minutes.",
  b2b: "Add your website. Get a sales plan and your first companies to contact.",
  consumer: "Add your website. Get a growth plan and places to find your first users.",
};

const MARKET_OPTIONS: { value: Market | "auto"; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "b2b", label: "Businesses" },
  { value: "consumer", label: "Consumers" },
];

/** Native radios support arrow keys as well as touch, without submitting the form. */
function MarketPick({ value, onChange }: { value: Market | "auto"; onChange: (v: Market | "auto") => void }) {
  return (
    <fieldset className="mt-5">
      <legend className="mb-1.5 text-[13px] font-medium text-fg">Who are your customers?</legend>
      <div className="inline-flex items-center gap-0.5 rounded-md bg-bg-subtle p-0.5 ring-1 ring-border">
        {MARKET_OPTIONS.map((o) => (
          <label key={o.value} className="relative cursor-pointer">
            <input type="radio" name="market" value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="peer sr-only" />
            <span className={cn(
              "inline-flex min-h-10 items-center rounded-[6px] px-3 text-[13px] font-medium transition-colors duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] sm:min-h-8",
              value === o.value ? "bg-surface text-fg shadow-xs" : "text-fg-3 hover:text-fg-2",
            )}>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** One setup form. The provider block appears only when an AI connection is needed. */
export function StartStep({ ws, onStart, starting }: { ws: Workspace; onStart: (args: StartArgs) => Promise<boolean>; starting: boolean }) {
  const o = ws.onboarding;
  const router = useRouter();
  const { refresh } = useWorkspace();
  const unreachable = o.error?.code === "unreachable" ? o.error.message : null;
  const [mode, setMode] = useState<"site" | "describe">(o.site === "none" && !o.url && o.note ? "describe" : "site");
  const [url, setUrl] = useState(o.url ?? "");
  const [note, setNote] = useState(o.note ?? "");
  const [market, setMarket] = useState<Market | "auto">(o.market ?? "auto");
  const [error, setError] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [keyCheckError, setKeyCheckError] = useState(false);
  const [keyCheck, setKeyCheck] = useState(0);
  const [sampleBusy, setSampleBusy] = useState(false);
  const keyForm = useKeyForm();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Couldn't check your AI connection.");
        return r.json() as Promise<KeyStatus>;
      })
      .then((s) => !cancelled && setKeyStatus(s))
      .catch(() => !cancelled && setKeyCheckError(true));
    return () => {
      cancelled = true;
    };
  }, [keyCheck]);

  const needsKey = keyStatus !== null && !keyStatus.hasKey;

  // The cursor goes to the first thing to fill in. The key check answers after the first paint, so when
  // it says there's no key, move there from the (still empty) website field the page autofocused.
  const want = startFocus({ needsKey, keySaved: !!keyForm.saved?.hasKey, mode, unreachable: !!unreachable });
  useEffect(() => {
    const el = document.activeElement as HTMLInputElement | null;
    const active = !el || el === document.body ? null : { id: el.id, value: el.value ?? "" };
    if (shouldMoveFocus(active, want)) document.getElementById(wantId(want))?.focus();
  }, [want]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (starting || keyForm.saving || !keyStatus) return;
    const domain = domainOf(url);
    if (mode === "site" && !domain) {
      setError("That doesn't look like a website. Try something like acme.com.");
      return;
    }
    if (mode === "describe" && note.trim().split(/\s+/).length < 6) {
      setError("A sentence or two is enough: what you sell, and who buys it.");
      return;
    }
    setError(null);
    if (needsKey && !keyForm.saved) {
      if (!(await keyForm.submit())) {
        document.getElementById(wantId("key"))?.focus();
        return;
      }
      setKeyStatus({ hasKey: true, keyHint: null });
    }
    const pick = market === "auto" ? undefined : market;
    await onStart(mode === "site" ? { url: domain!, note: note.trim() || undefined, market: pick } : { note: note.trim(), market: pick });
  };

  const submitOnEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const explore = async (replace = false) => {
    setSampleBusy(true);
    try {
      const res = await fetch("/api/workspace/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replace }),
      });
      if (res.status === 409) {
        // The founder already has work here; the sample would replace it, so ask first.
        toast("The sample replaces what you've set up so far. I'll save a backup of it first.", { action: { label: "Replace it", onClick: () => void explore(true) } });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Couldn't open the sample workspace.");
      }
      await refresh();
      router.replace("/today");
      toast("Sample workspace loaded. Everything here is made up. Start with your company any time.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the sample workspace.");
    } finally {
      setSampleBusy(false);
    }
  };

  return (
    <motion.main
      key="start"
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="mx-auto w-full max-w-[560px] px-4 pb-20 pt-[8vh] sm:px-6 sm:pt-[13vh]"
    >
        <motion.div variants={listItem} custom={0} className="mb-8 flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-surface text-fg shadow-sm ring-1 ring-inset ring-border"><BrandMark draw="once" className="size-8" /></span>
          <span className="page-eyebrow">A head start on your next chapter</span>
        </motion.div>
        <motion.h1
          variants={listItem}
          custom={0}
          className="text-balance font-serif text-[34px] leading-[40px] tracking-[-0.02em] text-fg [font-variation-settings:'opsz'_48] sm:text-[40px] sm:leading-[44px]"
        >
          Let&rsquo;s find your first customers.
        </motion.h1>
        <motion.p variants={listItem} custom={1} className="mt-3 text-pretty text-[15px] leading-[23px] text-fg-2">
          {mode === "describe" ? "Describe your product. Get a GTM plan and a place to start." : SUBTITLE[market]}
        </motion.p>

        <motion.form variants={listItem} custom={2} onSubmit={submit} className="mt-8" noValidate>
          {keyCheckError && (
            <div role="alert" className="mb-5 flex flex-wrap items-center gap-2 text-[13px] text-danger">
              Couldn&apos;t check your AI connection.
              <Button type="button" size="sm" variant="secondary" onClick={() => { setKeyCheckError(false); setKeyCheck((n) => n + 1); }}>Try again</Button>
            </div>
          )}
          {needsKey && (
            <div className="mb-5">
              <KeyBlock form={keyForm} />
            </div>
          )}

          {mode === "site" ? (
            <>
              <Label htmlFor="site">Your website</Label>
              <input
                id="site"
                autoFocus={!unreachable}
                inputMode="url"
                autoComplete="url"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="yourcompany.com"
                value={url}
                aria-invalid={!!(error || unreachable)}
                aria-describedby="site-error"
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError(null);
                }}
                className={cn(
                  "h-12 w-full rounded-md bg-surface px-4 font-mono text-[16px] text-fg shadow-xs ring-1 ring-border-strong/70 placeholder:text-fg-4 sm:text-[15px]",
                  "transition-[box-shadow] duration-150 ease-out-quad hover:ring-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                )}
              />
              <div id="site-error" aria-live="polite">
                <FieldError>{error}</FieldError>
                {!error && unreachable && <p className="mt-1.5 text-pretty text-[13px] leading-5 text-fg-2">{unreachable}</p>}
              </div>
              <div className="mt-5">
                <Label htmlFor="note" hint={unreachable ? undefined : "optional"}>
                  What do you sell, and to whom?
                </Label>
                <Textarea
                  id="note"
                  autoFocus={!!unreachable}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={submitOnEnter}
                  placeholder={NOTE_PLACEHOLDER[market]}
                  maxLength={2000}
                  className="min-h-[72px] text-[16px] leading-6 sm:text-[14px] sm:leading-[21px]"
                />
              </div>
            </>
          ) : (
            <>
              <Label htmlFor="describe">What are you building, and who is it for?</Label>
              <Textarea
                id="describe"
                autoFocus
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={submitOnEnter}
                placeholder="We help clinics get insurance pre-authorizations approved in hours, not weeks. Two design partners, no revenue yet."
                maxLength={2000}
                aria-invalid={!!error}
                aria-describedby="describe-error"
                className="min-h-[96px] text-[16px] leading-6 sm:text-[14px] sm:leading-[21px]"
              />
              <div id="describe-error" aria-live="polite">
                <FieldError>{error}</FieldError>
              </div>
            </>
          )}

          <MarketPick value={market} onChange={setMarket} />

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button type="submit" variant="agent" size="lg" loading={starting || keyForm.saving} disabled={!keyStatus}>
              {keyForm.saving ? "Connecting AI…" : starting ? "Building your plan…" : !keyStatus && !keyCheckError ? "Checking setup…" : "Build my GTM plan"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === "site" ? "describe" : "site"));
                setError(null);
              }}
              className="rounded-xs text-[13px] text-fg-3 underline-offset-4 transition-colors duration-150 hover:text-fg-2 hover:underline"
            >
              {mode === "site" ? "No website yet?" : "I have a website"}
            </button>
          </div>
          <p className="mt-3 text-[12px] text-fg-3">No CRM or email connection needed.</p>
        </motion.form>

        <motion.footer variants={listItem} custom={3} className="mt-14 border-t border-border pt-4">
          <p className="text-pretty text-[12px] leading-[18px] text-fg-3">
            Your workspace stays on this computer. You review and send every message.
          </p>
          <button
            type="button"
            onClick={() => void explore()}
            disabled={sampleBusy}
            className="mt-2 rounded-xs text-[12px] text-fg-3 underline decoration-border-strong underline-offset-4 transition-colors duration-150 hover:text-fg-2 disabled:opacity-60"
          >
              {sampleBusy ? "Opening the sample…" : "Try a sample · no API key needed"}
          </button>
        </motion.footer>
    </motion.main>
  );
}
