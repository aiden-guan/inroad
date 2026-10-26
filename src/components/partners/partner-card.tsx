"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { RunInline } from "@/components/today/parts";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { CopyButton } from "@/components/ui/misc";
import { SourceChip } from "@/components/ui/source";
import { cn } from "@/lib/client/cn";
import { CREATOR_OUTREACH } from "@/lib/consumer/benchmarks";
import { PARTNER_KIND_LABELS, PARTNER_STAGE_LABELS, PLATFORM_LABELS, partnerNext, partnerResults } from "@/lib/consumer/partners";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Partner, PartnerOffer, PartnerStage } from "@/lib/domain/types";
import { lintDraft, mergeLint, worstIssue } from "@/lib/quality/lint";
import { spring } from "@/lib/motion";

const OFFER_LABELS: Record<PartnerOffer, string> = {
  gifted: "Gifted product",
  flat_fee: "Flat fee",
  affiliate: "Commission",
  hybrid: "Fee + commission",
  free_access: "Free access",
  collab: "Collab, no payment",
};

/** Stages the founder moves by hand. Sending is marked from the draft; nothing moves on its own. */
const NEXT_STAGES: Partial<Record<PartnerStage, PartnerStage[]>> = {
  shortlist: ["passed"],
  contacted: ["replied", "passed"],
  replied: ["agreed", "passed"],
  agreed: ["live", "passed"],
  live: ["done"],
};

const STAGE_VERB: Record<PartnerStage, string> = {
  shortlist: "Back to shortlist",
  contacted: "Contacted",
  replied: "They replied",
  agreed: "They agreed",
  live: "It's live",
  done: "Done",
  passed: "Pass",
};

function relint(p: Partner, body: string, followUp: string, subject: string | null) {
  const kind = p.outreach?.channel === "email" ? "partner_email" : "partner_dm";
  const first = lintDraft({ subject, body, frame: "founder_card", step: 1, kind, knownNames: [p.name, p.handle ?? ""] });
  const follow = lintDraft({ subject: null, body: followUp, frame: "founder_card", step: 2, kind: "partner_dm", knownNames: [p.name] });
  return mergeLint([first, { ...follow, violations: follow.violations.filter((v) => v.code !== "LEN_UNDER" && v.code !== "OFFER_MISSING") }]);
}

