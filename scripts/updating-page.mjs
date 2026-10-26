/**
 * The page the launcher shows on the app's port while Inroad updates (scripts/serve.mjs), and the words for
 * each step, shared with the app's own progress (src/components/updates). No scripts: it reloads itself
 * every two seconds until the new server answers in its place.
 */

/** What each step of scripts/source-update.mjs is called on screen. */
export const UPDATE_STEPS = {
  stopping: "Stopping Inroad",
  checking: "Checking GitHub",
  downloading: "Downloading the new version",
  installing: "Installing what it needs (this can take a few minutes)",
  building: "Building it (a minute or two)",
  "rolling-back": "That didn't work, so I'm putting back the version you had",
  restarting: "Starting Inroad again",
};

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** @param {string | null} step */
export function updatingPage(step) {
  const line = UPDATE_STEPS[step ?? ""] ?? "Updating";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="2" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <title>Updating Inroad</title>
    <style>
      :root { --bg: #faf9f6; --fg: #1a1917; --fg-3: #8a867d; --accent: #2d4fd6; color-scheme: light dark; }
      @media (prefers-color-scheme: dark) { :root { --bg: #121110; --fg: #f2f0eb; --fg-3: #8f8b83; --accent: #7c93ff; } }
      html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; }
      main { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 0 16px; text-align: center; }
      .orb { width: 28px; height: 28px; border-radius: 50%; background: radial-gradient(circle at 34% 28%, color-mix(in oklab, var(--accent) 35%, white) 0%, var(--accent) 52%, color-mix(in oklab, var(--accent) 70%, black) 100%); animation: breathe 1.6s ease-in-out infinite; }
      h1 { margin: 0; font-size: 17px; font-weight: 600; }
      p { margin: 0; max-width: 42ch; color: var(--fg-3); }
      @keyframes breathe { 50% { transform: scale(0.86); opacity: 0.75; } }
      @media (prefers-reduced-motion: reduce) { .orb { animation: none; } }
    </style>
  </head>
  <body>
    <main>
      <div class="orb" aria-hidden="true"></div>
      <h1>Updating Inroad</h1>
      <p role="status">${escape(line)}…</p>
      <p>Your work is saved. This page opens Inroad again by itself when it's done.</p>
    </main>
  </body>
</html>
`;
}
