/**
 * Documents and starter content built in code from the playbook: zero tokens, instant.
 * `[[like this]]` marks a fact only the founder can supply; approval stays blocked until it's filled.
 * Sources: First Round on Sierra's design-partner program (https://review.firstround.com/sierra-design-partnership/),
 * Blomfield/Koomen on paid pilots and one-page proposals, the objection patterns in docs/research/01 §5.5.
 */
import type { Asset, Deal, ObjectionCard, Workspace } from "@/lib/domain/types";
import { ASSET_KINDS, PRICE_BANDS, parts, pilotDays, priceBand, themeNeedsProof, usdRange, type AssetKind } from "./model";

export const SIERRA_URL = "https://review.firstround.com/sierra-design-partnership/";

interface Draft {
  title: string;
  body: string;
}

function ctx(ws: Workspace) {
  const f = ws.foundation ? parts(ws.foundation) : null;
  const company = ws.company?.name || "[[company name]]";
  const founder = ws.founder.name || "[[your name]]";
  const email = ws.sender?.email || ws.founder.email || "[[email]]";
  const title = ws.founder.title || ws.sender?.title || "Founder";
  const obstacle = f?.icp.hypothesis.obstacle || "[[the problem]]";
  const segment = f?.icp.primarySegment || f?.icp.hypothesis.companyGroup || "[[the companies you sell to]]";
  const days = pilotDays(f?.commercial);
  const approved = ws.claims.filter((c) => c.approved);
  return { f, company, founder, email, title, obstacle, segment, days, approved };
}

function lines(...xs: (string | false | null | undefined)[]): string {
  return xs.filter((x) => x !== false && x !== null && x !== undefined).join("\n");
}

/* ───────────────────────────── Design-partner kit ───────────────────────────── */

function scorecard(ws: Workspace): Draft {
  const { f, obstacle } = ctx(ws);
  const musts = f?.icp.criteria.filter((c) => c.mustHave).map((c) => c.text) ?? [];
  const anti = f?.icp.antiIcp.map((a) => a.text) ?? [];
  return {
    title: "Design-partner selection scorecard",
    body: lines(
      "# Design-partner selection scorecard",
      "",
      "Score each candidate 0–2 on every row. Take partners who score 9 or more out of 12, and stop at 4–6. Sierra screened about 40 candidates to sign 6 paying partners.",
      "",
      "| | 0 | 1 | 2 |",
      "|---|---|---|---|",
      `| **Real problem** | Curious about the tech | Has the problem, not urgent | ${obstacle} costs them money or time today |`,
      "| **Scale** | Small for them | Moderate | Big enough to deserve a budget line |",
      "| **Will pay** | Wants it free | Will pay after results | Will pay 10–20% upfront |",
      "| **Three roles** | None named | A sponsor only | Executive sponsor, technical lead with system access, business lead |",
      "| **Launch** | No date | A soft date | A real launch date, in writing |",
      `| **Fit** | Misses a must-have | Meets most | ${musts.length ? musts.join("; ") : "Meets every must-have"} |`,
      "",
      "**Disqualify regardless of score if:**",
      ...(anti.length ? anti.map((a) => `- ${a}`) : ["- Nobody owns the problem", "- They spend no money or time on it today"]),
      "- They want a free, open-ended engagement",
      "",
      "**Steps:** 30-minute discovery → 30-minute live demo → security deep dive → verbal commit → signed terms.",
    ),
  };
}

