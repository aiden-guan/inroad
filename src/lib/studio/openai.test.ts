import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { checkOpenAIKey, generateImage } from "./openai";

const servers: Server[] = [];
async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Studio provider redirects", () => {
  it("never forwards a key or replays an image prompt to a redirect destination", async () => {
    let forwarded = 0;
    const other = await listen(createServer((_req, res) => {
      forwarded++;
      res.end("{}");
    }));
    const base = await listen(createServer((_req, res) => {
      res.writeHead(307, { location: `${other}/capture` });
      res.end();
    }));
    vi.stubEnv("OPENAI_BASE_URL", base);
    vi.stubEnv("OPENAI_API_KEY", "test-studio-key");
    expect(await checkOpenAIKey("test-studio-key")).toBe("unknown");
    await expect(generateImage({ prompt: "Private founder material", w: 1024, h: 1024 })).rejects.toThrow("Couldn't reach OpenAI");
    expect(forwarded).toBe(0);
  });

  it("still checks a key and generates an image on the configured endpoint", async () => {
    const png = Buffer.alloc(25);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(1024, 16);
    png.writeUInt32BE(1024, 20);
    const base = await listen(createServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer test-studio-key");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(req.url === "/models" ? { data: [] } : { data: [{ b64_json: png.toString("base64") }] }));
    }));
    vi.stubEnv("OPENAI_BASE_URL", base);
    vi.stubEnv("OPENAI_API_KEY", "test-studio-key");
    expect(await checkOpenAIKey("test-studio-key")).toBe("ok");
    expect(await generateImage({ prompt: "Approved founder material", w: 1024, h: 1024 })).toMatchObject({ png, width: 1024, height: 1024 });
  });
});
