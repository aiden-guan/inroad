"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input } from "@/components/ui/field";
import { ConfirmButton, CopyField, Disclosure, ExternalLink, Step } from "./parts";

export interface TunnelState {
  installed: boolean;
  running: boolean;
  starting: boolean;
  mode: "quick" | "named";
  namedUrl?: string;
  url?: string;
  error?: string;
  installCommand: string;
}

async function post(body: unknown): Promise<TunnelState> {
  const res = await fetch("/api/integrations/tunnel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as (TunnelState & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error ?? "That didn't save. Try again.");
  return json;
}

/**
 * "Keep the same address": a named Cloudflare tunnel on the founder's own domain. Set up once in
 * Cloudflare, it keeps one address across restarts, so webhooks and remote MCP URLs pasted into other
 * tools keep working. Three steps, the token pasted here, nothing else to run.
 */
export function NamedTunnelSetup({ tunnel, port, onChange }: { tunnel: TunnelState; port: string; onChange: (t: TunnelState) => void }) {
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (tunnel.namedUrl) {
    return (
      <p className="flex flex-wrap items-center gap-x-1 text-[12px] leading-[18px] text-fg-3">
        <span>
          Named tunnel: <span className="break-all font-mono text-fg-2">{tunnel.namedUrl}</span>. Its address stays the same, and it starts again by itself whenever Inroad starts.
        </span>
        <ConfirmButton
          confirmLabel="Use quick tunnels instead?"
          onConfirm={async () => {
            try {
              onChange(await post({ named: null }));
              toast("Named tunnel removed. Turning the public URL on starts a quick tunnel.");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "That didn't work. Try again.");
            }
          }}
        >
          Remove
        </ConfirmButton>
      </p>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await post({ named: { token, url } }));
      setToken("");
      setUrl("");
      toast.success("Named tunnel saved. Turn on Enable public URL to start it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Disclosure title="Keep the same address after restarts">
      <div className="space-y-4">
        <p className="text-[13px] leading-[19px] text-fg-2">
          A quick tunnel gets a new address every time it starts, so tools stop reaching Inroad until you paste the new one. A named tunnel on your own domain keeps one address. It&apos;s
          free with a Cloudflare account.
        </p>
        <Step n={1} title="Create a tunnel">
          <p className="text-[13px] leading-[19px] text-fg-2">Cloudflare → Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared. Name it Inroad.</p>
          <div className="mt-1.5">
            <ExternalLink href="https://one.dash.cloudflare.com/">Open Cloudflare</ExternalLink>
          </div>
        </Step>
        <Step n={2} title="Route a hostname to this computer">
          <p className="mb-1.5 text-[13px] leading-[19px] text-fg-2">Add a public hostname, like inroad.yourdomain.com, with service type HTTP and this URL:</p>
          <CopyField value={`127.0.0.1:${port}`} />
        </Step>
        <Step n={3} title="Paste the token and the hostname">
          <form onSubmit={save} className="space-y-2">
            <Input
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                if (error) setError(null);
              }}
              placeholder="eyJh… (or the whole install command)"
              aria-label="Tunnel token"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              className="font-mono text-[12px]"
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="https://inroad.yourdomain.com"
                aria-label="Public hostname"
                spellCheck={false}
                className="font-mono text-[12px]"
              />
              <Button type="submit" variant="primary" loading={busy} disabled={!token.trim() || !url.trim()}>
                Save
              </Button>
            </div>
          </form>
          <FieldError>{error}</FieldError>
          <p className="mt-2 text-[12px] leading-[18px] text-fg-3">The token stays on this computer, readable by you alone. Only hook URLs, the agent API and MCP answer at that address.</p>
        </Step>
      </div>
    </Disclosure>
  );
}
