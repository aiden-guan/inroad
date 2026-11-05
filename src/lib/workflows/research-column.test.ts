import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCompat } from "@/lib/ai/engine";
import { readColumns, replaceColumns } from "@/lib/columns/store";
import type { ResearchColumn } from "@/lib/columns/types";
import { fetchJSON, fetchText } from "@/lib/signals/http";
import { replaceWorkspace } from "@/lib/store/workspace";
import { at, makeAccount, makeWorkspace } from "@/test/factories";
import { routeFetches } from "@/test/http-fixtures";
import { startMock, type MockServer } from "@/test/mock-anthropic";
import { runWorkflow } from "@/test/run-workflow";
import researchColumn from "./research-column";

/**
 * A research column end to end against the mock model: code reads each company's site (saved responses), the
 * cheap model answers with a quote, code checks the quote, and each answer lands in columns.json. Asking again
 * costs nothing, and a question the job board settles never reaches the model.
 */

vi.mock("@/lib/signals/http", async (actual) => ({ ...(await actual<typeof import("@/lib/signals/http")>()), fetchText: vi.fn(), fetchJSON: vi.fn() }));

const HOME = `<html><head><title>Fernwick: evals for LLM apps</title><meta name="description" content="Trace, evaluate and monitor LLM apps in production."></head>
<body><main><h1>Evals in production</h1><p>Ship LLM features with confidence.</p><a href="/pricing">Pricing</a></main></body></html>`;
const PRICING = `<html><head><title>Pricing · Fernwick</title></head><body><main><h1>Pricing</h1><p>Pay per 1,000 traces, billed monthly.</p><p>No seats, no minimums.</p></main></body></html>`;

let mock: MockServer;

beforeAll(async () => {
  mock = await startMock();
  process.env.ANTHROPIC_BASE_URL = mock.url;
  process.env.ANTHROPIC_API_KEY = "mock";
});

afterAll(() => mock?.stop());

const usage: ResearchColumn = { id: "col_usage", question: "Do they bill on usage?", type: "yes_no", createdAt: at(-1) };
const finance: ResearchColumn = { id: "col_finance", question: "Are they hiring in finance?", type: "yes_no", createdAt: at(-1) };

beforeEach(async () => {
  await mock.reset();
  resetCompat();
  const r = routeFetches({ "https://fernwick.example": { url: "https://fernwick.example/", body: HOME }, "https://fernwick.example/pricing": PRICING });
  vi.mocked(fetchText).mockImplementation(r.fetchText);
  vi.mocked(fetchJSON).mockImplementation(r.fetchJSON);
  await replaceWorkspace(
    makeWorkspace({
      accounts: {
        "fernwick.example": makeAccount("fernwick.example", { name: "Fernwick" }),
        "stillwater.example": makeAccount("stillwater.example", { name: "Stillwater" }),
        "hiring.example": makeAccount("hiring.example", {
          name: "Hiring Co",
          enrichment: {
            crawledAt: new Date(Date.now() - 86_400_000).toISOString(),
            tech: [],
            socials: {},
            jobBoard: { provider: "lever", token: "hiringco" },
            openRoles: 3,
            rolesByTeam: [
              { team: "Finance", count: 2, titles: ["Controller", "Revenue Accountant"] },
              { team: "Engineering", count: 1, titles: ["Backend Engineer"] },
            ],
            news: [],
          },
        }),
      },
    }),
  );
  await replaceColumns({ columns: [usage, finance], hidden: [], cells: {}, views: [] });
});

describe("asking every company one question", () => {
  it("answers from their own site with a checked quote, leaves the rest unknown, and bills each answer", async () => {
    const { summary } = await runWorkflow(researchColumn, { columnId: "col_usage", domains: ["fernwick.example", "stillwater.example"] });
    expect(summary.status).toBe("done");
    const cells = readColumns().cells.col_usage;

    expect(cells["fernwick.example"]).toMatchObject({ value: true, method: "model", runId: summary.id });
    expect(cells["fernwick.example"].sources[0]).toMatchObject({ kind: "site", checked: true });
    expect(cells["fernwick.example"].sources[0].url).toMatch(/^https:\/\/fernwick\.example/);
    expect(cells["fernwick.example"].costUsd).toBeGreaterThan(0);

    // Nothing to read and nothing on file: Unknown, never a guess.
    expect(cells["stillwater.example"]).toMatchObject({ value: null, confidence: null, method: "model" });

    const billed = Object.values(cells).reduce((n, c) => n + (c.costUsd ?? 0), 0);
    expect(summary.receipt?.costUsd).toBeCloseTo(billed, 6);
  });

  it("costs nothing to ask again: answered companies are kept", async () => {
    await runWorkflow(researchColumn, { columnId: "col_usage", domains: ["fernwick.example"] });
    const asked = (await mock.requests()).length;
    const { summary, result } = await runWorkflow(researchColumn, { columnId: "col_usage", domains: ["fernwick.example"] });
    expect(result).toMatchObject({ cached: 1, answered: 0 });
    expect((await mock.requests()).length).toBe(asked);
    expect(summary.receipt?.costUsd).toBe(0);
  });

  it("settles a hiring question from the job board in code, without the model", async () => {
    const { result } = await runWorkflow(researchColumn, { columnId: "col_finance", domains: ["hiring.example"] });
    expect(result).toMatchObject({ answered: 1, free: 1 });
    expect(readColumns().cells.col_finance["hiring.example"]).toMatchObject({ value: true, method: "workspace", costUsd: 0, sources: [{ kind: "job_board", url: "https://jobs.lever.co/hiringco" }] });
    expect(await mock.requests()).toHaveLength(0);
  });

  it("reuses the answer to the same question asked in another column", async () => {
    await runWorkflow(researchColumn, { columnId: "col_usage", domains: ["fernwick.example"] });
    await replaceColumns({ ...readColumns(), columns: [...readColumns().columns, { ...usage, id: "col_usage2" }] });
    const before = (await mock.requests()).length;
    const { result } = await runWorkflow(researchColumn, { columnId: "col_usage2", domains: ["fernwick.example"] });
    expect(result).toMatchObject({ reused: 1 });
    expect(readColumns().cells.col_usage2["fernwick.example"]).toMatchObject({ value: true, method: "reused", costUsd: 0 });
    expect((await mock.requests()).length).toBe(before);
  });

  it("stops when the column is gone", async () => {
    await replaceColumns({ columns: [], hidden: [], cells: {}, views: [] });
    const { summary } = await runWorkflow(researchColumn, { columnId: "col_usage", domains: ["fernwick.example"] });
    expect(summary).toMatchObject({ status: "error", error: { message: "That column was deleted." } });
  });
});
