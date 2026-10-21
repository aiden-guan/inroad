/**
 * Intro engine checks. Run: npx tsx src/lib/intros/rules.test.ts
 * Plain node:assert, no test runner: whose move it is at every stage, the one-nudge rule, the
 * connector ledger, "ways in" ranking, the reducer's double opt-in, and the drafted notes.
 */
import assert from "node:assert/strict";
import { applyAction } from "@/lib/domain/actions";
import { addDays } from "@/lib/domain/ids";
import type { Connection, Connector, Intro, Workspace } from "@/lib/domain/types";
import { sampleWorkspace } from "@/lib/sample";
import { ledger, nextStep, reachMatch, waysIn, yourMoves } from "./rules";
import { messageFor } from "./templates";

const TODAY = "2026-10-21";
const results: string[] = [];
function check(name: string, fn: () => void) {
  fn();
  results.push(name);
  console.log(`  ok   ${name}`);
}

function base(): Workspace {
  const ws = sampleWorkspace(new Date(`${TODAY}T10:00:00`));
  ws.intros = {};
  return ws;
}

function ask(over: Partial<Intro> = {}): Intro {
  return {
    id: "i1",
    kind: "ask",
    stage: "asked",
    connectorId: "con_x",
    connectorName: "Claire Donovan",
    accountDomain: "quayside.example",
    targetName: "Rafael Ortiz, VP Finance",
    askedOn: TODAY,
    history: [],
    createdAt: `${TODAY}T09:00:00.000Z`,
    updatedAt: `${TODAY}T09:00:00.000Z`,
    ...over,
  };
}

const connector = (over: Partial<Connector> = {}): Connector => ({ id: "con_x", name: "Claire Donovan", relationship: "investor", introsMade: 0, ...over });

console.log("intros");

check("asked: the connector's move until day 5, then one nudge, then let it go a week later", () => {
  const ws = base();
  assert.equal(nextStep(ask({ askedOn: addDays(TODAY, -2) }), ws, TODAY).owner, "connector");
  const due = nextStep(ask({ askedOn: addDays(TODAY, -5) }), ws, TODAY);
  assert.equal(due.owner, "you");
  assert.equal(due.action, "nudge");
  const nudged = nextStep(ask({ askedOn: addDays(TODAY, -8), nudgedOn: addDays(TODAY, -3) }), ws, TODAY);
  assert.equal(nudged.owner, "connector", "after the nudge it's their move again, never a second nudge");
  const quiet = nextStep(ask({ askedOn: addDays(TODAY, -15), nudgedOn: addDays(TODAY, -7) }), ws, TODAY);
  assert.equal(quiet.action, "let_go");
  assert.equal(quiet.overdueDays, undefined, "due today, not late");
});

check("forwarded: waiting on the target, one check-in after a week", () => {
  const ws = base();
  const waiting = nextStep(ask({ stage: "forwarded", askedOn: addDays(TODAY, -6), forwardedOn: addDays(TODAY, -3) }), ws, TODAY);
  assert.equal(waiting.owner, "target");
  const check = nextStep(ask({ stage: "forwarded", askedOn: addDays(TODAY, -10), forwardedOn: addDays(TODAY, -7) }), ws, TODAY);
  assert.equal(check.action, "check_in");
});

check("introduced: reply within a day, then one follow-up to book; a held meeting asks for the thank-you", () => {
  const ws = base();
  assert.equal(nextStep(ask({ stage: "introduced", introducedOn: TODAY }), ws, TODAY).action, "reply");
  const replied = ask({ stage: "introduced", introducedOn: addDays(TODAY, -6), repliedOn: addDays(TODAY, -5) });
  assert.equal(nextStep(replied, ws, TODAY).action, "book");
  assert.equal(nextStep({ ...replied, nudgedOn: addDays(TODAY, -1) }, ws, TODAY).owner, "target");
  const met = nextStep(ask({ stage: "meeting", introducedOn: addDays(TODAY, -6), repliedOn: addDays(TODAY, -6), meetingOn: addDays(TODAY, -2) }), ws, TODAY);
  assert.equal(met.action, "close_loop");
  assert.equal(nextStep(ask({ stage: "done", thankedOn: TODAY }), ws, TODAY).owner, null);
});

