"use client";

import { Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { TagMenu } from "@/components/people/relationship-tags";
import { Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import type { RelationshipTag } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { getJson } from "./api";

/**
 * The second half of the network screen's approval point (SPEC W2): tag the people who already know you.
 * A design partner, past user or ex-colleague who changes jobs to an ICP company is the strongest
 * signal there is, and only the founder knows who they are. Search runs in code on this computer.
 */

interface Taggable {
  connectionId?: string;
  personId?: string;
  name: string;
  position?: string;
  company?: string;
  tags: RelationshipTag[];
}

function PersonRow({ p, i, onTags }: { p: Taggable; i: number; onTags: (tags: RelationshipTag[]) => void }) {
  return (
    <motion.li variants={listItem} custom={i} initial="hidden" animate="show" className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-fg">{p.name}</p>
        {(p.position || p.company) && <p className="truncate text-[12.5px] text-fg-3">{[p.position, p.company].filter(Boolean).join(" · ")}</p>}
      </div>
      <TagMenu connectionId={p.connectionId} personId={p.connectionId ? undefined : p.personId} tags={p.tags} name={p.name} onChange={onTags} />
    </motion.li>
  );
}

export function KnownPeople() {
  const [start, setStart] = useState<{ tagged: Taggable[]; suggested: Taggable[] } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Taggable[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<{ tagged: Taggable[]; suggested: Taggable[] }>("/api/network/people")
      .then((r) => !cancelled && setStart(r))
      .catch(() => !cancelled && setStart({ tagged: [], suggested: [] }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      getJson<{ results: Taggable[] }>(`/api/network/people?q=${encodeURIComponent(query)}`)
        .then((r) => !cancelled && setResults(r.results))
        .catch(() => !cancelled && setResults([]));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  // One person can show in two lists; a tag set in one shows in both.
  const retag = (p: Taggable, tags: RelationshipTag[]) => {
    const same = (x: Taggable) => (p.connectionId ? x.connectionId === p.connectionId : x.personId === p.personId);
    setResults((all) => all?.map((x) => (same(x) ? { ...x, tags } : x)) ?? all);
    setStart((s) => {
      if (!s) return s;
      const tagged = s.tagged.some(same) ? s.tagged.map((x) => (same(x) ? { ...x, tags } : x)) : tags.length ? [...s.tagged, { ...p, tags }] : s.tagged;
      return { tagged, suggested: s.suggested.map((x) => (same(x) ? { ...x, tags } : x)) };
    });
  };

  const searching = q.trim().length >= 2;
  const list = searching ? results : start ? [...start.tagged, ...start.suggested.filter((s) => !start.tagged.some((t) => t.connectionId === s.connectionId))] : null;

  return (
    <div>
      <p className="text-[12px] font-medium text-fg-3">Who already knows your product?</p>
      <p className="mt-1 text-pretty text-[12.5px] leading-[18px] text-fg-3">
        Tag your design partners, past users and ex-colleagues. When one of them changes jobs to a company that fits, I&apos;ll flag it first.
      </p>
      <div className="relative mt-2.5">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" aria-hidden />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length < 2) setResults(null);
          }}
          placeholder="Find someone by name or company"
          aria-label="Find a connection to tag"
          className="h-8 pl-8 text-[16px] sm:text-[13px]"
        />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {list === null ? (
          <motion.div key="loading" exit={{ opacity: 0, transition: { duration: 0.1 } }} className="mt-2 space-y-1.5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </motion.div>
        ) : list.length ? (
          <motion.ul key={searching ? "results" : "start"} initial="hidden" animate="show" className="mt-2 divide-y divide-border rounded-lg ring-1 ring-border">
            {list.map((p, i) => (
              <PersonRow key={p.connectionId ?? p.personId ?? p.name} p={p} i={i} onTags={(tags) => retag(p, tags)} />
            ))}
          </motion.ul>
        ) : (
          <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 text-[12.5px] text-fg-3">
            {searching ? "No connection matches that." : "Search for someone above to tag them."}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
