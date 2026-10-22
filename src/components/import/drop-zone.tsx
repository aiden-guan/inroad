"use client";

import { FileUp } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/client/cn";
import { CSV_LIMITS } from "@/lib/network/csv";

/**
 * Drag a CSV in, or click (or press Enter) to choose one. Reads the file locally; nothing is
 * uploaded until the founder confirms the preview.
 */
export function DropZone({
  title,
  hint,
  onFile,
  busy,
  error,
  icon,
  compact,
}: {
  title: ReactNode;
  hint?: ReactNode;
  onFile: (name: string, text: string) => void;
  busy?: boolean;
  error?: string | null;
  icon?: ReactNode;
  /** A shorter zone for inside another card (onboarding's "Two quick ones"). */
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  async function read(file: File | undefined) {
    setOver(false);
    if (!file) return;
    if (!/\.(csv|tsv|txt)$/i.test(file.name) && file.type && !/csv|text|excel|spreadsheet/i.test(file.type)) {
      setReadError(`${file.name} isn't a CSV. Export the list as CSV (File → Download → CSV in most tools), then drop it here.`);
      return;
    }
    if (file.size > CSV_LIMITS.bytes) {
      setReadError(`${file.name} is over 8 MB. Filter it to the companies you'd actually work, then try again.`);
      return;
    }
    setReadError(null);
    try {
      onFile(file.name, await file.text());
    } catch {
      setReadError("I couldn't read that file. Try exporting it again.");
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (busy) return;
    void read(e.dataTransfer.files?.[0]);
  };
  const shown = error ?? readError;

  return (
    <div>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={onDrop}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center",
            compact ? "px-4 py-5" : "px-6 py-9",
            "transition-[background-color,border-color,transform] duration-150 ease-out-quad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            over ? "scale-[1.01] border-fg-3 bg-bg-subtle" : "border-border-strong hover:bg-bg-subtle/70",
            busy && "cursor-default opacity-70",
          )}
        >
          <span className={cn("flex size-9 items-center justify-center rounded-full bg-surface text-fg-3 shadow-xs ring-1 ring-border transition-transform duration-150", over && "-translate-y-0.5")}>
            {busy ? <Spinner className="size-4" /> : (icon ?? <FileUp className="size-4" aria-hidden />)}
          </span>
          <span className="text-[14px] font-medium text-fg">{title}</span>
          {hint && <span className="max-w-[46ch] text-[12.5px] leading-[18px] text-fg-3 text-pretty">{hint}</span>}
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {shown && (
        <p role="alert" className="mt-2 text-[12.5px] leading-[18px] text-danger">
          {shown}
        </p>
      )}
    </div>
  );
}
