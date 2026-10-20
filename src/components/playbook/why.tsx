"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/client/cn";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Claim, Competitor, Positioning, ValueTheme } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { usePlaybook } from "./context";
import { ALT_KIND_LABELS, CATEGORY_STYLES, ROLE_LABELS, SIGNAL_LABELS, plural, provenance, themeNeedsProof, words } from "./model";
import { AddRow, Choice, Cite, DraftLabel, Drafted, Editable, FieldLabel, RemoveButton, Section, Stamp, StringList, Sub, TagList, WordCount, undoable } from "./ui";

const CLAIM_KINDS: Record<Claim["kind"], string> = {
  capability: "Capability",
  metric: "Metric",
  customer: "Customer",
  logo: "Logo",
  credential: "Credential",
  security: "Security",
};

/** Words that make buyers skim. Mirrors the outbound lint so the one-liner is held to the same bar. */
const HYPE =
  /\b(ai-powered|leverag\w*|seamless(ly)?|unlock\w*|empower\w*|streamlin\w*|robust|best-in-class|world-class|cutting-edge|game-?changer|revolutioni[sz]\w*|supercharg\w*|transformative|innovative|next level|synerg\w*|solutions?)\b/i;

export function WhySection() {
  const { ws } = usePlaybook();
  const prov = provenance(ws, "why");
  return (
    <Section id="why" title="Why us" kicker={<Stamp label={prov.label} isBet={prov.isBet} />}>
      <PositioningBlock />
      <Messaging />
      <Claims />
      <Competitors />
    </Section>
  );
}

/* ───────────────────────────── Positioning ───────────────────────────── */

