/**
 * Where the first screen puts the cursor: the first thing the founder has to fill in, top to bottom.
 * With no key, that's the key box above the website (Start would only say "paste your key first").
 * When the site couldn't be read, it's the one-sentence description. Otherwise, the website.
 */
export type StartField = "key" | "site" | "note" | "describe";

export function startFocus(s: { needsKey: boolean; keySaved: boolean; mode: "site" | "describe"; unreachable: boolean }): StartField {
  if (s.needsKey && !s.keySaved) return "key";
  if (s.mode === "describe") return "describe";
  return s.unreachable ? "note" : "site";
}

/**
 * Move the cursor to `want` once it's known (the key check answers after the first paint), but only if
 * the founder hasn't started on something else: nothing focused, or an empty field that got autofocus.
 * `active` is null when nothing (the page body) has focus.
 */
export function shouldMoveFocus(active: { id: string; value: string } | null, want: StartField): boolean {
  if (!active) return true;
  if (active.id === wantId(want)) return false;
  return active.value.trim() === "" && ["site", "note", "describe"].includes(active.id);
}

export function wantId(field: StartField): string {
  return field === "key" ? "anthropic-key" : field;
}