function dpTerms(ws: Workspace): Draft {
  const { company, founder, segment } = ctx(ws);
  const b = PRICE_BANDS[priceBand(ws).band];
  const fee: [number, number] = [Math.round(b.annual[0] * 0.1), Math.round(b.annual[1] * 0.2)];
  return {
    title: "Design-partner terms",
    body: lines(
      `# ${company} design-partner program`,
      "",
      `A paid, time-boxed partnership for a small group of ${segment}. You shape what we build; we commit a founder's time to your problem.`,
      "",
      "## What we ask of you",
      `- **An upfront fee** of 10–20% of the first-year contract value: [[fee]]. At our current anchor that's about ${usdRange(fee)}.`,
      "- **Three named people:** an executive sponsor, a technical lead with system access, and a business lead.",
      "- **A 60–90 minute kickoff** to agree the 3–4 problems that matter most.",
      "- **A weekly 30-minute standup** with candid feedback.",
      "- **A real launch date** for using it in production: [[launch date]].",
      "",
      "## What you get",
      "- A first version in about 2 weeks, then weekly releases shaped by your feedback.",
      `- A direct line to ${founder}, not a support queue.`,
      "- A say in the roadmap, and today's price held through conversion.",
      "",
      "## Term and conversion",
      "- **Length:** about 3 months, ending [[end date]]. Never more than 6.",
      "- **Conversion:** on [[conversion date]], you move to an annual contract at [[annual price]], with the upfront fee credited. If it isn't working by then, either side can walk away.",
      "",
      "_Draft terms. Not legal advice. Have counsel review before signing._",
    ),
  };
}

function kickoff(ws: Workspace): Draft {
  const { f, founder, obstacle } = ctx(ws);
  const champion = f?.personas.find((p) => p.role === "champion") ?? f?.personas[0];
  const kpiQs = (champion?.kpis ?? []).slice(0, 2).map((k) => `- "How do you measure ${k.replace(/\.$/, "").toLowerCase()} today, and what's it at?"`);
  return {
    title: "Design-partner kickoff agenda",
    body: lines(
      "# Design-partner kickoff (60–90 minutes)",
      "",
      `**Who:** their executive sponsor, technical lead and business lead; ${founder}.`,
      "**Goal:** agree the 3–4 problems we'll solve, how we'll measure them, and the dates.",
      "",
      "| Minutes | Block |",
      "|---|---|",
      "| 0–10 | Introductions. Confirm who owns what on both sides. |",
      `| 10–40 | Discovery: how ${obstacle} shows up today. Agree the 3–4 core problems, ranked. |`,
      "| 40–55 | Measures: the baseline today, the target, who measures it. |",
      "| 55–70 | Access and data: systems, a small sample to start with, security review. |",
      "| 70–90 | Plan: first version in about 2 weeks, the standup slot, the launch date, the conversion date. |",
      "",
      "## Questions",
      ...kpiQs,
      `- "What have you already tried for this, and why didn't it stick?"`,
      `- "What happens if this isn't fixed by [[a date that matters to them]]?"`,
      `- "Who else has to say yes before this runs in production?"`,
      "",
      "## Same day, after the call",
      "- Send the recap: the problems in their words, the measures, the dates and owners. End with “Did I miss or misstate anything?”",
      "- Send a short questionnaire: data access, security contact, who owns each measure.",
    ),
  };
}

function standup(): Draft {
  return {
    title: "Design-partner weekly standup",
    body: lines(
      "# Design-partner weekly standup (30 minutes)",
      "",
      "| Minutes | Block |",
      "|---|---|",
      "| 0–10 | Demo what shipped this week, on their data. |",
      "| 10–20 | Their feedback: what worked, what didn't, what's missing. |",
      "| 20–25 | Open tasks on their side: access, data, people. |",
      "| 25–30 | Launch-date check: is it still real? If not, what moved it? |",
      "",
      "## Notes",
      "- **Shipped:**",
      "- **Feedback, in their words:**",
      "- **Their open tasks:** owner · due",
      "- **Our open tasks:** owner · due",
      "- **Launch date:** on track / at risk / moved to",
      "- **Conversion date:** still on track?",
    ),
  };
}

/** The four kit documents, as unapproved assets. */
export function designPartnerKit(ws: Workspace, ids: () => string, at: string): Asset[] {
  const kit: [AssetKind, Draft][] = [
    ["other", scorecard(ws)],
    ["design_partner_terms", dpTerms(ws)],
    ["other", kickoff(ws)],
    ["other", standup()],
  ];
  return kit.map(([kind, d]) => ({ id: ids(), kind, title: d.title, body: d.body, createdAt: at, updatedAt: at, approved: false, kit: "design_partner", origin: "template", gaps: [] }));
}

