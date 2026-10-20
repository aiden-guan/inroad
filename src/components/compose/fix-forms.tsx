"use client";

import { Check } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import { newId, nowISO } from "@/lib/domain/ids";
import type { OutreachPackage, Person } from "@/lib/domain/types";

/**
 * Blockers the founder can fix without leaving the draft: a tiny inline form, saved with one
 * action, and the check re-runs live. Asked just in time, never up front.
 */

function Shell({ title, children, onSubmit, className }: { title: ReactNode; children: ReactNode; onSubmit: (e: FormEvent) => void; className?: string }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(e);
      }}
      className={cn("rounded-md bg-bg-subtle p-3 ring-1 ring-border animate-[rise-in_180ms_var(--ease-out)]", className)}
    >
      <p className="mb-2.5 text-[13px] leading-5 text-fg">{title}</p>
      {children}
    </form>
  );
}

export function SenderForm() {
  const { ws, dispatch } = useWorkspace();
  const id = useId();
  const s = ws?.sender;
  const [name, setName] = useState(s?.name || ws?.founder.name || "");
  const [title, setTitle] = useState(s?.title || ws?.founder.title || "");
  const [company, setCompany] = useState(s?.company || ws?.company?.name || "");
  const [address, setAddress] = useState(s?.postalAddress || "");
  const [saving, setSaving] = useState(false);
  const ready = name.trim() && title.trim() && company.trim() && address.trim();
  return (
    <Shell
      title={
        <>
          Your sender details go in the footer. US law (CAN-SPAM) needs a postal address on every cold email; a PO box or registered
          agent address works.
        </>
      }
      onSubmit={async () => {
        if (!ready) return;
        setSaving(true);
        await dispatch({ type: "sender.update", patch: { name: name.trim(), title: title.trim(), company: company.trim(), postalAddress: address.trim(), email: s?.email || ws?.founder.email || "" } });
        setSaving(false);
      }}
    >
      <div className="grid gap-2.5 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${id}-n`}>Name</Label>
          <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
        <div>
          <Label htmlFor={`${id}-t`}>Title</Label>
          <Input id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Founder & CEO" />
        </div>
        <div>
          <Label htmlFor={`${id}-c`}>Company</Label>
          <Input id={`${id}-c`} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" />
        </div>
      </div>
      <div className="mt-2.5">
        <Label htmlFor={`${id}-a`}>Postal address</Label>
        <Input id={`${id}-a`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="548 Market St #12345, San Francisco, CA 94104" autoComplete="street-address" />
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={!ready} loading={saving}>
          Save sender details
        </Button>
      </div>
    </Shell>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** No person on the draft yet (written to a role), or a person without an address. */
export function RecipientForm({ pkg, person }: { pkg: OutreachPackage; person?: Person }) {
  const { dispatch } = useWorkspace();
  const id = useId();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const validEmail = EMAIL_RE.test(email.trim());
  const ready = person ? validEmail : name.trim() && validEmail;
  return (
    <Shell
      title={person ? `What's ${person.name.split(" ")[0]}'s email? Add it only if you found it published or they gave it to you.` : "Who's this for? I wrote it to the role; add the person and I'll address it to them."}
      onSubmit={async () => {
        if (!ready) return;
        setSaving(true);
        const value = email.trim();
        const path = { kind: "published_email" as const, value, via: "you", verified: true, founderConfirmed: true };
        if (person) {
          await dispatch({ type: "person.upsert", person: { ...person, email: value, contactPaths: [...person.contactPaths.filter((p) => p.value !== value), path] } });
        } else {
          const personId = newId("per");
          await dispatch([
            {
              type: "person.upsert",
              person: {
                id: personId,
                accountDomain: pkg.accountDomain,
                name: name.trim(),
                title: title.trim(),
                email: value,
                evidenceIds: [],
                confidence: "high",
                mayHaveLeft: false,
                contactPaths: [path],
                jurisdiction: "unknown",
                doNotContact: false,
                source: "manual",
              },
            },
            { type: "outreach.setPerson", packageId: pkg.id, personId },
          ]);
        }
        setSaving(false);
      }}
    >
      <div className={cn("grid gap-2.5", !person && "sm:grid-cols-3")}>
        {!person && (
          <>
            <div>
              <Label htmlFor={`${id}-n`}>Name</Label>
              <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`${id}-t`}>Title</Label>
              <Input id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </>
        )}
        <div>
          <Label htmlFor={`${id}-e`}>Email</Label>
          <Input id={`${id}-e`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className="font-mono text-[12.5px]" />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={!ready} loading={saving}>
          {person ? "Save email" : "Add and address it"}
        </Button>
      </div>
    </Shell>
  );
}

/** The guessed-email interlock: a pattern guess needs the founder to say they checked it. */
export function VerifyGuess({ person, address }: { person: Person; address: string }) {
  const { dispatch } = useWorkspace();
  const id = useId();
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-bg-subtle p-3 ring-1 ring-border">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        onChange={(e) => {
          if (!e.target.checked) return;
          void dispatch({
            type: "person.upsert",
            person: { ...person, contactPaths: person.contactPaths.map((p) => (p.value.toLowerCase() === address.toLowerCase() ? { ...p, founderConfirmed: true } : p)) },
          });
        }}
      />
      <label htmlFor={id} className="text-[13px] leading-5 text-fg">
        I verified <span className="font-mono text-[12.5px]">{address}</span>
        <span className="block text-fg-3">It&apos;s a guess from their email format. Guesses that bounce hurt your domain; check it first.</span>
      </label>
    </div>
  );
}

