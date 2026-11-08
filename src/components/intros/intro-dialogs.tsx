"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea, Select } from "@/components/ui/field";
import { addDays, newId, nowISO, todayISO } from "@/lib/domain/ids";
import type { Intro, IntroSide, IntroStage, Workspace } from "@/lib/domain/types";
import { first } from "@/lib/moves/util";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Known {
  key: string;
  name: string;
  title?: string;
  email?: string;
  personId?: string;
}

/** Everyone the founder has on file, for the name pickers: people (with their company) and connectors. */
function knownPeople(ws: Workspace): Known[] {
  const out: Known[] = [];
  for (const p of Object.values(ws.people)) {
    if (p.doNotContact) continue;
    const acc = ws.accounts[p.accountDomain];
    out.push({ key: p.id, name: p.name, title: [p.title, acc?.name].filter(Boolean).join(" at "), email: p.email, personId: p.id });
  }
  for (const c of ws.connectors) {
    if (out.some((k) => k.name.toLowerCase() === c.name.toLowerCase())) continue;
    out.push({ key: c.id, name: c.name, title: c.company, email: c.email });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function SideFields({ label, side, onChange, known, other }: { label: string; side: IntroSide; onChange: (s: IntroSide) => void; known: Known[]; other: string }) {
  const id = useId();
  const pick = (name: string) => {
    const k = known.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    onChange(k ? { ...side, name: k.name, title: side.title || k.title, email: side.email || k.email, personId: k.personId } : { ...side, name, personId: undefined });
  };
  return (
    <fieldset className="space-y-2.5 rounded-md bg-bg-subtle/60 p-3 ring-1 ring-border">
      <legend className="sr-only">{label}</legend>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-n`}>{label}</Label>
          <Input id={`${id}-n`} list={`${id}-list`} value={side.name} onChange={(e) => pick(e.target.value)} placeholder="Name" autoComplete="off" />
          <datalist id={`${id}-list`}>
            {known.map((k) => (
              <option key={k.key} value={k.name}>
                {k.title}
              </option>
            ))}
          </datalist>
        </div>
        <div>
          <Label htmlFor={`${id}-t`} hint="Role and company">
            Who they are
          </Label>
          <Input id={`${id}-t`} value={side.title ?? ""} onChange={(e) => onChange({ ...side, title: e.target.value })} placeholder="VP Finance at Northwind" />
        </div>
      </div>
      <div>
        <Label htmlFor={`${id}-e`} hint="For the To line">
          Email
        </Label>
        <Input id={`${id}-e`} type="email" value={side.email ?? ""} onChange={(e) => onChange({ ...side, email: e.target.value })} className="font-mono text-[12.5px]" />
      </div>
      <div>
        <Label htmlFor={`${id}-w`}>Why would {first(side.name) || "they"} want to meet {first(other) || "the other person"}?</Label>
        <Textarea
          id={`${id}-w`}
          value={side.why}
          onChange={(e) => onChange({ ...side, why: e.target.value })}
          className="min-h-16"
          placeholder="One honest sentence. It goes in the note asking them, so it should be about what they get."
        />
      </div>
    </fieldset>
  );
}

const blank = (): IntroSide => ({ name: "", why: "", consent: "pending" });

/**
 * Give first: introduce two people. Double opt-in for real: each side is asked separately with a
 * note about the other, and the intro email only goes out once both said yes.
 */
export function MakeIntroDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Make an intro"
      description="Each side gets asked first, separately. Nobody's details move until both say yes."
      className="max-w-[620px]"
    >
      {open && <MakeIntroForm onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function MakeIntroForm({ onDone }: { onDone: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const known = useMemo(() => (ws ? knownPeople(ws) : []), [ws]);
  const [a, setA] = useState<IntroSide>(blank);
  const [b, setB] = useState<IntroSide>(blank);
  const [saving, setSaving] = useState(false);
  const sideOk = (s: IntroSide) => s.name.trim().length >= 2 && s.why.trim().length >= 10 && (!s.email?.trim() || EMAIL.test(s.email.trim()));
  const same = a.name.trim() && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
  const ready = sideOk(a) && sideOk(b) && !same;

  return (
    <form
      className="max-h-[calc(88vh-80px)] space-y-3 overflow-y-auto px-5 pb-5 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setSaving(true);
        const at = nowISO();
        const clean = (s: IntroSide): IntroSide => ({
          ...s,
          name: s.name.trim(),
          title: s.title?.trim() || undefined,
          email: s.email?.trim().toLowerCase() || undefined,
          why: s.why.trim().replace(/\s+/g, " ").slice(0, 240),
          consent: "pending",
        });
        const intro: Intro = {
          id: newId("intro"),
          kind: "give",
          stage: "asked",
          targetName: `${a.name.trim()} and ${b.name.trim()}`,
          sides: [clean(a), clean(b)],
          askedOn: todayISO(),
          history: [{ at, stage: "asked" }],
          createdAt: at,
          updatedAt: at,
        };
        const ok = await dispatch({ type: "intro.create", intro });
        setSaving(false);
        if (ok) {
          toast(`Next: ask ${first(a.name)} if they'd like the intro.`);
          onDone();
        }
      }}
    >
      <SideFields label="First person" side={a} onChange={setA} known={known} other={b.name} />
      <SideFields label="Second person" side={b} onChange={setB} known={known} other={a.name} />
      {same && <p className="text-[12.5px] text-danger">Pick two different people.</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!ready} loading={saving}>
          Start the intro
        </Button>
      </div>
    </form>
  );
}

