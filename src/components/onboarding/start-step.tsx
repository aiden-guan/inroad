"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { FieldError, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import type { Workspace } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { KeyBlock, useKeyForm, type KeyStatus } from "./key-block";
import { domainOf } from "./shared";

export interface StartArgs {
  url?: string;
  note?: string;
}

const NOTE_PLACEHOLDER = "e.g. We sell to heads of platform at Series B fintechs. Two design partners, no paid customers yet.";

/** Step 0: one column, one field, one action. The key block appears only when there's no key. */
export function StartStep({ ws, onStart, starting }: { ws: Workspace; onStart: (args: StartArgs) => Promise<boolean>; starting: boolean }) {
  const o = ws.onboarding;
  const router = useRouter();
  const { refresh } = useWorkspace();
  const unreachable = o.error?.code === "unreachable" ? o.error.message : null;
  const [mode, setMode] = useState<"site" | "describe">(o.site === "none" && !o.url && o.note ? "describe" : "site");
  const [url, setUrl] = useState(o.url ?? "");
  const [note, setNote] = useState(o.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const keyForm = useKeyForm();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json() as Promise<KeyStatus>)
      .then((s) => !cancelled && setKeyStatus(s))
      // If settings can't be read, let the run itself report a missing key.
      .catch(() => !cancelled && setKeyStatus({ hasKey: true, keyHint: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  const needsKey = keyStatus !== null && !keyStatus.hasKey;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (starting || keyForm.saving) return;
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
      if (!(await keyForm.submit())) return;
      setKeyStatus({ hasKey: true, keyHint: null });
    }
    await onStart(mode === "site" ? { url: domain!, note: note.trim() || undefined } : { note: note.trim() });
  };

  const submitOnEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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
        toast("The sample replaces what you've set up so far.", { action: { label: "Replace it", onClick: () => void explore(true) } });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Couldn't open the sample workspace.");
      }
      await refresh();
      router.replace("/today");
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
        <motion.h1
          variants={listItem}
          custom={0}
          className="text-balance font-serif text-[34px] leading-[40px] tracking-[-0.02em] text-fg [font-variation-settings:'opsz'_48] sm:text-[40px] sm:leading-[44px]"
        >
          Let&rsquo;s find your first customers.
        </motion.h1>
        <motion.p variants={listItem} custom={1} className="mt-3 text-pretty text-[15px] leading-[23px] text-fg-2">
          Paste your website. In about two minutes, I&rsquo;ll show you the first three companies worth talking to, and why now.
        </motion.p>

        <motion.form variants={listItem} custom={2} onSubmit={submit} className="mt-8" noValidate>
          {needsKey && (
            <div className="mb-5">
              <KeyBlock value={keyForm.key} onChange={keyForm.setKey} error={keyForm.error} saved={keyForm.saved} />
            </div>
          )}

          {mode === "site" ? (
            <>
              <label htmlFor="site" className="sr-only">
                Your website
              </label>
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
                  {unreachable ? "What do you sell, in one sentence?" : "Anything your website won’t tell me?"}
                </Label>
                <Textarea
                  id="note"
                  autoFocus={!!unreachable}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={submitOnEnter}
                  placeholder={NOTE_PLACEHOLDER}
                  maxLength={2000}
                  className="min-h-[72px] text-[16px] leading-6 sm:text-[14px] sm:leading-[21px]"
                />
              </div>
            </>
          ) : (
            <>
              <Label htmlFor="describe">No website yet? Describe what you&rsquo;re building in two sentences.</Label>
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
                className="min-h-[96px] text-[16px] leading-6 sm:text-[14px] sm:leading-[21px]"
              />
              <div aria-live="polite">
                <FieldError>{error}</FieldError>
              </div>
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Button type="submit" variant="agent" size="lg" kbd="↵" loading={starting || keyForm.saving}>
              Start
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
        </motion.form>

        <motion.footer variants={listItem} custom={3} className="mt-14 border-t border-border pt-4">
          <p className="text-pretty text-[12px] leading-[18px] text-fg-3">
            I read public pages and search the web. I never send anything, and your workspace stays on this computer.
          </p>
          <button
            type="button"
            onClick={() => void explore()}
            disabled={sampleBusy}
            className="mt-2 rounded-xs text-[12px] text-fg-3 underline decoration-border-strong underline-offset-4 transition-colors duration-150 hover:text-fg-2 disabled:opacity-60"
          >
            {sampleBusy ? "Opening the sample…" : "Explore a sample workspace"}
          </button>
        </motion.footer>
    </motion.main>
  );
}
