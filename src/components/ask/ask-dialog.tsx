"use client";

import * as RD from "@radix-ui/react-dialog";
import { useAsk } from "@/components/providers/ask-provider";
import { Conversation } from "./conversation";

/**
 * The global Ask window (⌘K → Ask, or "Ask about this" anywhere): a centered floating window that grows with
 * the conversation up to 72vh, full height on phones. Opened with a context it shows "About Northwind" and picks
 * up that record's recent thread; opened with a prefill it asks right away in a fresh thread.
 * Each open is a fresh session (the content unmounts on close); threads persist on the server.
 */
export function AskDialog() {
  const ask = useAsk();
  // A new context, prefill or thread while open starts a new session.
  const session = `${ask.context ? `${ask.context.kind}:${ask.context.id}` : ""}|${ask.prefill ?? ""}|${ask.threadId ?? ""}`;
  return (
    <RD.Root open={ask.open} onOpenChange={(open) => !open && ask.closeAsk()}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-[60] bg-overlay/60 data-[state=open]:animate-[fade-in_200ms_var(--ease-out)] data-[state=closed]:animate-[fade-out_150ms_var(--ease-out)]" />
        <RD.Content
          aria-describedby={undefined}
          className="fixed inset-x-2 bottom-2 top-2 z-[61] mx-auto flex max-w-[680px] origin-top flex-col overflow-hidden rounded-xl bg-surface-raised shadow-xl outline-none data-[state=closed]:animate-[pop-out_150ms_var(--ease-in-quad)] data-[state=open]:animate-[pop-in_200ms_var(--ease-out)] sm:bottom-auto sm:top-[10vh] sm:max-h-[72vh] sm:min-h-[min(420px,72vh)]"
        >
          <RD.Title className="sr-only">Ask</RD.Title>
          <Conversation
            key={session}
            variant="window"
            context={ask.context}
            prefill={ask.prefill}
            threadId={ask.threadId}
            resume
            onClose={ask.closeAsk}
            onNavigate={ask.closeAsk}
            className="min-h-0 flex-1"
          />
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
