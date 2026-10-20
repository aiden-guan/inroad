"use client";

import { useState } from "react";
import { LinkedInImport } from "./linkedin-import";
import { ListImport } from "./list-import";

interface FileIn {
  name: string;
  text: string;
}

/**
 * Drag-and-drop import: a CSV of companies and people (auto-detected presets, mapping preview,
 * dedupe report, undo, exports) or LinkedIn's Connections.csv (screened for ICP fit and job
 * changes). A file dropped into the wrong one is handed to the right one.
 *
 * Rendered by the Integrations hub for /integrations?import=csv|linkedin, inside its dialog.
 */
export function ImportFlow({ kind, onDone }: { kind: "csv" | "linkedin"; onDone?: () => void }) {
  const [mode, setMode] = useState<{ kind: "csv" | "linkedin"; file: FileIn | null }>({ kind, file: null });
  // The dialog can switch kinds while open (?import=csv → linkedin); follow the prop when it does.
  const [prop, setProp] = useState(kind);
  if (prop !== kind) {
    setProp(kind);
    setMode({ kind, file: null });
  }

  return (
    <div className="-mx-5 max-h-[72vh] overflow-y-auto px-5 pb-1 pt-1">
      {mode.kind === "linkedin" ? (
        <LinkedInImport key="linkedin" initial={mode.file} onList={(file) => setMode({ kind: "csv", file })} onDone={onDone} />
      ) : (
        <ListImport key="csv" initial={mode.file} onLinkedIn={(file) => setMode({ kind: "linkedin", file })} onDone={onDone} />
      )}
    </div>
  );
}
