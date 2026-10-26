"use client";

import { AnimatePresence, motion } from "motion/react";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/client/cn";
import { newId, nowISO } from "@/lib/domain/ids";
import type { StudioAudience, StudioMaterial, StudioProfile, Workspace } from "@/lib/domain/types";
import { AUDIENCES } from "@/lib/studio/formats";
import { INTAKE, intakeFor, openQuestions } from "@/lib/studio/intake";

const AUDIENCE_ORDER: StudioAudience[] = ["b2b", "prosumer", "developer", "b2c"];

/** Who the copy is for. The critic reads as this person; the picker orders formats for them. */
export function ProfileCard({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const profile = ws.studio.profile;
  const audience = profile?.audience ?? "b2b";
  const [neverSay, setNeverSay] = useState("");
  const update = (patch: Partial<StudioProfile>) => void dispatch({ type: "studio.profile.update", patch });

  return (
    <section className="rounded-lg bg-surface p-4 ring-1 ring-border">
      <h2 className="text-[13px] font-medium text-fg">Who it&apos;s for</h2>
      <p className="mt-0.5 text-[12px] leading-[17px] text-fg-3">{AUDIENCES[audience].blurb}</p>
      <div role="radiogroup" aria-label="Who it's for" className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-bg-subtle p-0.5 ring-1 ring-border">
        {AUDIENCE_ORDER.map((a) => (
          <button
            key={a}
            role="radio"
            aria-checked={a === audience}
            onClick={() => update({ audience: a })}
            className={cn(
              "h-7 rounded-[6px] text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-150",
              a === audience ? "bg-surface text-fg shadow-sm ring-1 ring-border" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {AUDIENCES[a].label}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <Label htmlFor="studio-reader" hint="The reader I write for">
          Reader
        </Label>
        <Textarea
          id="studio-reader"
          key={`reader-${profile?.reader ?? ""}`}
          defaultValue={profile?.reader ?? ""}
          placeholder={AUDIENCES[audience].reader}
          className="min-h-14 text-[13px]"
          onBlur={(e) => e.target.value.trim() !== (profile?.reader ?? "") && update({ reader: e.target.value.trim() })}
        />
      </div>
      <div className="mt-3">
        <Label htmlFor="studio-name">Product name</Label>
        <Input
          id="studio-name"
          key={`name-${profile?.productName ?? ""}`}
          defaultValue={profile?.productName ?? ws.company?.name ?? ""}
          onBlur={(e) => e.target.value.trim() !== (profile?.productName ?? "") && update({ productName: e.target.value.trim() })}
        />
      </div>
      <BrandColors colors={profile?.colors ?? []} onChange={(colors) => update({ colors })} />
      <div className="mt-3">
        <Label htmlFor="studio-never" hint="On top of the house list">
          Never say
        </Label>
        <div className="flex flex-wrap gap-1">
          {(profile?.neverSay ?? []).map((w) => (
            <span key={w} className="inline-flex h-6 items-center gap-1 rounded-xs bg-bg-subtle pl-2 pr-1 text-[12px] text-fg-2 ring-1 ring-border">
              {w}
              <button aria-label={`Remove ${w}`} onClick={() => update({ neverSay: (profile?.neverSay ?? []).filter((x) => x !== w) })} className="rounded-[3px] p-0.5 text-fg-3 hover:text-fg">
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Input
            id="studio-never"
            value={neverSay}
            onChange={(e) => setNeverSay(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !neverSay.trim()) return;
              e.preventDefault();
              update({ neverSay: [...new Set([...(profile?.neverSay ?? []), neverSay.trim()])] });
              setNeverSay("");
            }}
            placeholder="Add a word, press Enter"
            className="h-6 w-auto min-w-32 flex-1 text-[12px]"
          />
        </div>
      </div>
    </section>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Brand colors for graphics, background first. Hex only, so the design checks can measure contrast. */
function BrandColors({ colors, onChange }: { colors: string[]; onChange: (colors: string[]) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3">
      <Label htmlFor="studio-colors" hint="For graphics, background first">
        Brand colors
      </Label>
      <div className="flex items-center gap-2">
        {colors.length > 0 && (
          <span className="flex shrink-0 -space-x-1" aria-hidden>
            {colors.map((c) => (
              <span key={c} className="size-4 rounded-full ring-2 ring-surface" style={{ background: c }} />
            ))}
          </span>
        )}
        <Input
          id="studio-colors"
          key={`colors-${colors.join(",")}`}
          defaultValue={colors.join(", ")}
          placeholder="#14120F, #F4F1EA, #2F5BEA"
          aria-invalid={!!error}
          className="h-7 font-mono text-[12px]"
          onBlur={(e) => {
            const list = e.target.value
              .split(/[\s,]+/)
              .map((x) => x.trim())
              .filter(Boolean)
              .map((x) => (x.startsWith("#") ? x : `#${x}`));
            const bad = list.find((x) => !HEX.test(x));
            if (bad) {
              setError(`${bad} isn't a 6-digit hex color.`);
              return;
            }
            setError(null);
            if (list.join(",") !== colors.join(",")) onChange(list.slice(0, 5).map((x) => x.toUpperCase()));
          }}
        />
      </div>
      {error && <p className="mt-1 text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}

/** The founder's raw material: the receipts copy is built from. Questions first when it's thin. */
export function MaterialCard({ ws }: { ws: Workspace }) {
  const { dispatch } = useWorkspace();
  const [adding, setAdding] = useState<StudioMaterial["kind"] | null>(null);
  const open = openQuestions(ws);
  const material = [...ws.studio.material].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <section className="rounded-lg bg-surface p-4 ring-1 ring-border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-medium text-fg">Your material</h2>
          <p className="mt-0.5 text-[12px] leading-[17px] text-fg-3">Every specific in your copy comes from here, your approved claims or your playbook. Nothing is invented.</p>
        </div>
        {!adding && (
          <IconButton label="Add material" onClick={() => setAdding(open[0]?.kind ?? "story")}>
            <Plus className="size-4" />
          </IconButton>
        )}
      </div>

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div key="add" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <AddMaterial
              kind={adding}
              onKind={setAdding}
              onCancel={() => setAdding(null)}
              onSave={(m) => {
                void dispatch({ type: "studio.material.upsert", material: m });
                setAdding(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {!adding && open.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-fg-3">Worth answering</p>
          {open.slice(0, 4).map((q) => (
            <button
              key={q.kind}
              onClick={() => setAdding(q.kind)}
              className="block w-full rounded-md px-2.5 py-2 text-left text-[12.5px] leading-[18px] text-fg-2 ring-1 ring-border transition-colors hover:bg-bg-subtle hover:text-fg"
            >
              {q.question}
            </button>
          ))}
        </div>
      )}

      {material.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {material.map((m) => (
            <li key={m.id} className="group flex gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-fg-3">
                  {intakeFor(m.kind)?.label ?? m.kind}
                  {m.permission === "anonymized_only" && " · don't name them"}
                  {m.uses > 0 && <span className="font-mono tnum"> · used {m.uses}×</span>}
                </p>
                <p className="mt-0.5 text-[13px] leading-[19px] text-fg">{m.text}</p>
                {m.source && <p className="mt-0.5 text-[11.5px] text-fg-3">{m.source}</p>}
              </div>
              <IconButton label="Remove" onClick={() => void dispatch({ type: "studio.material.remove", id: m.id })} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                <X className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddMaterial({
  kind,
  onKind,
  onSave,
  onCancel,
}: {
  kind: StudioMaterial["kind"];
  onKind: (k: StudioMaterial["kind"]) => void;
  onSave: (m: StudioMaterial) => void;
  onCancel: () => void;
}) {
  const q = intakeFor(kind) ?? INTAKE[0];
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [anon, setAnon] = useState(kind === "quote" || kind === "story");
  const needsSource = !!q.askSource;
  const ready = text.trim().length > 3 && (!needsSource || source.trim().length > 2);
  return (
    <div className="mt-3 space-y-2.5">
      <div className="flex flex-wrap gap-1">
        {INTAKE.map((x) => (
          <button
            key={x.kind}
            onClick={() => onKind(x.kind)}
            className={cn("h-6 rounded-xs px-2 text-[11.5px] ring-1 transition-colors", x.kind === kind ? "bg-bg-subtle text-fg ring-border-strong" : "text-fg-3 ring-border hover:text-fg-2")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div>
        <Label htmlFor="studio-mat-text">{q.question}</Label>
        <Textarea id="studio-mat-text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={q.placeholder} className="text-[13px]" />
      </div>
      {needsSource && (
        <div>
          <Label htmlFor="studio-mat-source" hint="Needed to say it in public">
            Source
          </Label>
          <Input id="studio-mat-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder={q.askSource} />
        </div>
      )}
      {(kind === "quote" || kind === "story") && (
        <label className="flex items-center gap-2 text-[12px] text-fg-2">
          <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} className="accent-[var(--accent)]" />
          Don&apos;t name the person or company
        </label>
      )}
      <div className="flex items-center justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Tooltip content={!ready && needsSource && text.trim() ? "Add where it comes from first." : undefined}>
          <span>
            <Button
              size="sm"
              variant="primary"
              disabled={!ready}
              onClick={() =>
                onSave({
                  id: newId("mat"),
                  kind,
                  text: text.trim(),
                  source: source.trim() || undefined,
                  permission: kind === "quote" || kind === "story" ? (anon ? "anonymized_only" : "public") : undefined,
                  createdAt: nowISO(),
                  uses: 0,
                })
              }
            >
              Save
            </Button>
          </span>
        </Tooltip>
      </div>
    </div>
  );
}
