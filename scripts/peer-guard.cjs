/**
 * Preloaded into Inroad's server by scripts/serve.mjs (NODE_OPTIONS --require), before Next creates its
 * HTTP server. Stamps every request with the address its socket really comes from, in `x-inroad-peer`.
 * Whatever a caller sends under that name is overwritten, so no client can claim to be this computer.
 *
 * Next.js doesn't expose the socket to the proxy or route handlers, and it keeps a caller's own
 * X-Forwarded-For (it only fills the header in when it's missing), so headers alone can't tell a
 * request from this machine from one on the same Wi-Fi that says it is. src/lib/server/local-request.ts
 * decides locality from this stamp, and refuses everything when the stamp is missing.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload, loaded with --require */
const http = require("node:http");
const https = require("node:https");

const HEADER = "x-inroad-peer";
// Every event that hands a request to a listener. Next listens for "request" and "upgrade" (dev reloads).
const EVENTS = new Set(["request", "upgrade", "checkContinue", "checkExpectation", "connect"]);

for (const Server of [http.Server, https.Server]) {
  const emit = Server.prototype.emit;
  if (emit.inroadPeer) continue;
  const stamped = function (event, req, ...rest) {
    if (EVENTS.has(event) && req && req.headers) req.headers[HEADER] = (req.socket && req.socket.remoteAddress) || "";
    return emit.call(this, event, req, ...rest);
  };
  stamped.inroadPeer = true;
  Server.prototype.emit = stamped;
}

// Read by local-request.ts in this process and in the dev server's worker, which inherits both.
process.env.INROAD_PEER_GUARD = "1";
