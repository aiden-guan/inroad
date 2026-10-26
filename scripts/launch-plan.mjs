/**
 * What scripts/serve.mjs starts, worked out from its arguments and environment with no side effects,
 * so it can be tested (src/lib/server/launcher.test.ts). Plain JS: the launcher runs before any build.
 */

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|\[::1\]|localhost)$/i;

/** The value of a flag like `-p 3301` or `--port=3301`, removed from `args`. */
function take(args, short, long) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === short || a === long) {
      const value = args[i + 1];
      args.splice(i, 2);
      return value;
    }
    if (a.startsWith(`${long}=`)) {
      args.splice(i, 1);
      return a.slice(long.length + 1);
    }
  }
  return undefined;
}

/**
 * @param {string[]} argv  what follows `node scripts/serve.mjs`: `dev|start [--mock] [next options]`
 * @param {Record<string, string | undefined>} baseEnv  the launcher's environment
 * @param {string} guardPath  absolute path of scripts/peer-guard.cjs
 */
export function launchPlan(argv, baseEnv, guardPath) {
  const [mode, ...rest] = argv;
  if (mode !== "dev" && mode !== "start") return { error: "Usage: node scripts/serve.mjs dev|start [--mock] [next options]" };
  const mock = rest.includes("--mock");
  const args = rest.filter((a) => a !== "--mock");
  const env = { ...baseEnv };
  const host = take(args, "-H", "--hostname") ?? (env.INROAD_HOST || "127.0.0.1");
  const port = String(take(args, "-p", "--port") ?? (mock ? "3100" : env.PORT || "3000"));

  if (mock) {
    const mockUrl = `http://localhost:${env.MOCK_PORT || 4010}`;
    env.ANTHROPIC_BASE_URL = mockUrl;
    env.ANTHROPIC_API_KEY = "mock";
    // Choosing OpenAI in Settings talks to the mock too (any key works), and fake keys stay out of the keychain.
    env.OPENAI_BASE_URL = `${mockUrl}/v1`;
    env.INROAD_KEYCHAIN ||= "off";
    env.FIRECRAWL_API_URL = mockUrl;
    env.GTM_DATA_DIR ||= ".data-mock";
  }

  // The app reads these: where it listens and on which port (the tunnel connects there).
  env.INROAD_HOST = host;
  env.PORT = port;
  // Forward slashes: NODE_OPTIONS treats a backslash inside quotes as an escape, and Windows accepts both.
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require "${guardPath.replace(/\\/g, "/")}"`].filter(Boolean).join(" ");

  // The address to reach the server on from this machine.
  const local = host === "0.0.0.0" || host === "" ? "127.0.0.1" : host === "::" ? "[::1]" : host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

  return { mode, args: [mode, "-H", host, "-p", port, ...args], env, host, port, local, exposed: !LOOPBACK.test(host) };
}