/* ───────────────────────────── Blank templates per kind ───────────────────────────── */

function onePager(ws: Workspace): Draft {
  const { f, company, founder, email, title, days, approved } = ctx(ws);
  const oneLiner = f?.messaging.oneLiner || ws.company?.plainOneLiner || "[[what you do, in one plain sentence]]";
  const h = f?.icp.hypothesis;
  const words = f?.messaging.customerWords.slice(0, 2).map((w) => `“${w.phrase}”`) ?? [];
  const themes = f?.positioning.valueThemes ?? [];
  const security = approved.find((c) => c.kind === "security");
  return {
    title: `${company} one-pager`,
    body: lines(
      `# ${company}`,
      "",
      `**${oneLiner}**`,
      "",
      "## The problem",
      h?.role && h?.obstacle ? `${h.role} at ${h.companyGroup || "[[companies like theirs]]"} struggle with ${h.obstacle}${h.cause ? ` because ${h.cause}` : ""}.` : "[[The problem, in your buyer's words]]",
      words.length ? `In their words: ${words.join(", ")}.` : null,
      "",
      "## What changes",
      ...(themes.length
        ? themes.slice(0, 3).map((t) => {
            const claim = t.proof.map((p) => (p.claimId ? approved.find((c) => c.id === p.claimId) : undefined)).find(Boolean);
            return `- **${t.theme}.** ${t.outcome}${claim ? ` ${claim.text}` : themeNeedsProof(ws, t) ? " _We're validating this with design partners._" : ""}`;
          })
        : ["- **[[Outcome one]]**", "- **[[Outcome two]]**", "- **[[Outcome three]]**"]),
      "",
      "## How it works",
      "1. [[First step, in the buyer's words]]",
      "2. [[Second step]]",
      "3. [[What they see at the end]]",
      "",
      "## What a pilot looks like",
      `A paid ${days}-day pilot on your own data. We agree the success criteria in writing before we start and book the results review at kickoff. The pilot fee is credited in full to an annual contract.`,
      "",
      "## Security",
      security ? security.text : "Security details on request.",
      "",
      "## Contact",
      `${founder}, ${title} · ${email}`,
    ),
  };
}

function demoScript(ws: Workspace): Draft {
  const { f, company, days, obstacle, approved } = ctx(ws);
  const themes = (f?.positioning.valueThemes ?? []).slice(0, 3);
  const proof = approved.find((c) => c.kind === "metric" || c.kind === "customer");
  const beats = themes.length
    ? themes.map((t, i) => `| ${["0:45", "1:05", "1:25"][i]} | ${t.theme}: ${t.outcome} | [[Screen ${i + 1}, on data like theirs]] |`)
    : ["| 0:45 | [[Outcome one]] | [[Screen 1]] |", "| 1:10 | [[Outcome two]] | [[Screen 2]] |"];
  return {
    title: `${company} demo script`,
    body: lines(
      `# ${company}: a 2-minute demo`,
      "",
      `**Before you share your screen,** ask: “Is ${obstacle} still the thing you'd fix first?” If not, don't demo. Go back to discovery.`,
      "",
      "| Time | Say | Show |",
      "|---|---|---|",
      "| 0:00 | “You told me [[what they said matters]].” | Nothing yet. |",
      "| 0:15 | [[What changed in their world that makes this urgent now]] | |",
      "| 0:30 | “Today you [[what they do without you]], which costs [[what it costs them]].” | |",
      ...beats,
      `| 1:45 | ${proof ? proof.text : "“We're proving this with design partners now.”"} | |`,
      `| 1:55 | “Would a ${days}-day paid pilot on your data be the right next step?” | |`,
      "",
      "Keep “about us” under 30 seconds. The buyer is the protagonist, not the product.",
      "",
      "## If they go quiet",
      "- “What would you need to see to try this on your own data?”",
      "- “Who else would care about this being fixed?”",
      "- “What happens if this stays as it is for another quarter?”",
    ),
  };
}