function PositioningBlock() {
  const { p, set } = usePlaybook();
  const pos = p.positioning;
  const alts = pos.alternatives;
  const diffs = pos.differentiators;
  const style = CATEGORY_STYLES[pos.category.style] ?? CATEGORY_STYLES.head_to_head;
  return (
    <Sub id="positioning" title="Positioning" hint="Decided in order: what buyers do without you, what only you have, the value it creates, who cares most, then the category that makes it obvious.">
      <div className="rounded-lg bg-surface p-4 ring-1 ring-border sm:p-5">
        <FieldLabel>Category</FieldLabel>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <Editable value={pos.category.name} label="category" onSave={(v) => set(["positioning", "category", "name"], v)} className="font-serif text-[20px] leading-[28px] text-fg" />
          </div>
          <Choice
            label="Category style"
            value={pos.category.style}
            options={{ head_to_head: CATEGORY_STYLES.head_to_head.label, big_fish_small_pond: CATEGORY_STYLES.big_fish_small_pond.label, new_game: CATEGORY_STYLES.new_game.label }}
            onChange={(v) => set(["positioning", "category", "style"], v)}
          />
        </div>
        <p className="mt-0.5 text-[12.5px] text-fg-3">{style.hint}</p>
        <div className="mt-3">
          <Editable value={pos.category.why} label="why this category" multiline placeholder="Why this frame makes the value obvious" onSave={(v) => set(["positioning", "category", "why"], v)} className="text-[14px] leading-[21px] text-fg-2" />
        </div>
      </div>

      <div className="mt-8">
        <FieldLabel className="mb-2">What buyers do without you</FieldLabel>
        <ul className="divide-y divide-border border-y border-border">
          {alts.map((a, i) => (
            <li key={`${i}-${a.name}`} className="group/row flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Editable inline value={a.name} label="alternative" onSave={(v) => set(["positioning", "alternatives", i, "name"], v)} className="text-[14px] font-medium" />
                  <Choice label="Kind" value={a.kind} options={ALT_KIND_LABELS} onChange={(v) => set(["positioning", "alternatives", i, "kind"], v)} />
                </div>
                <Editable
                  value={a.whyChosenToday}
                  label="why buyers choose it today"
                  placeholder="Why buyers choose it today"
                  multiline
                  onSave={(v) => set(["positioning", "alternatives", i, "whyChosenToday"], v)}
                  className="mt-1 text-[13px] leading-5 text-fg-2"
                />
              </div>
              <RemoveButton
                label="Remove alternative"
                onClick={() => {
                  set(["positioning", "alternatives"], alts.filter((_, j) => j !== i));
                  undoable("Alternative removed", () => set(["positioning", "alternatives"], alts));
                }}
              />
            </li>
          ))}
        </ul>
        <AddRow
          label="Add an alternative"
          className="mt-2"
          onAdd={(name) => set(["positioning", "alternatives"], [...alts, { name, kind: "competitor", whyChosenToday: "" } satisfies Positioning["alternatives"][number]])}
        />
        {!alts.some((a) => a.kind === "status_quo") && alts.length > 0 && (
          <p className="mt-2 text-[12.5px] text-warning">The status quo is missing. Spreadsheets, doing nothing or a manual process is usually the real competitor.</p>
        )}
      </div>

      <div className="mt-8">
        <FieldLabel className="mb-2">What only you have</FieldLabel>
        <ul className="space-y-3">
          {diffs.map((d, i) => (
            <li key={`${i}-${d.capability.slice(0, 10)}`} className="group/row flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Editable value={d.capability} label="differentiator" onSave={(v) => set(["positioning", "differentiators", i, "capability"], v)} className="text-[14px] leading-[21px]" />
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-fg-3">
                  <span>vs</span>
                  <Editable inline value={d.vsAlternative} label="the alternative" onSave={(v) => set(["positioning", "differentiators", i, "vsAlternative"], v)} className="text-[12.5px] text-fg-2" />
                  <span aria-hidden>·</span>
                  <Choice
                    label="Proof status"
                    value={d.status}
                    options={{ claimed: "Claimed", proven: "Proven by a customer" }}
                    onChange={(v) => set(["positioning", "differentiators", i, "status"], v)}
                    className={cn(d.status === "proven" && "text-fg")}
                  />
                </div>
              </div>
              <RemoveButton
                label="Remove differentiator"
                onClick={() => {
                  set(["positioning", "differentiators"], diffs.filter((_, j) => j !== i));
                  undoable("Differentiator removed", () => set(["positioning", "differentiators"], diffs));
                }}
              />
            </li>
          ))}
        </ul>
        <AddRow
          label="Add a differentiator"
          className="mt-2"
          onAdd={(capability) => set(["positioning", "differentiators"], [...diffs, { capability, vsAlternative: alts[0]?.name ?? "", status: "claimed" }])}
        />
        <p className="mt-2 text-[12.5px] text-fg-3">Claimed until a customer proves it. Positioning can&apos;t rescue a product that isn&apos;t different; if this list is thin, say so to yourself first.</p>
      </div>

      <div className="mt-8">
        <FieldLabel className="mb-2">Value themes</FieldLabel>
        <div className="space-y-3">
          {pos.valueThemes.map((t, i) => (
            <ValueThemeCard key={t.id} theme={t} index={i} />
          ))}
          {pos.valueThemes.length === 0 && <p className="text-[13px] text-fg-3">No value themes yet.</p>}
        </div>
      </div>

      <div className="mt-8">
        <FieldLabel>Best-fit customers</FieldLabel>
        <p className="mb-2 text-[12.5px] text-fg-3">Who understood you fastest, bought fastest and got the most out of it. Not the average customer.</p>
        <StringList items={pos.bestFit} label="best-fit trait" addLabel="Add a trait" onChange={(v) => set(["positioning", "bestFit"], v)} />
      </div>
    </Sub>
  );
}

