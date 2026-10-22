import { todayISO } from "@/lib/domain/ids";
import type { Account, Activity, Angle, DraftStep, OutreachPackage, Person, PersonaRole, SignalType, TouchTags, Workspace } from "@/lib/domain/types";
import { activeBet, betArmFor } from "./bets";

/**
 * What a send was written with, stamped once when the founder sends it, so the Friday and monthly reviews
 * compare real sends by signal, frame, POV, persona and subject style (SPEC §6 Activity.tags). Pure: the
 * reducer runs it on both sides of an approval.
 */

/** The channel a send went out on, for the reviews: a pushed draft goes out as what it was written for. */
export function sendChannel(ws: Workspace, a: Activity): string {
  if (a.kind === "linkedin_dm" || a.kind === "linkedin_connect") return "linkedin";
  if (a.kind === "intro_requested") return "intro";
  if (a.kind === "pushed") return ws.outreach[a.draftRef?.packageId ?? ""]?.mode === "linkedin" ? "linkedin" : "email";
  return a.channel ?? "email";
}

/** The account signal this draft rests on: the angle's own signal, else one its evidence shows, else the freshest usable one. */
export function signalTypeFor(account: Account | undefined, angleId: string | undefined, evidenceIds: string[] = []): SignalType | undefined {
  if (!account) return undefined;
  const usable = account.signals.filter((s) => s.type !== "sensitive");
  // Angles drafted straight from a signal (no dossier yet) carry its id.
  if (angleId?.startsWith("sig_")) {
    const hit = usable.find((s) => s.id === angleId.slice(4));
    if (hit) return hit.type;
  }
  const angle = angleId ? account.dossier?.angles.find((a) => a.id === angleId) : undefined;
  const ids = new Set([...(angle?.evidenceIds ?? []), ...evidenceIds]);
  const cited = usable.filter((s) => s.evidenceId && ids.has(s.evidenceId)).sort((a, b) => b.strength - a.strength || b.date.localeCompare(a.date))[0];
  if (cited) return cited.type;
  return usable.filter((s) => s.usableInOutreach).sort((a, b) => b.strength - a.strength || b.date.localeCompare(a.date))[0]?.type;
}

/** The persona a person was written to as: their role, else the playbook persona their title matches. */
export function personaRole(ws: Workspace, person: Person | undefined): PersonaRole | undefined {
  if (!person) return undefined;
  if (person.role) return person.role;
  const title = person.title.toLowerCase();
  if (!title) return undefined;
  return (ws.foundation?.personas ?? []).find((p) => p.titles.some((t) => t && title.includes(t.toLowerCase())))?.role;
}

const STOP = new Set(
  "about after again also among because been before being between both cannot could does doing down during each from further have having here into itself just more most much must once only other over same should some such than that their them then there these they this those through under until very were what when where which while whom with would your yours".split(" "),
);
const TRIGGER = /\b(hir(e|es|ed|ing)|rais(e|ed|ing)|funding|series [a-e]|seed|launch(ed|es|ing)?|new (role|job|head|vp|cfo|cto|leader)|joined|job post|posting|opening|expan(d|sion)|acqui(red|sition)|ipo|rebrand|migrat(e|ion|ing))\b/i;

function stem(w: string): string {
  return w.replace(/(ings?|ed|es|s)$/, "");
}

function contentWords(text: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? []) {
    if (!STOP.has(w)) out.add(stem(w));
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/**
 * Whether a subject names the trigger (their news: a hire, a raise, a launch), the problem, or neither. Words are
 * matched against the angle's signal on one side and its pressure, POV and the persona's pains on the other.
 */
export function subjectStyle(subject: string | null | undefined, angle: Pick<Angle, "signal" | "title" | "pressure" | "pov" | "interpretation"> | undefined, pains: string[] = []): TouchTags["subjectStyle"] {
  const words = contentWords(subject ?? "");
  if (!words.size) return undefined;
  const trigger = overlap(words, contentWords(angle?.signal)) + (TRIGGER.test(subject ?? "") ? 1 : 0);
  const problem = overlap(words, contentWords([angle?.pressure, angle?.pov, angle?.interpretation, ...pains].filter(Boolean).join(" ")));
  if (!trigger && !problem) return "other";
  return trigger >= problem ? "trigger" : "problem";
}

function angleOf(account: Account | undefined, angleId: string | undefined): Angle | undefined {
  if (!account || !angleId) return undefined;
  const fromDossier = account.dossier?.angles.find((a) => a.id === angleId);
  if (fromDossier) return fromDossier;
  if (!angleId.startsWith("sig_")) return undefined;
  const s = account.signals.find((x) => x.id === angleId.slice(4));
  return s ? { id: angleId, title: s.headline, signal: s.headline, interpretation: s.implication, pressure: "", pov: "", proof: null, ask: "", evidenceIds: s.evidenceId ? [s.evidenceId] : [], bestFor: "champion", strength: 3 } : undefined;
}

/** The signal type and tags an activity for this sent step carries. Undefined fields are left out. */
export function touchTags(ws: Workspace, pkg: OutreachPackage, step: DraftStep, at: string): Pick<Activity, "signalType" | "tags"> {
  const account = ws.accounts[pkg.accountDomain];
  const angleId = step.angleId ?? pkg.angleId;
  const person = pkg.personId ? ws.people[pkg.personId] : undefined;
  const persona = personaRole(ws, person);
  const signalType = pkg.mode === "reply" ? undefined : (step.signalType ?? signalTypeFor(account, angleId, step.evidenceIds));
  const pains = (ws.foundation?.personas ?? []).find((p) => p.role === persona)?.pains ?? [];
  const firstTouch = step.step === 1 && (pkg.mode === "cold" || pkg.mode === "linkedin");
  // Writing bets were stamped on the draft; targeting bets (persona, signal, channel) are matched from the send itself.
  const bet = step.bet ?? (firstTouch ? betArmFor(activeBet(ws, todayISO(new Date(at))), { persona, signalType, channel: pkg.mode === "linkedin" ? "linkedin" : "email" }) : undefined);
  const tags: TouchTags = {
    frame: step.frame,
    povId: step.povId,
    credentialClaimId: step.credentialClaimId,
    persona,
    subjectStyle: step.thread === "new" ? subjectStyle(step.subject, angleOf(account, angleId), pains) : undefined,
    bet,
  };
  for (const k of Object.keys(tags) as (keyof TouchTags)[]) if (tags[k] === undefined) delete tags[k];
  return { ...(signalType ? { signalType } : {}), ...(Object.keys(tags).length ? { tags } : {}) };
}