function security(ws: Workspace): Draft {
  const { company, founder, email, approved } = ctx(ws);
  const confirmed = approved.filter((c) => c.kind === "security");
  const rows = ["SOC 2", "Data retention", "Hosting region", "Encryption in transit and at rest", "SSO / SAML", "Subprocessors", "Penetration test", "DPA"];
  return {
    title: `Security at ${company}`,
    body: lines(
      `# Security at ${company}`,
      "",
      confirmed.length ? "## What we can confirm" : null,
      ...confirmed.map((c) => `- ${c.text}`),
      confirmed.length ? "" : null,
      "| Item | Status |",
      "|---|---|",
      ...rows.map((r) => `| ${r} | Ask us |`),
      "",
      `Questions about security go to ${founder} at ${email}.`,
    ),
  };
}

function quoteBlock(deal: Deal | undefined, ws: Workspace): string[] {
  if (!deal) return ["[[Their situation, in their words]]"];
  const debriefs = deal.meetingIds.map((id) => ws.meetings[id]?.debrief).filter((d): d is NonNullable<typeof d> => !!d);
  const transcript = debriefs.find((d) => d.source === "transcript");
  const pain = deal.card?.pain;
  if (transcript && pain?.quotes.length) {
    const byId = new Map(transcript.quotes.map((q) => [q.id, q.text]));
    // Card fields cite quote ids; fall back to the text itself when a field stores the quote.
    const said = pain.quotes.map((q) => byId.get(q) ?? (q.includes(" ") ? q : null)).filter((q): q is string => !!q).slice(0, 2);
    if (said.length) return said.map((q) => `> ${q}`);
  }
  if (pain?.value) return [`Our understanding: ${pain.value}`];
  return ["[[Their situation, in their words]]"];
}

function pilotProposal(ws: Workspace, deal: Deal | undefined): Draft {
  const { company, founder, days } = ctx(ws);
  const customer = deal?.name || "[[customer]]";
  const card = deal?.card;
  const criteria =
    deal?.pilot?.criteria ||
    deal?.meetingIds.map((id) => ws.meetings[id]?.debrief?.pilotCriteria).find(Boolean) ||
    `By [[date]], using ${company} on [[scope]], ${customer} will move [[metric]] from [[baseline]] to [[target]], measured by [[method and owner]]. If met, ${customer} moves to [[plan]] at [[price]] starting [[date]].`;
  const fee = deal?.pilot?.feeUsd ? `$${deal.pilot.feeUsd.toLocaleString("en-US")}` : "[[pilot fee]]";
  return {
    title: `${customer} pilot proposal`,
    body: lines(
      `# ${customer} + ${company}: pilot proposal`,
      "",
      "## Context",
      ...quoteBlock(deal, ws),
      "",
      "## What it costs today",
      card?.pain.impact || "[[What the problem costs them today, from the call]]",
      "",
      "## Success criteria",
      criteria,
      "",
      "## Scope",
      "- **In:** [[what's included]]",
      "- **Out:** [[what's not]]",
      "- To start, minimal integration: [[a CSV export or a sample]].",
      "",
      "## Timeline",
      `- A ${days}-day pilot starting [[start date]].`,
      days <= 14 ? "- Check-ins every 2–3 days." : "- A check-in every week.",
      "- Results review on [[review date]], booked at kickoff.",
      "",
      "## Fee",
      `${fee}, credited in full to the annual contract.`,
      "",
      "## After the pilot",
      "If the success criteria are met, an annual contract at [[annual price]] with a [[30 or 60]]-day opt-out.",
      "",
      "## Owners",
      `- **${customer}:** ${card?.champion.name || "[[champion]]"} (champion), ${card?.economicBuyer.name || "[[economic buyer]]"} (economic buyer), [[technical lead]]`,
      `- **${company}:** ${founder}`,
      "",
      "## Next step",
      deal?.nextStep ? `${deal.nextStep.what}, by ${deal.nextStep.date}.` : "[[Who signs, and by when]]",
      "",
      "## Order form",
      "",
      "| | |",
      "|---|---|",
      `| Customer | ${customer} |`,
      `| Provider | ${company} |`,
      `| Pilot term | ${days} days |`,
      "| Start date | [[start date]] |",
      `| Pilot fee | ${fee} |`,
      "| Success criteria | As above |",
      "| Conversion | [[plan]] at [[annual price]] |",
      "| Opt-out window | [[30 or 60]] days |",
      "| Payment terms | [[payment terms]] |",
      "",
      `**Agreed by ${customer}:** name ________ · title ________ · date ________`,
      "",
      `**Agreed by ${company}:** ${founder} · title ________ · date ________`,
      "",
      "_Draft. Not legal advice. Have counsel review before signing._",
    ),
  };
}

