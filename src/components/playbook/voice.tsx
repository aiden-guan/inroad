"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/misc";
import { cn } from "@/lib/client/cn";
import { newId, nowISO } from "@/lib/domain/ids";
import type { PovItem, VoiceTraits } from "@/lib/domain/types";
import { EXTRACT_EVERY_EDITS, extractVoice, traitLines } from "@/lib/quality/voice";
import { listItem } from "@/lib/motion";
import { usePlaybook } from "./context";
import { plural, words } from "./model";
import { povPrompts } from "./templates";
import { DraftLabel, Drafted, Editable, FieldLabel, RemoveButton, Section, Sub, TagList, WordCount, undoable } from "./ui";

const POV_MAX = 30;
const EVIDENCE_MAX = 20;

export function VoiceSection() {
  return (
    <Section id="voice" title="Voice" kicker={<p className="text-[13px] text-fg-3">How you sound, and what you believe that others don&apos;t.</p>}>
      <VoiceCardBlock />
      <LearnedTraits />
      <PovBank />
    </Section>
  );
}

/* ───────────────────────────── Voice card ───────────────────────────── */

function VoiceCardBlock() {
  const { ws, p, dispatch, set } = usePlaybook();
  const v = ws.voice;
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"email" | "post">("email");
  const [expanded, setExpanded] = useState<number | null>(null);
  const samples = v?.samples ?? [];
  const n = words(text);

  const add = () => {
    void dispatch({ type: "voice.addSample", text: text.trim(), kind, at: nowISO() });
    setText("");
    toast(samples.length >= 5 ? "Added. I keep your five most recent samples." : "Sample added.");
  };

  return (
    <Sub id="voice-card" title="How you write" hint="Drafts match your sentence length, greeting and sign-off. Anything that goes out under your name is set the way the recipient will see it.">
      <FieldLabel>In a sentence or two</FieldLabel>
      <Editable
        value={v?.summary ?? ""}
        label="voice summary"
        multiline
        placeholder="Short sentences? Contractions? How do you open and sign off?"
        onSave={(s) => void dispatch({ type: "voice.update", patch: { summary: s }, at: nowISO() })}
        allowEmpty
        className="font-serif text-[17px] leading-[27px] text-fg"
      />
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <FieldLabel>Sign-off</FieldLabel>
          <Editable value={v?.signOff ?? ""} label="sign-off" placeholder="— Priya" allowEmpty onSave={(s) => void dispatch({ type: "voice.update", patch: { signOff: s }, at: nowISO() })} className="text-[14px]" />
        </div>
        <div>
          <FieldLabel className="mb-1.5">Never write</FieldLabel>
          <TagList items={p.messaging.bannedWords} label="banned word" placeholder="Add a word" onChange={(x) => set(["messaging", "bannedWords"], x)} />
        </div>
      </div>

      <div className="mt-7">
        <div className="mb-2 flex items-baseline justify-between">
          <FieldLabel className="mb-0">Samples</FieldLabel>
          <span className="font-mono text-[11.5px] tnum text-fg-3">{samples.length} of 5</span>
        </div>
        {samples.length > 0 && (
          <ul className="mb-3 space-y-2">
            {samples.map((s, i) => (
              <li key={`${i}-${s.text.slice(0, 16)}`} className="group/row rounded-md bg-surface px-3.5 py-3 ring-1 ring-border">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <Badge tone="outline">{s.kind === "email" ? "Email" : "Post"}</Badge>
                  <RemoveButton
                    label="Remove sample"
                    onClick={() => {
                      void dispatch({ type: "voice.removeSample", index: i, at: nowISO() });
                      undoable("Sample removed", () => void dispatch({ type: "voice.addSample", text: s.text, kind: s.kind, at: nowISO() }));
                    }}
                  />
                </div>
                <button type="button" onClick={() => setExpanded((x) => (x === i ? null : i))} className="block w-full text-left" aria-expanded={expanded === i}>
                  <p className={cn("whitespace-pre-wrap text-[14px] leading-[22px] text-fg", expanded !== i && "line-clamp-4")}>{s.text}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-md bg-surface p-3 ring-1 ring-border">
          <Textarea
            aria-label="Paste a sample"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={samples.length ? "Paste another email or post you wrote" : "Paste an email you wrote that got a reply. Your words, not a template."}
            className="min-h-20 bg-transparent text-[14px] leading-[22px] ring-0 hover:ring-0 focus-visible:ring-0"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <Segmented
              value={kind}
              onChange={setKind}
              layoutId="voice-kind"
              options={[
                { value: "email", label: "Email" },
                { value: "post", label: "Post" },
              ]}
            />
            <Button size="sm" disabled={n < 15} onClick={add}>
              {n > 0 && n < 15 ? `${15 - n} more words` : "Add sample"}
            </Button>
          </div>
        </div>
      </div>
    </Sub>
  );
}

/* ───────────────────────────── What I've learned ───────────────────────────── */

const GREETINGS: { value: NonNullable<VoiceTraits["greeting"]>; label: string }[] = [
  { value: "none", label: "None" },
  { value: "first_name", label: "Dana," },
  { value: "hi_first_name", label: "Hi Dana," },
  { value: "hey_first_name", label: "Hey Dana," },
];
const SUBJECTS: { value: NonNullable<VoiceTraits["subjectStyle"]>; label: string }[] = [
  { value: "lowercase", label: "lowercase" },
  { value: "sentence", label: "Sentence" },
  { value: "title", label: "Title Case" },
];

function withoutMeta(s: NonNullable<NonNullable<ReturnType<typeof usePlaybook>["ws"]["voice"]>["suggested"]>): VoiceTraits {
  const t: VoiceTraits & { at?: string; basis?: string } = { ...s };
  delete t.at;
  delete t.basis;
  return t;
}

function Trait({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <FieldLabel className="mb-1.5">{label}</FieldLabel>
      {children}
    </div>
  );
}

/**
 * Traits read in code from the founder's samples, edited drafts and "tone off" skips (SPEC §6 VoiceCard). A re-read
 * lands as a suggestion; drafts follow only what the founder keeps here.
 */
function LearnedTraits() {
  const { ws, dispatch } = usePlaybook();
  const v = ws.voice;
  const traits = v?.traits ?? {};
  const suggested = v?.suggested;
  const edits = v?.edits?.length ?? 0;
  const material = (v?.samples.length ?? 0) + edits > 0;
  const set = (patch: Partial<VoiceTraits>) => void dispatch({ type: "voice.setTraits", traits: { ...traits, ...patch }, at: nowISO() });

  return (
    <Sub
      id="voice-traits"
      title="What I've learned"
      hint="Read from your samples, the drafts you edit before sending and the ones you skip as tone off. Drafts follow what you keep here."
    >
      <AnimatePresence initial={false}>
        {suggested && (
          <motion.div
            key={suggested.at}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            className="mb-5 rounded-md bg-surface p-3.5 ring-1 ring-border"
          >
            <Drafted draft className="pl-3">
              <p className="text-[13px] font-medium text-fg">
                <DraftLabel /> · from {suggested.basis}
              </p>
              <ul className="mt-1.5 space-y-0.5 text-[13.5px] leading-[21px] text-fg-2">
                {traitLines(withoutMeta(suggested), "you").map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    void dispatch({ type: "voice.setTraits", traits: withoutMeta(suggested), at: nowISO() });
                    toast(suggested.signOff ? `Kept. Drafts follow these from now on, signed “${suggested.signOff}”.` : "Kept. Drafts follow these from now on.");
                  }}
                >
                  Use these
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void dispatch({ type: "voice.dismissSuggestion", at: nowISO() })}>
                  Not now
                </Button>
              </div>
            </Drafted>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Trait label="Greeting">
          <Segmented value={traits.greeting ?? ("" as NonNullable<VoiceTraits["greeting"]>)} onChange={(greeting) => set({ greeting })} layoutId="voice-greeting" options={GREETINGS} className="max-w-full overflow-x-auto" />
        </Trait>
        <Trait label="Subject lines">
          <Segmented value={traits.subjectStyle ?? ("" as NonNullable<VoiceTraits["subjectStyle"]>)} onChange={(subjectStyle) => set({ subjectStyle })} layoutId="voice-subject" options={SUBJECTS} />
        </Trait>
        <Trait label="Contractions">
          <Segmented
            value={traits.contractions === undefined ? "" : traits.contractions ? "yes" : "no"}
            onChange={(c) => set({ contractions: c === "yes" })}
            layoutId="voice-contractions"
            options={[
              { value: "yes", label: "It's, we're" },
              { value: "no", label: "It is, we are" },
            ]}
          />
        </Trait>
        <Trait label="Formality">
          <Segmented
            value={traits.formality ? String(traits.formality) : ""}
            onChange={(f) => set({ formality: Number(f) as VoiceTraits["formality"] })}
            layoutId="voice-formality"
            options={["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n }))}
          />
        </Trait>
        <Trait label="Words you use" wide>
          <TagList items={traits.usesWords ?? []} label="word you use" placeholder="Add a word" onChange={(usesWords) => set({ usesWords })} />
        </Trait>
        <Trait label="Words you cut from drafts" wide>
          <TagList items={traits.avoidsWords ?? []} label="word you cut" placeholder="Add a word" onChange={(avoidsWords) => set({ avoidsWords })} />
        </Trait>
        <Trait label="Habits" wide>
          <TagList items={traits.punctuationHabits ?? []} label="habit" placeholder="Add one, like “No exclamation marks”" onChange={(punctuationHabits) => set({ punctuationHabits })} />
        </Trait>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11.5px] tnum text-fg-3">
          {traits.avgSentenceWords ? `~${traits.avgSentenceWords} words a sentence · ` : ""}
          {plural(edits, "edit")} kept · re-read every {EXTRACT_EVERY_EDITS} edits and every 3rd sample
        </p>
        <Button
          size="xs"
          variant="secondary"
          disabled={!material}
          onClick={() => {
            const at = nowISO();
            const next = structuredClone(v!);
            extractVoice(next, at);
            void dispatch({ type: "voice.extract", at });
            if (!next.suggested) toast("Nothing new since you last kept them.");
          }}
        >
          Re-read now
        </Button>
      </div>
    </Sub>
  );
}

/* ───────────────────────────── POV bank ───────────────────────────── */

function PovBank() {
  const { ws, dispatch } = usePlaybook();
  const [text, setText] = useState("");
  const [evidence, setEvidence] = useState("");
  const [prompt, setPrompt] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const prompts = povPrompts(ws);
  const tw = words(text);
  const ew = words(evidence);
  const valid = tw >= 4 && tw <= POV_MAX && ew >= 2 && ew <= EVIDENCE_MAX;

  // Opinions the founder stated on calls, offered once until added.
  const known = new Set(ws.povs.map((p) => p.text.trim().toLowerCase()));
  const suggestions = Object.values(ws.meetings)
    .flatMap((m) => (m.debrief?.povCandidates ?? []).map((c) => ({ ...c, deal: ws.deals[m.dealId]?.name, meetingId: m.id })))
    .filter((c) => !known.has(c.text.trim().toLowerCase()))
    .slice(0, 3);

  const add = (pov: Pick<PovItem, "text" | "evidence">) => {
    void dispatch({ type: "pov.upsert", pov: { id: newId("pov"), text: pov.text, evidence: pov.evidence, createdAt: nowISO(), uses: 0 } });
  };

  return (
    <Sub
      id="povs"
      title="Points of view"
      hint="Every cold email rests on one opinion only you could hold, with one line of evidence only you have. It's the part of outreach nobody else can copy."
      right={ws.povs.length > 0 && <span className="font-mono text-[12px] tnum text-fg-3">{ws.povs.length} in the bank</span>}
    >
      {ws.povs.length > 0 && (
        <ul className="mb-4 space-y-3">
          <AnimatePresence initial={false}>
            {ws.povs.map((pov, i) => (
              <motion.li
                key={pov.id}
                layout="position"
                variants={listItem}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                custom={i}
                className="group/row flex items-start gap-3 border-l border-border-strong pl-3.5"
              >
                <div className="min-w-0 flex-1">
                  <Editable value={pov.text} label="point of view" multiline maxWords={POV_MAX} onSave={(v) => void dispatch({ type: "pov.upsert", pov: { ...pov, text: v } })} className="text-[15px] font-medium leading-[23px] text-fg" />
                  <Editable value={pov.evidence} label="evidence" maxWords={EVIDENCE_MAX} onSave={(v) => void dispatch({ type: "pov.upsert", pov: { ...pov, evidence: v } })} className="mt-0.5 text-[13px] leading-5 text-fg-3" />
                  <p className="mt-1 font-mono text-[11px] tnum text-fg-3">{pov.uses ? `used in ${plural(pov.uses, "draft")}` : "not used yet"}</p>
                </div>
                <RemoveButton
                  label="Remove point of view"
                  onClick={() => {
                    void dispatch({ type: "pov.remove", id: pov.id });
                    undoable("Point of view removed", () => void dispatch({ type: "pov.upsert", pov }));
                  }}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {suggestions.length > 0 && (
        <div className="mb-4 space-y-2">
          <FieldLabel>You said this on a call</FieldLabel>
          {suggestions.map((s) => (
            <Drafted key={`${s.meetingId}-${s.text}`} draft className="rounded-r-md bg-surface py-2.5 pr-3 ring-1 ring-border">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[14px] leading-[21px]">{s.text}</p>
                  <p className="mt-0.5 text-[12.5px] text-fg-3">
                    <DraftLabel /> · {s.basis}
                    {s.deal ? ` · ${s.deal}` : ""}
                  </p>
                </div>
                <Button size="xs" onClick={() => add({ text: s.text, evidence: s.basis })}>
                  Add to the bank
                </Button>
              </div>
            </Drafted>
          ))}
        </div>
      )}

      <div className="rounded-lg bg-surface p-4 ring-1 ring-border">
        <label htmlFor="pov-text" className="mb-1.5 block text-[12px] font-medium text-fg-2">
          {prompt ?? "What do you believe that most people selling to your buyer would disagree with?"}
        </label>
        <Textarea
          id="pov-text"
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nobody budgets for reconciliation until an auditor finds the gap."
          className="min-h-14 text-[14px] leading-[21px]"
        />
        <div className="mt-1 flex justify-end">
          <WordCount n={tw} max={POV_MAX} />
        </div>
        <label htmlFor="pov-evidence" className="mb-1.5 mt-1 block text-[12px] font-medium text-fg-2">
          Why you can say it
        </label>
        <Input id="pov-evidence" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="From 14 calls with controllers, Aug–Oct" className="text-[13.5px]" />
        <div className="mt-1 flex justify-end">
          <WordCount n={ew} max={EVIDENCE_MAX} />
        </div>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-[12px] text-fg-3">Stuck? Answer one of these instead:</p>
            <div className="flex flex-wrap gap-1.5">
              {prompts.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setPrompt(q);
                    area.current?.focus();
                  }}
                  className={cn(
                    "max-w-full rounded-xs px-2 py-1 text-left text-[12px] leading-4 ring-1 ring-inset transition-colors duration-150",
                    prompt === q ? "bg-bg-subtle text-fg ring-border-strong" : "text-fg-2 ring-border hover:bg-bg-subtle hover:text-fg",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={!valid}
            onClick={() => {
              add({ text: text.trim(), evidence: evidence.trim() });
              setText("");
              setEvidence("");
              setPrompt(null);
              toast("Added. Cold drafts can lead with it now.");
            }}
          >
            Add to the bank
          </Button>
        </div>
      </div>
    </Sub>
  );
}
