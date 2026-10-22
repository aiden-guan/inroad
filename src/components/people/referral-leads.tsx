"use client";

import { ArrowUpRight, Check, Plus } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ReferralWrite } from "@/components/compose/composer";
import { useRuns } from "@/components/providers/runs-provider";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import { firstName, shortDate } from "@/lib/client/format";
import { referralLeads, type ReferralLead } from "@/lib/deals/referrals";
import { nowISO } from "@/lib/domain/ids";
import type { Account, Meeting, Workspace } from "@/lib/domain/types";

/** A first guess at a company's website from its name ("Kestrel Labs" → kestrellabs.com); the founder corrects it. */
function guessDomain(company: string | undefined): string {
  const slug = (company ?? "").toLowerCase().replace(/\b(inc|llc|ltd|corp|co|the)\b/g, "").replace(/[^a-z0-9]+/g, "");
  return slug ? `${slug}.com` : "";
}

function cleanDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

/**
 * The people a call suggested ("who else should I talk to?"), each one click from a first touch
 * that says who sent you. A company that isn't on file yet is added (as a referral) and researched
 * first. Used in the debrief review and on Today's referral card.
 */
export function ReferralLeads({ meeting, className }: { meeting: Meeting; className?: string }) {
  const { ws } = useWorkspace();
  if (!ws) return null;
  const leads = referralLeads(ws, meeting);
  if (!leads.length) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {leads.map((l) => (
        <LeadRow key={l.key} ws={ws} lead={l} meeting={meeting} />
      ))}
    </ul>
  );
}

function LeadRow({ ws, lead, meeting }: { ws: Workspace; lead: ReferralLead; meeting: Meeting }) {
  const { dispatch } = useWorkspace();
  const { start } = useRuns();
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [site, setSite] = useState(() => guessDomain(lead.company));
  const [error, setError] = useState<string | null>(null);
  const referrer = lead.referrerId ? ws.people[lead.referrerId] : undefined;
  const deal = ws.deals[meeting.dealId];
  const fallback = deal?.accountDomain ?? lead.domain ?? "";
  const account = lead.domain ? ws.accounts[lead.domain] : undefined;
  const how = `on the ${shortDate(meeting.startsAt)} call`;
  const label = lead.name ?? lead.company ?? "Someone they named";

  const addCompany = async () => {
    const domain = cleanDomain(site);
    if (!domain) {
      setError("Enter their website, like kestrel.com.");
      return;
    }
    const existing = ws.accounts[domain];
    const acc: Account = {
      domain,
      name: lead.company?.trim() || domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
      status: "tracked",
      source: "referral",
      sourceDetail: `Referred by ${referrer?.name ?? "a contact"} ${how}`,
      addedAt: nowISO(),
      fitScore: 0,
      tier: "C",
      criteria: [],
      signals: [],
      whyNow: null,
      whyNowScore: 0,
      peopleIds: [],
      warmPathCount: 0,
      watch: true,
    };
    // Already on file (perhaps under another name): the referral points at it from now on.
    const ok = await dispatch([
      ...(existing ? [] : [{ type: "account.add" as const, account: acc }]),
      ...(meeting.debrief ? [{ type: "meeting.patchDebrief" as const, id: meeting.id, generatedAt: meeting.debrief.generatedAt, patch: { referralDomain: { index: lead.index, domain } } }] : []),
    ]);
    if (!ok) return;
    setAdding(false);
    if (!existing?.dossier) void start("dossier", { domain }, { notify: false });
    toast(existing ? `${existing.name} is already in Companies. Linked it to this referral.` : `${acc.name} added as a referral. Researching it now.`);
  };

  return (
    <li className="rounded-md bg-surface px-3 py-2.5 ring-1 ring-border">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {/* A basis, so a narrow card wraps the action under the quote instead of squeezing the quote beside it. */}
        <div className="min-w-0 flex-1 basis-[16rem]">
          <p className="text-[13.5px]">
            <span className="font-medium text-fg">{label}</span>
            {lead.name && lead.company && <span className="text-fg-2"> at {lead.company}</span>}
          </p>
          {lead.quote && <p className="mt-0.5 font-serif text-[15px] italic leading-[22px] text-fg-2">“{lead.quote}”</p>}
          {referrer && <p className="mt-0.5 text-[12px] text-fg-3">Suggested by {referrer.name}</p>}
        </div>
        {lead.acted ? (
          <span className="inline-flex h-7 items-center gap-1.5 text-[12.5px] text-fg-2">
            <Check className="size-3.5 text-success" aria-hidden /> {lead.personId && ws.people[lead.personId]?.doNotContact ? "Do not contact" : "On it"}
          </span>
        ) : !lead.domain && lead.company ? (
          !adding && (
            <Button size="xs" variant="secondary" icon={<Plus className="size-3" />} onClick={() => setAdding(true)}>
              Add {lead.company}
            </Button>
          )
        ) : (
          !lead.name &&
          account && (
            <Link href={`/companies?c=${encodeURIComponent(account.domain)}`} className="inline-flex h-7 items-center gap-1 text-[12.5px] text-fg-2 hover:text-fg">
              Open {account.name} <ArrowUpRight className="size-3" />
            </Link>
          )
        )}
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addCompany();
          }}
          className="mt-2.5 flex flex-wrap items-end gap-2 animate-[fade-in_150ms_var(--ease-out)]"
        >
          <div className="min-w-0 flex-1 sm:flex-none">
            <Label htmlFor={`${id}-site`}>{lead.company}&apos;s website</Label>
            <Input
              id={`${id}-site`}
              value={site}
              onChange={(e) => {
                setSite(e.target.value);
                if (error) setError(null);
              }}
              placeholder="kestrel.com"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              className="font-mono text-[12.5px] sm:w-56"
            />
          </div>
          <Button type="submit" size="sm" variant="agent" disabled={!site.trim()}>
            Add and research
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          {error && <p className="w-full text-[12px] text-danger">{error}</p>}
        </form>
      )}

      {!lead.acted && lead.name && lead.domain && (
        <ReferralWrite
          ws={ws}
          name={lead.name}
          referrerId={lead.referrerId}
          personId={lead.personId}
          domain={lead.domain}
          fallbackDomain={fallback}
          quote={lead.quote}
          how={how}
        />
      )}
      {!lead.acted && lead.name && !lead.domain && !lead.company && (
        <ReferralWrite ws={ws} name={lead.name} referrerId={lead.referrerId} fallbackDomain={fallback} quote={lead.quote} how={how} />
      )}
      {!lead.acted && lead.name && !lead.domain && lead.company && !adding && (
        <p className="mt-1.5 text-[12px] text-fg-3">Add {lead.company} first, then I&apos;ll draft a note to {firstName(lead.name)} that says {referrer ? firstName(referrer.name) : "who"} sent you.</p>
      )}
    </li>
  );
}
