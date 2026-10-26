import type { DraftFrame } from "@/lib/domain/types";

/**
 * The critic's calibration set (SPEC §4.0 "Pre-launch calibration gate"): 40 labeled first touches, 20 that model
 * human emails that got replies and 20 that model AI-SDR emails. The critic must accept at least 70% of the first
 * and reject at least 85% of the second, or its prompt gets tuned before launch.
 *
 * Fourteen of the AI-SDR emails fail lint outright (banned phrases, hype, more than one ask, about the sender); six
 * pass lint and are generic only in substance (no real premise, a claim anyone could make), which is the critic's
 * job to catch.
 *
 * These are written to the patterns in docs/research (01 §3, 04 §4), for invented companies and people. They are not
 * real emails. The SPEC asks for permissioned real ones: put them in `calibration.json` in the data folder (same
 * shape as below) and the eval reads those instead. Until then, this set catches regressions in the critic prompt
 * and the lint, not the critic's absolute accuracy.
 */

export interface CalibrationEmail {
  id: string;
  /** "replied": a human email that got a reply. "ai_sdr": a templated AI-SDR email. */
  label: "replied" | "ai_sdr";
  frame: DraftFrame;
  /** Who the critic reads it as. */
  persona: string;
  band: string;
  subject: string;
  body: string;
}

export const CALIBRATION_GATE = { acceptReplied: 0.7, rejectAiSdr: 0.85 } as const;

const replied = (id: string, frame: DraftFrame, persona: string, band: string, subject: string, body: string): CalibrationEmail => ({ id, label: "replied", frame, persona, band, subject, body });
const aiSdr = (id: string, persona: string, band: string, subject: string, body: string): CalibrationEmail => ({ id, label: "ai_sdr", frame: "4t", persona, band, subject, body });

