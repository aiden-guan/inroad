"use client";

import { useState } from "react";
import { Segmented } from "@/components/ui/misc";
import type { SnippetId } from "@/lib/api-keys/types";
import { Callout, CodeBlock, CopyField, LOCAL_ORIGIN } from "./bits";

/** Copy-paste setup for each kind of client, with the real key filled in when we have it (right after creation). */

export const PLACEHOLDER = "inr_YOUR_KEY";

const TABS: { value: SnippetId; label: string }[] = [
  { value: "claude_code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "claude_desktop", label: "Claude Desktop" },
  { value: "muse", label: "Meta Muse" },
  { value: "rest", label: "n8n, Zapier, ChatGPT" },
];

export function musePrompt(mcpUrl: string): string {
  return `Create a custom connector for Inroad, my go-to-market hub. It's an MCP server over Streamable HTTP at ${mcpUrl} with bearer-token auth. Ask me for the token in your secure credentials prompt, never in chat.

How to use it:
- Before prospecting or writing for me, call get_icp and get_playbook. Describe my company only with approved_claims.
- Before enriching or researching a list, call score_accounts and drop tier "none".
- Call search_records before contacting anyone, and skip anyone marked do_not_contact.
- Read get_account before writing to someone at a company.
- Save leads with add_accounts (source "muse") and record what happens with log_activity.
- Never send email or messages in my name. Put every draft in my approval queue with submit_draft.`;
}

function Step({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-[19px] text-fg-2 text-pretty">{children}</p>;
}

export function Snippets({
  token,
  base,
  localBase,
  isLocal,
  initial = "claude_code",
}: {
  token?: string;
  /** Where cloud clients reach this app: the public tunnel address when set, else this origin. */
  base: string;
  /** This computer's origin; local clients (Claude Code, Cursor, Claude Desktop) always use it. */
  localBase?: string;
  isLocal: boolean;
  initial?: SnippetId;
}) {
  const [tab, setTab] = useState<SnippetId>(initial);
  const key = token ?? PLACEHOLDER;
  const mcpUrl = `${base}/api/mcp`;
  // Tunnel addresses change on restart, so configs that live on this computer skip the tunnel.
  const local = (localBase || base).replace(/\/+$/, "");
  const localMcpUrl = `${local}/api/mcp`;
  const httpRemote = local.startsWith("http://") && !LOCAL_ORIGIN.test(local);

  return (
    <div className="min-w-0">
      <div className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-none">
        <Segmented value={tab} onChange={setTab} options={TABS} layoutId={`snippet-tab-${token ? "new" : "row"}`} className="w-max" />
      </div>
      <div key={tab} className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2.5 animate-[rise-in_180ms_var(--ease-out)]">
        {tab === "claude_code" && (
          <>
            <Step>Run this in your terminal. Claude Code reaches Inroad on this computer directly.</Step>
            <CodeBlock code={`claude mcp add --transport http inroad ${localMcpUrl} \\\n  --header "Authorization: Bearer ${key}"`} />
            <Step>Then try: “Read my ICP from Inroad and score these 20 companies.”</Step>
          </>
        )}
        {tab === "cursor" && (
          <>
            <Step>
              Add this to <code className="font-mono text-[12px]">~/.cursor/mcp.json</code>, or to <code className="font-mono text-[12px]">.cursor/mcp.json</code> in one project.
            </Step>
            <CodeBlock code={JSON.stringify({ mcpServers: { inroad: { url: localMcpUrl, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)} />
          </>
        )}
        {tab === "claude_desktop" && (
          <>
            <Step>Settings → Developer → Edit Config. Add this, then restart Claude Desktop. It connects through mcp-remote, which needs Node.js.</Step>
            <CodeBlock
              code={JSON.stringify(
                {
                  mcpServers: {
                    inroad: {
                      command: "npx",
                      args: ["-y", "mcp-remote", localMcpUrl, "--header", "Authorization:${AUTH_HEADER}", ...(httpRemote ? ["--allow-http"] : [])],
                      env: { AUTH_HEADER: `Bearer ${key}` },
                    },
                  },
                },
                null,
                2,
              )}
            />
          </>
        )}
        {tab === "muse" && (
          <>
            {isLocal && (
              <Callout tone="warning">
                Muse runs in Meta&apos;s cloud and can&apos;t reach <span className="font-mono text-[12px]">localhost</span>. Set a public address below first, then copy this again.
              </Callout>
            )}
            <Step>Paste this into Muse. It builds the connector itself; give it the key only in its secure credentials prompt.</Step>
            <CodeBlock code={musePrompt(mcpUrl)} label="Copy prompt" wrap />
          </>
        )}
        {tab === "rest" && (
          <>
            {isLocal && <Callout tone="warning">Zapier, Make and ChatGPT run in the cloud. Set a public address below; n8n on this computer can use localhost.</Callout>}
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-1 text-[12px] text-fg-3">Base URL</p>
                <CopyField value={`${base}/api/v1`} />
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[12px] text-fg-3">OpenAPI spec</p>
                <CopyField value={`${base}/api/v1/openapi.json`} />
              </div>
            </div>
            <Step>
              Send <code className="font-mono text-[12px]">Authorization: Bearer {key === PLACEHOLDER ? "<key>" : "…"}</code> on every call. In n8n use an HTTP Request node with Header Auth. In ChatGPT, create a GPT, then Actions → Import from URL with the OpenAPI link and API key auth (Bearer).
            </Step>
            <CodeBlock
              code={`curl -X POST ${base}/api/v1/accounts \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"source":"n8n","accounts":[{"domain":"acme.com","people":[{"email":"jane@acme.com","title":"VP Finance"}]}]}'`}
            />
          </>
        )}
      </div>
    </div>
  );
}
