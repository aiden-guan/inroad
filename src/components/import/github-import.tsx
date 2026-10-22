"use client";

import { Check, Lock, Star } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import type { ImportResponse, UndoResponse } from "@/lib/network/types";
import { ease } from "@/lib/motion";
import { postJson } from "./api";

/**
 * W2 · GitHub stargazers. People who starred the founder's repo already know the product: their public
 * profiles say where they work, and each one I can place becomes a person at that company. Zero tokens,
 * undoable. GitHub's own limit applies (about 50 profiles an hour without a token).
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const REPO = /^(?:https?:\/\/github\.com\/)?[a-z\d][a-z\d-]{0,38}\/[\w.-]{1,100}\/?$/i;

export function GitHubImport({ onDone }: { onDone?: () => void }) {
  const { refresh } = useWorkspace();
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResponse["batch"] | null>(null);
  const [undone, setUndone] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = repo.trim();
    if (!REPO.test(value)) {
      setError("Use owner/name, like acme/acme-sdk, or paste the repo's GitHub link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<ImportResponse>("/api/import/github", { repo: value });
      setResult(r.batch);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!result) return;
    setBusy(true);
    try {
      const r = await postJson<UndoResponse>("/api/import/undo", { batchId: result.id });
      setUndone(r.message);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't undo that import.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const g = result.github;
    const c = result.counts;
    const made = [c.accountsCreated && plural(c.accountsCreated, "company", "companies"), c.peopleCreated && plural(c.peopleCreated, "person", "people")].filter(Boolean).join(" and ");
    return (
      <div className="grid gap-4 py-2">
        <div className="flex items-start gap-3">
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: ease.out }}
            className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", undone ? "bg-bg-subtle text-fg-3" : "bg-success-subtle text-success")}
          >
            <Check className="size-4" aria-hidden />
          </motion.span>
          <div className="min-w-0" aria-live="polite">
            <p className="text-[15px] font-medium text-fg">{undone ? "Import undone" : made ? `Imported ${made}` : "No one I could place yet"}</p>
            <p className="mt-1 text-pretty text-[13px] leading-[19px] text-fg-2">
              {undone ??
                [
                  g ? `Read ${plural(g.read, "profile")}${g.total > g.read ? ` of ${g.total.toLocaleString("en-US")} stargazers, newest first` : ""} on ${g.repo}; ${g.matched} named a company I could place.` : null,
                  c.accountsUpdated ? `${plural(c.accountsUpdated, "company", "companies")} you already had got a stargazer tag.` : null,
                  g?.rateLimited ? "GitHub's hourly limit stopped me early. Run it again in an hour for the rest." : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
            </p>
            {!undone && g && !g.withToken && g.total > g.read && (
              <p className="mt-2 text-[12.5px] leading-[18px] text-fg-3">
                Without a token GitHub allows about 50 profiles an hour.{" "}
                <Link href="/settings#public-data" onClick={onDone} className="font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline">
                  Add a GitHub token
                </Link>{" "}
                to read up to 300 at once.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!undone && made && (
            <Link
              href="/companies?view=prospects"
              onClick={onDone}
              className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-fg shadow-btn transition-[background-color,transform] duration-150 hover:bg-primary-hover active:scale-[0.97]"
            >
              See them in Companies
            </Link>
          )}
          {!undone && made && (
            <Button variant="ghost" onClick={() => void undo()} loading={busy}>
              Undo import
            </Button>
          )}
          <Button variant={undone || !made ? "primary" : "secondary"} onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="flex gap-2.5 text-pretty text-[13.5px] leading-5 text-fg-2">
        <Star className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
        People who starred your repo already know what you built. I read their public GitHub profiles and add the ones whose company I can tell, newest stars first.
      </p>
      <div>
        <Label htmlFor="github-repo">Your repository</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="github-repo"
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
              if (error) setError(null);
            }}
            placeholder="acme/acme-sdk"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error}
            className="h-9 font-mono text-[16px] sm:flex-1 sm:text-[13px]"
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!repo.trim()}>
            Import stargazers
          </Button>
        </div>
        <FieldError>{error}</FieldError>
      </div>
      <p className="flex gap-2 text-[12.5px] leading-[18px] text-fg-3">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Only public profile fields (name, company, site, location). Nothing goes to Claude. Someone I can&apos;t place at a company is skipped, never guessed.
        </span>
      </p>
    </form>
  );
}