export const CALIBRATION_SET: CalibrationEmail[] = [
  replied(
    "h01",
    "founder_card",
    "Controller",
    "120",
    "close after the billing hire",
    "Dana, the billing analyst post at Northwind asks the new hire to own usage reconciliation in their first 90 days. In the controllers I've talked to this year, that script tends to outlive the person who wrote it. I ran billing pipelines at a payments company for five years. Is reconciliation going to sit with the analyst, or stay with you?",
  ),
  replied(
    "h02",
    "founder_card",
    "Head of Platform",
    "60",
    "your on-call post",
    "Sam, your post on cutting pages by moving alerts to SLOs was the clearest take on that I've read this year. I'm researching how infra teams under 30 engineers decide what wakes someone up. Not a pitch: would you give me 20 minutes on where SLO alerts broke down for you?",
  ),
  replied(
    "h03",
    "founder_card",
    "VP Finance",
    "250",
    "the two systems at close",
    "Mei, your Q3 letter says usage pricing now drives most new revenue. When usage and invoices live in two systems, close tends to turn into a spreadsheet one analyst owns. I spent six years building billing at a public SaaS company. Does your team still tie usage to invoices by hand each month?",
  ),
  replied(
    "h04",
    "founder_card",
    "CTO",
    "35",
    "SOC 2 before the first enterprise deal",
    "Raj, your careers page lists a first security hire, and your pricing page added an enterprise tier in August. The first enterprise buyer usually asks for SOC 2 evidence before a pilot. I led compliance at a 40-person startup through that exact step. Is the security hire meant to own the audit, or is it landing on you?",
  ),
  replied(
    "h05",
    "founder_card",
    "Head of Data",
    "90",
    "dbt models and month-end",
    "Ben, you mentioned on the podcast that finance still pulls usage numbers from your dbt models by hand at month-end. That handoff is where most of the numbers I hear about go wrong. I built the data team at a usage-billed API company. Who owns the month-end pull today, your team or finance?",
  ),
  replied(
    "h06",
    "founder_card",
    "RevOps Lead",
    "150",
    "your renewal forecast thread",
    "Nadia, your thread on forecasting renewals from product usage got a lot of replies from other RevOps leads. Most of them seemed to rebuild the same sheet each quarter. I ran RevOps at two seat-to-usage pricing changes. Which signal do you trust most when a renewal starts to slip?",
  ),
  replied(
    "h07",
    "4t",
    "Controller",
    "80",
    "usage tiers and close",
    "Ana, your pricing page moved to usage tiers in June. When usage events and invoices sit in two systems, close often becomes a sheet only one analyst understands. A BI dashboard shows the gap, but it doesn't close it. Is invoicing straight from usage data on your list this quarter, or is that a next-year problem?",
  ),
  replied(
    "h08",
    "4t",
    "Head of Support",
    "200",
    "after the help center move",
    "Leo, your help center moved to a new vendor last month, per the changelog. Ticket tags rarely survive a move like that, so the weekly deflection report can quietly break for a while. Most teams notice when the numbers look too good. Are you still trusting last month's deflection rate?",
  ),
  replied(
    "h09",
    "4t",
    "VP Engineering",
    "110",
    "the second region",
    "Grace, your status page added an EU region in September. The second region is usually when deploy scripts that worked fine for years start to fork. Teams patch them by hand until one release goes out half-done. Has your release process been rebuilt for two regions yet, or is that still ahead?",
  ),
  replied(
    "h10",
    "4t",
    "Finance Lead",
    "45",
    "your new pricing calculator",
    "Theo, your site launched a pricing calculator last week. Calculators tend to promise numbers that billing then has to honor, line by line. The gap usually shows up in the first quarter's invoices. Who checks that the calculator and the invoices agree, you or the product team?",
  ),
  replied(
    "h11",
    "4t",
    "Director of IT",
    "400",
    "after the Okta rollout",
    "Priya, your job post for an identity engineer mentions finishing the Okta rollout. The last 10% of apps in a rollout like that are usually the old ones nobody owns. They stay on shared passwords for months. Do you know yet which apps will be left over?",
  ),
  replied(
    "h12",
    "problem_prompter",
    "VP Sales",
    "300",
    "the enterprise target",
    "Claire, your CEO's letter puts enterprise at half of new bookings next year. Enterprise deals tend to stall in security review, not in the demo. Most teams answer each questionnaire by hand and lose weeks per deal. Instead of a meeting, here's a question: who on your side owns security reviews today?",
  ),
  replied(
    "h13",
    "problem_prompter",
    "CFO",
    "500",
    "audit prep this year",
    "Marcus, your 10-K notes a material weakness in revenue recognition for usage contracts. Fixing that usually means a year of manual controls before the systems catch up. The controls tend to sit with two people who then can't take a vacation. Has the auditor agreed on a date for the remediation?",
  ),
  replied(
    "h14",
    "problem_prompter",
    "Chief Product Officer",
    "220",
    "pricing experiments",
    "Ivy, your roadmap post says pricing experiments are a priority for next half. Pricing tests at your size usually stall on billing changes, not on the idea. Engineering ends up hard-coding each test. Where does a pricing experiment get blocked today, product, billing or finance?",
  ),
  replied(
    "h15",
    "mouse_trap",
    "Controller",
    "70",
    "the reconciliation sheet",
    "Owen, your billing analyst post mentions reconciling usage to invoices every month. Would it help if that took an hour instead of three days?",
  ),
  replied(
    "h16",
    "mouse_trap",
    "Head of Platform",
    "140",
    "spend per service",
    "Raj, your KubeCon talk said cost alerts arrive a sprint too late. Would your teams look at spend per service if it showed up in the pull request?",
  ),
  replied(
    "h17",
    "mouse_trap",
    "Head of Security",
    "320",
    "the questionnaire backlog",
    "Nora, your security page now asks buyers to email for a questionnaire. Would you want those answered from what your stack already proves?",
  ),
  replied(
    "h18",
    "observation_problem_proof",
    "Controller",
    "95",
    "close in two days",
    "Ana, your team posted a role to automate the month-end close. The slow part is usually matching usage to invoices across two systems. Wrenfield cut their close from nine days to two after moving that match into one place. Is close time something you're measured on this year?",
  ),
  replied(
    "h19",
    "observation_problem_proof",
    "VP Engineering",
    "180",
    "deploys across regions",
    "Grace, your engineering blog says deploys now run in three regions. Fanning a release out by hand is where the half-done deploys come from. Lumenwire went from weekly rollbacks to one in a quarter after making regions one pipeline. Are rollbacks still part of your week?",
  ),
  replied(
    "h20",
    "observation_problem_proof",
    "Head of RevOps",
    "260",
    "renewal risk from usage",
    "Nadia, your team moved renewals onto usage-based plans this year. Renewal risk then shows up in product data weeks before the CRM notices. Rowanstack caught three slipping renewals a month earlier after watching usage drops. Which renewals are you most worried about next quarter?",
  ),

  aiSdr(
    "a01",
    "Controller",
    "120",
    "Quick question",
    "Hi Dana,\n\nI hope this email finds you well! I came across Northwind and was really impressed by your growth. Companies like yours often struggle with financial operations, and our AI-powered platform helps streamline reconciliation seamlessly.\n\nWould you be open to a quick 15-minute call next week to explore how we can help?\n\nBest,",
  ),
  aiSdr(
    "a02",
    "Head of Platform",
    "60",
    "Revolutionize your infrastructure",
    "Hi Sam,\n\nI wanted to reach out because I noticed you're the Head of Platform at Acme. Our cutting-edge solution empowers engineering teams to unlock 10x productivity with best-in-class observability.\n\nAre you the right person to speak with about this? If not, could you point me in the right direction?",
  ),
  aiSdr(
    "a03",
    "VP Finance",
    "250",
    "Re: our conversation",
    "Hi Mei,\n\nJust following up on my previous email! I know you're busy, but I'd love to show you how our robust platform can transform your finance team. We've helped hundreds of companies like yours save time and money.\n\nWhen works for a quick chat? Here's my calendar: https://cal.example/demo",
  ),
  aiSdr(
    "a04",
    "CTO",
    "35",
    "Congrats on the raise!",
    "Hi Raj,\n\nCongrats on the recent funding round! That's a huge milestone. As you scale, security will become crucial. Our innovative compliance solution helps startups like yours get SOC 2 ready in weeks, not months.\n\nWould you be interested in a demo? Or would a short case study be more helpful?",
  ),
  aiSdr(
    "a05",
    "Head of Data",
    "90",
    "Elevate your data stack",
    "Hi Ben,\n\nIn today's fast-paced data landscape, teams need tools that keep up. Our next-level platform seamlessly integrates with your existing stack to deliver transformative insights.\n\nI'd love to set up a time to walk you through it. Are you free Tuesday or Wednesday?",
  ),
  aiSdr(
    "a06",
    "RevOps Lead",
    "150",
    "Supercharge your pipeline",
    "Hi Nadia,\n\nI noticed that your company is growing fast and thought you might be interested in our AI SDR. It books meetings on autopilot so your team can focus on closing! Teams like yours see 3x more pipeline in the first month.\n\nOpen to learning more?",
  ),
  aiSdr(
    "a07",
    "Controller",
    "80",
    "Partnership opportunity",
    "Hi Ana,\n\nMy name is Jordan and I'm an account executive at FinFlow. We help finance leaders leverage automation to streamline close and unlock strategic value.\n\nI'd love to pick your brain about your current process and share a few ideas. Do you have 30 minutes this week?",
  ),
  aiSdr(
    "a08",
    "Head of Support",
    "200",
    "Your support team",
    "Hi Leo,\n\nI hope you're doing well. I wanted to touch base about your support operations. Our AI-powered helpdesk is a game-changer for teams that want to delight customers and reduce costs.\n\nCan we hop on a call this week? Let me know what time works best!",
  ),
  aiSdr(
    "a09",
    "VP Engineering",
    "110",
    "release management at Acme",
    "Grace, Acme looks like it's growing fast, and growth usually brings new release headaches. Engineering leaders tell us deploys get harder as teams scale. We built a tool that makes releases simpler and safer for teams of any size, with very little setup. Would it make sense to compare notes on how you handle releases today?",
  ),
  aiSdr(
    "a10",
    "Finance Lead",
    "45",
    "Saw your website",
    "Hi Theo,\n\nSaw your website and loved what you're building! Startups like yours often face challenges with billing as they scale. Our seamless billing solution can help you automate invoicing and boost revenue.\n\nWould love to connect. Are you free for a 20-minute call?",
  ),
  aiSdr(
    "a11",
    "Director of IT",
    "400",
    "Transform your identity management",
    "Hi Priya,\n\nI'm reaching out because identity management is more crucial than ever. Our robust platform empowers IT teams to unlock seamless access control across every app.\n\nI'd love to schedule a demo. Would next Thursday at 2pm work, or should I send over some materials first?",
  ),
  aiSdr(
    "a12",
    "VP Sales",
    "300",
    "sales coaching",
    "Claire, your company has a great reputation, and your sales team must be busy this quarter. Sales leaders we talk to want reps to ramp faster and coach more consistently. Our coaching tool gives every rep feedback after every call. Would your reps benefit from more consistent coaching this quarter?",
  ),
  aiSdr(
    "a13",
    "CFO",
    "500",
    "finance automation",
    "Marcus, as CFO you probably spend a lot of time on reporting and audits. Most finance leaders we meet want their teams focused on strategy instead of manual work. Our automation tool handles the repetitive parts of the close for you. Is giving your team more time for strategy something you care about this year?",
  ),
  aiSdr(
    "a14",
    "Chief Product Officer",
    "220",
    "Unlock pricing insights",
    "Hi Ivy,\n\nI came across your company and was impressed by your product! Our pricing intelligence solution helps product leaders leverage data to unlock revenue growth. It's not just a tool, it's a strategic partner.\n\nWould you be open to a brief call to explore synergies?",
  ),
  aiSdr(
    "a15",
    "Controller",
    "70",
    "month-end at your company",
    "Owen, I know month-end can be stressful for controllers. We work with finance teams of all sizes to make close faster and more accurate. Our customers usually see results within the first month, and setup takes an afternoon. Would you like to see how it could work for your team?",
  ),
  aiSdr(
    "a16",
    "Head of Platform",
    "140",
    "cloud costs",
    "Raj, cloud costs are top of mind for every platform leader right now. We help engineering teams see where their spend goes and act on it. It takes about ten minutes to connect your account and see your first report. Would it be useful to see where your cloud spend is going?",
  ),
  aiSdr(
    "a17",
    "Head of Security",
    "320",
    "Security made simple",
    "Hi Nora,\n\nIn today's ever-evolving threat landscape, security teams need a partner they can trust. Our world-class platform delivers robust protection and seamless compliance.\n\nWould you be open to exploring how we can help? I'd love to grab 15 minutes on your calendar.",
  ),
  aiSdr(
    "a18",
    "Controller",
    "95",
    "your finance team",
    "Ana, your finance team is clearly doing important work at a growing company. Finance teams tell us manual processes slow them down as they scale. We help teams like Ana's automate the busywork so they can focus on what matters. Is automating manual finance work on your roadmap?",
  ),
  aiSdr(
    "a19",
    "VP Engineering",
    "180",
    "developer productivity",
    "Grace, engineering teams everywhere are trying to ship faster with fewer people. We help engineering leaders measure and improve developer productivity across the whole team. Our dashboards show where time goes so you can fix bottlenecks early. Would better visibility into developer productivity help your team this year?",
  ),
  aiSdr(
    "a20",
    "Head of RevOps",
    "260",
    "forecast accuracy",
    "Nadia, forecast accuracy is something every RevOps leader thinks about. We help revenue teams get a clearer view of pipeline health so forecasts are more reliable. It connects to your CRM in minutes and needs no change to how reps work. Is improving forecast accuracy a priority for you this quarter?",
  ),
];

