"use client";

import { AtSign, Check, UserSearch } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { PEOPLE_DATA_PRICE } from "@/lib/connectors/catalog";
import type { Account, Person } from "@/lib/domain/types";
import { listItem } from "@/lib/motion";
import { credits, usePeopleData, type Preview } from "./use-people-data";

type Found = { people: Preview[]; titles: string[]; total?: number };

/**
 * "Who works here?" without opening LinkedIn: a free Apollo search by the ICP's titles, then the
 * founder adds the ones worth it (one click each, cost shown before the click).
 */
export function FindPeople({ account }: { account: Account }) {
  const pd = usePeopleData();
  const [found, setFound] = useState<Found | null>(null);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  if (!pd.connected) {
    return (
      <p className="text-[12.5px] leading-[18px] text-fg-3">
        See who works here and get their work email without leaving Inroad.{" "}
        <Link href="/integrations#firecrawl" className="font-medium text-fg-2 underline-offset-4 hover:text-fg hover:underline">
          Connect Firecrawl
        </Link>
      </p>
    );
  }

  const search = async (titles?: string[]) => {
    setSearching(true);
    const r = await pd.find(account.domain, titles);
    setSearching(false);
    if (r) {
      setFound(r);
      setEditing(null);
    }
  };

  const add = async (p: Preview) => {
    setAdding(p.id);
    const r = await pd.add(account.domain, p.id);
    setAdding(null);
    if (!r) return;
    setFound((f) => f && { ...f, people: f.people.map((x) => (x.id === p.id ? { ...x, personId: r.personId } : x)) });
    const cost = r.credits ? ` · ${credits(r.credits)}` : "";
    if (r.movedOn) toast.warning(`Added ${p.firstName}, but Apollo shows them at another company now. Marked as may have left${cost}.`);
    else if (r.email?.verified) toast.success(`Added ${p.firstName} with a verified work email${cost}`);
    else if (r.email) toast(`Added ${p.firstName}. The work email is unverified, so you'll confirm it before sending${cost}.`);
    else toast(`Added ${p.firstName}. Apollo has no work email for them${cost}.`);
  };

  if (!found) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button size="sm" icon={<UserSearch className="size-3.5" />} loading={searching} onClick={() => void search()}>
          {searching ? "Searching Apollo" : "Find people here"}
        </Button>
        <span className="text-[12px] text-fg-3">Free. Searches Apollo by your buyer titles.</span>
      </div>
    );
  }

  const shown = found.people;
  return (
    <div className="overflow-hidden rounded-md bg-surface ring-1 ring-border">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2">
        <UserSearch className="size-3.5 text-fg-3" aria-hidden />
        {editing === null ? (
          <>
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">
              {shown.length ? (
                <>
                  {found.total && found.total > shown.length ? `${shown.length} of ${found.total.toLocaleString("en-US")}` : shown.length} on Apollo
                </>
              ) : (
                "No one on Apollo"
              )}
              {found.titles.length > 0 && <span className="text-fg-3"> · {found.titles.join(", ")}</span>}
            </p>
            <Button size="xs" variant="ghost" onClick={() => setEditing(found.titles.join(", "))}>
              Change titles
            </Button>
          </>
        ) : (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search(editing.split(",").map((t) => t.trim()).filter(Boolean));
            }}
          >
            <Input autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} placeholder="VP Engineering, Head of Platform" aria-label="Titles to search for" className="h-7 text-[12.5px]" />
            <Button size="xs" type="submit" variant="primary" loading={searching}>
              Search
            </Button>
            <Button size="xs" type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </form>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="px-3 py-4 text-[13px] leading-[19px] text-fg-3">
          {found.titles.length ? "Nobody with those titles. Try broader ones, like the function's head." : "Apollo has no one listed here yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((p, i) => (
            <motion.li key={p.id} variants={listItem} initial="hidden" animate="show" custom={i} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px]">
                  <span className="font-medium text-fg">
                    {p.firstName} {p.lastName}
                  </span>{" "}
                  <span className="text-fg-2">{p.title}</span>
                </p>
                <p className="text-[12px] text-fg-3">{p.hasEmail ? "Work email on file" : "No email on file"}</p>
              </div>
              {p.personId ? (
                <Badge tone="outline">
                  <Check className="size-3" aria-hidden /> On file
                </Badge>
              ) : (
                <Tooltip content={`Full name, LinkedIn and work email. Up to ${credits(PEOPLE_DATA_PRICE.add)}, nothing if Apollo can't match them.`}>
                  <Button size="xs" loading={adding === p.id} disabled={adding !== null && adding !== p.id} onClick={() => void add(p)}>
                    Add
                  </Button>
                </Tooltip>
              )}
            </motion.li>
          ))}
        </ul>
      )}
      <p className="border-t border-border px-3 py-2 text-[11.5px] text-fg-3">
        Adding someone costs up to {credits(PEOPLE_DATA_PRICE.add)}. <span className="font-mono tnum">{pd.used.toLocaleString("en-US")}</span> of{" "}
        <span className="font-mono tnum">{pd.limit.toLocaleString("en-US")}</span> used this month.
      </p>
    </div>
  );
}

/** One click to a work email for someone on file. Shown only when Firecrawl is connected. */
export function FindEmailButton({ person, size = "xs" }: { person: Person; size?: "xs" | "sm" }) {
  const pd = usePeopleData();
  const [busy, setBusy] = useState(false);
  if (!pd.connected || person.doNotContact) return null;
  const first = person.name.split(" ")[0];
  const run = async () => {
    setBusy(true);
    const r = await pd.workEmail(person.id);
    setBusy(false);
    if (!r) return;
    const cost = r.credits ? ` · ${credits(r.credits)}` : "";
    if (!r.email) toast(`No work email found for ${first}. Nothing was charged.`);
    else if (r.email.verified) toast.success(`Found ${r.email.address}, verified${cost}`);
    else toast(`Found ${r.email.address}. It's unverified, so you'll confirm it before sending${cost}.`);
  };
  return (
    <Tooltip content={`Looks up a work email with FullEnrich. Up to ${credits(PEOPLE_DATA_PRICE.workEmail)}, nothing if none is found.`}>
      <Button size={size} variant="ghost" icon={<AtSign className="size-3.5" />} loading={busy} onClick={() => void run()}>
        {busy ? "Looking it up" : "Find work email"}
      </Button>
    </Tooltip>
  );
}
