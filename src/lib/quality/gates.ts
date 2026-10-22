import { shortDate } from "@/lib/client/format";
import { isDataProvider } from "@/lib/connectors/catalog";
import { todayISO, weekOf } from "@/lib/domain/ids";
import type { ContactPath, DraftStep, Jurisdiction, OutreachPackage, Person, Workspace } from "@/lib/domain/types";
import { capUsage } from "./cap";
import { recentFirstTouch } from "./sequence";

/**
 * Pre-send gates, in code, at approval time. Drafts can be generated before the gates pass;
 * the founder fixes blockers inline (sender details, the recipient's address, a verification
 * checkbox) and the check updates live. Sources:
 *  - CAN-SPAM: opt-out + postal address in every commercial email (ftc.gov compliance guide)
 *  - GDPR Art. 14: name the actual source of the address by the first contact (gdpr-info.eu/art-14-gdpr)
 *  - CASL: conspicuous publication on a first-party page, relevant to the role
 */

export type EmailConfidence = "verified" | "published" | "role" | "guess" | "none";

export type BlockerCode =
  | "suppressed"
  | "do_not_contact"
  | "no_recipient"
  | "no_email"
  | "sender_incomplete"
  | "guess_unverified"
  | "guess_blocked"
  | "ca_unpublished"
  | "cap_week"
  | "cap_day"
  | "account_week"
  | "already_contacted";

export interface Blocker {
  code: BlockerCode;
  text: string;
  /** Which inline form fixes it, if any. */
  fix?: "sender" | "recipient" | "email" | "verify" | "linkedin";
}

export interface Preflight {
  channel: "email" | "linkedin" | "intro";
  to: string | null;
  path: ContactPath | null;
  emailConfidence: EmailConfidence;
  jurisdiction: { value: Jurisdiction; basis: "person_location" | "company_hq" | "unknown" };
  sourceHost: string | null;
  blockers: Blocker[];
  warnings: string[];
  /** Code-generated; the model never writes it. Null when the channel has none or the sender is incomplete. */
  footer: string | null;
  capRemainingThisWeek: number;
  capRemainingToday: number;
}

export const PERSONAL_DOMAINS = /@(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|mac|aol|proton|protonmail|pm|gmx|web|mail|yandex|zoho)\.[a-z.]+$/i;
const EMAIL_KINDS: ContactPath["kind"][] = ["published_email", "integration", "role_inbox", "pattern_guess"];

