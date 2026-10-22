import "server-only";
import { ActionError } from "@/lib/domain/actions";
import { nowISO } from "@/lib/domain/ids";
import type { Account, RelationshipTag } from "@/lib/domain/types";
import { ensureAccount, ensurePerson, isFreeMail, normalizeDomain } from "@/lib/hub/records";
import { normalizeCompany } from "@/lib/network/csv";
import { fullName } from "@/lib/network/import";
import { updateConnections } from "@/lib/network/store";
import { ycDirectory } from "@/lib/signals/yc";
import { mutateWorkspace, readWorkspace } from "@/lib/store/workspace";
import { resolveDomain } from "@/lib/workflows/discovery";
import { accountFor, type KnownUser, type KnownUsersKind } from "./known-users";

/**
 * The founder's users and design partners become customers (gtm-11): an account with status customer
 * and a tag for how they know the product, the named person as its champion, and that person's LinkedIn
 * connection tagged. So the Customers tab has them, a referral ask comes next, and when anyone who
 * worked there changes jobs to an ICP company, the re-import flags it as a champion job change.
 * A name without a website is placed through the YC directory or its own homepage, never guessed.
 */

export interface AddKnownResult {
  added: { domain: string; name: string }[];
  unplaced: string[];
}

export async function addKnownUsers(input: { users: KnownUser[]; kind: KnownUsersKind }): Promise<AddKnownResult> {
  const users = input.users.slice(0, 10);
  if (!users.length) throw new ActionError("Name at least one company, by website or name.");
  const dir = users.some((u) => !u.domain) ? await ycDirectory() : [];
  const placed: (KnownUser & { domain: string })[] = [];
  const unplaced: string[] = [];
  const own = readWorkspace().company?.domain?.toLowerCase();
  for (const u of users) {
    const domain = u.domain ? normalizeDomain(u.domain) : ((await resolveDomain(u.name, dir))?.domain ?? null);
    // The founder's own company is never its own customer.
    if (!domain || isFreeMail(domain) || (own && (domain === own || domain.endsWith(`.${own}`)))) unplaced.push(u.name);
    else placed.push({ ...u, domain });
  }

  const at = nowISO();
  const tag: RelationshipTag = input.kind;
  const people: { name: string; company: string }[] = [];
  const added = (
    await mutateWorkspace((ws) => {
      const out: AddKnownResult["added"] = [];
      for (const u of placed) {
        const account: Account = accountFor(ws, u) ?? ensureAccount(ws, { domain: u.domain, name: u.name }, { source: "manual", sourceDetail: "You named them as your users", at, tag }).account;
        // A customer is never a prospect again, and the tag says how they know the product.
        account.status = "customer";
        account.watch = false;
        if (!(account.tags ?? []).includes(tag)) account.tags = [...(account.tags ?? []), tag];
        if (u.person) {
          const { person } = ensurePerson(ws, { domain: account.domain, name: u.person }, { via: "You, at onboarding", source: "manual" });
          person.champion ??= "untested";
          if (!(person.tags ?? []).includes(tag)) person.tags = [...(person.tags ?? []), tag];
          people.push({ name: u.person.toLowerCase(), company: normalizeCompany(account.name) });
        }
        out.push({ domain: account.domain, name: account.name });
      }
      return out;
    })
  ).value;

  // The named person among the founder's connections, by name at that company.
  if (people.length) {
    await updateConnections((rows) => {
      for (const r of rows) {
        const full = fullName(r).toLowerCase();
        const hit = people.find((p) => p.company === r.companyNorm && (full === p.name || full.split(" ")[0] === p.name));
        if (hit && !r.tags?.includes(tag)) r.tags = [...(r.tags ?? []), tag];
      }
    });
  }
  return { added, unplaced };
}