check("give: nothing moves until both sides said yes", () => {
  const ws = base();
  const give: Intro = {
    ...ask(),
    kind: "give",
    connectorId: undefined,
    sides: [
      { name: "Ava Whitman", why: "x", consent: "pending" },
      { name: "Marcus Lindqvist", why: "y", consent: "pending" },
    ],
  };
  const first = nextStep(give, ws, TODAY);
  assert.equal(first.action, "nudge");
  assert.equal(first.side, 0, "ask the first side first");
  ws.intros[give.id] = give;
  applyAction(ws, { type: "intro.mark", id: give.id, field: "askedOn", side: 0, at: `${TODAY}T10:00:00.000Z` });
  applyAction(ws, { type: "intro.consent", id: give.id, side: 0, consent: "yes", at: `${TODAY}T10:00:00.000Z` });
  const second = nextStep(ws.intros[give.id], ws, TODAY);
  assert.equal(second.side, 1);
  applyAction(ws, { type: "intro.consent", id: give.id, side: 1, consent: "yes", at: `${TODAY}T11:00:00.000Z` });
  assert.equal(nextStep(ws.intros[give.id], ws, TODAY).action, "send_intro");
  applyAction(ws, { type: "intro.advance", id: give.id, stage: "introduced", at: `${TODAY}T12:00:00.000Z`, activityId: "act_t" });
  assert.equal(ws.activities.at(-1)?.kind, "intro_made");
  assert.equal(nextStep(ws.intros[give.id], ws, addDays(TODAY, 14)).action, "check_how");
});

check("give: one side passing closes it, and the other side is never told", () => {
  const ws = base();
  ws.intros.g = { ...ask({ id: "g" }), kind: "give", sides: [{ name: "A B", why: "x", consent: "pending", askedOn: TODAY }, { name: "C D", why: "y", consent: "pending" }] };
  applyAction(ws, { type: "intro.consent", id: "g", side: 0, consent: "no", at: `${TODAY}T10:00:00.000Z` });
  assert.equal(ws.intros.g.stage, "declined");
  assert.equal(ws.intros.g.sides![1].askedOn, undefined);
});

check("approving a warm-intro draft opens a tracked intro once and marks the connector asked", () => {
  const ws = base();
  const pkg = Object.values(ws.outreach).find((p) => p.mode === "warm_intro")!;
  const step = pkg.steps[0].step;
  applyAction(ws, { type: "outreach.approveStep", packageId: pkg.id, step, at: `${TODAY}T10:00:00.000Z`, activityId: "act_a" });
  const intro = ws.intros[`intro_${pkg.id}`];
  assert.ok(intro);
  assert.equal(intro.stage, "asked");
  assert.equal(intro.packageId, pkg.id);
  applyAction(ws, { type: "outreach.approveStep", packageId: pkg.id, step, at: `${TODAY}T10:05:00.000Z`, activityId: "act_b" });
  assert.equal(Object.values(ws.intros).filter((i) => i.packageId === pkg.id).length, 1);
  const c = ws.connectors.find((x) => x.id === intro.connectorId);
  if (c) assert.equal(c.lastAskedOn, TODAY);
});

check("undoing a sent intro ask removes its intro and restores the connector's last ask", () => {
  const ws = base();
  const pkg = Object.values(ws.outreach).find((p) => p.mode === "warm_intro")!;
  const c = ws.connectors.find((x) => x.id === pkg.connectorId || x.name === pkg.intro?.connectorName)!;
  const before = c.lastAskedOn;
  const step = pkg.steps[0].step;
  applyAction(ws, { type: "outreach.approveStep", packageId: pkg.id, step, at: `${TODAY}T10:00:00.000Z`, activityId: "act_u" });
  assert.ok(ws.intros[`intro_${pkg.id}`]);
  applyAction(ws, { type: "outreach.unapproveStep", packageId: pkg.id, step, activityId: "act_u" });
  assert.equal(ws.intros[`intro_${pkg.id}`], undefined);
  assert.equal(ws.connectors.find((x) => x.id === c.id)!.lastAskedOn, before);
});

check("introduced counts once on the connector, even when the stage is set twice", () => {
  const ws = base();
  ws.connectors.push(connector());
  ws.intros.i1 = ask();
  applyAction(ws, { type: "intro.advance", id: "i1", stage: "introduced", at: `${TODAY}T10:00:00.000Z` });
  applyAction(ws, { type: "intro.advance", id: "i1", stage: "meeting", at: `${TODAY}T11:00:00.000Z` });
  applyAction(ws, { type: "intro.advance", id: "i1", stage: "introduced", at: `${TODAY}T12:00:00.000Z` });
  assert.equal(ws.connectors.find((c) => c.id === "con_x")!.introsMade, 1);
  assert.equal(ws.activities.filter((a) => a.kind === "intro_made" && a.summary.includes("Claire")).length, 1);
});

