import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAiKey, keyHint, readAiKey, redactKeys, resetAiKeyCache, saveAiKey } from "./ai-keys";
import { DATA_DIR } from "./settings";

/**
 * The key store as it runs where there's no keychain (tests set INROAD_KEYCHAIN=off): the encrypted file.
 * A key must never be readable from disk as text, and must come back only for the provider it was saved under.
 */

const KEYS = () => path.join(DATA_DIR, "ai-keys.json");
const SECRET = () => path.join(DATA_DIR, "ai-keys.secret");
const OPENAI = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";

beforeEach(() => {
  fs.rmSync(KEYS(), { force: true });
  fs.rmSync(SECRET(), { force: true });
  resetAiKeyCache();
});

describe("saving and reading a key", () => {
  it("keeps it encrypted on disk, owner-only, and gives it back after a restart", () => {
    expect(saveAiKey("openai", OPENAI)).toBe("file");
    const disk = fs.readFileSync(KEYS(), "utf8");
    expect(disk).not.toContain(OPENAI);
    expect(disk).not.toContain(OPENAI.slice(-12));
    if (process.platform !== "win32") {
      expect(fs.statSync(KEYS()).mode & 0o777).toBe(0o600);
      expect(fs.statSync(SECRET()).mode & 0o777).toBe(0o600);
    }
    resetAiKeyCache();
    expect(readAiKey("openai")).toBe(OPENAI);
  });

  it("keeps each provider's key apart, and deletes one without touching the other", () => {
    saveAiKey("openai", OPENAI);
    saveAiKey("groq", "gsk_groqkey1234567890");
    deleteAiKey("openai");
    resetAiKeyCache();
    expect(readAiKey("openai")).toBeUndefined();
    expect(readAiKey("groq")).toBe("gsk_groqkey1234567890");
  });

  it("won't open a sealed key moved under another provider's name, or one that was tampered with", () => {
    saveAiKey("openai", OPENAI);
    const file = JSON.parse(fs.readFileSync(KEYS(), "utf8"));
    file.keys.xai = file.keys.openai;
    file.keys.openai = { ...file.keys.openai, data: Buffer.from("nope").toString("base64") };
    fs.writeFileSync(KEYS(), JSON.stringify(file));
    resetAiKeyCache();
    expect(readAiKey("xai")).toBeUndefined();
    expect(readAiKey("openai")).toBeUndefined();
  });

  it("finds nothing when the data key is gone, instead of failing every run", () => {
    saveAiKey("openai", OPENAI);
    fs.rmSync(SECRET());
    resetAiKeyCache();
    expect(readAiKey("openai")).toBeUndefined();
  });
});

describe("showing and quoting a key", () => {
  it("shows the last four characters only", () => {
    expect(keyHint(OPENAI)).toBe("…6789");
  });

  it("takes a saved key out of text an API sent back", () => {
    saveAiKey("openai", OPENAI);
    expect(redactKeys(`Incorrect API key provided: ${OPENAI}.`)).toBe("Incorrect API key provided: [key].");
    expect(redactKeys("bearer xai-thisisalongkey", ["xai-thisisalongkey"])).toBe("bearer [key]");
  });
});
