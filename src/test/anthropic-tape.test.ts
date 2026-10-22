import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pickTape, useTape, type Tape } from "./anthropic-tape";

/**
 * Replay answers from the recorded file, but what a test asserts about requests (the cache TTL, the
 * cached prefix) has to be what the code sends now: a change there must fail the suite, not pass on
 * the recording.
 */

let tape: Tape | undefined;
afterEach(async () => {
  await tape?.close();
  tape = undefined;
});

/** The compose tape's first request (a cold draft on Sonnet), as the code would send it, with changes. */
function draftRequest(patch: Record<string, unknown> = {}) {
  return {
    model: "claude-sonnet-5-5",
    max_tokens: 8000,
    stream: true,
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral", ttl: "1h" },
    system: [{ type: "text", text: "You write cold first touches." }],
    tools: [{ name: "submit_draft", input_schema: { type: "object" } }],
    messages: [{ role: "user", content: "Write to Dana at Northwind." }],
    ...patch,
  };
}

async function send(body: object) {
  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await res.text();
  return res.status;
}

describe("replaying a tape", () => {
  it("reports the request that was sent, not the recorded one", async () => {
    tape = await useTape("compose-cold");
    expect(tape.exchanges()).toEqual([]);
    expect(await send(draftRequest())).toBe(200);
    expect(tape.misses).toEqual([]);
    expect(tape.exchanges().map((e) => e.request.cacheTtl)).toEqual(["1h"]);
    expect(tape.messages()).toHaveLength(1);
  });

  it("fails a request that drifted from the recording: a 5-minute cache, another max_tokens", async () => {
    tape = await useTape("compose-cold");
    expect(await send(draftRequest({ cache_control: { type: "ephemeral" }, max_tokens: 4000 }))).toBe(200);
    expect(tape.exchanges().map((e) => [e.request.cacheTtl, e.request.maxTokens])).toEqual([["5m", 4000]]);
    expect(tape.misses).toHaveLength(1);
    expect(tape.misses[0]).toMatch(/maxTokens 8000 → 4000; cacheTtl "1h" → "5m"/);
  });

  it("hashes the cached prefix and each turn, ignoring where the cache marker sits", async () => {
    tape = await useTape("compose-cold");
    await send(draftRequest({ messages: [{ role: "user", content: [{ type: "text", text: "Write to Dana.", cache_control: { type: "ephemeral" } }] }] }));
    await send(draftRequest({ model: "claude-haiku-5-5", system: [{ type: "text", text: `Now: ${Date.now()}` }], tools: [{ name: "submit_critique", input_schema: {} }], max_tokens: 3000, output_config: { effort: "low" }, messages: [{ role: "user", content: [{ type: "text", text: "Write to Dana." }] }] }));
    const [a, b] = tape.exchanges().map((e) => e.request);
    expect(a.turns).toEqual(b.turns);
    expect(a.prefix).not.toBe(b.prefix);
  });
});

describe("which tape replays", () => {
  it("is whichever was recorded last, so re-recording from the mock after a live smoke takes effect", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tapes-"));
    const write = (file: string, source: "mock" | "live", recordedAt: string) => {
      fs.writeFileSync(path.join(dir, file), JSON.stringify({ version: 1, name: "compose-cold", source, recordedAt, exchanges: [] }));
      return path.join(dir, file);
    };
    const live = write("live.json", "live", "2026-10-20T10:00:00.000Z");
    const mock = write("mock.json", "mock", "2026-10-01T10:00:00.000Z");
    expect(pickTape([live, mock])?.tape.source).toBe("live");
    // npm run tapes:record after changing the prompt.
    write("mock.json", "mock", "2026-10-21T10:00:00.000Z");
    expect(pickTape([live, mock])).toMatchObject({ path: mock, tape: { source: "mock" } });
    expect(pickTape([path.join(dir, "missing.json")])).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("names the file and the command when it has no answer", async () => {
    tape = await useTape("compose-cold");
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draftRequest({ tools: [] })) });
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/\(src\/test\/fixtures\/anthropic\/compose-cold\.json\).*npm run tapes:record -- compose$/);
    expect(tape.misses).toHaveLength(1);
  });
});
