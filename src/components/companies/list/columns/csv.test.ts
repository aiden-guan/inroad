import { describe, expect, it } from "vitest";
import type { ColumnCell, ResearchColumn } from "@/lib/columns/types";
import { csvField, exportCsv, toCsv } from "./csv";

describe("CSV export", () => {
  it("quotes what needs quoting and never lets a cell run as a formula", () => {
    expect(csvField("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField("=HYPERLINK(\"https://evil.example\")")).toBe("\"'=HYPERLINK(\"\"https://evil.example\"\")\"");
    expect(csvField("+1 555")).toBe("'+1 555");
    expect(csvField(-5)).toBe("-5");
    expect(csvField(null)).toBe("");
    expect(toCsv([["a", 1], ["b", true]])).toBe("a,1\r\nb,true");
  });

  it("adds each research column's answer, confidence and first source", () => {
    const column: ResearchColumn = { id: "col_usage", question: "Do they bill on usage?", type: "yes_no", createdAt: "2026-11-01T10:00:00.000Z" };
    const cell: ColumnCell = {
      columnId: "col_usage",
      domain: "fernwick.example",
      value: true,
      confidence: "high",
      sources: [{ url: "https://fernwick.example/pricing", quote: "Pay per 1,000 traces.", kind: "site", checked: true }],
      at: "2026-11-04T10:00:00.000Z",
      method: "model",
    };
    const csv = exportCsv(
      [{ name: "Fernwick", domain: "fernwick.example", tier: "A", fit: 88, status: "Tracked", whyNow: "Hiring a Billing Analyst", whyNowDate: "2026-10-24", whyNowUrl: "https://fernwick.example/careers", warm: 0, openRoles: 8 }],
      [column],
      { col_usage: { "fernwick.example": cell } },
    );
    const [head, row] = csv.split("\r\n");
    expect(head).toBe("Company,Domain,Tier,Fit,Status,Why now,Why now date,Why now source,Warm paths,Open roles,Do they bill on usage?,Do they bill on usage? (confidence),Do they bill on usage? (source)");
    expect(row).toBe("Fernwick,fernwick.example,A,88,Tracked,Hiring a Billing Analyst,2026-10-24,https://fernwick.example/careers,0,8,Yes,high,https://fernwick.example/pricing");
  });
});
