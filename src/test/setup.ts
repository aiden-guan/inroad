import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

/**
 * Runs before every test file:
 *  - its own empty data folder, so no test reads or writes the founder's `.data/`
 *  - no AI provider credentials, and an Anthropic base URL nothing listens on, so a stray model call fails
 *    fast instead of spending tokens (the engine test points these at the in-test mock)
 *  - global fetch only reaches loopback: the suite never touches the network
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "inroad-test-"));
process.env.GTM_DATA_DIR = dataDir;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
delete process.env.ANTHROPIC_PROFILE;
process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:9";
// Keys go to the encrypted key file, never this computer's real keychain.
process.env.INROAD_KEYCHAIN = "off";
for (const name of ["OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "XAI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "TOGETHER_API_KEY", "INROAD_AI_KEY", "INROAD_AI_PROVIDER", "INROAD_AI_MODEL", "INROAD_AI_BASE_URL", "FIRECRAWL_API_KEY", "TINYFISH_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY", "BRAVE_SEARCH_API_KEY", "INROAD_SEARCH_PROVIDER", "INROAD_SEARCH_KEY", "INROAD_SEARCH_URL"]) delete process.env[name];
// Like Anthropic's: an OpenAI base URL nothing listens on, so a stray image or chat call fails fast.
process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    return Promise.reject(new Error(`Tests must not reach the network (fetch ${url.origin})`));
  }
  return realFetch(input, init);
};

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
