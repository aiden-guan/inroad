import type { AgentEvent } from "./events";

/** Reads an SSE response from `streamRun` and yields parsed agent events. Browser-safe. */
export async function* readAgentStream(response: Response): AsyncGenerator<AgentEvent> {
  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // not JSON
    }
    yield { type: "error", message };
    yield { type: "done" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        yield JSON.parse(data) as AgentEvent;
      } catch {
        // ignore malformed frame
      }
    }
  }
}
