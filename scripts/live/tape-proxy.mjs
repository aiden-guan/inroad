/**
 * A loopback proxy in front of the Messages API (the real one, or the mock) that records every exchange
 * as a tape and, when given a cap, refuses any request that could take total spend past it.
 *
 * The cap is hard: before forwarding, a request reserves its worst case (its prompt billed as uncached
 * input, max_tokens of output, every server-tool use it allows); when the response ends, the reservation
 * is replaced by what the response's usage says it cost. A request that doesn't fit is answered with a
 * 400 and never reaches the API.
 *
 * Tapes are grouped by name: POST /__tape/start {"name"} begins one, POST /__tape/stop ends it and returns
 * its exchanges (tests in another process use these; tests in this process call start()/stop()).
 */
import http from "node:http";
import https from "node:https";

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "accept-encoding"]);

/** The final message an SSE stream describes (what the SDK's finalMessage() would return), for billing. */
export function messageFromEvents(events) {
  let message = null;
  for (const e of events) {
    if (e.type === "message_start") message = { ...e.message, content: [], usage: { ...e.message.usage } };
    else if (!message) continue;
    else if (e.type === "content_block_start") {
      message.content.push(e.content_block);
      if (e.content_block?.type === "fallback") message.model = e.content_block.to?.model ?? message.model;
    } else if (e.type === "message_delta") {
      message.stop_reason = e.delta?.stop_reason ?? message.stop_reason;
      message.stop_details = e.delta?.stop_details ?? message.stop_details;
      // Cumulative totals, present only when they apply: overwrite, never add (as the SDK does).
      for (const [k, v] of Object.entries(e.usage ?? {})) if (v !== null && v !== undefined) message.usage[k] = v;
    }
  }
  return message;
}

export function parseSSE(raw) {
  const events = [];
  for (const chunk of raw.split(/\n\n+/)) {
    const data = chunk
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // keep-alive or partial chunk
    }
  }
  return events;
}

/** What tells two requests apart for replay: the model, the tool set and how far into the conversation. */
export function exchangeKey(body) {
  const tools = (body.tools ?? []).map((t) => t.name).sort().join(",");
  return `${body.model}|${tools}|${body.messages?.length ?? 0}`;
}

export function requestSummary(body) {
  return {
    model: body.model,
    tools: (body.tools ?? []).map((t) => t.name),
    messages: body.messages?.length ?? 0,
    maxTokens: body.max_tokens,
    effort: body.output_config?.effort ?? null,
    cacheTtl: body.cache_control?.ttl ?? (body.cache_control ? "5m" : null),
    stream: body.stream === true,
  };
}

/**
 * @param {{ upstream: string, apiKey?: string, capUsd?: number, price?: { worstCase(body): number, actual(message): number }, coalesce?: boolean, log?: (line: string) => void }} opts
 */
export async function startTapeProxy(opts) {
  const upstream = new URL(opts.upstream);
  const client = upstream.protocol === "https:" ? https : http;
  const log = opts.log ?? (() => {});
  let spent = 0;
  let reserved = 0;
  let tape = null;
  const all = [];

  const server = http.createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      if (req.url.startsWith("/__tape/")) return control(req, res, raw);
      const body = raw ? JSON.parse(raw) : {};
      const isMessages = req.method === "POST" && /^\/v1\/messages(\?|$)/.test(req.url);

      let hold = 0;
      if (isMessages && opts.capUsd !== undefined && opts.price) {
        hold = opts.price.worstCase(body);
        if (spent + reserved + hold > opts.capUsd) {
          const message = `Smoke spend cap reached: $${spent.toFixed(4)} spent, $${reserved.toFixed(4)} in flight, this request could cost up to $${hold.toFixed(4)} (cap $${opts.capUsd}).`;
          log(`[tape-proxy] refused: ${message}`);
          res.writeHead(400, { "content-type": "application/json", "x-should-retry": "false" });
          res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } }));
          record(body, { status: 400, headers: { "content-type": "application/json" }, json: { type: "error", error: { type: "invalid_request_error", message } }, capped: true });
          return;
        }
        reserved += hold;
      }

      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
      if (opts.apiKey) {
        headers["x-api-key"] = opts.apiKey;
        delete headers.authorization;
      }
      headers.host = upstream.host;
      const target = new URL(req.url, upstream);
      const up = client.request(target, { method: req.method, headers }, (upRes) => {
        const out = { "content-type": upRes.headers["content-type"] ?? "application/json" };
        for (const h of ["request-id", "retry-after", "retry-after-ms", "x-should-retry", "anthropic-organization-id"]) if (upRes.headers[h]) out[h] = upRes.headers[h];
        res.writeHead(upRes.statusCode ?? 502, out);
        let text = "";
        upRes.setEncoding("utf8");
        upRes.on("data", (c) => {
          text += c;
          res.write(c);
        });
        upRes.on("end", () => {
          res.end();
          if (!isMessages) return;
          const sse = /event-stream/.test(out["content-type"]);
          const events = sse ? parseSSE(text) : null;
          let cost = 0;
          if (opts.price) {
            const message = sse ? messageFromEvents(events) : upRes.statusCode === 200 ? safeJSON(text) : null;
            cost = message?.usage ? opts.price.actual(message) : 0;
          }
          reserved -= hold;
          spent += cost;
          record(body, sse ? { status: upRes.statusCode, headers: out, events: opts.coalesce ? coalesce(events) : events, costUsd: cost } : { status: upRes.statusCode, headers: out, json: safeJSON(text), costUsd: cost });
        });
      });
      up.on("error", (err) => {
        reserved -= hold;
        log(`[tape-proxy] upstream failed: ${err.message}`);
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: `Upstream unreachable: ${err.message}` } }));
      });
      up.end(raw);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: String(err?.message ?? err) } }));
    }
  });

  function record(body, response) {
    const exchange = { key: exchangeKey(body), request: requestSummary(body), ...response };
    all.push(exchange);
    if (tape) tape.exchanges.push(exchange);
  }

  function control(req, res, raw) {
    const body = raw ? JSON.parse(raw) : {};
    if (req.url.startsWith("/__tape/start")) {
      api.start(body.name);
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith("/__tape/peek")) {
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ exchanges: tape?.exchanges ?? [], spentUsd: spent }));
    }
    if (req.url.startsWith("/__tape/stop")) {
      const exchanges = api.stop();
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ exchanges, spentUsd: spent }));
    }
    res.writeHead(404).end();
  }

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const api = {
    url: `http://127.0.0.1:${port}`,
    start(name) {
      tape = { name, exchanges: [] };
    },
    stop() {
      const done = tape?.exchanges ?? [];
      tape = null;
      return done;
    },
    /** The current tape's exchanges so far. */
    peek: () => [...(tape?.exchanges ?? [])],
    spentUsd: () => spent,
    exchanges: () => [...all],
    close: () => new Promise((resolve) => server.close(resolve)),
  };
  return api;
}

function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Merges consecutive deltas of one block (smaller tapes; the same final message). Mock tapes only. */
function coalesce(events) {
  const out = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    if (e.type === "content_block_delta" && prev?.type === "content_block_delta" && prev.index === e.index && prev.delta.type === e.delta.type) {
      const k = { text_delta: "text", thinking_delta: "thinking", input_json_delta: "partial_json" }[e.delta.type];
      if (k) {
        out[out.length - 1] = { ...prev, delta: { ...prev.delta, [k]: prev.delta[k] + e.delta[k] } };
        continue;
      }
    }
    out.push(e);
  }
  return out;
}
