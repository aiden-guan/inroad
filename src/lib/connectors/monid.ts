import "server-only";
import { z } from "zod";
import { request } from "./http";
import { fail, ok, type ConnectorFactory } from "./types";

export const monid: ConnectorFactory = (secret) => ({
  id: "monid", name: "Monid",
  async validate() {
    if (!/^monid_(live|test)_\S+$/.test(secret)) return fail("validation", "Paste a Monid API key beginning monid_live_ or monid_test_.");
    const response = await request({ tool: "Monid", url: "https://api.monid.ai/v1/auth/whoami", headers: { authorization: `Bearer ${secret}` }, secrets: [secret], retries: 1 });
    if (!response.ok) return response;
    const parsed = z.object({ workspace: z.object({ workspaceId: z.string().min(1), name: z.string() }) }).safeParse(response.value);
    if (!parsed.success) return fail("validation", "This Monid key has no usable workspace. Create a workspace API key in Monid.");
    return ok({ accountLabel: parsed.data.workspace.name || parsed.data.workspace.workspaceId, config: { workspaceId: parsed.data.workspace.workspaceId } });
  },
});
