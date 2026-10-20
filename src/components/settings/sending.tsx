"use client";

import type { Action } from "@/lib/domain/actions";
import type { SenderIdentity, Workspace } from "@/lib/domain/types";
import { buildFooter, capUsage } from "@/lib/quality/gates";
import { cn } from "@/lib/client/cn";
import { DomainHealth } from "./domain-health";
import { Group, Row, SettingsSection, Stepper, TextSetting } from "./parts";
import { SuppressionList } from "./suppression";
import { emailProblem } from "./validate";

type Dispatch = (actions: Action | Action[]) => Promise<boolean>;

/** What the footer will use: saved sender details, else the same defaults the reducer fills in. */
function senderOf(ws: Workspace): SenderIdentity {
  const s = ws.sender;
  return {
    ...(s ?? {}),
    name: s?.name ?? ws.founder.name ?? "",
    title: s?.title ?? ws.founder.title ?? "Founder",
    company: s?.company ?? ws.company?.name ?? "",
    email: s?.email ?? ws.founder.email ?? "",
    postalAddress: s?.postalAddress ?? "",
  };
}

export function SendingSection({ ws, dispatch, refresh, now, today }: { ws: Workspace; dispatch: Dispatch; refresh: () => Promise<void>; now: number; today: string }) {
  return (
    <SettingsSection
      id="sending"
      title="Sending"
      description="Who your emails come from, whether your domain is trusted, how much cold email goes out, and who never hears from you."
    >
      <SenderGroup ws={ws} dispatch={dispatch} />
      <DomainHealth ws={ws} refresh={refresh} now={now} />
      <CapsGroup ws={ws} dispatch={dispatch} today={today} />
      <SuppressionList ws={ws} dispatch={dispatch} />
    </SettingsSection>
  );
}

/* ───────────── Sender identity + CAN-SPAM footer ───────────── */

function SenderGroup({ ws, dispatch }: { ws: Workspace; dispatch: Dispatch }) {
  const sender = senderOf(ws);
  const update = (patch: Partial<SenderIdentity>) => dispatch({ type: "sender.update", patch });
  const footer = buildFooter({ ...ws, sender }, { jurisdiction: "US", sourceHost: null, guessed: false, companyName: sender.company });
  const missing = [!sender.name && "name", !sender.title && "title", !sender.company && "company", !sender.postalAddress && "postal address"].filter(Boolean) as string[];

  return (
    <Group
      id="sender"
      title="Sender identity"
      hint="Every cold email ends with a footer built from these. US law (CAN-SPAM) asks for a real postal address and an easy opt-out in commercial email, B2B included. A registered PO box or mailbox service counts."
    >
      <TextSetting label="Name" value={sender.name} required="The footer needs your name." autoComplete="name" onSave={(v) => update({ name: v })} />
      <TextSetting label="Title" value={sender.title} required="The footer needs a title." autoComplete="organization-title" onSave={(v) => update({ title: v })} />
      <TextSetting label="Company" value={sender.company} required="The footer needs your company name." autoComplete="organization" onSave={(v) => update({ company: v })} />
      <TextSetting
        label="Sending email"
        hint="The address your drafts go out from."
        value={sender.email}
        placeholder="you@company.com"
        type="email"
        inputMode="email"
        autoComplete="email"
        validate={emailProblem}
        normalize={(v) => v.trim().toLowerCase()}
        onSave={(v) => update({ email: v })}
      />
      <TextSetting
        label="Postal address"
        hint="Street, city, postcode, country."
        value={sender.postalAddress}
        placeholder={"100 Main St, Suite 200\nAustin, TX 78701, USA"}
        multiline
        autoComplete="street-address"
        onSave={(v) => update({ postalAddress: v })}
      />
      <div className="px-4 py-3.5">
        <p className="mb-2 text-[12px] font-medium text-fg-3">What recipients see at the end of a cold email</p>
        <div className={cn("rounded-md bg-sunken px-3.5 py-3 ring-1 ring-inset ring-border", !footer && "border border-dashed border-border-strong ring-0")}>
          {footer ? (
            <p className="whitespace-pre-line text-[13px] leading-5 text-fg-2 [overflow-wrap:anywhere]">{footer}</p>
          ) : (
            <p className="text-[13px] leading-5 text-fg-3">
              {sender.name || "Name"} · {sender.title || "Title"}, {sender.company || "Company"} ·{" "}
              <span className="text-warning">{sender.postalAddress ? sender.postalAddress.replace(/\s*\n\s*/g, ", ") : "postal address"}</span>
              <br />
              If this isn&apos;t relevant, reply &ldquo;no&rdquo; and I won&apos;t follow up.
            </p>
          )}
        </div>
        <p className={cn("mt-2 text-[12px] leading-[18px]", footer ? "text-fg-3" : "text-warning")}>
          {footer
            ? "For people in the EU, the UK, or somewhere I can't tell, I add one more line: where I found their address and how to have it deleted (GDPR Art. 14)."
            : `Add your ${missing.join(", ")} to finish the footer. Until then I can draft emails, but you can't approve them.`}
        </p>
      </div>
    </Group>
  );
}

/* ───────────── Caps ───────────── */

function CapsGroup({ ws, dispatch, today }: { ws: Workspace; dispatch: Dispatch; today: string }) {
  const used = capUsage(ws, today);
  const caps = ws.caps;
  const set = (patch: Partial<Workspace["caps"]>) => void dispatch({ type: "caps.update", patch });
  return (
    <Group
      id="caps"
      title="Caps"
      hint="These limit cold email first touches only. Follow-ups, replies, LinkedIn and intro asks never count. Steady, low volume protects your domain; the goal comes from conversations, so more cold email isn't the lever."
    >
      <Row
        label="Cold first touches a week"
        hint={
          <>
            This week: <span className="font-mono tnum text-fg-2">{used.thisWeek}</span> sent, <span className="font-mono tnum text-fg-2">{used.remainingWeek}</span> left. New slots open Monday.
          </>
        }
      >
        <div className="flex sm:justify-end">
          <Stepper label="cold first touches a week" value={caps.firstTouchesPerWeek} min={10} max={50} step={5} onChange={(v) => set({ firstTouchesPerWeek: v })} />
        </div>
      </Row>
      <Row
        label="Most in one day"
        hint={
          <>
            Today: <span className="font-mono tnum text-fg-2">{used.today}</span> sent. Inbox providers trust consistent daily volume over bursts.
          </>
        }
      >
        <div className="flex sm:justify-end">
          <Stepper label="cold first touches a day" value={caps.firstTouchesPerDayMax} min={5} max={30} onChange={(v) => set({ firstTouchesPerDayMax: v })} />
        </div>
      </Row>
      <Row label="People per company a week" hint="Two people at one company hearing from you the same week compare notes. Stagger them.">
        <div className="flex sm:justify-end">
          <Stepper label="people per company a week" value={caps.contactsPerAccountPerWeek} min={1} max={3} onChange={(v) => set({ contactsPerAccountPerWeek: v })} />
        </div>
      </Row>
    </Group>
  );
}
