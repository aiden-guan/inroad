import { connection } from "next/server";
import { z } from "zod";
import { ConnectionInput, callConnection, discoverConnection, removeConnection, saveConnection } from "@/lib/automation/connections";
import { MappedImportInput, commitMappedImport, previewMappedImport, suggestFields } from "@/lib/automation/imports";
import { monitorStatus, pollMonitors, removeMonitor, saveMonitor } from "@/lib/automation/monitors";
import { readAutomation, updateAutomation } from "@/lib/automation/store";
import { Binding } from "@/lib/automation/types";
import { researchMetrics } from "@/lib/search/research";
import { getSecret } from "@/lib/store/workspace";
import { errorResponse, readJSON } from "@/lib/server/http";

export async function GET() {
  await connection();
  try {
    const data = readAutomation();
    return Response.json(
      {
        connections: data.connections.map((c) => ({ ...c, hasKey: !!getSecret("hub", `tool_${c.id}`) })),
        ...monitorStatus(),
        imports: data.imports,
        sessions: data.sessions,
        receipts: data.receipts.slice(0, 100),
        metrics: researchMetrics(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["discover", "connect"]), input: ConnectionInput }),
  z.object({ action: z.literal("bindings"), id: z.string().uuid(), bindings: z.array(Binding).max(8) }),
  z.object({ action: z.literal("toggle"), id: z.string().uuid(), enabled: z.boolean() }),
  z.object({ action: z.literal("call"), id: z.string().uuid(), tool: z.string().max(200), args: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("disconnect"), id: z.string().uuid() }),
  z.object({ action: z.enum(["preview_import", "import"]), input: MappedImportInput }),
  z.object({ action: z.literal("suggest_mapping"), data: z.unknown(), resultPath: z.string().max(200).default("") }),
  z.object({ action: z.literal("save_monitor"), input: z.unknown(), id: z.string().uuid().optional() }),
  z.object({ action: z.enum(["remove_monitor", "check_monitor", "read_observation"]), id: z.string().uuid() }),
  z.object({ action: z.literal("toggle_monitor"), id: z.string().uuid(), enabled: z.boolean() }),
]);

/** Connections execute reads; importing and monitoring only change this local workspace. */
export async function POST(request: Request) {
  try {
    const body = Body.parse(await readJSON(request));
    let result: unknown;
    switch (body.action) {
      case "discover":
        result = await discoverConnection(body.input);
        break;
      case "connect":
        result = await saveConnection(body.input);
        break;
      case "call":
        result = await callConnection(body.id, body.tool, body.args, request.signal);
        break;
      case "disconnect":
        await removeConnection(body.id);
        result = { removed: true };
        break;
      case "bindings":
        result = (
          await updateAutomation((data) => {
            const target = data.connections.find((c) => c.id === body.id);
            if (!target) throw new Error("This connection no longer exists.");
            for (const binding of body.bindings)
              if (!target.tools.some((t) => t.name === binding.tool && t.readOnly)) throw new Error("Choose a discovered read-only tool.");
            if (new Set(body.bindings.map((b) => b.capability)).size !== body.bindings.length) throw new Error("Use one binding per capability.");
            target.bindings = body.bindings;
            return target;
          })
        ).value;
        break;
      case "toggle":
        result = (
          await updateAutomation((data) => {
            const target = data.connections.find((c) => c.id === body.id);
            if (!target) throw new Error("This connection no longer exists.");
            target.enabled = body.enabled;
            return target;
          })
        ).value;
        break;
      case "suggest_mapping":
        result = suggestFields(body.data, body.resultPath);
        break;
      case "preview_import":
        result = previewMappedImport(body.input);
        break;
      case "import":
        result = await commitMappedImport(body.input);
        break;
      case "save_monitor":
        result = await saveMonitor(body.input, body.id);
        break;
      case "remove_monitor":
        await removeMonitor(body.id);
        result = { removed: true };
        break;
      case "check_monitor":
        if (!readAutomation().monitors.some((m) => m.id === body.id && m.enabled)) throw new Error("That monitor is paused or no longer exists.");
        result = await pollMonitors({ forceId: body.id });
        break;
      case "toggle_monitor": {
        const target = readAutomation().monitors.find((m) => m.id === body.id);
        if (!target) throw new Error("This monitor no longer exists.");
        result = await saveMonitor({ ...target, enabled: body.enabled }, body.id);
        break;
      }
      case "read_observation":
        await updateAutomation((data) => {
          const target = data.observations.find((o) => o.id === body.id);
          if (target) target.read = true;
        });
        result = { read: true };
        break;
    }
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, 400);
  }
}
