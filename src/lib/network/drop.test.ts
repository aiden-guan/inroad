import { describe, expect, it } from "vitest";
import { droppedLine, planDrop } from "./drop";
import type { ImportBatchSummary } from "./types";

const CONNECTIONS = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Dana,Okafor,https://www.linkedin.com/in/dana,,Northwind,Head of Engineering,12 Oct 2024
`;

describe("onboarding's list drop", () => {
  it("takes Connections.csv as the network, and other lists as companies when a website or work email maps", () => {
    expect(planDrop(CONNECTIONS)).toEqual({ kind: "linkedin" });
    const waitlist = planDrop("Email,Signed up\nana@acme.example,2026-10-01\n");
    expect(waitlist).toMatchObject({ kind: "list", mapping: expect.objectContaining({ email: 0 }) });
    expect(planDrop("Company,Website\nAcme,acme.example\n")).toMatchObject({ kind: "list", mapping: expect.objectContaining({ domain: 1 }) });
    expect(planDrop("Name,Notes\nAna,met at a meetup\n")).toEqual({ kind: "unmapped" });
    expect(planDrop("First Name,Last Name,URL,Company,Position\n")).toEqual({ kind: "empty" });
  });

  it("says what came in, in one line", () => {
    const batch = (patch: Partial<ImportBatchSummary>): ImportBatchSummary => ({
      id: "imp",
      kind: "csv",
      fileName: "waitlist.csv",
      importedAt: "2026-10-20T10:00:00.000Z",
      rows: 40,
      skipped: 0,
      counts: { accountsCreated: 38, accountsUpdated: 0, peopleCreated: 52, peopleUpdated: 1 },
      ...patch,
    });
    expect(droppedLine(batch({}))).toBe("38 companies and 53 people from waitlist.csv. I'll look at them first.");
    expect(droppedLine(batch({ counts: { accountsCreated: 0, accountsUpdated: 0, peopleCreated: 0, peopleUpdated: 0 } }))).toBe("Nothing new in waitlist.csv: those companies are already here.");
    expect(droppedLine(batch({ kind: "linkedin", linkedin: { total: 1240, added: 1240, changed: 0, removed: 0, withEmail: 80 } }))).toBe(
      "1,240 connections in. I'll start with the people who already know you, and screen the rest against your bet once it's ready.",
    );
  });
});
