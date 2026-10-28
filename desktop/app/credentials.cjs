/* eslint-disable @typescript-eslint/no-require-imports -- used by Electron's CommonJS main process */
const { spawnSync } = require("node:child_process");

/** Ad hoc builds have no stable Keychain identity across updates. Keep their keys in the existing
 * owner-only encrypted store, importing an older Keychain entry the first time it is used. A build
 * signed by a Developer ID keeps the OS store. Explicit configuration still takes precedence. */
function keychainMode({
  packaged,
  platform,
  executable,
  configured,
  inspect = spawnSync,
}) {
  if (configured || !packaged || platform !== "darwin") return configured;
  try {
    const result = inspect(
      "/usr/bin/codesign",
      ["-dv", "--verbose=2", executable],
      { encoding: "utf8", timeout: 3000 },
    );
    if (
      result.status === 0 &&
      /^TeamIdentifier=(?!not set\s*$)[A-Z0-9]+\s*$/m.test(result.stderr || "")
    )
      return undefined;
  } catch {
    // An unsigned build or unavailable signature inspection has no stable identity either.
  }
  return "prefer-file";
}

module.exports = { keychainMode };
