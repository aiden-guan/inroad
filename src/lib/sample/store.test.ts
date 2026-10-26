import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POST as resetRoute } from "@/app/api/workspace/reset/route";
import { POST as sampleRoute } from "@/app/api/workspace/sample/route";
import { readConnections } from "@/lib/network/store";
import { listBackups } from "@/lib/store/backup";
import { DATA_DIR } from "@/lib/store/settings";
import { readWorkspace } from "@/lib/store/workspace";

/**
 * The sample workspace is clearly made up and leaving it is one click: the shell's "Start with my
 * company" calls the reset route with no confirmation and lands on /welcome with an empty workspace.
 */

describe("the sample workspace", () => {
  it("is marked as the sample, so the shell can say it's made up", async () => {
    const res = await sampleRoute(new Request("http://localhost:3000/api/workspace/sample", { method: "POST", body: "" }));
    expect(res.status).toBe(200);
    expect(readWorkspace().sample).toBe(true);
    expect(readWorkspace().company?.name).toBe("Ledgerline");
    expect(readConnections().length).toBeGreaterThan(0);
  });

  it("is left with one call that needs no confirmation and saves no backup of made-up data", async () => {
    const before = listBackups().length;
    const res = await resetRoute();
    expect(res.status).toBe(200);
    const ws = (await res.json()) as { sample?: boolean; onboarding: { status: string }; company: unknown; accounts: object };
    expect(ws.sample).toBeUndefined();
    expect(ws.onboarding.status).toBe("new");
    expect(ws.company).toBeNull();
    expect(Object.keys(ws.accounts)).toHaveLength(0);
    expect(readConnections()).toEqual([]);
    expect(fs.existsSync(path.join(DATA_DIR, "connections.json"))).toBe(false);
    expect(listBackups().length).toBe(before);
  });
});
