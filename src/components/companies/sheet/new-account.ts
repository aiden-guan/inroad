import { nowISO } from "@/lib/domain/ids";
import type { Account } from "@/lib/domain/types";

/** A company the founder added by hand, before anything is known about it (the sheet's "Add and research", ⌘K "Add a deal"). */
export function newAccount(domain: string): Account {
  return {
    domain,
    name: domain.split(".")[0].replace(/^./, (c) => c.toUpperCase()),
    status: "new",
    source: "manual",
    addedAt: nowISO(),
    fitScore: 0,
    tier: "C",
    criteria: [],
    signals: [],
    whyNow: null,
    whyNowScore: 0,
    peopleIds: [],
    warmPathCount: 0,
    watch: false,
  };
}
