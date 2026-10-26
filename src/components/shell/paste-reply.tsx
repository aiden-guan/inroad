"use client";

import { Building2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Favicon } from "@/components/ui/favicon";
import { Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/client/cn";
import { targetOf, type PasteTarget, type SenderMatch } from "@/lib/replies/sender";

const WHY: Record<string, string> = { email: "by their address", name: "by name", domain: "new here" };

/**
 * ⌘K "Paste a reply": paste it, see who it's from (matched in code by address or name: people on file,
 * then LinkedIn connections, then someone new at the company the address belongs to), confirm, and land
 * on their company with the answer being drafted. Logging the reply cancels their follow-ups.
 */
export function PasteReply({ onDone }: { onDone: () => void }) {
  const { refresh } = useWorkspace();
  const router = useRouter();
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<SenderMatch[] | null>(null);
  const [pick, setPick] = useState<number | "other">(0);
  const [other, setOther] = useState({ name: "", domain: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);

  // Who sent it, a moment after the paste settles. Free: code only, nothing leaves this computer.
  useEffect(() => {
    const body = text.trim();
    if (body.length < 8) return;
    const n = ++asked.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/replies/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body }) });
        const out = (await res.json()) as { matches?: SenderMatch[]; error?: string };
        if (n !== asked.current) return;
        if (!res.ok) throw new Error(out.error ?? "Couldn't read who it's from.");
        setMatches(out.matches ?? []);
        setPick(out.matches?.length ? 0 : "other");
      } catch (e) {
        if (n === asked.current) setError(e instanceof Error ? e.message : "Couldn't read who it's from.");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [text]);

  const target: PasteTarget | null =
    pick === "other"
      ? other.name.trim() && other.domain.trim()
        ? { domain: other.domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""), name: other.name.trim() }
        : null
      : matches?.[pick]
        ? targetOf(matches[pick])
        : null;
  const ready = text.trim().length >= 2 && !!target && !busy;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!ready || !target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, target }) });
      const out = (await res.json()) as { reply?: { personId: string; domain: string; marked: number }; error?: string };
      if (!res.ok || !out.reply) throw new Error(out.error ?? "That didn't save. Try again.");
      await refresh();
      onDone();
      router.push(`/companies?c=${encodeURIComponent(out.reply.domain)}&intent=reply&ref=${encodeURIComponent(out.reply.personId)}`);
      toast("Reply logged. Their follow-ups are cancelled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't save. Try again.");
      setBusy(false);
    }
  };

  // The palette owns arrows and Enter for its list; here the keys belong to the form. ⌘↵ sends.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return;
    e.stopPropagation();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="space-y-3 p-3">
      <Textarea
        autoFocus
        aria-label="Their reply"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
          if (e.target.value.trim().length < 8) setMatches(null);
        }}
        placeholder="Paste their reply, with the From line if you have it. I'll work out who it's from."
        className="max-h-[38vh] min-h-32 text-[14px] leading-[21px]"
      />

      {matches && (
        <div role="radiogroup" aria-label="Who it's from" className="space-y-1">
          <p className="px-1 text-[11px] font-medium text-fg-3">{matches.length ? "From" : "I can't tell who sent this"}</p>
          {matches.map((m, i) => (
            <button
              key={m.kind === "person" ? m.personId : m.kind === "connection" ? m.connectionId : `new-${m.domain}`}
              type="button"
              role="radio"
              aria-checked={pick === i}
              onClick={() => setPick(i)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] ring-1 transition-colors duration-150",
                pick === i ? "bg-surface ring-border-strong" : "ring-transparent hover:bg-bg-subtle",
              )}
            >
              <Favicon domain={m.domain} name={m.company} size={16} />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-fg">{m.name}</span>
                <span className="text-fg-3">
                  {" "}
                  · {"title" in m && m.title ? `${m.title}, ` : ""}
                  {m.company}
                </span>
              </span>
              <span className="shrink-0 text-[11.5px] text-fg-3">
                {m.kind === "connection" ? "LinkedIn connection" : m.kind === "new" ? (m.knownCompany ? `New at ${m.company}` : "New company") : WHY[m.why]}
              </span>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={pick === "other"}
            onClick={() => setPick("other")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-fg-2 ring-1 transition-colors duration-150",
              pick === "other" ? "bg-surface ring-border-strong" : "ring-transparent hover:bg-bg-subtle",
            )}
          >
            <UserPlus className="size-4 shrink-0 text-fg-3" aria-hidden />
            Someone else
          </button>
          {pick === "other" && (
            <div className="grid gap-2 px-1 pt-1 sm:grid-cols-2">
              <Input aria-label="Their name" placeholder="Their name" value={other.name} onChange={(e) => setOther((o) => ({ ...o, name: e.target.value }))} className="h-8" />
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-2.5 top-2 size-4 text-fg-3" aria-hidden />
                <Input aria-label="Their company's website" placeholder="company.com" value={other.domain} onChange={(e) => setOther((o) => ({ ...o, domain: e.target.value }))} className="h-8 pl-8 font-mono text-[12.5px]" />
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="px-1 text-[12.5px] text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <Button type="submit" variant="agent" size="sm" kbd="⌘↵" loading={busy} disabled={!ready}>
          Read it and draft a reply
        </Button>
        <span className="text-[12px] text-fg-3">Logs it and stops their follow-ups. The draft costs a few cents.</span>
      </div>
    </form>
  );
}
