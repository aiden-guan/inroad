"use client";

import { Check, ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { shortDate } from "@/lib/client/format";
import type { CommunityQuestion } from "@/lib/signals/community";
import { questionBrief } from "./model";

type Found = { status: "idle" | "loading" | "error" } | { status: "done"; queries: string[]; questions: CommunityQuestion[] };
type Answer = { queries: string[]; questions: CommunityQuestion[]; reached: boolean };

const SHOWN = 6;

/**
 * Recent questions on Hacker News that match the buyer's pains (found in code, no tokens), each one a click away from
 * the community-answer draft. The founder answers by hand, in the thread.
 */
export function QuestionFinder({ onPick }: { onPick: (brief: string) => void }) {
  const [found, setFound] = useState<Found>({ status: "idle" });
  const [picked, setPicked] = useState<string | null>(null);

  const find = async () => {
    setFound({ status: "loading" });
    try {
      const res = await fetch("/api/content/questions", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Answer;
      if (!body.reached) throw new Error("unreachable");
      setFound({ status: "done", queries: body.queries, questions: body.questions });
    } catch {
      setFound({ status: "error" });
    }
  };

  if (found.status !== "done") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button size="sm" variant="ghost" icon={<Search className="size-3.5" />} loading={found.status === "loading"} onClick={() => void find()}>
          Find questions on Hacker News
        </Button>
        <span className="font-mono text-[11.5px] text-fg-3">{found.status === "error" ? "Hacker News didn't answer. Try again in a minute." : "free · no AI"}</span>
      </div>
    );
  }

  if (!found.queries.length) return <p className="mt-2 text-[12.5px] leading-[18px] text-fg-3">Add your buyer&apos;s pains under Who first, so I know what to search for.</p>;

  if (!found.questions.length) {
    return (
      <p className="mt-2 text-[12.5px] leading-[18px] text-fg-3">
        Nobody asked about {found.queries.map((q) => `“${q}”`).join(" or ")} in the last 60 days. Paste a question from a community you&apos;re in instead.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[12px] text-fg-3">
        Last 60 days, for {found.queries.map((q) => `“${q}”`).join(", ")}
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-md bg-bg-subtle/40 ring-1 ring-border">
        {found.questions.slice(0, SHOWN).map((q) => (
          <li key={q.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
            <div className="min-w-0 flex-1">
              <a href={q.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-baseline gap-1 text-[13.5px] font-medium text-fg hover:underline">
                <span className="truncate">{q.title || "Comment"}</span>
                <ExternalLink className="size-3 shrink-0 self-center text-fg-3 group-hover:text-fg" aria-hidden />
              </a>
              {q.text && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[18px] text-fg-2 [overflow-wrap:anywhere]">{q.text}</p>}
              <p className="mt-0.5 font-mono text-[11px] text-fg-3">
                {q.kind === "ask_hn" ? "Ask HN" : "Comment"} · {shortDate(q.createdAt)}
                {q.author && ` · ${q.author}`}
              </p>
            </div>
            <Button
              size="sm"
              variant={picked === q.id ? "ghost" : "secondary"}
              icon={picked === q.id ? <Check className="size-3.5" /> : undefined}
              onClick={() => {
                setPicked(q.id);
                onPick(questionBrief(q));
              }}
              className="self-start"
            >
              {picked === q.id ? "Picked" : "Answer this"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
