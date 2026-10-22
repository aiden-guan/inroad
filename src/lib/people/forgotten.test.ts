import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAction } from "@/lib/domain/actions";
import type { Workspace } from "@/lib/domain/types";
import { applyListImport, importConnections } from "@/lib/network/import";
import { autoMap, presetById } from "@/lib/network/presets";
import { parseCsv } from "@/lib/network/csv";
import { importStargazers } from "@/lib/network/stargazers";
import { readConnections, updateConnections } from "@/lib/network/store";
import { resetToEmptyWorkspace, restoreWorkspace } from "@/lib/sample/store";
import { resetGates } from "@/lib/signals/gate";
import { resetGithubBudget } from "@/lib/signals/github";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { BACKUP_DIR, readSnapshot, snapshot } from "@/lib/store/backup";
import { OPT_OUTS_FILE } from "@/lib/store/opt-outs";
import { DATA_DIR } from "@/lib/store/settings";
import { mutateWorkspace, readWorkspace, replaceWorkspace } from "@/lib/store/workspace";
import { at, makeAccount, makePerson, makeWorkspace } from "@/test/factories";
import { routeFetches } from "@/test/http-fixtures";
import { forgetKeys, wasForgotten } from "./forget";

/**
 * Someone with no email on file who asked to be deleted stays deleted: what's kept is a one-way
 * fingerprint of their LinkedIn profile and of their name at their company, and a restore or an import
 * that would bring them back checks it. No network.
 */

vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const NOTES = "Dana Whitfield lives in Berlin, has two kids, mentioned her health issue on our call";
const LI = "https://www.linkedin.com/in/dana-whitfield";

function withDana(): Workspace {
  return makeWorkspace({
    onboarding: { status: "hired" },
    company: { name: "Acme", domain: "acme.dev" } as never,
    accounts: { "northwind.io": makeAccount("northwind.io", { name: "Northwind", peopleIds: ["per_dana"] }) },
    people: { per_dana: makePerson("per_dana", "northwind.io", { name: "Dana Whitfield", email: undefined, linkedinUrl: LI, notes: NOTES, contactPaths: [{ kind: "linkedin", value: LI, verified: true, founderConfirmed: true }] }) },
  });
}
const forget = (ws: Workspace) => applyAction(ws, { type: "person.forget", id: "per_dana", at: at(0), suppressionId: "sup_dana" });

beforeEach(async () => {
  vi.clearAllMocks();
  resetGates();
  resetGithubBudget();
  fs.rmSync(BACKUP_DIR(), { recursive: true, force: true });
  fs.rmSync(path.join(DATA_DIR, OPT_OUTS_FILE), { force: true });
  fs.rmSync(path.join(DATA_DIR, "cache"), { recursive: true, force: true });
  await updateConnections((rows) => void rows.splice(0, rows.length));
  await replaceWorkspace(withDana());
});

describe("deleting someone with no email", () => {
  it("keeps fingerprints of their profile and name at their company, never the name itself", () => {
    const ws = withDana();
    forget(ws);
    expect(ws.people.per_dana).toBeUndefined();
    expect(ws.suppression).toEqual([]);
    expect(ws.forgotten).toEqual(forgetKeys({ linkedinUrl: LI, name: "Dana Whitfield", domain: "northwind.io" }));
    expect(ws.forgotten).toHaveLength(2);
    const text = JSON.stringify(ws);
    expect(text).not.toMatch(/whitfield/i);
    // Recognised by profile (any spelling of the URL) or by name at the same company, and not at another.
    expect(wasForgotten(ws, { linkedinUrl: "http://linkedin.com/in/Dana-Whitfield/?trk=x" })).toBe(true);
    expect(wasForgotten(ws, { name: " dana  WHITFIELD ", domain: "Northwind.io" })).toBe(true);
    expect(wasForgotten(ws, { name: "Dana Whitfield", domain: "other.com" })).toBe(false);
    expect(wasForgotten(ws, { name: "Dana Whitfield" })).toBe(false);
  });

  it("a backup from before brings nothing of them back, even across a reset", async () => {
    // Her LinkedIn row came in before she was a person here, so the backup holds it without a link to her.
    await updateConnections((rows) => {
      rows.push({ id: "con_dana", firstName: "Dana", lastName: "Whitfield", url: "https://linkedin.com/in/dana-whitfield/", company: "Northwind", position: "CFO", companyNorm: "northwind" });
      rows.push({ id: "con_lee", firstName: "Lee", lastName: "Park", url: "https://www.linkedin.com/in/lee-park", company: "Ledgerly", position: "Controller", companyNorm: "ledgerly" });
    });
    const daily = snapshot("daily", new Date("2026-10-20T16:00:00.000Z"));
    await mutateWorkspace(forget);
    await updateConnections((rows) => void rows.splice(0, 1));
    await resetToEmptyWorkspace();

    const { forgotten } = await restoreWorkspace(readSnapshot(daily.name));
    expect(forgotten).toBe(1);
    const ws = readWorkspace();
    expect(ws.people.per_dana).toBeUndefined();
    expect(JSON.stringify(ws)).not.toContain("Berlin");
    expect(readConnections().map((c) => c.id)).toEqual(["con_lee"]);
  });

  it("a re-import doesn't bring them back: LinkedIn's file, a list or a repo's stargazers", async () => {
    await mutateWorkspace(forget);

    const header = "First Name,Last Name,URL,Email Address,Company,Position,Connected On";
    const li = await importConnections({ fileName: "Connections.csv", text: [header, `Dana,Whitfield,${LI},,Northwind,CFO,12 Mar 2023`, "Lee,Park,https://www.linkedin.com/in/lee-park,,Ledgerly,Controller,02 Jan 2024"].join("\n") });
    expect(readConnections().map((c) => c.firstName)).toEqual(["Lee"]);
    expect(li.skipped).toBe(1);

    const text = ["name,email,website,linkedin", `Dana Whitfield,,northwind.io,`, `Sam Ortiz,sam@northwind.io,northwind.io,`].join("\n");
    const parsed = parseCsv(text);
    const list = await applyListImport({ fileName: "prospects.csv", text, preset: "generic", mapping: autoMap(parsed.headers, presetById("generic"), parsed.rows) });
    expect(Object.values(readWorkspace().people).map((p) => p.name)).toEqual(["Sam Ortiz"]);
    expect(list.skipped).toBe(1);

    const API = "https://api.github.com";
    const r = routeFetches({
      [`${API}/repos/acmehq/acme-sdk`]: JSON.stringify({ full_name: "acmehq/acme-sdk", stargazers_count: 1 }),
      [`${API}/repos/acmehq/acme-sdk/stargazers?per_page=100&page=1`]: JSON.stringify([{ starred_at: "2026-10-01T10:00:00Z", user: { login: "dwhit", html_url: "https://github.com/dwhit" } }]),
      [`${API}/users/dwhit`]: JSON.stringify({ login: "dwhit", html_url: "https://github.com/dwhit", type: "User", name: "Dana Whitfield", company: "Northwind", blog: "https://northwind.io" }),
    });
    vi.mocked(fetchText).mockImplementation(r.fetchText);
    vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
    const stars = await importStargazers({ repo: "acmehq/acme-sdk" });
    expect(stars.skipped).toBe(1);
    expect(Object.values(readWorkspace().people).map((p) => p.name)).toEqual(["Sam Ortiz"]);
  });
});