function insight(ws: Workspace, calls: number): Draft {
  const { f } = ctx(ws);
  const persona = f?.personas.find((p) => p.role === "champion")?.titles[0] ?? "[[persona]]";
  return {
    title: `What we learned from ${calls} calls with ${persona}s`,
    body: lines(
      `# What we learned from ${calls} calls with ${persona}s`,
      "",
      "_Anonymized. Nothing here identifies a company or a person._",
      "",
      "## 1. [[A pattern from 3 or more calls]]",
      "[[How many of the calls, and one anonymized line]]",
      "",
      "## 2. [[Second pattern]]",
      "",
      "## 3. [[Third pattern]]",
      "",
      "## What it means for you",
      "[[One paragraph]]",
      "",
      "[[One question for the reader]]",
    ),
  };
}

function caseStudy(ws: Workspace): Draft {
  const { approved, segment } = ctx(ws);
  const facts = approved.filter((c) => c.kind === "customer" || c.kind === "metric");
  return {
    title: "Case study",
    body: lines(
      "# [[Customer, or “a " + segment + " company” if anonymized]]",
      "",
      "## The situation",
      "[[Where they were before]]",
      "",
      "## The problem",
      "[[What it cost them]]",
      "",
      "## What they did",
      "[[How they used it]]",
      "",
      "## Results",
      ...(facts.length ? facts.map((c) => `- ${c.text}`) : ["- [[An approved result]]"]),
    ),
  };
}

/** A starting document for any kind, built from the playbook. */
export function templateFor(kind: AssetKind, ws: Workspace, opts: { deal?: Deal; calls?: number } = {}): Draft {
  switch (kind) {
    case "one_pager":
      return onePager(ws);
    case "demo_script":
      return demoScript(ws);
    case "security":
      return security(ws);
    case "design_partner_terms":
      return dpTerms(ws);
    case "pilot_proposal":
      return pilotProposal(ws, opts.deal);
    case "insight":
      return insight(ws, opts.calls ?? 0);
    case "case_study":
      return caseStudy(ws);
    default:
      return { title: ASSET_KINDS[kind].label, body: "# [[Title]]\n\n[[Body]]" };
  }
}

/* ───────────────────────────── Starter content ───────────────────────────── */

