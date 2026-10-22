import { describe, expect, it } from "vitest";
// Plain JS, run by Node before any build (npm run dev, npm start, npm run dev:mock).
import { launchPlan } from "../../../scripts/launch-plan.mjs";

/**
 * What the launcher starts: loopback by default, the socket-stamping guard always preloaded, and the
 * mock's environment set in Node, so the same npm scripts work in cmd, PowerShell, bash and zsh.
 */

const GUARD = "/repo/scripts/peer-guard.cjs";

describe("the launcher", () => {
  it("serves on 127.0.0.1:3000 with the guard preloaded", () => {
    const p = launchPlan(["dev"], {}, GUARD);
    expect(p).toMatchObject({ mode: "dev", host: "127.0.0.1", port: "3000", local: "127.0.0.1", exposed: false });
    expect(p.args).toEqual(["dev", "-H", "127.0.0.1", "-p", "3000"]);
    expect(p.env).toMatchObject({ INROAD_HOST: "127.0.0.1", PORT: "3000", NODE_OPTIONS: `--require "${GUARD}"` });
  });

  it("starts the production server the same way, and passes other next options through", () => {
    const p = launchPlan(["start", "--port=3301", "--turbopack"], { PORT: "4000" }, GUARD);
    expect(p.args).toEqual(["start", "-H", "127.0.0.1", "-p", "3301", "--turbopack"]);
    expect(launchPlan(["start"], { PORT: "4000" }, GUARD).port).toBe("4000");
  });

  it("keeps NODE_OPTIONS already set (the e2e's offline preload) and writes Windows paths with forward slashes", () => {
    const p = launchPlan(["dev"], { NODE_OPTIONS: '--require "/e2e/offline.cjs"' }, "C:\\Users\\f\\inroad\\scripts\\peer-guard.cjs");
    expect(p.env?.NODE_OPTIONS).toBe('--require "/e2e/offline.cjs" --require "C:/Users/f/inroad/scripts/peer-guard.cjs"');
  });

  it("listens elsewhere only when asked, and says so", () => {
    expect(launchPlan(["dev"], { INROAD_HOST: "0.0.0.0" }, GUARD)).toMatchObject({ host: "0.0.0.0", local: "127.0.0.1", exposed: true });
    expect(launchPlan(["dev", "-H", "::"], {}, GUARD)).toMatchObject({ host: "::", local: "[::1]", exposed: true });
    expect(launchPlan(["dev", "-H", "::1"], {}, GUARD)).toMatchObject({ local: "[::1]", exposed: false });
  });

  it("runs against the mock with its own data folder and port, no shell syntax needed", () => {
    const p = launchPlan(["dev", "--mock"], { ANTHROPIC_API_KEY: "sk-ant-real" }, GUARD);
    expect(p.port).toBe("3100");
    expect(p.args).not.toContain("--mock");
    expect(p.env).toMatchObject({ ANTHROPIC_BASE_URL: "http://localhost:4010", FIRECRAWL_API_URL: "http://localhost:4010", ANTHROPIC_API_KEY: "mock", GTM_DATA_DIR: ".data-mock" });
    const moved = launchPlan(["dev", "--mock", "-p", "3301"], { MOCK_PORT: "4301", GTM_DATA_DIR: "/tmp/scratch" }, GUARD);
    expect(moved.env).toMatchObject({ ANTHROPIC_BASE_URL: "http://localhost:4301", GTM_DATA_DIR: "/tmp/scratch", PORT: "3301" });
  });

  it("refuses anything but dev or start", () => {
    expect(launchPlan(["build"], {}, GUARD)).toEqual({ error: expect.stringMatching(/^Usage:/) });
    expect(launchPlan([], {}, GUARD)).toEqual({ error: expect.stringMatching(/^Usage:/) });
  });
});
