import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { ProviderId } from "@/lib/ai/providers";

export type AiKeyId = ProviderId | `connection:${string}`;
import { readDataFile, writeDataFile, writeFileAtomic } from "./data-file";
import { DATA_DIR } from "./settings";

/**
 * Where AI provider keys live. Built for a released app, where the key is someone's money:
 *
 *  1. The operating system's credential store when there is one: macOS Keychain, Windows Credential
 *     Manager, or the Secret Service on Linux (GNOME Keyring, KWallet). The key never touches a file.
 *  2. Otherwise (a headless Linux box, a container) an encrypted file: AES-256-GCM, its own random
 *     data key in a separate file, both readable by this user only (0600). That keeps the key out of
 *     anything that copies or shows settings.json, backups and exports included; the computer account
 *     is still the boundary, as it is for the keychain.
 *
 * Keys go in and never come back out to the browser: the app shows the provider and the last four
 * characters. Reads are cached in memory so the keychain is asked once per process, not once per run.
 * INROAD_KEYCHAIN=off skips the keychain (tests, and anyone who prefers the file).
 */

export type KeyStore = "keychain" | "file";

const SERVICE = "Inroad";
const account = (provider: AiKeyId) => `ai-key:${provider}`;

const KEYS_FILE = () => path.join(DATA_DIR, "ai-keys.json");
const DATA_KEY_FILE = () => path.join(DATA_DIR, "ai-keys.secret");

interface Sealed {
  iv: string;
  tag: string;
  data: string;
}
interface KeysFile {
  v: 1;
  keys: Partial<Record<AiKeyId, Sealed>>;
}

type Keyring = typeof import("@napi-rs/keyring");

const cache = (() => {
  const g = globalThis as unknown as { __inroadAiKeys?: Map<AiKeyId, string | null> };
  g.__inroadAiKeys ??= new Map();
  return g.__inroadAiKeys;
})();

let keyringModule: Keyring | null | undefined;

/** The native keyring, or null where it can't load (an unsupported platform) or is turned off. */
function keyring(): Keyring | null {
  if (process.env.INROAD_KEYCHAIN === "off") return null;
  if (keyringModule === undefined) {
    try {
      // Loaded at runtime from the app's own node_modules (never bundled, see next.config.ts), so it resolves the
      // same in dev and in a production build. A platform without a prebuilt binary falls back to the file.
      keyringModule = createRequire(path.join(process.cwd(), "package.json"))("@napi-rs/keyring") as Keyring;
    } catch {
      keyringModule = null;
    }
  }
  return keyringModule;
}

/** Linux: the Secret Service only. The kernel keyring it would fall back to forgets everything at reboot. */
function entry(k: Keyring, provider: AiKeyId) {
  return new k.Entry(SERVICE, account(provider), { linux: { store: "secret-service" } });
}

/* ───────────── The encrypted file ───────────── */

function dataKey(create: boolean): Buffer | null {
  const file = DATA_KEY_FILE();
  try {
    const raw = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
    if (raw.length === 32) return raw;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (!create) return null;
  const fresh = randomBytes(32);
  writeFileAtomic(file, fresh.toString("base64"));
  return fresh;
}

function readFile(): KeysFile {
  return readDataFile<KeysFile>(KEYS_FILE(), () => ({ v: 1, keys: {} }), (raw) => {
    const f = (raw ?? {}) as Partial<KeysFile>;
    return { v: 1, keys: f.keys && typeof f.keys === "object" ? f.keys : {} };
  });
}

function seal(key: Buffer, plain: string, provider: AiKeyId): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // The provider is bound in as associated data: a sealed OpenAI key can't be moved under another name.
  cipher.setAAD(Buffer.from(account(provider)));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function open(key: Buffer, sealed: Sealed, provider: AiKeyId): string | null {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(account(provider)));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Tampered with, or the data key was replaced: treat as no key rather than crash every run.
    return null;
  }
}

function writeToFile(provider: AiKeyId, value: string) {
  const file = readFile();
  file.keys[provider] = seal(dataKey(true)!, value, provider);
  writeDataFile(KEYS_FILE(), file);
}

function removeFromFile(provider: AiKeyId) {
  const file = readFile();
  if (!file.keys[provider]) return;
  delete file.keys[provider];
  writeDataFile(KEYS_FILE(), file);
}

function readFromFile(provider: AiKeyId): string | null {
  const sealed = readFile().keys[provider];
  if (!sealed) return null;
  const key = dataKey(false);
  return key ? open(key, sealed, provider) : null;
}

/* ───────────── Public API ───────────── */

/** Saves a provider's key, in the keychain when one works (checked by reading it back), else the encrypted file. */
export function saveAiKey(provider: AiKeyId, value: string): KeyStore {
  const k = keyring();
  let where: KeyStore = "file";
  if (k) {
    try {
      const e = entry(k, provider);
      e.setPassword(value);
      if (e.getPassword() === value) where = "keychain";
    } catch {
      // No credential store here (or it's locked): the file it is.
    }
  }
  if (where === "keychain") removeFromFile(provider);
  else writeToFile(provider, value);
  cache.set(provider, value);
  return where;
}

/** A provider's saved key, or undefined. The keychain is asked first, then the file. */
export function readAiKey(provider: AiKeyId): string | undefined {
  if (cache.has(provider)) return cache.get(provider) ?? undefined;
  let value: string | null = null;
  const k = keyring();
  if (k) {
    try {
      value = entry(k, provider).getPassword();
    } catch {
      value = null;
    }
  }
  value ??= readFromFile(provider);
  cache.set(provider, value);
  return value ?? undefined;
}

/** Forgets a provider's key everywhere it might be. */
export function deleteAiKey(provider: AiKeyId) {
  const k = keyring();
  if (k) {
    try {
      entry(k, provider).deleteCredential();
    } catch {
      // nothing there, or no store
    }
  }
  removeFromFile(provider);
  cache.set(provider, null);
}

/** "…abcd": enough to recognize a key, never enough to use it. */
export function keyHint(value: string): string {
  return `…${value.trim().slice(-4)}`;
}

/** Takes any saved or given key out of a string (an API's error text can quote part of one). */
export function redactKeys(text: string, extra: (string | undefined)[] = []): string {
  let out = text;
  for (const v of [...cache.values(), ...extra]) {
    if (v && v.length >= 8) out = out.split(v).join("[key]");
  }
  return out;
}

/** Tests only: forget what was read, so the next read goes to the store again. */
export function resetAiKeyCache() {
  cache.clear();
}
