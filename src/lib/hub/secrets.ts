import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getSecret, setSecrets } from "@/lib/store/workspace";

/**
 * Two per-workspace secrets, both in secrets.json:
 *  - inbound: the path token in /api/hooks/{source}/{secret}; whoever has the URL can post data in
 *  - signing: `whsec_…` key for Standard Webhooks signatures on everything we send out
 */

export function inboundSecret(): string {
  let s = getSecret("webhook_in", "secret");
  if (!s) {
    s = randomBytes(18).toString("base64url");
    setSecrets("webhook_in", { secret: s });
  }
  return s;
}

export function signingSecret(): string {
  let s = getSecret("webhook_out", "secret");
  if (!s) {
    s = `whsec_${randomBytes(32).toString("base64")}`;
    setSecrets("webhook_out", { secret: s });
  }
  return s;
}

export function rotateSecret(which: "inbound" | "signing"): string {
  if (which === "inbound") setSecrets("webhook_in", { secret: null });
  else setSecrets("webhook_out", { secret: null });
  return which === "inbound" ? inboundSecret() : signingSecret();
}

/** Constant-time check of the path token. */
export function verifyInbound(given: string): boolean {
  const expected = getSecret("webhook_in", "secret");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