function ValueThemeCard({ theme, index }: { theme: ValueTheme; index: number }) {
  const { ws, set } = usePlaybook();
  const path = ["positioning", "valueThemes", index] as const;
  const approved = ws.claims.filter((c) => c.approved);
  const linked = new Set(theme.proof.map((x) => x.claimId).filter(Boolean));
  const addProof = (c: Claim) => {
    set([...path], { ...theme, proof: [...theme.proof, { text: c.text, claimId: c.id }], needsProof: false });
  };
  return (
    <div className="relative rounded-lg bg-surface p-4 ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <Editable value={theme.theme} label="value theme" onSave={(v) => set([...path, "theme"], v)} className="text-[15px] font-semibold leading-[22px]" />
        </div>
        {themeNeedsProof(ws, theme) && <Badge tone="warning">Needs proof · never claimed in outreach</Badge>}
      </div>
      <Editable value={theme.outcome} label="outcome" multiline onSave={(v) => set([...path, "outcome"], v)} className="mt-1 font-serif text-[16px] leading-[25px] text-fg-2" />
      <div className="mt-3 border-t border-border pt-3">
        {theme.proof.length > 0 && (
          <ul className="space-y-1.5">
            {theme.proof.map((pr, j) => {
              const claim = pr.claimId ? ws.claims.find((c) => c.id === pr.claimId) : undefined;
              return (
                <li key={j} className="group/row relative flex items-start gap-2 text-[13px] leading-5 text-fg-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-fg-3" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {claim?.text ?? pr.text}
                    {claim && !claim.approved && <span className="ml-1.5 text-[11.5px] text-warning">claim not approved yet</span>}
                    {pr.claimId && !claim && <span className="ml-1.5 text-[11.5px] text-warning">claim removed</span>}
                    {pr.evidenceId && <Cite ids={[pr.evidenceId]} />}
                  </span>
                  <RemoveButton
                    label="Remove proof"
                    onClick={() => {
                      const proof = theme.proof.filter((_, k) => k !== j);
                      set([...path], { ...theme, proof, needsProof: proof.length === 0 });
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {approved.some((c) => !linked.has(c.id)) ? (
          <Menu
            align="start"
            trigger={
              <button type="button" className="mt-1.5 inline-flex h-7 items-center gap-1.5 text-[12.5px] text-fg-3 transition-colors hover:text-fg">
                <Plus className="size-3.5" />
                Prove it with an approved claim
              </button>
            }
          >
            <MenuLabel>Approved claims</MenuLabel>
            {approved
              .filter((c) => !linked.has(c.id))
              .map((c) => (
                <MenuItem key={c.id} onSelect={() => addProof(c)}>
                  <span className="line-clamp-2 max-w-72">{c.text}</span>
                </MenuItem>
              ))}
          </Menu>
        ) : (
          theme.proof.length === 0 && <p className="text-[12.5px] text-fg-3">No proof yet. Approve a claim below to use it here.</p>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Messaging ───────────────────────────── */

function Messaging() {
  const { p, set } = usePlaybook();
  const m = p.messaging;
  const hype = m.oneLiner.match(HYPE)?.[0];
  const n = words(m.oneLiner);
  return (
    <Sub id="messaging" title="Messaging" hint="The one-liner goes out under your name, so it's set the way buyers will read it.">
      <FieldLabel>One-liner</FieldLabel>
      <Editable value={m.oneLiner} label="one-liner" multiline maxWords={25} onSave={(v) => set(["messaging", "oneLiner"], v)} className="text-[16px] font-medium leading-[24px] text-fg" />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <WordCount n={n} max={25} />
        {hype && <span className="text-[12.5px] text-warning">“{hype}” reads as hype. Buyers skim past it.</span>}
      </div>
      <p className="mt-1 text-[12.5px] text-fg-3">Shape: {"{Product}"} is a {"{category}"} that helps {"{best-fit customer}"} {"{outcome}"} without {"{the pain of today's alternative}"}.</p>

      {m.themes.length > 0 && (
        <div className="mt-7">
          <FieldLabel className="mb-2">Headlines, each against one alternative</FieldLabel>
          <ul className="space-y-2.5">
            {m.themes.map((t, i) => (
              <li key={`${t.valueThemeId}-${i}`}>
                <Editable value={t.headline} label="headline" onSave={(v) => set(["messaging", "themes", i, "headline"], v)} className="text-[14px] font-medium" />
                <p className="flex flex-wrap items-baseline gap-1 text-[12.5px] text-fg-3">
                  vs <Editable inline value={t.vsAlternative} label="alternative" onSave={(v) => set(["messaging", "themes", i, "vsAlternative"], v)} className="text-[12.5px] text-fg-2" />
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.byPersona.length > 0 && (
        <div className="mt-7">
          <FieldLabel className="mb-2">By persona</FieldLabel>
          <ul className="space-y-2.5">
            {m.byPersona.map((b, i) => {
              const persona = p.personas.find((x) => x.id === b.personaId);
              return (
                <li key={b.personaId} className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-4">
                  <span className="pt-px text-[13px] font-medium text-fg-2">{persona ? ROLE_LABELS[persona.role] : "Persona"}</span>
                  <Editable value={b.line} label="persona line" multiline onSave={(v) => set(["messaging", "byPersona", i, "line"], v)} className="text-[14px] leading-[21px]" />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {m.bySignal.length > 0 && (
        <div className="mt-7">
          <FieldLabel className="mb-2">By signal</FieldLabel>
          <ul className="space-y-2.5">
            {m.bySignal.map((b, i) => (
              <li key={`${b.signal}-${i}`} className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-4">
                <span className="pt-px text-[13px] font-medium text-fg-2">{SIGNAL_LABELS[b.signal] ?? b.signal}</span>
                <Editable value={b.implication} label="what it implies" multiline onSave={(v) => set(["messaging", "bySignal", i, "implication"], v)} className="text-[14px] leading-[21px]" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-7">
        <FieldLabel>Their words</FieldLabel>
        <p className="mb-2 text-[12.5px] text-fg-3">Phrases buyers actually use. Drafts borrow these instead of your vocabulary.</p>
        <TagList
          items={m.customerWords.map((w) => w.phrase)}
          label="phrase"
          placeholder="Add a phrase you heard"
          onChange={(phrases) =>
            set(
              ["messaging", "customerWords"],
              phrases.map((phrase) => m.customerWords.find((w) => w.phrase === phrase) ?? { phrase, source: "founder" as const }),
            )
          }
        />
      </div>
    </Sub>
  );
}

/* ───────────────────────────── Claims ───────────────────────────── */

function Claims() {
  const { ws, dispatch } = usePlaybook();
  const claims = [...ws.claims].sort((a, b) => Number(a.approved) - Number(b.approved));
  const drafts = claims.filter((c) => !c.approved).length;
  const proof = (ws.company?.proof ?? []).filter((pr) => !ws.claims.some((c) => c.text.trim().toLowerCase() === pr.text.trim().toLowerCase()));
  const company = ws.company?.name ?? "you";

  const approveAll = () => {
    const ids = claims.filter((c) => !c.approved);
    void dispatch(ids.map((c) => ({ type: "claim.upsert" as const, claim: { ...c, approved: true } })));
    toast(`Approved ${plural(ids.length, "claim")}. Outreach can use ${ids.length === 1 ? "it" : "them"} now.`);
  };

  return (
    <Sub
      id="claims"
      title="Claims"
      hint={`Facts about ${company} that outreach may state. Drafts stay here; only approved claims appear in emails, one-pagers and proposals.`}
      right={
        drafts > 1 && (
          <Button size="sm" variant="ghost" onClick={approveAll}>
            Approve all {drafts}
          </Button>
        )
      }
    >
      {claims.length === 0 && proof.length === 0 && (
        <p className="mb-2 text-[13px] leading-5 text-fg-3">No claims yet. Add the facts you&apos;d stand behind on a call: a metric, a customer you can name, a credential.</p>
      )}
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {claims.map((c, i) => (
            <motion.li key={c.id} layout="position" variants={listItem} initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.1 } }} custom={i} className="group/row relative">
              <ClaimRow claim={c} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <AddRow
        label="Add a claim"
        placeholder="A fact you'd stand behind on a call"
        className="mt-2"
        onAdd={(text) => {
          void dispatch({ type: "claim.upsert", claim: { id: newId("cl"), text, kind: "capability", evidenceIds: [], approved: true, permission: "public", createdAt: nowISO() } });
          toast("Added and approved. Outreach can use it now.");
        }}
      />

      {proof.length > 0 && (
        <div className="mt-6">
          <FieldLabel className="mb-2">On your site, not a claim yet</FieldLabel>
          <ul className="space-y-2">
            {proof.map((pr) => (
              <li key={pr.text} className="relative flex items-start justify-between gap-3 rounded-md bg-bg-subtle px-3 py-2.5 ring-1 ring-border">
                <span className="min-w-0 flex-1 text-[13.5px] leading-5 text-fg-2">
                  {pr.text}
                  {pr.evidenceId && <Cite ids={[pr.evidenceId]} />}
                </span>
                <Button
                  size="xs"
                  onClick={() =>
                    void dispatch({
                      type: "claim.upsert",
                      claim: { id: newId("cl"), text: pr.text, kind: pr.kind === "metric" ? "metric" : pr.kind === "founder_credential" ? "credential" : pr.kind === "logo" ? "logo" : "customer", evidenceIds: pr.evidenceId ? [pr.evidenceId] : [], approved: true, permission: "public", createdAt: nowISO() },
                    })
                  }
                >
                  Use as claim
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Sub>
  );
}

function ClaimRow({ claim }: { claim: Claim }) {
  const { dispatch } = usePlaybook();
  const upsert = (patch: Partial<Claim>) => void dispatch({ type: "claim.upsert", claim: { ...claim, ...patch } });
  return (
    <Drafted draft={!claim.approved} className="py-1.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Editable value={claim.text} label="claim" multiline onSave={(v) => upsert({ text: v })} className="text-[14px] leading-[22px]" />
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
            {!claim.approved && <DraftLabel />}
            <Choice label="Claim kind" value={claim.kind} options={CLAIM_KINDS} onChange={(v) => upsert({ kind: v })} />
            <Choice label="Permission" value={claim.permission} options={{ public: "Can name them", anonymized_only: "Anonymized only" }} onChange={(v) => upsert({ permission: v })} />
            {claim.evidenceIds.length === 0 && !claim.approved && <span>No source. Approve only if you can back it up.</span>}
          </div>
          <Cite ids={claim.evidenceIds} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {claim.approved ? (
            <span className="inline-flex h-6 items-center gap-1 text-[12px] text-fg-3">
              <Check className="size-3.5" aria-hidden /> In use
            </span>
          ) : (
            <Button size="xs" variant="primary" onClick={() => upsert({ approved: true })}>
              Approve
            </Button>
          )}
          <Menu
            trigger={
              <button type="button" aria-label="More for this claim" className="inline-flex size-6 items-center justify-center rounded-xs text-fg-3 transition-colors hover:bg-bg-subtle hover:text-fg">
                <MoreHorizontal className="size-4" />
              </button>
            }
          >
            {claim.approved && <MenuItem onSelect={() => upsert({ approved: false })}>Stop using in outreach</MenuItem>}
            {claim.approved && <MenuSeparator />}
            <MenuItem
              danger
              onSelect={() => {
                void dispatch({ type: "claim.remove", id: claim.id });
                undoable("Claim removed", () => void dispatch({ type: "claim.upsert", claim }));
              }}
            >
              Remove
            </MenuItem>
          </Menu>
        </div>
      </div>
    </Drafted>
  );
}

/* ───────────────────────────── Competitors ───────────────────────────── */

function Competitors() {
  const { p, set } = usePlaybook();
  const list = p.competitors;
  const save = (next: Competitor[]) => set(["competitors"], next);
  return (
    <Sub id="competitors" title="Competitors" hint="Never knock them. Know when you win, when you lose, and the questions that surface the gap.">
      <div className="space-y-3">
        {list.map((c, i) => (
          <article key={`${c.name}-${i}`} className="group/card rounded-lg bg-surface p-4 ring-1 ring-border">
            <header className="flex items-center gap-2.5">
              {c.domain && <Favicon domain={c.domain} name={c.name} size={18} />}
              <div className="min-w-0 flex-1">
                <Editable value={c.name} label="competitor name" onSave={(v) => set(["competitors", i, "name"], v)} className="text-[15px] font-semibold" />
              </div>
              {c.domain && <span className="hidden font-mono text-[12px] text-fg-3 sm:inline">{c.domain}</span>}
              <RemoveButton
                className="group-hover/card:opacity-100"
                label={`Remove ${c.name}`}
                onClick={() => {
                  save(list.filter((_, j) => j !== i));
                  undoable(`${c.name} removed`, () => save(list));
                }}
              />
            </header>
            {c.positioningQuote && <p className="mt-2 font-serif text-[15px] italic leading-[23px] text-fg-2">“{c.positioningQuote}”</p>}
            <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <FieldLabel>We win when</FieldLabel>
                <Editable value={c.whenWeWin} label="when we win" multiline onSave={(v) => set(["competitors", i, "whenWeWin"], v)} className="text-[13.5px] leading-5" />
              </div>
              <div>
                <FieldLabel>We lose when</FieldLabel>
                <Editable value={c.whenWeLose} label="when we lose" multiline onSave={(v) => set(["competitors", i, "whenWeLose"], v)} className="text-[13.5px] leading-5" />
              </div>
            </div>
            <div className="mt-3">
              <FieldLabel>Questions that surface the gap</FieldLabel>
              <StringList items={c.landmineQuestions} label="question" addLabel="Add a question" onChange={(v) => set(["competitors", i, "landmineQuestions"], v)} itemClassName="text-[13.5px]" />
            </div>
          </article>
        ))}
      </div>
      <AddRow label="Add a competitor" className="mt-2" onAdd={(name) => save([...list, { name, whenWeWin: "", whenWeLose: "", landmineQuestions: [] }])} />
    </Sub>
  );
}