check("ledger: one open ask at a time, two weeks' rest, give before a fourth ask", () => {
  const ws = base();
  const c = connector({ relationship: "advisor" });
  ws.connectors.push(c);
  ws.intros.a = ask({ id: "a", askedOn: addDays(TODAY, -2) });
  assert.equal(ledger(ws, c, TODAY).status, "in_flight");
  ws.intros.a = ask({ id: "a", stage: "done", askedOn: addDays(TODAY, -5), thankedOn: TODAY });
  assert.equal(ledger(ws, c, TODAY).status, "resting");
  ws.intros.a = ask({ id: "a", stage: "done", askedOn: addDays(TODAY, -60) });
  ws.intros.b = ask({ id: "b", stage: "declined", askedOn: addDays(TODAY, -40) });
  ws.intros.c = ask({ id: "c", stage: "no_answer", askedOn: addDays(TODAY, -20) });
  assert.equal(ledger(ws, c, TODAY).status, "give_first");
  c.gives = [{ at: addDays(TODAY, -3), what: "Sent a customer lead" }];
  assert.equal(ledger(ws, c, TODAY).status, "ready");
  assert.equal(ledger(ws, { ...c, relationship: "investor", gives: [] }, TODAY).status, "ready", "investors don't owe a give");
});

check("reach matching: domains and names are exact, industry words are topic, generic words match nothing", () => {
  const acc = { domain: "northwind.example", name: "Northwind Metrics", oneLiner: "Kubernetes observability, priced per GB ingested.", tags: [] };
  assert.equal(reachMatch("northwind.example", acc), "exact");
  assert.equal(reachMatch("Northwind Metrics", acc), "exact");
  assert.equal(reachMatch("ex-Northwind folks", acc), "exact");
  assert.equal(reachMatch("observability founders", acc), "topic");
  assert.equal(reachMatch("usage-priced SaaS founders", acc), null);
  assert.equal(reachMatch("fintech CFOs", acc), null);
});

check("ways in: direct first, then insiders, connectors and alumni, with blocking concerns sorted last", () => {
  const ws = base();
  const acc = ws.accounts["glassmoor.example"];
  const rows: Connection[] = [
    { id: "cn1", firstName: "Nina", lastName: "Park", url: "https://www.linkedin.com/in/nina-park", company: "Glassmoor", companyNorm: "glassmoor", matchedDomain: acc.domain, position: "VP Engineering" },
    { id: "cn2", firstName: "Omar", lastName: "Haddad", url: "https://www.linkedin.com/in/omar-h", company: "Other Co", companyNorm: "other co", position: "CFO", history: [{ company: "Glassmoor", position: "Controller", seenOn: "2024-03-01" }] },
  ];
  const ways = waysIn(ws, acc.domain, rows, TODAY);
  const kinds = ways.map((w) => w.kind);
  assert.ok(kinds.includes("inside"), "a connection who works there");
  assert.ok(kinds.includes("alumni"), "a connection who used to work there");
  assert.ok(kinds.includes("connector"), "Ines listed glassmoor.example");
  assert.ok(ways.indexOf(ways.find((w) => w.kind === "inside")!) < ways.indexOf(ways.find((w) => w.kind === "alumni")!));
  for (let i = 1; i < ways.length; i++) assert.ok(!(ways[i].ready && !ways[i - 1].ready), "ready paths come first");
});

check("ways in: a connector who passed on this company isn't suggested as ready for 90 days", () => {
  const ws = base();
  const c = ws.connectors.find((x) => x.reach?.includes("glassmoor.example"))!;
  ws.intros.p = ask({ id: "p", connectorId: c.id, connectorName: c.name, accountDomain: "glassmoor.example", stage: "declined", askedOn: addDays(TODAY, -30), closedOn: addDays(TODAY, -28) });
  const way = waysIn(ws, "glassmoor.example", [], TODAY).find((w) => w.via.connectorId === c.id)!;
  assert.equal(way.ready, false);
  assert.ok(way.concerns.some((x) => /passed/.test(x)));
});

check("your moves: the reply to an intro outranks a nudge", () => {
  const ws = base();
  ws.intros.n = ask({ id: "n", askedOn: addDays(TODAY, -9) });
  ws.intros.r = ask({ id: "r", stage: "introduced", introducedOn: TODAY });
  assert.deepEqual(
    yourMoves(ws, TODAY).map((m) => m.intro.id),
    ["r", "n"],
  );
});

check("notes: short, no em dashes or exclamation marks, connector's email on the To line", () => {
  const ws = base();
  ws.connectors.push(connector({ email: "claire@fund.example" }));
  const intro = ask({ stage: "introduced", introducedOn: TODAY, repliedOn: undefined });
  for (const action of ["nudge", "check_in", "let_go", "reply", "book", "close_loop", "thank"] as const) {
    const m = messageFor(action, intro, ws, TODAY);
    assert.ok(m.body.length > 20 && m.body.length < 600, action);
    assert.ok(!/[—!]/.test(m.body), `${action} has no em dash or exclamation mark`);
  }
  assert.equal(messageFor("nudge", intro, ws, TODAY).to, "claire@fund.example");
  assert.match(messageFor("reply", intro, ws, TODAY).body, /BCC/);
});

console.log(`\nall passing (${results.length})`);
