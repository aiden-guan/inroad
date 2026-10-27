import { describe, expect, it } from "vitest";
import { ActionError } from "@/lib/domain/actions";
import { BODY_LIMIT_BYTES, BodyTooLargeError, bodyCutShort, readJSON, readTextBody, TOO_BIG } from "./http";

/**
 * Request bodies as route handlers get them behind Next's proxy, which passes on only the first 10 MB.
 * A body cut there must read as too big, not as the wrong kind of request.
 */

const post = (body: string, length?: number) =>
  new Request("http://localhost:3000/api/import", { method: "POST", body, headers: length === undefined ? {} : { "content-length": String(length) } });

describe("reading a request body", () => {
  it("parses JSON", async () => {
    expect(await readJSON(post('{"rows":[1,2]}'))).toEqual({ rows: [1, 2] });
  });

  it("says a body cut short at the limit is too big", async () => {
    const whole = JSON.stringify({ csv: "a,b\n".repeat(50) });
    const err = await readJSON(post(whole.slice(0, 40), whole.length)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect((err as Error).message).toBe(TOO_BIG);
  });

  it("still says bad JSON is bad JSON when all of it arrived", async () => {
    await expect(readJSON(post("not json", 8))).rejects.toThrow("Request body must be JSON.");
    await expect(readJSON(post("not json"))).rejects.toThrow("Request body must be JSON.");
  });

  it("compares what arrived with the length the client declared", () => {
    expect(bodyCutShort(post("x", BODY_LIMIT_BYTES + 5), BODY_LIMIT_BYTES)).toBe(true);
    expect(bodyCutShort(post("abc", 3), 3)).toBe(false);
    expect(bodyCutShort(new Request("http://localhost:3000/", { method: "POST" }), 0)).toBe(false);
  });
});

describe("public API body budgets", () => {
  it("counts UTF-8 bytes, with and without a declared length", async () => {
    await expect(readTextBody(post("éé"), 3)).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(readTextBody(post("éé", 4), 3)).rejects.toBeInstanceOf(BodyTooLargeError);
    await expect(readTextBody(post("éé"), 4)).resolves.toBe("éé");
    await expect(readTextBody(new Request("http://localhost/"), 4)).resolves.toBe("");
  });

  it("cancels chunked uploads as soon as their actual byte count exceeds the budget", async () => {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(4));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://localhost/", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readTextBody(request, 5)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
  });

  it("decodes multibyte characters split across chunks without corrupting valid JSON", async () => {
    const bytes = new TextEncoder().encode('{"name":"é"}');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const request = new Request("http://localhost/", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(JSON.parse(await readTextBody(request, bytes.length))).toEqual({ name: "é" });
  });
});