/** The objections early-stage founders hear most, with the response pattern that works. Drafts until approved. */
export function starterObjections(ws: Workspace, ids: () => string): ObjectionCard[] {
  const { days, obstacle } = ctx(ws);
  const rows: Omit<ObjectionCard, "id" | "approved" | "timesHeard">[] = [
    {
      objection: "You're too early. You don't have any customers like us.",
      category: "startup_risk",
      underlyingConcern: "If this fails, it lands on them.",
      clarifyingQ: "What would you need to see to feel safe trying it on a small scale?",
      response: `Fair. That's why we start with a paid ${days}-day pilot with success criteria agreed in writing, and a 30-day opt-out on the annual. You get a direct line to me, not a support queue.`,
      walkAwayIf: "They need references we can't give and won't run a pilot.",
    },
    {
      objection: "Just send me some info.",
      category: "info_request",
      underlyingConcern: "A polite exit, or real interest without time.",
      clarifyingQ: `Happy to. So I send something useful rather than a deck: is ${obstacle} a problem this quarter, or should I check back later?`,
      response: "Send the one-pager and book 15 minutes to go through it before you hang up.",
      walkAwayIf: "No problem today and no date to revisit.",
    },
    {
      objection: "We don't have budget for this.",
      category: "budget",
      underlyingConcern: "It isn't a priority, or nobody owns it.",
      clarifyingQ: "Is this costing you money or time today? Roughly how much?",
      response: "If it's costing that much, a pilot within your own sign-off limit pays for itself. Start there and let the results make the budget case.",
      walkAwayIf: "They spend no money or time on it today.",
    },
    {
      objection: "We'll build it ourselves.",
      category: "build",
      underlyingConcern: "Control, or doubt that it's hard.",
      clarifyingQ: "How many engineers for how long, and who maintains it afterwards?",
      response: `That's a real option. Compare engineers times months plus upkeep with a ${days}-day pilot that's live sooner. If the pilot fails, you've lost little; if it works, you've saved the build.`,
      walkAwayIf: "It's core to their product and they have the team.",
    },
    {
      objection: "We already use something for this.",
      category: "competitor",
      underlyingConcern: "Switching cost and the risk of looking wrong.",
      clarifyingQ: "What made you pick it? Is there anything you wish it did?",
      response: "Never knock the incumbent. If the gap they name is one we close, offer a side-by-side pilot on exactly that gap.",
      walkAwayIf: "They're happy and the gap doesn't matter to them.",
    },
    {
      objection: "Not a priority right now.",
      category: "priority",
      underlyingConcern: "No critical event.",
      clarifyingQ: "What would make it a priority? Is anything changing in the next quarter?",
      response: "If there's a date that matters, work back from it. If there isn't, agree a dated check-in rather than chasing.",
      walkAwayIf: "No critical event and no owner.",
    },
    {
      objection: "Security review will take months.",
      category: "security",
      underlyingConcern: "Their security team will block it.",
      clarifyingQ: "What does your review need from us, and who runs it?",
      response: "Start it this week: send the security page and a DPA template, and scope a minimal-data pilot (a CSV or a small sample) that may not need the full review.",
      walkAwayIf: "They need a certification you won't have for a year.",
    },
    {
      objection: "The price is too high.",
      category: "budget",
      underlyingConcern: "Value isn't clear yet, or it's above their sign-off limit.",
      clarifyingQ: "Compared with what?",
      response: "Go back to what the problem costs them. Offer options on scope or term, not a bare discount. Discount only for something in return: a case study, a multi-year term, a reference, or signing by a date.",
      walkAwayIf: "The value they named is smaller than the price at any scope.",
    },
    {
      objection: "I need to talk to my team.",
      category: "team",
      underlyingConcern: "They can't sell it internally yet.",
      clarifyingQ: "Of course. Who's on the team, and what will they ask?",
      response: "Offer to join that conversation, or send a one-pager they can forward. Book the follow-up before you hang up.",
      walkAwayIf: "They won't name who decides.",
    },
  ];
  return rows.map((r) => ({ ...r, id: ids(), approved: false, timesHeard: 0 }));
}

/** Questions that pull a first-hand point of view out of the founder. */
export function povPrompts(ws: Workspace): string[] {
  const { obstacle, segment } = ctx(ws);
  return [
    `What does everyone selling to ${segment} get wrong about ${obstacle}?`,
    "What did your last three users say right before they said yes?",
    "What did you believe before building this that turned out to be wrong?",
    "Which common advice in your space do you disagree with, and why?",
  ];
}
