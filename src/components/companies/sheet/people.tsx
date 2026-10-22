"use client";

import { ArrowUpRight, Copy, Handshake, MapPin, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ComposeButton } from "@/components/compose/composer";
import { FindEmailButton, FindPeople } from "@/components/people/find-people";
import { ForgetPerson } from "@/components/people/forget-person";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { isDataProvider } from "@/lib/connectors/catalog";
import { rankPaths, PATH_LABEL } from "@/lib/deals/rules";
import type { Account, ContactPath, Dossier, Person } from "@/lib/domain/types";
import { Cited, ROLE_LABEL, Section, useEvidence } from "./shared";

/** Committee by role, named people with sources, and contact paths ranked warm → published → inbox → guess → LinkedIn. */
export function PeopleSection({ account, committee, topAngleId }: { account: Account; committee: Dossier["committee"]; topAngleId?: string }) {
  const { ws } = useWorkspace();
  if (!ws) return null;
  const inCommittee = new Set(committee.flatMap((c) => c.personIds));
  const everyone = account.peopleIds.map((id) => ws.people[id]).filter((p): p is Person => !!p);
  const warm = everyone.filter((p) => p.contactPaths.some((x) => x.kind === "warm_intro"));
  const others = everyone.filter((p) => !inCommittee.has(p.id) && !warm.includes(p));

  return (
    <Section label="Who to talk to">
      <div className="space-y-5">
        {warm.length > 0 && (
          <div className="rounded-md bg-bg-subtle p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-fg">
              <Handshake className="size-3.5 text-fg-2" aria-hidden />
              You know {warm.length === 1 ? "someone" : `${warm.length} people`} here. Start warm.
            </p>
            <ul className="space-y-2">
              {warm.slice(0, 4).map((p) => (
                <PersonRow key={p.id} person={p} domain={account.domain} angleId={topAngleId} />
              ))}
            </ul>
          </div>
        )}

        {committee.map((c, i) => {
          const people = c.personIds.map((id) => ws.people[id]).filter((p): p is Person => !!p && !warm.includes(p));
          return (
            <div key={`${c.role}-${i}`}>
              <p className="text-[13px] font-medium text-fg">
                {ROLE_LABEL[c.role]}
                {c.likelyTitles.length > 0 && <span className="font-normal text-fg-3"> · usually {c.likelyTitles.slice(0, 3).join(", ")}</span>}
              </p>
              {people.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {people.map((p) => (
                    <PersonRow key={p.id} person={p} domain={account.domain} angleId={topAngleId} />
                  ))}
                </ul>
              ) : (
                c.personIds.length === 0 && <p className="mt-1 font-serif text-[15px] italic leading-[22px] text-fg-3">No one named in public sources. Ask your champion who owns this.</p>
              )}
            </div>
          );
        })}

        {others.length > 0 && (
          <div>
            <p className="text-[13px] font-medium text-fg">{committee.length ? "Also on file" : "On file"}</p>
            <ul className="mt-2 space-y-2">
              {others.slice(0, 6).map((p) => (
                <PersonRow key={p.id} person={p} domain={account.domain} angleId={topAngleId} />
              ))}
            </ul>
          </div>
        )}

        <FindPeople key={account.domain} account={account} />
      </div>
    </Section>
  );
}

function PersonRow({ person, domain, angleId }: { person: Person; domain: string; angleId?: string }) {
  const ev = useEvidence();
  const [forgetting, setForgetting] = useState(false);
  const paths = rankPaths(person.contactPaths).filter((p) => !p.bounced);
  const top = paths[0];
  const direct = top?.kind === "warm_intro" && top.via === "connection";
  const mode = direct ? "linkedin" : top?.kind === "warm_intro" ? "warm_intro" : top?.kind === "linkedin" ? "linkedin" : "cold";
  const label = direct ? "Message on LinkedIn" : top?.kind === "warm_intro" ? "Ask for an intro" : top?.kind === "linkedin" ? "Draft a LinkedIn note" : "Write";
  const hasEmail = !!person.email || paths.some((p) => p.value.includes("@"));
  return (
    <li className="rounded-md bg-surface px-3 py-2.5 ring-1 ring-border">
      <Cited evidence={ev(person.evidenceIds).slice(0, 2)} chips="below">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px]">
              <span className="font-medium text-fg">{person.name}</span>
              <span className="text-fg-2">{person.title}</span>
              {person.mayHaveLeft && <Badge tone="warning">May have left</Badge>}
              {person.doNotContact && <Badge tone="danger">Do not contact</Badge>}
              {person.champion && <Badge tone="outline">Champion · {person.champion}</Badge>}
            </p>
            {person.location && (
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-fg-3">
                <MapPin className="size-3" aria-hidden /> {person.location}
              </p>
            )}
            {paths.length > 0 ? (
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {paths.slice(0, 3).map((p, i) => (
                  <PathItem key={`${p.kind}-${i}`} path={p} />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[12px] text-fg-3">No contact path yet. Ask for an intro or find them on LinkedIn.</p>
            )}
            {!hasEmail && (
              <div className="-ml-2 mt-1">
                <FindEmailButton person={person} />
              </div>
            )}
          </div>
          {!person.doNotContact && <ComposeButton domain={domain} personId={person.id} angleId={angleId} mode={mode} label={label} />}
          <Menu
            trigger={
              <IconButton label={`More for ${person.name}`}>
                <MoreHorizontal className="size-4" />
              </IconButton>
            }
          >
            <MenuItem danger onSelect={() => setForgetting(true)}>
              Delete their details
            </MenuItem>
          </Menu>
        </div>
        {forgetting && <ForgetPerson person={person} onCancel={() => setForgetting(false)} className="mt-3 border-t border-border pt-3 animate-[fade-in_150ms_var(--ease-out)]" />}
      </Cited>
    </li>
  );
}

function PathItem({ path }: { path: ContactPath }) {
  const isUrl = /^https?:\/\//.test(path.value);
  const copy = async () => {
    await navigator.clipboard.writeText(path.value);
    toast("Copied");
  };
  if (path.kind === "warm_intro") {
    return (
      <li className="flex items-center gap-1.5 text-[12px] text-fg-2">
        <Handshake className="size-3" aria-hidden />
        {path.via === "connection" ? "You're connected" : `Warm intro${path.via ? ` via ${path.via}` : ""}`}
        {isUrl && (
          <a href={path.value} target="_blank" rel="noreferrer" className="inline-flex items-center text-fg-3 hover:text-fg" aria-label="Open profile">
            <ArrowUpRight className="size-3" />
          </a>
        )}
      </li>
    );
  }
  if (isUrl) {
    return (
      <li>
        <a href={path.value} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-fg-2 hover:text-fg hover:underline">
          {PATH_LABEL[path.kind]} <ArrowUpRight className="size-3" />
        </a>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-1.5 text-[12px]">
      <button onClick={() => void copy()} className="group inline-flex items-center gap-1 font-mono text-fg-2 hover:text-fg" title="Copy address">
        {path.value}
        <Copy className="size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
      </button>
      {path.kind === "pattern_guess" ? (
        <Badge tone="warning">{isDataProvider(path.via) ? `${path.via} · unverified` : "Guessed · unverified"}</Badge>
      ) : path.kind === "integration" && path.via ? (
        <span className="text-fg-3">{path.verified ? `verified by ${path.via}` : `from ${path.via}`}</span>
      ) : (
        <span className="text-fg-3">{PATH_LABEL[path.kind].toLowerCase()}</span>
      )}
    </li>
  );
}
