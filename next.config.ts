import type { NextConfig } from "next";

const desktop = process.env.INROAD_DESKTOP === "1";

const nextConfig: NextConfig = {
  // The Mac app (desktop/) runs the self-contained server.js; `npm start` keeps using `next start`.
  ...(desktop
    ? {
        output: "standalone" as const,
        outputFileTracingIncludes: {
          // Loaded at runtime by name (store/ai-keys.ts), so tracing can't see it: the keychain module and its binaries.
          "/*": ["./node_modules/@napi-rs/keyring/**/*", "./node_modules/@napi-rs/keyring-*/**/*"],
        },
        outputFileTracingExcludes: {
          // Reads under the data folder look like project-wide file access to the tracer. Nothing here runs from
          // source, and a data folder must never end up inside an app build.
          "/*": ["./src/**/*", "./docs/**/*", "./e2e/**/*", "./scripts/**/*", "./desktop/**/*", "./.data*/**/*", "./test-results/**/*", "./playwright-report/**/*", "./*.md", "./tsconfig*", "./vitest*", "./eslint*", "./playwright*"],
        },
      }
    : {}),
  cacheComponents: true,
  // Native modules with per-platform binaries, loaded with Node's require at runtime, never bundled:
  // the keychain (@napi-rs/keyring) and the renderer for Studio graphics (SVG → PNG).
  serverExternalPackages: ["@napi-rs/keyring", "@resvg/resvg-js", "playwright-core"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
