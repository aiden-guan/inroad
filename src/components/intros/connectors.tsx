"use client";

import { Gift, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Connector, Workspace } from "@/lib/domain/types";
import { ledger, type Ledger } from "@/lib/intros/rules";

export const RELATIONSHIP_LABEL: Record<Connector["relationship"], string> = {
  investor: "Investor",
  angel: "Angel",
  advisor: "Advisor",
  customer: "Customer",
  friend: "Friend",
  ex_colleague: "Ex-colleague",
  connection: "Connection",
};

const STATUS: Record<Ledger["status"], { label: (l: Ledger) => string; tone: "success" | "neutral" | "warning" | "outline" }> = {
  ready: { label: () => "Ready to ask", tone: "success" },
  in_flight: { label: () => "Ask in flight", tone: "outline" },
  resting: { label: (l) => `Resting until ${new Date(`${l.restUntil}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`, tone: "neutral" },
  give_first: { label: () => "Give first", tone: "warning" },
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** The people who introduce the founder, each with a give/get ledger and a plain "should I ask now?" */
export function ConnectorList({ ws, today, onEdit }: { ws: Workspace; today: string; onEdit: (c: Connector) => void }) {
  const listed = ws.connectors
    .map((c) => ({ c, l: ledger(ws, c, today) }))
    .sort((a, b) => Number(a.c.relationship === "connection") - Number(b.c.relationship === "connection") || b.l.introduced - a.l.introduced || a.c.name.localeCompare(b.c.name));
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg bg-surface ring-1 ring-border">
      {listed.map(({ c, l }) => (
        <ConnectorRow key={c.id} c={c} l={l} onEdit={() => onEdit(c)} />
      ))}
    </ul>
  );
}

function ConnectorRow({ c, l, onEdit }: { c: Connector; l: Ledger; onEdit: () => void }) {
  const { dispatch } = useWorkspace();
  const [giving, setGiving] = useState(false);
  const [give, setGive] = useState("");
  const status = STATUS[l.status];
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-bg-subtle font-mono text-[11px] text-fg-2 ring-1 ring-border">
          {initials(c.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
            <span className="font-medium text-fg">{c.name}</span>
            <span className="text-fg-3">
              {RELATIONSHIP_LABEL[c.relationship]}
              {c.company ? ` · ${c.company}` : ""}
            </span>
            <Tooltip content={l.advice}>
              <span>
                <Badge tone={status.tone}>{status.label(l)}</Badge>
              </span>
            </Tooltip>
          </p>
          <p className="mt-0.5 text-[12.5px] text-fg-3">{l.line}</p>
          {(c.reach?.length ?? 0) > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {c.reach!.map((r) => (
                <span key={r} className="rounded-xs bg-bg-subtle px-1.5 py-0.5 text-[11.5px] text-fg-2 ring-1 ring-border">
                  {r}
                </span>
              ))}
            </div>
          )}
          {l.status === "give_first" && l.advice && <p className="mt-1.5 text-[12.5px] leading-[18px] text-warning">{l.advice}</p>}
          {giving && (
            <form
              className="mt-2 flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (give.trim().length < 3) return;
                const ok = await dispatch({ type: "connector.give", id: c.id, what: give, at: nowISO() });
                if (ok) {
                  toast(`Logged. It balances ${c.name.split(" ")[0]}'s ledger.`);
                  setGive("");
                  setGiving(false);
                }
              }}
            >
              <Input autoFocus value={give} onChange={(e) => setGive(e.target.value)} placeholder="What you did for them: an intro, a lead, a favor" aria-label={`What you did for ${c.name}`} className="h-7 text-[12.5px]" />
              <Button size="xs" type="submit" variant="primary" disabled={give.trim().length < 3}>
                Log
              </Button>
              <Button size="xs" type="button" variant="ghost" onClick={() => setGiving(false)}>
                Cancel
              </Button>
            </form>
          )}
        </div>
        <Menu
          trigger={
            <IconButton label={`More for ${c.name}`}>
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
        >
          <MenuItem icon={<Gift className="size-3.5" />} onSelect={() => setGiving(true)}>
            Log something you did for them
          </MenuItem>
          <MenuItem icon={<Pencil className="size-3.5" />} onSelect={onEdit}>
            Edit
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Trash2 className="size-3.5" />}
            danger
            onSelect={() => {
              void dispatch({ type: "connector.remove", id: c.id });
              toast(`Removed ${c.name}. Their past intros stay in the history.`);
            }}
          >
            Remove
          </MenuItem>
        </Menu>
      </div>
    </li>
  );
}

