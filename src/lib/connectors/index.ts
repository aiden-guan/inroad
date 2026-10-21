import "server-only";
import type { Workspace } from "@/lib/domain/types";
import { getSecret, readWorkspace } from "@/lib/store/workspace";
import { attio } from "./attio";
import type { NativeConnectorId } from "./catalog";
import { firecrawl } from "./firecrawl";
import { hubspot } from "./hubspot";
import { instantly } from "./instantly";
import { lemlist } from "./lemlist";
import { smartlead } from "./smartlead";
import { slack } from "./slack";
import type { Connector, ConnectorConfig, ConnectorFactory } from "./types";

const FACTORIES: Record<NativeConnectorId, ConnectorFactory> = { hubspot, attio, instantly, smartlead, lemlist, slack, firecrawl };

/** The secret for a native connector lives under this key in secrets.json. */
export const SECRET_KEY = "key";

/** Builds a connector from a key the founder just pasted (not saved yet). */
export function makeConnector(id: NativeConnectorId, secret: string, config: ConnectorConfig = {}): Connector {
  return FACTORIES[id](secret.trim(), config);
}

/** The saved, enabled connector, or null when it isn't connected. */
export function connectorFor(id: NativeConnectorId, ws: Workspace = readWorkspace()): Connector | null {
  const state = ws.integrations[id];
  const secret = getSecret(id, SECRET_KEY);
  if (!state?.enabled || !secret) return null;
  return FACTORIES[id](secret, state.config ?? {});
}

export * from "./catalog";
export * from "./types";
