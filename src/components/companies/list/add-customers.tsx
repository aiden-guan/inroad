"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { postJson } from "@/components/import/api";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { knownUsersKind, parseKnownUsers, type KnownUser } from "@/lib/customers/known-users";
import type { Workspace } from "@/lib/domain/types";

/** The result line both entry points show: who was added, and who still needs a website. */
export function addedLine(r: { added: { name: string }[]; unplaced: string[] }): string {
  const names = (xs: string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  return [
    r.added.length ? `Added ${names(r.added.map((a) => a.name))} to Customers.` : null,
    r.unplaced.length ? `I couldn't find a website for ${names(r.unplaced)}; add ${r.unplaced.length === 1 ? "it" : "them"} by domain.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Posts known users as customers; returns the line to show, or throws with the server's message. */
export async function addKnown(ws: Workspace, users: KnownUser[]): Promise<{ line: string; added: number }> {
  const r = await postJson<{ added: { domain: string; name: string }[]; unplaced: string[] }>("/api/customers/known", { users, kind: knownUsersKind(ws) });
  return { line: addedLine(r), added: r.added.length };
}

/** "Already have users?" Websites or names, one line, for founders whose customers predate Inroad. */
export function AddCustomers({ ws }: { ws: Workspace }) {
  const { refresh } = useWorkspace();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const users = parseKnownUsers(text);
    if (!users.length) {
      setError("Name a company by website (acme.com) or by name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await addKnown(ws, users);
      await refresh();
      if (r.added) {
        toast(r.line);
        setText("");
      } else setError(r.line);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-[420px] text-left">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          placeholder="acme.com, northwind.io, Dana at Globex"
          aria-label="Companies already using you"
          aria-invalid={!!error}
          className="h-9 text-[16px] sm:flex-1 sm:text-[13.5px]"
        />
        <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()}>
          Add customers
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </form>
  );
}
