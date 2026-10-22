import "server-only";
import { ActionError } from "@/lib/domain/actions";
import { newId, nowISO } from "@/lib/domain/ids";
import type { Workspace } from "@/lib/domain/types";
import { ensureAccount, ensurePerson, findPerson, isFreeMail, isSuppressed, normalizeDomain } from "@/lib/hub/records";
import { wasForgotten } from "@/lib/people/forget";
import { githubStargazers, hasGithubToken, type Stargazer } from "@/lib/signals/github";
import { normalizeCompanyName, ycByName, ycDirectory, type YcCompany } from "@/lib/signals/yc";
import { mutateWorkspace } from "@/lib/store/workspace";
import { mutateNetwork } from "./store";
import type { ImportBatch } from "./types";

/**
 * W2 · GitHub stargazers: for a developer-tool founder, the people who starred the repo are the warmest
 * list there is after their own network. Each stargazer whose profile names a company we can place
 * (an "@org" whose site we know, a site that matches the company, a work email, or a YC or workspace
 * company by name) becomes a person at that account, sourced and undoable like any import. The rest
 * are skipped, never guessed. Zero tokens; GitHub's own rate limit applies (60 lookups an hour without
 * a token, so about 50 profiles).
 */

function placeOf(ws: Workspace, s: Stargazer, dir: YcCompany[]): { domain: string; name?: string } | null {
  if (s.domain) return { domain: s.domain };
  if (!s.company) return null;
  const y = ycByName(dir, s.company);
  if (y) return { domain: y.domain, name: y.name };
  const n = normalizeCompanyName(s.company);
  const acc = n.length >= 3 ? Object.values(ws.accounts).find((a) => normalizeCompanyName(a.name) === n) : undefined;
  return acc ? { domain: acc.domain, name: acc.name } : null;
}

export async function importStargazers(input: { repo: string }): Promise<ImportBatch> {
  const r = await githubStargazers(input.repo);
  if (!r) throw new ActionError("I couldn't find that repository on GitHub. Use owner/name, like acme/acme-sdk, or paste its GitHub link. It has to be public.");
  if (!r.stargazers.length) {
    throw new ActionError(
      r.rateLimited
        ? `GitHub's hourly limit is used up. Try again in an hour${hasGithubToken() ? "" : ", or add a GitHub token in Settings → General for 5,000 lookups an hour"}.`
        : `${r.repo} has no stargazers yet.`,
    );
  }
  const dir = await ycDirectory();
  const at = nowISO();
  const label = `Starred ${r.repo} on GitHub`;
  const batch = (
    await mutateWorkspace((ws) => {
      const own = ws.company?.domain?.toLowerCase();
      const b: ImportBatch = {
        id: newId("imp"),
        kind: "github",
        presetLabel: "GitHub stargazers",
        fileName: r.repo,
        importedAt: at,
        rows: r.stargazers.length,
        skipped: 0,
        counts: { accountsCreated: 0, accountsUpdated: 0, peopleCreated: 0, peopleUpdated: 0 },
        github: { repo: r.repo, total: r.total, read: r.stargazers.length, matched: 0, rateLimited: r.rateLimited, withToken: hasGithubToken() },
        created: { accounts: [], people: [] },
        filled: [],
        statusChanged: [],
      };
      const touched = new Set<string>();
      for (const s of r.stargazers) {
        const place = placeOf(ws, s, dir);
        const domain = place ? normalizeDomain(place.domain) : null;
        if (!domain || isFreeMail(domain) || (own && (domain === own || domain.endsWith(`.${own}`))) || /(^|\.)github\.(com|io)$/.test(domain) || isSuppressed(ws, s.email, domain) || wasForgotten(ws, { email: s.email, name: s.name ?? s.login, domain })) {
          b.skipped++;
          continue;
        }
        b.github!.matched++;
        const { account, created } = ensureAccount(ws, { domain, name: place?.name ?? s.company }, { source: "stargazers", sourceDetail: label.slice(0, 120), at, tag: "stargazer" });
        if (created) {
          if (!b.created.accounts.includes(domain)) b.created.accounts.push(domain);
        } else if (!(account.tags ?? []).includes("stargazer")) {
          account.tags = [...(account.tags ?? []), "stargazer"];
          b.filled.push({ kind: "account", id: domain, field: "tag", value: "stargazer" });
          touched.add(domain);
        }
        const name = s.name ?? s.login;
        const before = findPerson(ws, { email: s.email ?? null, name, domain });
        const { person, created: made } = ensurePerson(ws, { domain, email: s.email ?? null, name, location: s.location }, { via: "GitHub profile", source: "stargazers" });
        const note = `${label}${s.starredAt ? ` (${s.starredAt.slice(0, 10)})` : ""} · ${s.url}`;
        if (made) {
          b.created.people.push(person.id);
          person.notes = note.slice(0, 400);
        } else if (before && !person.notes) {
          person.notes = note.slice(0, 400);
          b.filled.push({ kind: "person", id: person.id, field: "notes", value: person.notes });
        }
      }
      b.counts = {
        accountsCreated: b.created.accounts.length,
        accountsUpdated: touched.size,
        peopleCreated: b.created.people.length,
        peopleUpdated: b.filled.filter((f) => f.kind === "person").length,
      };
      return b;
    })
  ).value;
  await mutateNetwork((n) => {
    n.imports.unshift(batch);
  });
  return batch;
}
