/** Only Inroad's own top-level window may write text to the clipboard. Reading stays denied. */
function allowClipboardWrite({ permission, requestingUrl, serverUrl, isMainFrame, isAppWindow }) {
  if (permission !== "clipboard-sanitized-write" || !isMainFrame || !isAppWindow) return false;
  try {
    return new URL(requestingUrl).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

module.exports = { allowClipboardWrite };
