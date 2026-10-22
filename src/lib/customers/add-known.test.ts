import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importConnections, knowsProduct } from "@/lib/network/import";
import { readConnections, updateConnections } from "@/lib/network/store";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { DATA_DIR } from "@/lib/store/settings";
import { readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { makeAccount, makeWorkspace } from "@/test/factories";
import { routeFetches } from "@/test/http-fixtures";
import { addKnownUsers } from "./add-known";

/**
 * Onboarding's "last 3 users" become customers in one click: the account (status customer, tagged), the
 * named person as champion, their LinkedIn connection tagged, and job-change tracking for everyone who
 * worked there. A bare name is placed by its own homepage, never guessed. No network.
 */

vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

function serve(routes: Parameters<typeof routeFetches>[0]) {
  const r = routeFetches(routes);
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
}

beforeEach(async () => {
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
  (globalThis as Record<string, unknown>).__inroadYc = undefined;
  await updateConnections((rows) => void rows.splice(0, rows.length));
  await replaceWorkspace(
    makeWorkspace({
      company: { name: "Ledgerline", domain: "ledgerline.io" } as never,
      accounts: { "northwind.io": makeAccount("northwind.io", { name: "Northwind", status: "new", watch: true }) },
    }),
  );
  serve({ "https://globex.com": `<html><head><title>Globex | Usage billing</title></head></html>` });
});

describe("adding the founder's users as customers", () => {
  it("creates or updates each as a tagged customer, with the named person as champion", async () => {
    const r = await addKnownUsers({
      users: [{ name: "Acme", domain: "acme.com" }, { name: "Northwind", domain: "northwind.io" }, { name: "Globex", person: "Dana" }, { name: "Nowhere Labs" }, { name: "Ledgerline", domain: "ledgerline.io" }],
      kind: "design_partner",
    });
    expect(r).toEqual({
      added: [
        { domain: "acme.com", name: "Acme" },
        { domain: "northwind.io", name: "Northwind" },
        { domain: "globex.com", name: "Globex" },
      ],
      unplaced: ["Nowhere Labs", "Ledgerline"],
    });
    const ws = readWorkspace();
    expect(ws.accounts["acme.com"]).toMatchObject({ status: "customer", tags: ["design_partner"], source: "manual", sourceDetail: "You named them as your users" });
    // Already tracked as a prospect: now a customer, no longer watched as one.
    expect(ws.accounts["northwind.io"]).toMatchObject({ status: "customer", watch: false, tags: ["design_partner"] });
    const dana = Object.values(ws.people).find((p) => p.name === "Dana")!;
    expect(dana).toMatchObject({ accountDomain: "globex.com", champion: "untested", tags: ["design_partner"] });
    expect(ws.accounts["ledgerline.io"]).toBeUndefined();
  });

  it("tags the named person's connection, and anyone who worked there knows the product when they move", async () => {
    const header = "First Name,Last Name,URL,Email Address,Company,Position,Connected On";
    await importConnections({ fileName: "Connections.csv", text: [header, "Dana,Okafor,https://www.linkedin.com/in/dana-okafor,,Acme,Head of Finance,12 Mar 2023", "Ravi,Shah,https://www.linkedin.com/in/ravi-shah,,Acme,Engineer,12 Mar 2023"].join("\n") });
    await addKnownUsers({ users: [{ name: "Acme", domain: "acme.com", person: "Dana Okafor" }], kind: "past_user" });
    expect(readConnections().map((c) => [c.firstName, c.tags])).toEqual([
      ["Dana", ["past_user"]],
      ["Ravi", undefined],
    ]);
    // Ravi wasn't named, but worked at a company the founder called a user: a move to an ICP company counts.
    await importConnections({ fileName: "Connections.csv", text: [header, "Dana,Okafor,https://www.linkedin.com/in/dana-okafor,,Acme,Head of Finance,12 Mar 2023", "Ravi,Shah,https://www.linkedin.com/in/ravi-shah,,Northwind,Staff Engineer,12 Mar 2023"].join("\n") });
    const ravi = readConnections().find((c) => c.firstName === "Ravi")!;
    expect(ravi.previous?.company).toBe("Acme");
    expect(knowsProduct(readWorkspace(), ravi)).toBe(true);
  });

  it("refuses an empty list", async () => {
    await expect(addKnownUsers({ users: [], kind: "past_user" })).rejects.toThrow(/at least one company/);
  });
});