function host(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function localDate(iso: string): string {
  return todayISO(new Date(iso));
}

/** The address we'd send to and how much we trust it. Bounced paths never count. */
export function resolveEmail(person: Person | undefined): { to: string | null; path: ContactPath | null; confidence: EmailConfidence } {
  if (!person) return { to: null, path: null, confidence: "none" };
  const paths = person.contactPaths.filter((p) => EMAIL_KINDS.includes(p.kind) && !p.bounced && p.value.includes("@"));
  const byEmail = person.email ? paths.find((p) => p.value.toLowerCase() === person.email!.toLowerCase()) : undefined;
  const path = byEmail ?? (person.email ? undefined : paths.sort((a, b) => EMAIL_KINDS.indexOf(a.kind) - EMAIL_KINDS.indexOf(b.kind))[0]);
  const to = person.email ?? path?.value ?? null;
  if (!to) return { to: null, path: null, confidence: "none" };
  if (!path) return { to, path: null, confidence: "verified" }; // the founder typed it in
  const confidence: EmailConfidence =
    path.kind === "pattern_guess"
      ? path.verified || path.founderConfirmed
        ? "verified"
        : "guess"
      : path.kind === "role_inbox"
        ? "role"
        : path.kind === "published_email"
          ? path.verified
            ? "verified"
            : "published"
          : "verified";
  return { to, path, confidence };
}

export function jurisdictionFor(ws: Workspace, person: Person | undefined, domain: string): Preflight["jurisdiction"] {
  if (person?.location && person.jurisdiction && person.jurisdiction !== "unknown") return { value: person.jurisdiction, basis: "person_location" };
  const hq = ws.accounts[domain]?.dossier?.snapshot.jurisdiction;
  if (hq && hq !== "unknown") return { value: hq, basis: "company_hq" };
  if (person?.jurisdiction && person.jurisdiction !== "unknown") return { value: person.jurisdiction, basis: "person_location" };
  return { value: "unknown", basis: "unknown" };
}

export function senderComplete(ws: Workspace): boolean {
  const s = ws.sender;
  return Boolean(s?.name?.trim() && s.title?.trim() && s.company?.trim() && s.postalAddress?.trim());
}

/**
 * Cold first-touch counts for the cap: this week (Mon–Sun) and today. One counter for every surface
 * (see ./cap): LinkedIn, intros, replies to prospects and follow-ups don't count; cold event invites do.
 */
export { capUsage };

/** Bounces above 2% of the last 50 sends block every guessed address. */
function guessesBlockedByBounces(ws: Workspace): boolean {
  const sends = ws.activities.filter((a) => a.kind === "touch_sent" && a.channel === "email").slice(-50);
  if (sends.length < 10) return false;
  const since = sends[0].at;
  const bounces = ws.activities.filter((a) => a.kind === "bounce" && a.at >= since).length;
  return bounces / sends.length > 0.02;
}

export function buildFooter(
  ws: Workspace,
  opts: { jurisdiction: Jurisdiction; sourceHost: string | null; guessed: boolean; companyName: string },
): string | null {
  const s = ws.sender;
  if (!s || !senderComplete(ws)) return null;
  const lines = [`${s.name} · ${s.title}, ${s.company} · ${s.postalAddress.replace(/\s*\n\s*/g, ", ")}`, `If this isn't relevant, reply "no" and I won't follow up.`];
  const strict = opts.jurisdiction === "EU" || opts.jurisdiction === "UK" || opts.jurisdiction === "unknown";
  if (!strict) return lines.join("\n");
  const del = `Reply "stop" and I'll delete your details.`;
  if (opts.guessed) lines.push(`I guessed your work email from ${opts.companyName}'s address format. ${del}`);
  else if (opts.sourceHost) lines.push(`I found your work email on ${opts.sourceHost}. ${del}`);
  else lines.push(del);
  return lines.join("\n");
}

export function preflight(ws: Workspace, pkg: OutreachPackage, step: DraftStep | undefined, today = todayISO()): Preflight {
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  const account = ws.accounts[pkg.accountDomain];
  const companyName = account?.name ?? pkg.accountDomain;
  const channel: Preflight["channel"] = pkg.mode === "linkedin" ? "linkedin" : pkg.mode === "warm_intro" ? "intro" : "email";
  const { to, path, confidence: rawConfidence } = resolveEmail(person);
  const jurisdiction = jurisdictionFor(ws, person, pkg.accountDomain);
  const blockers: Blocker[] = [];
  const warnings: string[] = [];
  const caps = capUsage(ws, today);
  const confidence = rawConfidence;
  // An address from Apollo or FullEnrich names its source, verified or not; only our own format guesses say "guessed".
  const fromProvider = isDataProvider(path?.via);
  const sourceHost = path?.sourceUrl ? host(path.sourceUrl) : path?.kind === "integration" || fromProvider ? (path?.via ?? null) : null;

  const suppressed = ws.suppression.some(
    (s) => (s.email && to && s.email.toLowerCase() === to.toLowerCase()) || (s.domain && s.domain.toLowerCase() === pkg.accountDomain.toLowerCase()),
  );
  if (suppressed) blockers.push({ code: "suppressed", text: "They're on your suppression list." });
  else if (person?.doNotContact) blockers.push({ code: "do_not_contact", text: `${person.name} asked not to be contacted.` });

  const isOutbound = step && (step.status === "draft" || step.status === "approved");
  const isReply = pkg.mode === "reply";

  if (channel === "email" && isOutbound && !suppressed && !person?.doNotContact) {
    if (!person) blockers.push({ code: "no_recipient", text: "No recipient yet.", fix: "recipient" });
    else if (!to) blockers.push({ code: "no_email", text: `No email for ${person.name} yet.`, fix: "email" });

    if (!isReply && !senderComplete(ws)) {
      blockers.push({ code: "sender_incomplete", text: "Your sender details are missing.", fix: "sender" });
    }

    if (to && !isReply) {
      const eu = jurisdiction.value === "EU" || jurisdiction.value === "UK";
      const guessed = path?.kind === "pattern_guess" && !path.verified;
      if (guessed && (eu || guessesBlockedByBounces(ws))) {
        blockers.push({
          code: "guess_blocked",
          text: eu ? "EU/UK: I can't email a guessed address. LinkedIn or a warm intro works." : "Your recent bounce rate is over 2%, so guessed addresses are paused.",
          fix: "linkedin",
        });
      } else if (rawConfidence === "guess") {
        blockers.push({
          code: "guess_unverified",
          text: fromProvider ? `Unverified address: ${path?.via} couldn't confirm the mailbox.` : "Unverified address: a guess from their email format.",
          fix: "verify",
        });
      }
      if (jurisdiction.value === "CA") {
        const firstParty = path?.kind === "published_email" && sourceHost && sourceHost.endsWith(pkg.accountDomain);
        if (!firstParty) blockers.push({ code: "ca_unpublished", text: "Canada (CASL): only addresses published on their own site. Try LinkedIn or an intro.", fix: "linkedin" });
      }
      if (eu && !sourceHost && !guessed) warnings.push("EU/UK: note where you found this address. GDPR Art. 14 asks you to tell them.");
      if (PERSONAL_DOMAINS.test(to)) warnings.push("Personal address. If they're a sole trader, UK and EU rules need consent first.");
      if (rawConfidence === "role") warnings.push("Role inbox. Replies are rarer than to a named person.");
    }

    if (pkg.mode === "cold" && step?.step === 1 && step.status === "draft") {
      if (caps.remainingWeek <= 0) blockers.push({ code: "cap_week", text: `You've sent ${caps.thisWeek} first touches this week, your cap. More slots open Monday.` });
      else if (caps.remainingToday <= 0) blockers.push({ code: "cap_day", text: `${caps.today} first touches today is the daily cap. Send this tomorrow.` });
      const weekStart = weekOf(today);
      const others = new Set(
        ws.activities
          .filter((a) => a.kind === "touch_sent" && a.channel === "email" && a.accountDomain === pkg.accountDomain && a.personId !== pkg.personId && localDate(a.at) >= weekStart)
          .map((a) => a.personId),
      );
      if (others.size >= ws.caps.contactsPerAccountPerWeek) {
        blockers.push({ code: "account_week", text: `You've already written to ${others.size} people at ${companyName} this week. Give it until Monday.` });
      }
      // A second, unrelated first touch to the same person lands in their inbox on a separate thread.
      const earlier = pkg.personId
        ? Object.values(ws.outreach)
            .filter((p) => p.id !== pkg.id && p.mode === "cold" && p.personId === pkg.personId)
            .map((p) => recentFirstTouch(p, today))
            .find(Boolean)
        : undefined;
      if (earlier) {
        blockers.push({ code: "already_contacted", text: `You already emailed ${person?.name ?? "them"} on ${shortDate(earlier.sentAt ?? today)}. Follow up in that thread instead.` });
      }
    }
  }

  const footer =
    channel === "email" && !isReply
      ? buildFooter(ws, { jurisdiction: jurisdiction.value, sourceHost, guessed: path?.kind === "pattern_guess" && !path.verified && !fromProvider, companyName })
      : null;

  return {
    channel,
    to,
    path,
    emailConfidence: confidence,
    jurisdiction,
    sourceHost,
    blockers,
    warnings,
    footer,
    capRemainingThisWeek: caps.remainingWeek,
    capRemainingToday: caps.remainingToday,
  };
}

/** Sign-off line: the founder's own, from the voice card, else their first name. */
export function signOff(ws: Workspace): string {
  const own = ws.voice?.signOff?.trim();
  if (own) return own;
  const name = (ws.sender?.name || ws.founder.name || "").trim().split(/\s+/)[0];
  return name ?? "";
}

/** Exactly what the recipient reads: body, sign-off, footer. */
export function outgoingText(ws: Workspace, body: string, footer: string | null): string {
  const parts = [body.trim()];
  const so = signOff(ws);
  if (so) parts.push(so);
  if (footer) parts.push(footer);
  return parts.join("\n\n");
}
