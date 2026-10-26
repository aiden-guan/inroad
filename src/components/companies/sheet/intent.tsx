"use client";

import { X } from "lucide-react";
import { ComposeButton } from "@/components/compose/composer";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { IconButton } from "@/components/ui/button";
import { rankPaths } from "@/lib/deals/rules";
import type { Person } from "@/lib/domain/types";
import { first } from "@/lib/moves/util";

/** What a ⌘K command asked this sheet to do: `?intent=reply|write|intro&ref=<person or connector id>`. */
export type SheetIntent = { kind: "reply" | "write" | "intro"; ref: string };

export function readIntent(params: Pick<URLSearchParams, "get">): SheetIntent | null {
  const kind = params.get("intent");
  const ref = params.get("ref");
  return ref && (kind === "reply" || kind === "write" || kind === "intro") ? { kind, ref } : null;
}

/** How to reach someone first, from their best contact path (the same rule as the person rows in "Who to talk to"). */
function composeModeFor(person: Person): { mode: "cold" | "linkedin" | "warm_intro"; label: string } {
  const top = rankPaths(person.contactPaths).filter((p) => !p.bounced)[0];
  const direct = top?.kind === "warm_intro" && top.via === "connection";
  const mode = direct ? "linkedin" : top?.kind === "warm_intro" ? "warm_intro" : top?.kind === "linkedin" ? "linkedin" : "cold";
  const label = direct ? "Message on LinkedIn" : top?.kind === "warm_intro" ? "Ask for an intro" : top?.kind === "linkedin" ? "Draft a LinkedIn note" : "Write";
  return { mode, label };
}

/** Drops the command from the URL, so a reload or Back doesn't run it again. */
export function clearIntent() {
  const url = new URL(window.location.href);
  url.searchParams.delete("intent");
  url.searchParams.delete("ref");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

/**
 * The palette's "Paste a reply", "Write to…" and "Ask a connector for intros" land here: the composer for
 * that person (or connector), opened as if its button had been pressed, at the top of the sheet. The
 * sheet is where composing happens (880px); nothing opens over it.
 */
export function IntentBlock({ domain, intent }: { domain: string; intent: SheetIntent }) {
  const { ws } = useWorkspace();
  if (!ws) return null;
  const person = intent.kind !== "intro" ? ws.people[intent.ref] : undefined;
  const connector = intent.kind === "intro" ? ws.connectors.find((c) => c.id === intent.ref) : undefined;
  if ((intent.kind !== "intro" && person?.accountDomain !== domain) || (intent.kind === "intro" && !connector)) return null;

  const name = first(person?.name ?? connector?.name ?? "");
  const company = ws.accounts[domain]?.name ?? domain;
  // The draft view quotes their reply; a new reply for the same person remounts the composer so it reads that one.
  const reply =
    intent.kind === "reply" && person
      ? ws.activities.filter((a) => a.kind === "reply_received" && a.personId === person.id && a.body).sort((a, b) => b.at.localeCompare(a.at))[0]
      : undefined;
  const write = person && intent.kind === "write" ? composeModeFor(person) : undefined;
  // "Write to" takes their best path: an intro ask when the way in is warm, LinkedIn when that's all there is.
  const title =
    intent.kind === "reply"
      ? `Reply to ${name}`
      : intent.kind === "intro"
        ? `Ask ${name} for an intro to ${company}`
        : write?.mode === "warm_intro"
          ? `Ask for an intro to ${person?.name}`
          : write?.mode === "linkedin"
            ? `Message ${person?.name} on LinkedIn`
            : `Write to ${person?.name}`;

  return (
    <section aria-label={title} className="mb-6 rounded-lg bg-surface p-4 ring-1 ring-border animate-[rise-in_180ms_var(--ease-out)]">
      <div className="mb-3 flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-[14px] font-medium text-fg">{title}</h2>
        <IconButton label="Hide" className="-mr-1.5 -mt-1" onClick={clearIntent}>
          <X className="size-4" />
        </IconButton>
      </div>
      {intent.kind === "reply" && person && <ComposeButton key={reply?.id} domain={domain} personId={person.id} mode="reply" label={`Draft a reply to ${name}`} autoOpen />}
      {intent.kind === "write" && person && write && <ComposeButton domain={domain} personId={person.id} mode={write.mode} label={write.label === "Write" ? `Write to ${name}` : write.label} autoOpen />}
      {intent.kind === "intro" && connector && <ComposeButton domain={domain} mode="warm_intro" connectorId={connector.id} label={`Draft the ask to ${name}`} autoOpen />}
    </section>
  );
}
