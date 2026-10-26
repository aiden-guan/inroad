import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Connector, Workspace } from "@/lib/domain/types";
import { computeMoves } from "@/lib/moves/rules";
import { NOW, TODAY, at, makeAccount, makePackage, makePerson, makeSignal, makeStep, makeWorkspace } from "@/test/factories";
import { listMessage, listTarget, reachFor } from "./list";

const ivy = (patch: Partial<Connector> = {}): Connector => ({ id: "con_ivy", name: "Ivy Chen", relationship: "investor", introsMade: 0, email: "ivy@alder.vc", ...patch });

/** Prospects with no warm path, fit 90 down, none touched yet. */
function desk(domains: string[], connector: Connector): Workspace {
  const ws = makeWorkspace({ founder: { name: "Priya Raman" }, onboarding: { status: "hired", hiredAt: at(-30) }, connectors: [connector] });
  domains.forEach((d, i) => {
    ws.accounts[d] = makeAccount(d, { fitScore: 90 - i, peopleIds: [`per_${i}`], oneLiner: "Usage-billing API for logistics teams", signals: [makeSignal(`s${i}`, { headline: `${d} is hiring a controller` })] });
    ws.people[`per_${i}`] = makePerson(`per_${i}`, d, { name: `Pat ${i}`, title: "Controller" });
  });
  return ws;
}
const asks = (ws: Workspace) => computeMoves(ws, NOW).filter((m) => ["today.connector", "today.connector_list", "today.connector_marks"].includes(m.rule));

describe("connector asks follow who the connector can reach", () => {
  it("never pairs a connector with a company their reach doesn't name (the audit's Ivy and Acme)", () => {
    const ws = desk(["acme.example"], ivy({ reach: ["stripe.com", "fintech CFOs"] }));
    expect(asks(ws)).toEqual([]);
  });

  it("asks for the company their reach names, a domain or where they work before a topic", () => {
    const ws = desk(["acme.example", "beta.example"], ivy({ reach: ["logistics founders", "beta.example"] }));
    const [m] = asks(ws);
    expect(m).toMatchObject({ rule: "today.connector", title: "Ask Ivy for an intro to Beta", ref: { kind: "account", id: "beta.example" }, subjectIds: ["con_ivy"] });
    expect(m.why).toBe("Investor · reaches “beta.example” · 0 of 4 intro asks this week");
    expect(reachFor(ivy({ reach: ["logistics founders"] }), ws.accounts["acme.example"])).toEqual({ entry: "logistics founders", exact: false });
    expect(reachFor(ivy({ company: "Acme" }), ws.accounts["acme.example"])).toEqual({ entry: "Acme", exact: true });
  });
});

describe("the list to mark", () => {
  const four = ["a1.example", "a2.example", "a3.example", "a4.example"];

  it("offers a list instead of a blind ask when nobody's reach names a target", () => {
    const ws = desk(four, ivy({ reach: ["stripe.com"] }));
    const [m] = asks(ws);
    expect(m).toMatchObject({ id: "mv_connlist_con_ivy_2026-10-19", title: "Send Ivy your top 4 targets to mark", subjectIds: ["con_ivy", ...four] });
    expect(m.why).toBe("Investor · a short list to mark beats a blind ask · 0 of 4 intro asks this week");
    // Not for a customer, and not for fewer than three targets.
    expect(asks(desk(four, ivy({ relationship: "customer" })))).toEqual([]);
    expect(asks(desk(four.slice(0, 2), ivy()))).toEqual([]);
  });

  it("writes the list in code: company, who, why, one easy question", () => {
    const ws = desk(four.slice(0, 2), ivy());
    const targets = ["a1.example", "a2.example"].map((d) => listTarget(ws, ws.accounts[d], TODAY));
    expect(listMessage(ws, ws.connectors[0], targets)).toEqual({
      to: "ivy@alder.vc",
      subject: "2 companies I'd love to meet",
      body: [
        "Hi Ivy,",
        "",
        "Here are 2 companies I'd love to meet. Could you mark any where you'd be comfortable making an introduction? No pressure on any of them, and I'll write a note you can forward as is.",
        "",
        "1. A1 (a1.example) · Pat 0, Controller",
        "   a1.example is hiring a controller",
        "2. A2 (a2.example) · Pat 1, Controller",
        "   a2.example is hiring a controller",
        "",
        "Thank you,",
        "Priya",
      ].join("\n"),
    });
  });

  it("counts as the ask, asks what they marked the next day, and drafts only the marked rows", () => {
    const ws = desk(four, ivy());
    applyAction(ws, { type: "connector.sendList", id: "con_ivy", domains: four, at: at(0) });
    expect(asks(ws)).toEqual([]); // resting, and the marks question waits a day
    const tomorrow = new Date(2026, 9, 21, 9, 30);
    const [marks] = computeMoves(ws, tomorrow).filter((m) => m.rule === "today.connector_marks");
    expect(marks).toMatchObject({ id: `mv_connmarks_con_ivy_${TODAY}`, title: "Record which targets Ivy marked", subjectIds: ["con_ivy"] });
    expect(marks.why).toBe("4 targets sent Oct 20 · forwardables only for the ones they mark");
    applyAction(ws, { type: "connector.markList", id: "con_ivy", marked: ["a2.example", "a4.example"], at: at(1) });
    expect(computeMoves(ws, tomorrow).filter((m) => m.rule === "today.connector_marks")).toEqual([]);
  });

  it("gives each forwardable drafted for one connector in a week its own card", () => {
    const ws = desk(four, ivy());
    for (const [i, d] of ["a2.example", "a4.example"].entries()) {
      ws.outreach[`pkg_${i}`] = makePackage(`pkg_${i}`, d, { mode: "warm_intro", connectorId: "con_ivy", personId: ws.accounts[d].peopleIds[0], createdAt: at(0, `09:0${i}`), steps: [makeStep(1)], intro: { connectorName: "Ivy Chen", wrapper: "w", forwardable: { subject: "s", body: "b" } } });
    }
    const drafts = computeMoves(ws, NOW).filter((m) => m.rule === "today.intro_draft").map((m) => m.id);
    expect(drafts).toHaveLength(2);
    expect(new Set(drafts).size).toBe(2);
  });
});