export function PartnerCard({ p, today, focused }: { p: Partner; today: string; focused?: boolean }) {
  const { dispatch } = useWorkspace();
  const [open, setOpen] = useState(!!focused);
  const next = partnerNext(p, today);
  const at = () => nowISO();
  const results = partnerResults(p);
  const paidOrGifted = !!p.offer && p.offer.type !== "collab";

  return (
    <article id={`partner-${p.id}`} className={cn("rounded-lg bg-surface ring-1 ring-border", focused && "ring-2 ring-[var(--ring)]")}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3.5 text-left sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[14.5px] font-medium text-fg">{p.name}</span>
            <span className="font-mono text-[11.5px] text-fg-3">{[PARTNER_KIND_LABELS[p.kind], p.platform ? PLATFORM_LABELS[p.platform] : null, p.handle].filter(Boolean).join(" · ")}</span>
          </p>
          <p className="mt-0.5 line-clamp-2 text-pretty text-[13px] leading-5 text-fg-2">{p.fit}</p>
          <p className={cn("mt-1 text-[12.5px]", next.action ? "font-medium text-fg" : "text-fg-3")}>
            {PARTNER_STAGE_LABELS[p.stage]} · {next.line}
          </p>
        </div>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-fg-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />
      </button>

      <motion.div initial={false} animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }} transition={spring.smooth} className="overflow-hidden" aria-hidden={!open}>
        {open && (
          <div className="space-y-5 border-t border-border px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-fg-3">
              {p.url && (
                <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg-2 hover:text-fg hover:underline">
                  Open their page <ExternalLink className="size-3" />
                </a>
              )}
              {p.sourceUrl && <SourceChip url={p.sourceUrl} claim={p.fit} />}
              {p.audience && <span>Audience: {p.audience}</span>}
              {p.followers !== undefined && <span className="font-mono">{p.followers.toLocaleString("en-US")} followers</span>}
            </div>

            <OfferEditor p={p} />
            <Outreach p={p} today={today} />

            {p.stage === "agreed" && p.kind === "creator" && (
              <div className="rounded-md bg-bg-subtle px-3 py-2.5 text-[13px] leading-5 text-fg-2">
                {p.briefAssetId ? (
                  <>
                    Brief written.{" "}
                    <Link href={`/playbook?asset=${encodeURIComponent(p.briefAssetId)}`} className="text-fg underline underline-offset-2">
                      Open it
                    </Link>
                  </>
                ) : (
                  <>
                    Send the brief before anything is made: what to make, the key points, and the #ad rule.{" "}
                    <Link href={`/playbook?new=creator_brief&partner=${encodeURIComponent(p.id)}#assets`} className="text-fg underline underline-offset-2">
                      Write the brief
                    </Link>
                  </>
                )}
              </div>
            )}

            {p.stage === "live" && paidOrGifted && p.kind === "creator" && (
              <div className={cn("rounded-md px-3 py-2.5 text-[13px] leading-5", p.disclosure === "confirmed" ? "bg-bg-subtle text-fg-2" : "bg-warning-subtle text-fg")}>
                {p.disclosure === "confirmed" ? (
                  "You confirmed the post says #ad."
                ) : (
                  <>
                    <p>Check the live post: &ldquo;#ad&rdquo; or &ldquo;Ad&rdquo; at the start of the caption, said or shown in the video. The brand is responsible for this, not only the creator.</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void dispatch({ type: "partner.update", id: p.id, patch: { disclosure: "confirmed" }, at: at() })}>
                        It does
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void dispatch({ type: "partner.update", id: p.id, patch: { disclosure: "missing" }, at: at() });
                          toast("Ask them to add “#ad” at the start of the caption today, before you share or boost it.");
                        }}
                      >
                        It doesn&apos;t
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {(p.stage === "live" || p.stage === "done") && <ResultsForm p={p} />}
            {results.signups + results.orders > 0 && (
              <p className="font-mono text-[12px] text-fg-3">
                {results.signups} signups · {results.orders} orders{results.costUsd ? ` · $${results.costUsd} spent` : ""}
                {results.costPer !== undefined ? ` · $${results.costPer.toFixed(2)} each` : ""}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              {(NEXT_STAGES[p.stage] ?? []).map((s) => (
                <Button key={s} size="sm" variant={s === "passed" ? "ghost" : "secondary"} onClick={() => void dispatch({ type: "partner.setStage", id: p.id, stage: s, at: at() })}>
                  {STAGE_VERB[s]}
                </Button>
              ))}
              <Button
                size="sm"
                variant="danger"
                className="ml-auto"
                onClick={() => {
                  const before = p;
                  void dispatch({ type: "partner.remove", id: p.id });
                  toast(`${p.name} removed.`, { action: { label: "Undo", onClick: () => void dispatch({ type: "partner.upsert", partner: before }) } });
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    </article>
  );
}

function OfferEditor({ p }: { p: Partner }) {
  const { dispatch } = useWorkspace();
  const [type, setType] = useState<PartnerOffer | "">(p.offer?.type ?? "");
  const [amount, setAmount] = useState(p.offer?.amountUsd ? String(p.offer.amountUsd) : "");
  const [pct, setPct] = useState(p.offer?.commissionPct ? String(p.offer.commissionPct) : "");
  const [terms, setTerms] = useState(p.offer?.terms ?? "");
  const [code, setCode] = useState(p.trackingCode ?? "");
  const save = () => {
    const n = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined);
    void dispatch({
      type: "partner.update",
      id: p.id,
      patch: { offer: type ? { type, amountUsd: n(amount), commissionPct: n(pct), terms: terms.trim() || undefined } : undefined, trackingCode: code.trim() || undefined },
      at: nowISO(),
    });
    toast("Saved the offer.");
  };
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-fg-2">What they get</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Offer">
        {(Object.keys(OFFER_LABELS) as PartnerOffer[]).map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={type === o}
            onClick={() => setType(o)}
            className={cn("inline-flex h-7 items-center rounded-sm px-2.5 text-[12.5px] ring-1 ring-inset transition-colors duration-150", type === o ? "bg-fg text-bg ring-fg" : "text-fg-2 ring-border hover:bg-bg-subtle")}
          >
            {OFFER_LABELS[o]}
          </button>
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <Label htmlFor={`fee-${p.id}`} className="mb-1 text-[11.5px]">
            Fee, $
          </Label>
          <Input id={`fee-${p.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="font-mono text-[16px] sm:text-[13px]" />
        </div>
        <div>
          <Label htmlFor={`pct-${p.id}`} className="mb-1 text-[11.5px]">
            Commission, %
          </Label>
          <Input id={`pct-${p.id}`} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className="font-mono text-[16px] sm:text-[13px]" />
        </div>
        <div className="col-span-2">
          <Label htmlFor={`code-${p.id}`} className="mb-1 text-[11.5px]">
            Their code or link
          </Label>
          <Input id={`code-${p.id}`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="MAYA10" maxLength={80} className="font-mono text-[16px] sm:text-[13px]" />
        </div>
        <div className="col-span-2 sm:col-span-4">
          <Label htmlFor={`terms-${p.id}`} className="mb-1 text-[11.5px]">
            Terms (deliverables, usage, when you pay)
          </Label>
          <Input id={`terms-${p.id}`} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="One 45-second video, organic only, paid within 7 days of posting" maxLength={240} className="text-[16px] sm:text-[13px]" />
        </div>
      </div>
      <Button size="sm" className="mt-2.5" onClick={save}>
        Save
      </Button>
    </div>
  );
}

function Outreach({ p, today }: { p: Partner; today: string }) {
  const { dispatch } = useWorkspace();
  const o = p.outreach;
  const [subject, setSubject] = useState(o?.subject ?? "");
  const [body, setBody] = useState(o?.body ?? "");
  const [followUp, setFollowUp] = useState(o?.followUp ?? "");
  // A new draft from a run replaces the local copy.
  const [seen, setSeen] = useState(o?.draftedAt);
  if (o && o.draftedAt !== seen) {
    setSeen(o.draftedAt);
    setSubject(o.subject ?? "");
    setBody(o.body);
    setFollowUp(o.followUp ?? "");
  }
  const next = partnerNext(p, today);
  const lint = o ? relint(p, body, followUp, o.channel === "email" ? subject : null) : null;
  const worst = lint ? worstIssue(lint) : null;
  const dirty = !!o && (body !== o.body || followUp !== (o.followUp ?? "") || (o.channel === "email" && subject !== (o.subject ?? "")));

  if (!o) {
    return (
      <div>
        <p className="mb-2 text-[13px] leading-5 text-fg-2">
          One note, under {CREATOR_OUTREACH.maxWords} words: why their audience fits, what they get and when you pay. One follow-up after about a week, then let it go.
        </p>
        <RunInline workflow="partners" args={{ mode: "draft", partnerId: p.id }} runRef={{ kind: "playbook", id: `partner:${p.id}` }} label="Draft the note" hint="About $0.02 · no web" />
      </div>
    );
  }

  const mark = (what: "outreach" | "follow_up") => {
    const activityId = newId("act");
    void dispatch([
      ...(dirty ? [{ type: "partner.editOutreach" as const, id: p.id, subject: o.channel === "email" ? subject : undefined, body, followUp }] : []),
      { type: "partner.markSent", id: p.id, what, at: nowISO(), activityId },
    ]);
    toast(what === "outreach" ? `Marked as sent to ${p.name}.` : `Marked the follow-up as sent.`, {
      action: { label: "Undo", onClick: () => void dispatch({ type: "partner.unmark", id: p.id, what, activityId }) },
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-fg-2">{o.channel === "email" ? "Email" : "Direct message"} · draft</p>
        <RunInline workflow="partners" args={{ mode: "draft", partnerId: p.id, channel: o.channel }} runRef={{ kind: "playbook", id: `partner:${p.id}` }} label="Redraft" variant="secondary" />
      </div>
      {o.channel === "email" && (
        <Input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!!o.sentOn} className="text-[16px] sm:text-[13.5px]" />
      )}
      <Textarea aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} disabled={!!o.sentOn} className="min-h-36 text-[16px] leading-6 sm:text-[13.5px] sm:leading-[21px]" />
      <p className={cn("text-[12.5px]", worst ? "text-danger" : "text-fg-3")}>{worst ? worst.detail : `Passes the checks · ${lint?.stats.words ?? 0} words`}</p>
      {lint && lint.violations.filter((v) => v.severity === "warn").length > 0 && (
        <ul className="space-y-0.5 text-[12px] text-fg-3">
          {lint.violations
            .filter((v) => v.severity === "warn")
            .slice(0, 3)
            .map((v) => (
              <li key={v.code + v.detail}>{v.detail}</li>
            ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={o.channel === "email" ? `${subject}\n\n${body}` : body} label="Copy" />
        {p.url && (
          <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[13px] text-fg-2 ring-1 ring-border hover:bg-bg-subtle hover:text-fg">
            Open their page <ExternalLink className="size-3" />
          </a>
        )}
        {dirty && !o.sentOn && (
          <Button size="sm" variant="ghost" onClick={() => void dispatch({ type: "partner.editOutreach", id: p.id, subject: o.channel === "email" ? subject : undefined, body, followUp })}>
            Save edits
          </Button>
        )}
        {!o.sentOn ? (
          <Button size="sm" variant="primary" disabled={!!worst} onClick={() => mark("outreach")}>
            I sent it
          </Button>
        ) : (
          <span className="font-mono text-[12px] text-fg-3">Sent {o.sentOn}</span>
        )}
      </div>

      {o.sentOn && (
        <div className="space-y-2 rounded-md bg-bg-subtle p-3">
          <p className="text-[12px] font-medium text-fg-2">The one follow-up{next.action === "follow_up" ? " · due now" : o.followedUpOn ? ` · sent ${o.followedUpOn}` : next.dueOn ? ` · ${next.dueOn}` : ""}</p>
          <Textarea aria-label="Follow-up" value={followUp} onChange={(e) => setFollowUp(e.target.value)} disabled={!!o.followedUpOn} className="min-h-20 text-[16px] sm:text-[13.5px]" />
          {!o.followedUpOn && p.stage === "contacted" && (
            <div className="flex flex-wrap gap-2">
              <CopyButton text={followUp} label="Copy" />
              <Button size="sm" onClick={() => mark("follow_up")} disabled={next.action !== "follow_up"}>
                I sent the follow-up
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultsForm({ p }: { p: Partner }) {
  const { dispatch } = useWorkspace();
  const [vals, setVals] = useState({ views: "", clicks: "", signups: "", orders: "", costUsd: "" });
  const fields: { key: keyof typeof vals; label: string }[] = [
    { key: "views", label: "Views" },
    { key: "clicks", label: "Clicks" },
    { key: "signups", label: "Signups" },
    { key: "orders", label: "Orders" },
    { key: "costUsd", label: "Cost, $" },
  ];
  const save = () => {
    const n = (s: string) => (s.trim() && Number.isFinite(Number(s)) && Number(s) >= 0 ? Number(s) : undefined);
    const result = { at: nowISO(), views: n(vals.views), clicks: n(vals.clicks), signups: n(vals.signups), orders: n(vals.orders), costUsd: n(vals.costUsd) };
    if (Object.values(result).filter((v) => typeof v === "number").length === 0) {
      toast("Add at least one number.");
      return;
    }
    void dispatch({ type: "partner.logResult", id: p.id, result });
    setVals({ views: "", clicks: "", signups: "", orders: "", costUsd: "" });
    toast("Logged. Count it from their code or link, and “how did you hear about us?”.");
  };
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-fg-2">What it brought</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {fields.map((f) => (
          <div key={f.key}>
            <Label htmlFor={`r-${f.key}-${p.id}`} className="mb-1 text-[11.5px]">
              {f.label}
            </Label>
            <Input id={`r-${f.key}-${p.id}`} inputMode="decimal" value={vals[f.key]} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} className="font-mono text-[16px] sm:text-[13px]" />
          </div>
        ))}
      </div>
      <Button size="sm" className="mt-2.5" onClick={save}>
        Log results
      </Button>
    </div>
  );
}
