import { describe, expect, it } from "vitest";
import { cleanBaseUrl, detectProvider, providerById, rankModels, tierModels } from "./providers";

describe("recognizing a pasted key", () => {
  it.each([
    ["sk-ant-api03-abcdefghijklmnop", "anthropic"],
    ["sk-proj-abcdefghijklmnopqrstuv", "openai"],
    ["sk-svcacct-abcdefghijklmnopqrstuv", "openai"],
    ["sk-or-v1-abcdefghijklmnop", "openrouter"],
    ["gsk_abcdefghijklmnopqrstuv", "groq"],
    ["xai-abcdefghijklmnopqrstuv", "xai"],
    ["AIzaSyabcdefghijklmnopqrstuvwxyz012345", "gemini"],
    ["  sk-proj-abcdefghijklmnopqrstuv  ", "openai"],
  ])("%s → %s", (key, provider) => {
    expect(detectProvider(key)).toBe(provider);
  });

  it("says nothing about keys without a telling prefix", () => {
    expect(detectProvider("")).toBeNull();
    expect(detectProvider("abc123")).toBeNull();
    expect(detectProvider("sk-short")).toBeNull();
  });
});

describe("ordering a provider's model list", () => {
  it("drops embeddings, speech, images and moderation, and puts the preferred chat models first", () => {
    const ids = ["text-embedding-3-small", "whisper-1", "gpt-4o-mini", "dall-e-3", "gpt-4.1", "omni-moderation-latest", "gpt-4o", "tts-1", "gpt-4o-search-preview"];
    expect(rankModels(providerById("openai")!, ids)).toEqual(["gpt-4.1", "gpt-4o", "gpt-4o-mini"]);
  });

  it("strips Gemini's models/ prefix and keeps the provider's order when nothing is preferred", () => {
    expect(rankModels(providerById("ollama")!, ["models/qwen3:8b", "llama3.1:8b", "nomic-embed-text"])).toEqual(["qwen3:8b", "llama3.1:8b"]);
  });
});

describe("which model runs each task", () => {
  it("runs everything on the chosen model, the quick tasks on its smaller sibling when the key has one", () => {
    expect(tierModels("gpt-x", ["gpt-x", "gpt-x-mini"])).toEqual({ strategist: "gpt-x", operator: "gpt-x", fast: "gpt-x-mini" });
    expect(tierModels("grok-9", ["grok-9"])).toEqual({ strategist: "grok-9", operator: "grok-9", fast: "grok-9" });
  });

  it("lets the founder's per-task picks win", () => {
    expect(tierModels("a", ["a", "a-mini"], { strategist: "big", fast: "tiny" })).toEqual({ strategist: "big", operator: "a", fast: "tiny" });
  });
});

describe("a typed base URL", () => {
  it("takes https anywhere and plain http only on this computer", () => {
    expect(cleanBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(cleanBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    expect(cleanBaseUrl("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/v1");
    expect(cleanBaseUrl("http://api.example.com/v1")).toBeNull();
    expect(cleanBaseUrl("ftp://example.com")).toBeNull();
    expect(cleanBaseUrl("not a url")).toBeNull();
  });

  it("refuses credentials, queries and fragments in the address", () => {
    expect(cleanBaseUrl("https://user:pass@api.example.com/v1")).toBeNull();
    expect(cleanBaseUrl("https://api.example.com/v1?key=abc")).toBeNull();
    expect(cleanBaseUrl("https://api.example.com/v1#x")).toBeNull();
  });
});
