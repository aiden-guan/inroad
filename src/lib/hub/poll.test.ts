import { describe, expect, it } from "vitest";
import { NOW, makeAccount, makePerson, makeWorkspace } from "@/test/factories";
import { applyCrm } from "./poll";

/** What a CRM poll does with the contacts it pulls (research 07: the CRM owns contacts). */
describe("applyCrm", () => {
  const changes = (people: { email: string; name: string; title?: string }[]) => ({ companies: [], people, deals: [], cursor: {} });

  it("files contacts at companies already here, but never someone who asked to be deleted", () => {
    const ws = makeWorkspace({ accounts: { "northwind.com": makeAccount("northwind.com") }, people: { per_dana: makePerson("per_dana", "northwind.com") } });
    ws.suppression.push({ id: "sup_ana", email: "ana@northwind.com", reason: "requested_delete", at: NOW.toISOString() });
    const out = applyCrm(
      ws,
      "hubspot",
      changes([
        { email: "Ana@northwind.com", name: "Ana Ruiz", title: "CFO" },
        { email: "lee@northwind.com", name: "Lee Park", title: "Controller" },
        { email: "kim@elsewhere.com", name: "Kim Ode" },
      ]),
      new Map(),
      {},
      NOW.toISOString(),
    );
    const emails = Object.values(ws.people).map((p) => p.email);
    expect(emails).toContain("lee@northwind.com");
    expect(emails).not.toContain("ana@northwind.com");
    expect(emails).not.toContain("kim@elsewhere.com");
    expect(out.people).toBe(1);
  });
});