/**
 * Acceptance and rejection rates, and whether they clear the gate. No verdict (the critic call failed, ran
 * out of nudges, was refused) counts as accepted, because that's what compose does with it: the draft ships
 * unjudged (criticPassed(null)). A critic that fails on AI-SDR emails fails the gate instead of shrinking it.
 */
export function scoreCalibration(results: { id: string; label: CalibrationEmail["label"]; accepted: boolean | null }[]) {
  const asShipped = results.map((r) => ({ ...r, accepted: r.accepted ?? true }));
  const replied = asShipped.filter((r) => r.label === "replied");
  const aiSdr = asShipped.filter((r) => r.label === "ai_sdr");
  const acceptReplied = replied.length ? replied.filter((r) => r.accepted).length / replied.length : 0;
  const rejectAiSdr = aiSdr.length ? aiSdr.filter((r) => !r.accepted).length / aiSdr.length : 0;
  return {
    replied: replied.length,
    aiSdr: aiSdr.length,
    unjudged: results.filter((r) => r.accepted === null).length,
    acceptReplied,
    rejectAiSdr,
    passed: replied.length > 0 && aiSdr.length > 0 && acceptReplied >= CALIBRATION_GATE.acceptReplied && rejectAiSdr >= CALIBRATION_GATE.rejectAiSdr,
    misses: asShipped.filter((r) => (r.label === "replied" ? !r.accepted : r.accepted)).map((r) => r.id),
  };
}
