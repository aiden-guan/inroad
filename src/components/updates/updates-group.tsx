"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/integrations/parts";
import { Advanced, Callout, Group, Row } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Markdown, Skeleton } from "@/components/ui/misc";
import { shortDate } from "@/lib/client/format";
import { UpdateButton } from "./update-button";
import { statusLine, updateAction } from "./update-model";
import { useUpdates } from "./update-provider";

const SHOWN_CHANGES = 8;

/**
 * The first sentence of a message from the updater, and the rest. The first says what's wrong in plain words; the
 * rest is usually the commands that fix it, which belong in the details.
 */
function splitReason(text: string): { lead: string; detail: string | null } {
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text.trim());
  return m ? { lead: m[1], detail: m[2] } : { lead: text.trim(), detail: null };
}

function Reason({ text }: { text: string }) {
  const { lead, detail } = splitReason(text);
  return (
    <>
      <p>{lead}</p>
      {detail && (
        <details className="mt-1">
          <summary className="w-fit cursor-pointer rounded-xs text-fg-3 hover:text-fg-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">How to fix it</summary>
          <p className="mt-1 font-mono text-[12px] leading-[18px] text-fg-2 [overflow-wrap:anywhere]">{detail}</p>
        </details>
      )}
    </>
  );
}

/**
 * Settings → General → Updates: the version, what's new, one click to update, and whether Inroad checks by
 * itself. Works the same in a browser (a git checkout) and in the Mac app; how a checkout updates itself is in the
 * Advanced details, not the main copy.
 */
export function UpdatesGroup() {
  const { status, checking, check, setAutoCheck } = useUpdates();
  const [allChanges, setAllChanges] = useState(false);
  const action = updateAction(status);
  const source = status?.channel === "source";

  const hint =
    status?.channel === "desktop"
      ? "New versions download in the background. Restarting saves a backup of your workspace first, and if the new version can't be installed, you keep the one you have."
      : "Updating saves a backup of your workspace first, then installs the new version and restarts Inroad. If anything goes wrong, you keep the version you have.";

  return (
    <Group id="updates" title="Updates" hint={hint}>
      {!status ? (
        <div className="space-y-2 px-5 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
      ) : (
        <>
          <Row
            label={<span className="font-mono text-[12.5px] tnum">Inroad {status.current}</span>}
            hint={
              <span role="status" aria-live="polite">
                {statusLine(status)}
              </span>
            }
          >
            <div className="flex flex-wrap items-center justify-end gap-2">
              {status.phase !== "unavailable" && (
                <Button size="sm" variant={action ? "ghost" : "secondary"} loading={checking || status.phase === "checking"} disabled={status.phase === "downloading" || status.phase === "updating"} onClick={() => void check()}>
                  Check now
                </Button>
              )}
              {action && <UpdateButton action={action} />}
            </div>
          </Row>

          {(status.blocked || status.error || status.last?.ok === false) && (
            <div className="space-y-2 px-5 py-4">
              {status.last?.ok === false && (
                <Callout tone="warning" title="The last update didn't finish">
                  {status.last.rolledBack && <p>You&apos;re still on the version you had.</p>}
                  {status.last.error && <Reason text={status.last.error} />}
                </Callout>
              )}
              {status.blocked && (
                <Callout tone="warning" title={status.phase === "unavailable" ? "Update this copy by hand" : "Can't update in one click"}>
                  <Reason text={status.blocked} />
                </Callout>
              )}
              {status.error && (
                <Callout tone="neutral" title="The last check didn't finish">
                  <Reason text={status.error} />
                </Callout>
              )}
            </div>
          )}

          {status.latest && (status.latest.changes?.length || status.latest.notes || status.latest.url) ? (
            <div className="px-5 py-4">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-[13px] font-medium text-fg">What&rsquo;s new{status.channel === "desktop" ? ` in ${status.latest.label}` : ""}</p>
                {status.latest.url && (
                  <a href={status.latest.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[12px] text-fg-3 hover:text-fg">
                    On GitHub <ArrowUpRight className="size-3" aria-hidden />
                  </a>
                )}
              </div>
              {status.latest.changes?.length ? (
                <>
                  <ul className="space-y-1.5">
                    {(allChanges ? status.latest.changes : status.latest.changes.slice(0, SHOWN_CHANGES)).map((c) => (
                      <li key={c.sha ?? c.subject} className="flex gap-3 text-[13px] leading-[19px]">
                        <span className="min-w-0 flex-1 text-fg-2 text-pretty">{c.subject}</span>
                        {c.date && <span className="shrink-0 font-mono text-[12px] tnum text-fg-3">{shortDate(c.date)}</span>}
                      </li>
                    ))}
                  </ul>
                  {!allChanges && status.latest.changes.length > SHOWN_CHANGES && (
                    <Button size="xs" variant="ghost" onClick={() => setAllChanges(true)} className="-ml-2 mt-1.5">
                      Show all {status.latest.total ?? status.latest.changes.length}
                    </Button>
                  )}
                </>
              ) : status.latest.notes ? (
                <Markdown className="max-h-72 overflow-y-auto text-[13px] leading-[19px] text-fg-2">{status.latest.notes}</Markdown>
              ) : null}
            </div>
          ) : null}

          {status.phase !== "unavailable" && (
            <Row label="Check for updates by itself" hint="Every 6 hours, Inroad checks GitHub for a newer version. Nothing about your work is sent.">
              <div className="flex sm:justify-end">
                <Switch checked={status.autoCheck} onChange={(on) => void setAutoCheck(on)} label="Check for updates by itself" />
              </div>
            </Row>
          )}

          {source && (
            <Advanced summary="How this copy updates">
              <p>
                This copy runs from Inroad&apos;s source code. A check is a <span className="font-mono">git fetch</span> of the branch it follows. Updating backs up your workspace, pulls the new
                commits, installs anything new, rebuilds the app and restarts it. If any step fails, it goes back to the commit you had.
              </p>
            </Advanced>
          )}
        </>
      )}
    </Group>
  );
}