/** For asks made outside Inroad (a text, a hallway): log them so the follow-through still happens. */
export function LogAskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Log an intro you asked for" description="Asked by text, at an event, anywhere. I'll keep track of whose move it is." className="max-w-[560px]">
      {open && <LogAskForm onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function LogAskForm({ onDone }: { onDone: () => void }) {
  const { ws, dispatch } = useWorkspace();
  const id = useId();
  const today = todayISO();
  const [connectorId, setConnectorId] = useState(ws?.connectors.find((c) => c.relationship !== "connection")?.id ?? "");
  const [target, setTarget] = useState("");
  const [domain, setDomain] = useState("");
  const [askedOn, setAskedOn] = useState(today);
  const [stage, setStage] = useState<IntroStage>("asked");
  const [saving, setSaving] = useState(false);
  if (!ws) return null;
  const connector = ws.connectors.find((c) => c.id === connectorId);
  const accounts = Object.values(ws.accounts)
    .filter((a) => a.status !== "disqualified")
    .sort((x, y) => x.name.localeCompare(y.name));
  const ready = !!connector && target.trim().length >= 2 && askedOn <= today && askedOn >= addDays(today, -120);

  if (!ws.connectors.length) {
    return <p className="px-5 pb-5 pt-3 text-[13.5px] leading-[21px] text-fg-2">Add the person you asked first, under “People who introduce you”.</p>;
  }

  return (
    <form
      className="space-y-3 px-5 pb-5 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready || !connector) return;
        setSaving(true);
        const at = nowISO();
        const person = domain ? Object.values(ws.people).find((p) => p.accountDomain === domain && p.name.toLowerCase() === target.trim().split(",")[0].toLowerCase()) : undefined;
        const intro: Intro = {
          id: newId("intro"),
          kind: "ask",
          stage: "asked",
          connectorId: connector.id,
          connectorName: connector.name,
          personId: person?.id,
          accountDomain: domain || undefined,
          targetName: person ? `${person.name}${person.title ? `, ${person.title}` : ""}` : target.trim(),
          askedOn,
          history: [{ at, stage: "asked", note: "Logged by hand" }],
          createdAt: at,
          updatedAt: at,
        };
        const actions = [
          { type: "intro.create" as const, intro },
          { type: "connector.upsert" as const, connector: { ...connector, lastAskedOn: [connector.lastAskedOn ?? "", askedOn].sort().at(-1) } },
          ...(stage !== "asked" ? [{ type: "intro.advance" as const, id: intro.id, stage, at, activityId: stage === "introduced" ? newId("act") : undefined }] : []),
        ];
        const ok = await dispatch(actions);
        setSaving(false);
        if (ok) {
          toast("Logged. I'll tell you when it's your move.");
          onDone();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-c`}>Who you asked</Label>
          <Select
            id={`${id}-c`}
            value={connectorId}
            onChange={(e) => setConnectorId(e.target.value)}
            className="h-8 w-full rounded-sm bg-surface px-2 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {ws.connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-d`}>Asked on</Label>
          <Input id={`${id}-d`} type="date" value={askedOn} max={today} onChange={(e) => setAskedOn(e.target.value)} className="font-mono text-[12.5px]" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-t`}>For an intro to</Label>
          <Input id={`${id}-t`} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Rafael Ortiz, VP Finance" />
        </div>
        <div>
          <Label htmlFor={`${id}-a`} hint="Optional">
            At
          </Label>
          <Select
            id={`${id}-a`}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="h-8 w-full rounded-sm bg-surface px-2 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <option value="">Not a company on your list</option>
            {accounts.map((a) => (
              <option key={a.domain} value={a.domain}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor={`${id}-s`}>Where it stands</Label>
        <Select
          id={`${id}-s`}
          value={stage}
          onChange={(e) => setStage(e.target.value as IntroStage)}
          className="h-8 w-full rounded-sm bg-surface px-2 text-[13px] text-fg ring-1 ring-border-strong/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <option value="asked">Waiting on {first(connector?.name) || "them"}</option>
          <option value="forwarded">{first(connector?.name) || "They"} is checking with them</option>
          <option value="introduced">The intro email landed</option>
        </Select>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!ready} loading={saving}>
          Log it
        </Button>
      </div>
    </form>
  );
}
