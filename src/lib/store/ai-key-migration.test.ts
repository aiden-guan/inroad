import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  values: new Map<string, string>(),
  reads: vi.fn(),
  writes: vi.fn(),
  deletes: vi.fn(),
}));
vi.mock("node:module", () => ({
  createRequire: () => () => ({
    Entry: class {
      account: string;
      constructor(_service: string, account: string) {
        this.account = account;
      }
      getPassword() {
        native.reads(this.account);
        return native.values.get(this.account) ?? null;
      }
      setPassword(value: string) {
        native.writes(this.account);
        native.values.set(this.account, value);
      }
      deleteCredential() {
        native.deletes(this.account);
        native.values.delete(this.account);
      }
    },
  }),
}));

import {
  aiKeyStore,
  deleteAiKey,
  readAiKey,
  resetAiKeyCache,
  saveAiKey,
} from "./ai-keys";
import { DATA_DIR } from "./settings";

const KEY = "sk-test-legacy-key-never-printed";
beforeEach(() => {
  vi.stubEnv("INROAD_KEYCHAIN", "prefer-file");
  fs.rmSync(path.join(DATA_DIR, "ai-keys.json"), { force: true });
  fs.rmSync(path.join(DATA_DIR, "ai-keys.secret"), { force: true });
  native.values.clear();
  native.reads.mockClear();
  native.writes.mockClear();
  native.deletes.mockClear();
  resetAiKeyCache();
});

describe("ad hoc Mac key migration", () => {
  it("imports an existing key once, encrypts it, and avoids Keychain after relaunch", () => {
    native.values.set("ai-key:openai", KEY);
    expect(readAiKey("openai")).toBe(KEY);
    expect(native.reads).toHaveBeenCalledTimes(1);
    const disk = fs.readFileSync(path.join(DATA_DIR, "ai-keys.json"), "utf8");
    expect(disk).not.toContain(KEY);
    expect(aiKeyStore("openai", "keychain")).toBe("file");
    resetAiKeyCache();
    expect(readAiKey("openai")).toBe(KEY);
    expect(native.reads).toHaveBeenCalledTimes(1);
  });

  it("saves replacements and connection keys without opening Keychain", () => {
    native.values.set("ai-key:openai", "old-value");
    expect(saveAiKey("openai", KEY)).toBe("file");
    expect(saveAiKey("connection:gateway", "connection-secret")).toBe("file");
    resetAiKeyCache();
    expect(readAiKey("openai")).toBe(KEY);
    expect(readAiKey("connection:gateway")).toBe("connection-secret");
    expect(native.reads).not.toHaveBeenCalled();
    expect(native.writes).not.toHaveBeenCalled();
  });

  it("never resurrects an old Keychain value after deletion or a later signed update", () => {
    native.values.set("ai-key:openai", KEY);
    expect(readAiKey("openai")).toBe(KEY);
    deleteAiKey("openai");
    resetAiKeyCache();
    vi.stubEnv("INROAD_KEYCHAIN", "on");
    expect(readAiKey("openai")).toBeUndefined();
    expect(native.reads).toHaveBeenCalledTimes(1);
    expect(native.deletes).not.toHaveBeenCalled();
  });

  it("does not repeatedly check absent accounts or restore a corrupt local key from an old entry", () => {
    expect(readAiKey("groq")).toBeUndefined();
    resetAiKeyCache();
    expect(readAiKey("groq")).toBeUndefined();
    expect(native.reads).toHaveBeenCalledTimes(1);
    saveAiKey("openai", KEY);
    native.values.set("ai-key:openai", "stale-key");
    fs.rmSync(path.join(DATA_DIR, "ai-keys.secret"));
    resetAiKeyCache();
    expect(readAiKey("openai")).toBeUndefined();
    expect(native.reads).toHaveBeenCalledTimes(1);
  });

  it("still uses the OS store when a consistently signed app saves a new key", () => {
    saveAiKey("openai", "local-value");
    vi.stubEnv("INROAD_KEYCHAIN", "on");
    expect(saveAiKey("openai", KEY)).toBe("keychain");
    resetAiKeyCache();
    expect(readAiKey("openai")).toBe(KEY);
    expect(aiKeyStore("openai", "keychain")).toBe("keychain");
  });
});