/** Cold drafts need a first-hand opinion. Asked the first time one is missing. */
export function PovForm({ onSaved }: { onSaved: (povId: string) => void }) {
  const { dispatch } = useWorkspace();
  const id = useId();
  const [text, setText] = useState("");
  const [basis, setBasis] = useState("");
  const [saving, setSaving] = useState(false);
  const ready = text.trim().split(/\s+/).length >= 5;
  return (
    <Shell
      title="Cold notes land when they carry a view the reader hasn't heard ten times. What do you believe about this problem that most buyers don't?"
      onSubmit={async () => {
        if (!ready) return;
        setSaving(true);
        const pov = { id: newId("pov"), text: text.trim(), evidence: basis.trim(), createdAt: nowISO(), uses: 0 };
        const ok = await dispatch({ type: "pov.upsert", pov });
        setSaving(false);
        if (ok) onSaved(pov.id);
      }}
    >
      <Label htmlFor={`${id}-p`}>Your point of view</Label>
      <Textarea id={`${id}-p`} value={text} onChange={(e) => setText(e.target.value)} placeholder="The reconciliation script outlives the person who wrote it, so the second hire inherits a black box." />
      <div className="mt-2.5">
        <Label htmlFor={`${id}-b`} hint="Optional">
          Where it comes from
        </Label>
        <Input id={`${id}-b`} value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="30 calls with platform leads, Jun–Oct 2026" />
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="submit" variant="agent" size="sm" disabled={!ready} loading={saving}>
          Save and rewrite with it
        </Button>
      </div>
    </Shell>
  );
}

export function AvailabilityForm() {
  const { ws, dispatch } = useWorkspace();
  const id = useId();
  const [value, setValue] = useState(ws?.founder.availability ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <Shell
      title="Add when you're free so I can offer two exact times next time."
      onSubmit={async () => {
        if (!value.trim()) return;
        const ok = await dispatch({ type: "founder.update", patch: { availability: value.trim() } });
        if (ok) setSaved(true);
      }}
    >
      <div className="flex gap-2">
        <Input id={id} aria-label="Availability" value={value} onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }} placeholder="Tue–Thu 10–4 PT" />
        <Button type="submit" variant="secondary" size="md" disabled={!value.trim()}>
          {saved ? <Check className="size-3.5 text-success" /> : null}
          {saved ? "Saved" : "Save"}
        </Button>
      </div>
    </Shell>
  );
}
