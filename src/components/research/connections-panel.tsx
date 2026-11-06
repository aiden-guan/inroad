"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Textarea } from "@/components/ui/field";
import type { Binding, Capability, ToolConnection } from "@/lib/automation/types";
import { ImportMapper } from "./import-mapper";
import { controlClass, localPost, type AutomationController } from "./use-automation";

const freshBinding = (): Binding => ({
  capability: "search",
  tool: "",
  queryField: "query",
  limitField: "limit",
  resultPath: "results",
  fields: { url: "url", title: "title", description: "description" },
  defaults: {},
});
const examples = [
  {
    name: "n8n",
    steps: "Use an HTTP Request node with an Inroad agent key. Read the playbook, post accounts through the REST API, or post activities to your inbound hook.",
  },
  {
    name: "Zapier",
    steps: "Use Webhooks by Zapier to send a JSON POST to Inroad's inbound URL. Map the company domain, name and work email before testing one record.",
  },
  { name: "Make", steps: "Use HTTP → Make a request. Send JSON to the inbound URL shown in Integrations. Test one account before scheduling the scenario." },
];

export function ConnectionsPanel({ automation }: { automation: AutomationController }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"mcp" | "openapi">("mcp");
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [authScheme, setAuthScheme] = useState<"bearer" | "raw">("bearer");
  const [spec, setSpec] = useState("");
  const [discovered, setDiscovered] = useState<ToolConnection | null>(null);
  const [binding, setBinding] = useState<Binding>(freshBinding);
  const [defaults, setDefaults] = useState("{}");
  const [args, setArgs] = useState('{"query":"company research","limit":3}');
  const [output, setOutput] = useState<unknown>(undefined);
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const existing = discovered && automation.data?.connections.some((c) => c.id === discovered.id);
  async function safely(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The connection didn't finish.");
    } finally {
      setBusy(false);
    }
  }
  function edit(connection: ToolConnection) {
    setDiscovered(connection);
    setName(connection.name);
    setKind(connection.kind);
    setEndpoint(connection.endpoint);
    setAuthHeader(connection.authHeader);
    setAuthScheme(connection.authScheme);
    setKey("");
    setSpec("");
    setOutput(undefined);
    const first = connection.bindings[0] ?? { ...freshBinding(), tool: connection.tools.find((t) => t.readOnly)?.name ?? "" };
    setBinding(first);
    setDefaults(JSON.stringify(first.defaults, null, 2));
  }
  async function discover() {
    await safely(async () => {
      const result = await automation.run<ToolConnection>({
        action: "discover",
        input: {
          name,
          kind,
          endpoint,
          ...(key ? { key } : {}),
          authHeader,
          authScheme,
          ...(spec.trim() ? { spec: JSON.parse(spec) } : {}),
          ...(existing ? { id: discovered!.id } : {}),
        },
      });
      setDiscovered(result);
      setBinding({ ...freshBinding(), tool: result.tools.find((t) => t.readOnly)?.name ?? "" });
      setMessage(`${result.tools.filter((t) => t.readOnly).length} read-only tools found. Choose a capability and map its fields.`);
    });
  }
  async function save() {
    await safely(async () => {
      const mapped = { ...binding, defaults: JSON.parse(defaults) };
      if (
        existing &&
        discovered!.name === name &&
        discovered!.endpoint === endpoint &&
        discovered!.authHeader === authHeader &&
        discovered!.authScheme === authScheme &&
        !key &&
        !spec.trim()
      ) {
        const bindings = [...discovered!.bindings.filter((b) => b.capability !== mapped.capability), mapped];
        const saved = await automation.run<ToolConnection>({ action: "bindings", id: discovered!.id, bindings });
        setDiscovered(saved);
      } else {
        const saved = await automation.run<ToolConnection>({
          action: "connect",
          input: {
            ...(existing ? { id: discovered!.id } : {}),
            name,
            kind,
            endpoint,
            ...(key ? { key } : {}),
            authHeader,
            authScheme,
            ...(spec.trim() ? { spec: JSON.parse(spec) } : {}),
            bindings: [...(discovered?.bindings.filter((b) => b.capability !== mapped.capability) ?? []), mapped],
          },
        });
        setDiscovered(saved);
        setKey("");
      }
      setMessage("Connection and mapping saved. Run a preview to verify the returned records.");
    });
  }
  const connected = (automation.data?.connections.length ?? 0) > 0;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-[18px] font-medium text-fg">Bring in what your other tools know</h2>
        <p className="mt-1 max-w-[70ch] text-[13px] leading-6 text-fg-2">
          Search with the engine you already pay for, import companies and people from another tool&apos;s export, or let your automations send leads in. Everything
          here reads; nothing changes or sends anything in those tools. CRM, sequencer and webhook connections live in{" "}
          <Link href="/integrations#inbound" className="underline">
            Integrations
          </Link>
          .
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-inset ring-border">
            <h3 className="text-[14px] font-medium text-fg">Use your own search engine</h3>
            <p className="mt-1 text-[12.5px] leading-[18px] text-fg-2">Firecrawl, Exa, Tavily, Brave and others, with a daily request limit you set.</p>
            <Link href="/settings#web-search" className="mt-2 inline-block text-[12.5px] font-medium text-fg underline underline-offset-2">
              Choose a search provider
            </Link>
          </div>
          <div className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-inset ring-border">
            <h3 className="text-[14px] font-medium text-fg">Import records from another tool</h3>
            <p className="mt-1 text-[12.5px] leading-[18px] text-fg-2">Paste a JSON export, map its fields, and preview before anything is added. Opt-outs are kept.</p>
            <a href="#import-records" className="mt-2 inline-block text-[12.5px] font-medium text-fg underline underline-offset-2">
              Paste an export
            </a>
          </div>
          <div className="rounded-xl bg-surface p-4 shadow-xs ring-1 ring-inset ring-border">
            <h3 className="text-[14px] font-medium text-fg">Automate with n8n, Zapier or Make</h3>
            <p className="mt-1 text-[12.5px] leading-[18px] text-fg-2">Read your playbook or send in accounts from a workflow. Starter files below.</p>
            <a href="#automations" className="mt-2 inline-block text-[12.5px] font-medium text-fg underline underline-offset-2">
              See the starters
            </a>
          </div>
        </div>
      </section>
      {automation.data?.connections.map((connection) => (
        <article key={connection.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="min-w-0">
            <p className="text-[14px] font-medium">
              {connection.name} · {connection.enabled ? "Enabled" : "Paused"}
            </p>
            <p className="mt-1 break-all text-[12px] text-fg-3">{connection.endpoint}</p>
            <p className="mt-1 text-[12px] text-fg-2">{connection.bindings.map((b) => b.capability).join(", ") || "No capabilities mapped"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => edit(connection)}>
              Manage
            </Button>
            {connection.bindings.some((b) => b.capability === "search") && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !connection.enabled}
                onClick={() =>
                  void safely(async () => {
                    await localPost("/api/settings", { search: { provider: "connected", connectionId: connection.id } });
                    setMessage(`Web search now uses ${connection.name}.`);
                  })
                }
              >
                Use for web search
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void safely(async () => {
                  await automation.run({ action: "toggle", id: connection.id, enabled: !connection.enabled });
                })
              }
            >
              {connection.enabled ? "Pause" : "Enable"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void safely(async () => {
                  await automation.run({ action: "disconnect", id: connection.id });
                  if (discovered?.id === connection.id) setDiscovered(null);
                })
              }
            >
              Disconnect
            </Button>
          </div>
        </article>
      ))}
      <details open={connected || !!discovered || undefined} className="group rounded-xl ring-1 ring-inset ring-border">
        <summary className="cursor-pointer list-none rounded-xl px-5 py-3.5 hover:bg-bg-subtle/60 [&::-webkit-details-marker]:hidden">
          <span className="text-[14px] font-medium text-fg">Advanced: connect an MCP server or an OpenAPI tool</span>
          <span className="mt-0.5 block text-[12.5px] text-fg-3">For tools without a built-in connection. Inroad finds their read-only operations and you map the fields.</span>
        </summary>
      <section className="space-y-4 border-t border-border p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[17px] font-medium">{existing ? `Manage ${discovered!.name}` : "Connect a tool"}</h2>
          {discovered && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDiscovered(null);
                setName("");
                setEndpoint("");
                setKey("");
                setSpec("");
                setOutput(undefined);
              }}
            >
              New connection
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] text-fg-2">
            Connection name
            <Input aria-label="Connection name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-[12px] text-fg-2">
            Connection type
            <select
              aria-label="Connection type"
              className={controlClass}
              value={kind}
              disabled={!!discovered}
              onChange={(e) => setKind(e.target.value as "mcp" | "openapi")}
            >
              <option value="mcp">MCP over HTTP</option>
              <option value="openapi">OpenAPI 3 document</option>
            </select>
          </label>
          <label className="text-[12px] text-fg-2 sm:col-span-2">
            {kind === "mcp" ? "MCP endpoint" : "API base URL"}
            <Input aria-label="Tool endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://your-tool.example/api" />
          </label>
          <label className="text-[12px] text-fg-2">
            API key (optional)
            <Input aria-label="Tool API key" type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} />
          </label>
          <label className="text-[12px] text-fg-2">
            Authentication
            <select
              aria-label="Tool authentication"
              className={controlClass}
              value={authScheme}
              onChange={(e) => {
                setAuthScheme(e.target.value as "bearer" | "raw");
                setAuthHeader(e.target.value === "bearer" ? "Authorization" : "X-API-Key");
              }}
            >
              <option value="bearer">Bearer token</option>
              <option value="raw">API key header</option>
            </select>
          </label>
          {authScheme === "raw" && (
            <label className="text-[12px] text-fg-2">
              API key header name
              <Input aria-label="API key header name" value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} />
            </label>
          )}
        </div>
        {kind === "openapi" && (
          <label className="block text-[12px] text-fg-2">
            OpenAPI JSON
            <Textarea
              aria-label="OpenAPI JSON"
              rows={7}
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder='{"openapi":"3.0.3","paths":{...}}'
            />
            <input
              type="file"
              accept=".json,application/json"
              aria-label="Upload OpenAPI document"
              className="mt-2 max-w-full text-[12px]"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && file.size <= 2_000_000) void file.text().then(setSpec);
                else if (file) setError("Choose a JSON document under 2 MB.");
              }}
            />
          </label>
        )}
        <Button size="sm" disabled={busy || !name || !endpoint} loading={busy} onClick={() => void discover()}>
          Discover tools
        </Button>
        {discovered && (
          <div className="space-y-4 border-t border-border pt-4">
            <p className="text-[12px] text-fg-3">
              {discovered.tools.length} operations found. Only tools declared read-only are available. Connection keys stay on this computer.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] text-fg-2">
                Capability
                <select
                  aria-label="Capability"
                  className={controlClass}
                  value={binding.capability}
                  onChange={(e) => {
                    const capability = e.target.value as Capability;
                    setBinding({
                      ...binding,
                      capability,
                      fields:
                        capability === "search"
                          ? { url: "url", title: "title", description: "description" }
                          : capability === "fetch"
                            ? { url: "url", title: "title", text: "text" }
                            : { domain: "domain", company: "company", email: "email", name: "name", title: "title" },
                    });
                  }}
                >
                  <option value="search">Web search</option>
                  <option value="fetch">Fetch a page</option>
                  <option value="records">Read records</option>
                  <option value="enrich">Enrich records</option>
                </select>
              </label>
              <label className="text-[12px] text-fg-2">
                Read-only operation
                <select
                  aria-label="Read-only operation"
                  className={controlClass}
                  value={binding.tool}
                  onChange={(e) => setBinding({ ...binding, tool: e.target.value })}
                >
                  <option value="">Choose a read operation</option>
                  {discovered.tools
                    .filter((t) => t.readOnly)
                    .map((tool) => (
                      <option key={tool.name} value={tool.name}>
                        {tool.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-[12px] text-fg-2">
                Query argument
                <Input
                  aria-label="Query argument"
                  value={binding.queryField}
                  onChange={(e) => setBinding({ ...binding, queryField: e.target.value })}
                  placeholder="query, q, url, or blank"
                />
              </label>
              <label className="text-[12px] text-fg-2">
                Limit argument
                <Input
                  aria-label="Limit argument"
                  value={binding.limitField}
                  onChange={(e) => setBinding({ ...binding, limitField: e.target.value })}
                  placeholder="limit, count, or blank"
                />
              </label>
              <label className="text-[12px] text-fg-2 sm:col-span-2">
                Results path
                <Input
                  aria-label="Tool results path"
                  value={binding.resultPath}
                  onChange={(e) => setBinding({ ...binding, resultPath: e.target.value })}
                  placeholder="results, data.records, or blank"
                />
              </label>
              {Object.entries(binding.fields).map(([field, path]) => (
                <label key={field} className="text-[12px] text-fg-2">
                  Result {field}
                  <Input
                    aria-label={`Result ${field}`}
                    value={path}
                    onChange={(e) => setBinding({ ...binding, fields: { ...binding.fields, [field]: e.target.value } })}
                  />
                </label>
              ))}
            </div>
            <label className="block text-[12px] text-fg-2">
              Default arguments (JSON)
              <Textarea aria-label="Default arguments" rows={3} value={defaults} onChange={(e) => setDefaults(e.target.value)} />
            </label>
            {binding.tool && (
              <details className="text-[12px] text-fg-3">
                <summary>Operation input fields</summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(discovered.tools.find((t) => t.name === binding.tool)?.inputSchema, null, 2)}
                </pre>
              </details>
            )}
            <Button size="sm" disabled={busy || !binding.tool} onClick={() => void save()}>
              {existing ? "Save capability mapping" : "Save connection"}
            </Button>
            {existing && (
              <div className="space-y-3 border-t border-border pt-4">
                <label className="block text-[12px] text-fg-2">
                  Preview arguments (JSON)
                  <Textarea aria-label="Preview arguments" rows={3} value={args} onChange={(e) => setArgs(e.target.value)} />
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !binding.tool}
                  onClick={() =>
                    void safely(async () => {
                      setOutput(await automation.run({ action: "call", id: discovered.id, tool: binding.tool, args: JSON.parse(args) }));
                    })
                  }
                >
                  Run read-only preview
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
      </details>
      {(error || message) && (
        <div className="-mt-3 px-1">
          {error && <FieldError>{error}</FieldError>}
          {message && (
            <p role="status" className="text-[12px] text-fg-2">
              {message}
            </p>
          )}
        </div>
      )}
      {output !== undefined && (
        <section className="space-y-3 rounded-xl p-5 ring-1 ring-inset ring-border">
          <details className="text-[12px] text-fg-3">
            <summary className="cursor-pointer">Raw response</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle p-3 text-[12px]">{JSON.stringify(output, null, 2)}</pre>
          </details>
          <ImportMapper key={JSON.stringify(output).slice(0, 500)} data={output} name={name} automation={automation} />
        </section>
      )}
      <section id="import-records" className="scroll-mt-24 space-y-3 rounded-xl p-5 ring-1 ring-inset ring-border">
        <h2 className="text-[16px] font-medium">Import records from another tool</h2>
        <p className="text-[12px] text-fg-3">Paste a JSON export or preview response. CSV imports remain available in Integrations.</p>
        <Textarea aria-label="JSON records to import" rows={5} value={json} onChange={(e) => setJson(e.target.value)} />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !json.trim()}
          onClick={() =>
            void safely(async () => {
              setOutput(JSON.parse(json));
              setName(name || "JSON export");
            })
          }
        >
          Map JSON records
        </Button>
      </section>
      <section id="automations" className="grid scroll-mt-24 gap-3 sm:grid-cols-3">
        {examples.map((example) => (
          <article key={example.name} className="rounded-lg bg-bg-subtle p-4">
            <h3 className="text-[14px] font-medium">{example.name}</h3>
            <p className="mt-2 text-[12px] leading-5 text-fg-2">{example.steps}</p>
            <Link href="/integrations#inbound" className="mt-3 inline-block text-[12px] underline">
              Get connection URL and sample
            </Link>
            {example.name === "n8n" && (
              <div className="mt-2 flex flex-col gap-2 text-[12px]">
                <a href="/integrations/n8n-read-playbook.json" download className="underline">
                  Download playbook workflow
                </a>
                <a href="/integrations/n8n-import-account.json" download className="underline">
                  Download account import workflow
                </a>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
