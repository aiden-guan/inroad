import { addBusinessDays, todayISO } from "@/lib/domain/ids";
import type { Activity, Move, Workspace } from "@/lib/domain/types";
import type { Clock } from "./clock";
import { DOMAIN, PERSON, PERSONA } from "./ids";

/**
 * What makes Today's triage visible on the sample's first load, added to the assembled workspace:
 *  - a referral in the replies lane (Sam at Cinderpath points to Nora, with her address), next to Dana's question and
 *    Grace's out-of-office;
 *  - a reminder that came due (Leo hasn't answered the recap), so the follow-up radar has a card and a bump;
 *  - three "wrong person" skips on the Head of Data persona inside 30 days, so "What I've learned" has an adjustment.
 * Ids are explicit, so the sample's numbered activities (act_001…) keep their ids.
 */
export function seedToday(ws: Workspace, c: Clock): void {
  const activities: Activity[] = [
    {
      id: "act_sam_touch",
      at: c.at(-5, "09:20"),
      kind: "touch_sent",
      personId: PERSON.sam,
      accountDomain: DOMAIN.cinderpath,
      channel: "email",
      source: "founder",
      summary: "Cold email to Sam Whitlock about the Senior Accountant posting",
      body: "Sam, Cinderpath is hiring a Senior Accountant for revenue and AR. When plans are priced per monthly active user, the usage tie-out tends to land on that hire in their first close. Who owns that reconciliation today?",
    },
    {
      id: "act_sam_referral",
      at: c.at(-1, "16:05"),
      kind: "reply_received",
      personId: PERSON.sam,
      accountDomain: DOMAIN.cinderpath,
      channel: "email",
      source: "founder",
      sentiment: "referral",
      summary: "Sam Whitlock pointed you to Nora Vance",
      body: "Thanks Priya. I'm not the right person for this anymore. Nora Vance (nora.vance@cinderpath.example), our new Revenue Accounting Manager, owns the close now. Worth reaching out to her.",
    },
  ];
  ws.activities.push(...activities);
  ws.activities.sort((a, b) => a.at.localeCompare(b.at));

  // The recap after Saltmarsh's discovery call went out six days ago with "Remind me if no reply" on: due now.
  const recap = ws.activities.find((a) => a.kind === "touch_sent" && a.personId === PERSON.leo && /^Recap and one-pager/.test(a.summary));
  if (recap) recap.remindOn = addBusinessDays(todayISO(new Date(recap.at)), 4);

  const skip = (id: string, days: number, title: string, domain: string): Move => ({
    id,
    createdAt: c.at(-days, "08:30"),
    dueOn: c.d(-days),
    kind: "first_touch",
    title,
    why: "Fresh signal at an A-tier account",
    minutes: 4,
    evidenceIds: [],
    priority: 50,
    rule: "today.signal",
    status: "skipped",
    skipReason: "wrong_person",
    settledAt: c.at(-days, "09:05"),
    skipTarget: { persona: { key: `psn:${PERSONA.technical}`, label: "Head of Data" }, domain },
  });
  for (const m of [
    skip("mv_sample_skip_cinderpath", 10, "Write to the Head of Data at Cinderpath", DOMAIN.cinderpath),
    skip("mv_sample_skip_bramblecast", 6, "Write to the Data Platform Lead at Bramblecast", DOMAIN.bramblecast),
    skip("mv_sample_skip_driftglass", 4, "Write to the Head of Data at Driftglass", DOMAIN.driftglass),
  ]) {
    ws.moves[m.id] = m;
  }
}