const RELATIONSHIPS: Connector["relationship"][] = ["investor", "angel", "advisor", "customer", "ex_colleague", "friend", "connection"];

/** Add or edit a connector. Reach is what makes "Ways in" find them: companies, domains, roles, circles. */
export function ConnectorDialog({ open, onOpenChange, connector }: { open: boolean; onOpenChange: (o: boolean) => void; connector?: Connector }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={connector ? `Edit ${connector.name}` : "Add someone who introduces you"} className="max-w-[560px]">
      {open && <ConnectorForm key={connector?.id ?? "new"} connector={connector} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function ConnectorForm({ connector, onDone }: { connector?: Connector; onDone: () => void }) {
  const { dispatch } = useWorkspace();
  const id = useId();
  const [name, setName] = useState(connector?.name ?? "");
  const [relationship, setRelationship] = useState<Connector["relationship"]>(connector?.relationship ?? "investor");
  const [email, setEmail] = useState(connector?.email ?? "");
  const [linkedinUrl, setLinkedinUrl] = useState(connector?.linkedinUrl ?? "");
  const [company, setCompany] = useState(connector?.company ?? "");
  const [reach, setReach] = useState((connector?.reach ?? []).join(", "));
  const [notes, setNotes] = useState(connector?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const urlOk = !linkedinUrl.trim() || /^https?:\/\//.test(linkedinUrl.trim());
  const ready = name.trim().length >= 2 && emailOk && urlOk;

  return (
    <form
      className="space-y-3.5 px-5 pb-5 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setSaving(true);
        const next: Connector = {
          ...(connector ?? { id: newId("con"), introsMade: 0 }),
          name: name.trim(),
          relationship,
          ...(email.trim() ? { email: email.trim().toLowerCase() } : { email: undefined }),
          ...(linkedinUrl.trim() ? { linkedinUrl: linkedinUrl.trim() } : { linkedinUrl: undefined }),
          ...(company.trim() ? { company: company.trim() } : { company: undefined }),
          reach: reach
            .split(/[,\n]/)
            .map((r) => r.trim())
            .filter(Boolean)
            .slice(0, 12),
          ...(notes.trim() ? { notes: notes.trim() } : { notes: undefined }),
        };
        const ok = await dispatch({ type: "connector.upsert", connector: next });
        setSaving(false);
        if (ok) {
          toast(connector ? "Saved" : `Added ${next.name}`);
          onDone();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-n`}>Name</Label>
          <Input id={`${id}-n`} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Claire Donovan" />
        </div>
        <div>
          <Label htmlFor={`${id}-r`}>Who they are to you</Label>
          <select
            id={`${id}-r`}
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as Connector["relationship"])}
            className="h-8 w-full rounded-sm bg-surface px-2 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${id}-e`} hint="Fills the To line">
            Email
          </Label>
          <Input id={`${id}-e`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!emailOk} placeholder="claire@fund.com" className="font-mono text-[12.5px]" />
        </div>
        <div>
          <Label htmlFor={`${id}-c`} hint="Optional">
            Works at
          </Label>
          <Input id={`${id}-c`} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Alder Street Ventures" />
        </div>
      </div>
      <div>
        <Label htmlFor={`${id}-l`} hint="Optional">
          LinkedIn
        </Label>
        <Input id={`${id}-l`} value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} aria-invalid={!urlOk} placeholder="https://www.linkedin.com/in/…" className="font-mono text-[12.5px]" />
      </div>
      <div>
        <Label htmlFor={`${id}-reach`} hint="Comma-separated">
          Who they can reach
        </Label>
        <Input id={`${id}-reach`} value={reach} onChange={(e) => setReach(e.target.value)} placeholder="their portfolio, fintech CFOs, stripe.com, ex-Datadog" />
        <p className="mt-1 text-[12px] leading-[17px] text-fg-3">Companies, domains, roles or circles. “Ways in” on each company matches against these, so the right person comes up without you remembering.</p>
      </div>
      <div>
        <Label htmlFor={`${id}-notes`} hint="Optional">
          Notes
        </Label>
        <Textarea id={`${id}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" placeholder="How they like to be asked, what they care about" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!ready} loading={saving}>
          {connector ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
