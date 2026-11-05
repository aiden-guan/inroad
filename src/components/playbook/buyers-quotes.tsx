"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { QuoteRow } from "@/components/voice/parts";
import { cn } from "@/lib/client/cn";
import { words } from "@/lib/voice/text";
import { usePlaybook } from "./context";
import { Sub } from "./ui";

/**
 * Every quote on file, newest first: a searchable bank of what buyers said, each with its receipt. Paraphrase can be
 * hidden so only their own words remain. Searching is plain text in code, every word must appear.
 */

const PAGE = 20;

export function QuoteBank({ consumer }: { consumer: boolean }) {
  const { voice } = usePlaybook();
  const [query, setQuery] = useState("");
  const [theirWords, setTheirWords] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const all = useMemo(() => voice.snippets.filter((s) => s.source !== "summary"), [voice.snippets]);
  const list = useMemo(() => {
    const q = words(query);
    return all.filter((s) => (!theirWords || s.verbatim) && (!q.length || q.every((w) => `${s.text} ${s.company ?? ""} ${s.speaker ?? ""} ${s.title ?? ""}`.toLowerCase().includes(w))));
  }, [all, query, theirWords]);
  const verbatim = all.filter((s) => s.verbatim).length;

  return (
    <Sub id="buyer-quotes" title={consumer ? "Every note" : "Every quote"} right={<span className="font-mono text-[12px] tnum text-fg-3">{all.length}</span>}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search {consumer ? "notes" : "quotes"}</span>
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder={consumer ? "Search your notes" : "Search what buyers said: “security”, “NetSuite”, a company"}
            className="h-9 w-full rounded-md bg-surface pl-8 pr-3 text-[13px] text-fg shadow-xs ring-1 ring-inset ring-border-strong/70 placeholder:text-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </label>
        {!consumer && verbatim < all.length && (
          <button
            type="button"
            aria-pressed={theirWords}
            onClick={() => setTheirWords((v) => !v)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-md px-3 text-[12.5px] font-medium ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              theirWords ? "bg-surface text-fg ring-border-strong" : "text-fg-2 ring-border hover:bg-bg-subtle",
            )}
          >
            Their words only · {verbatim}
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="mt-3 text-[13px] text-fg-3">Nothing matches “{query}”.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {list.slice(0, shown).map((s) => (
            <QuoteRow key={s.id} s={s} compact />
          ))}
        </ul>
      )}
      {list.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-2 rounded-xs text-[12.5px] text-fg-3 underline-offset-2 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
          Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}
        </button>
      )}
    </Sub>
  );
}
