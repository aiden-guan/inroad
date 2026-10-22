/**
 * The Messages API wire format: one planned turn sent as server-sent events (what the engine uses) or as a
 * plain JSON message. Block shapes and event order follow the real stream: message_start (input usage),
 * content blocks with their deltas, message_delta (stop reason, output usage, server tool counts,
 * per-attempt iterations), message_stop.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunks(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [""];
}

/** The block as it appears in a finished (non-streamed) message. */
function finalBlock(b) {
  switch (b.type) {
    case "thinking":
      return { type: "thinking", thinking: b.thinking, signature: b.signature ?? "mock-signature" };
    case "text":
      return { type: "text", text: b.text };
    default:
      return b;
  }
}

export function jsonMessage(plan) {
  return {
    id: plan.id,
    type: "message",
    role: "assistant",
    model: plan.model,
    content: plan.blocks.map(finalBlock),
    stop_reason: plan.stop,
    stop_sequence: null,
    stop_details: plan.stopDetails ?? null,
    usage: { ...plan.usage.start, ...plan.usage.end },
  };
}

export async function streamMessage(res, plan, { delay = 0 } = {}) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "request-id": plan.requestId });
  const send = async (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (delay) await sleep(delay);
  };
  await send({
    type: "message_start",
    message: { id: plan.id, type: "message", role: "assistant", model: plan.requestedModel ?? plan.model, content: [], stop_reason: null, stop_sequence: null, usage: { ...plan.usage.start, output_tokens: 1 } },
  });

  for (const [index, b] of plan.blocks.entries()) {
    switch (b.type) {
      case "thinking":
        await send({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "", signature: "" } });
        for (const part of chunks(b.thinking, 48)) await send({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: part } });
        await send({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: b.signature ?? "mock-signature" } });
        break;
      case "text":
        await send({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
        for (const part of b.text.split(/(?<= )/).reduce((acc, w) => {
          // ~3 words a delta, like the real stream
          if (!acc.length || acc[acc.length - 1].split(" ").length > 3) acc.push(w);
          else acc[acc.length - 1] += w;
          return acc;
        }, [])) {
          await send({ type: "content_block_delta", index, delta: { type: "text_delta", text: part } });
        }
        break;
      case "server_tool_use":
      case "tool_use": {
        await send({ type: "content_block_start", index, content_block: { type: b.type, id: b.id, name: b.name, input: {} } });
        const json = JSON.stringify(b.input ?? {});
        for (const part of chunks(json, 400)) await send({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: part } });
        break;
      }
      default:
        // Result blocks (web search, web fetch, code execution) and fallback boundaries arrive whole.
        await send({ type: "content_block_start", index, content_block: b });
    }
    await send({ type: "content_block_stop", index });
    if (plan.midstreamError && index === 0) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: plan.midstreamError })}\n\n`);
      res.end();
      return;
    }
  }

  await send({
    type: "message_delta",
    delta: { stop_reason: plan.stop, stop_sequence: null, stop_details: plan.stopDetails ?? null },
    usage: plan.usage.end,
  });
  await send({ type: "message_stop" });
  res.end();
}
