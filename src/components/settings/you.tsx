"use client";

import { ArrowUpRight } from "lucide-react";
import type { Action } from "@/lib/domain/actions";
import type { Workspace } from "@/lib/domain/types";
import { Segmented } from "@/components/ui/misc";
import { Group, Row, SettingsSection, TextSetting } from "./parts";
import { emailProblem, gmailProblem, normalizeUrl, urlProblem } from "./validate";

type Dispatch = (actions: Action | Action[]) => Promise<boolean>;

export function YouSection({ ws, dispatch }: { ws: Workspace; dispatch: Dispatch }) {
  const f = ws.founder;
  const update = (patch: Partial<Workspace["founder"]>) => dispatch({ type: "founder.update", patch });
  const authUser = (f.gmailAuthUser || "0").trim() || "0";

  return (
    <SettingsSection id="you" title="You" description="Who I'm working for, and the details I need when someone says yes.">
      <Group title="About you">
        <TextSetting label="Name" value={f.name} required="I need a name to sign your emails." autoComplete="name" onSave={(v) => update({ name: v })} />
        <TextSetting label="Title" value={f.title ?? ""} placeholder="Co-founder & CEO" autoComplete="organization-title" onSave={(v) => update({ title: v })} />
        <TextSetting
          label="Email"
          value={f.email ?? ""}
          placeholder="you@company.com"
          type="email"
          inputMode="email"
          autoComplete="email"
          validate={emailProblem}
          normalize={(v) => v.trim().toLowerCase()}
          onSave={(v) => update({ email: v })}
        />
      </Group>

      <Group title="Gmail" hint="Approved drafts open in Gmail's compose window, and Check replies runs one Gmail search. Nothing is sent from here.">
        <TextSetting
          label="Gmail account"
          hint={
            <>
              Your address, or the account number in Gmail&apos;s URL. Empty means your first signed-in account.{" "}
              <a
                href={`https://mail.google.com/mail/u/${encodeURIComponent(authUser)}/?tf=cm`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 whitespace-nowrap text-fg-2 underline underline-offset-2 hover:text-fg"
              >
                Open a blank draft to check <ArrowUpRight className="size-3" aria-hidden />
              </a>
            </>
          }
          value={f.gmailAuthUser ?? ""}
          placeholder="0 or you@company.com"
          mono
          inputMode="email"
          validate={gmailProblem}
          normalize={(v) => v.trim().toLowerCase()}
          onSave={(v) => update({ gmailAuthUser: v })}
        />
      </Group>

      <Group title="Booking" hint="Used only after someone replies with interest. Two specific times get booked more often than a bare link, so I lead with your availability.">
        <TextSetting
          label="Availability"
          hint="When you take first calls, with a time zone."
          value={f.availability ?? ""}
          placeholder="Tue–Thu 10–4 PT"
          onSave={(v) => update({ availability: v })}
        />
        <TextSetting
          label="Scheduling link"
          hint="A fallback after the two times."
          value={f.schedulingUrl ?? ""}
          placeholder="cal.com/you/20min"
          mono
          type="url"
          inputMode="url"
          validate={urlProblem}
          normalize={normalizeUrl}
          onSave={(v) => update({ schedulingUrl: v })}
        />
      </Group>

      <Group title="LinkedIn">
        <Row
          label="LinkedIn Premium"
          hint="Free accounts get only a few personalized invite notes a month. Without Premium I keep invites blank and save the message for after they accept."
        >
          <div className="flex sm:justify-end">
            <Segmented<"yes" | "no" | "unset">
              layoutId="settings-premium"
              value={f.linkedinPremium === true ? "yes" : f.linkedinPremium === false ? "no" : "unset"}
              onChange={(v) => void update({ linkedinPremium: v === "yes" })}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
            />
          </div>
        </Row>
      </Group>
    </SettingsSection>
  );
}
