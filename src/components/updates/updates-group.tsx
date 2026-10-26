"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/integrations/parts";
import { Callout, Group, Row } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Markdown, Skeleton } from "@/components/ui/misc";
import { shortDate } from "@/lib/client/format";
import { UpdateButton } from "./update-button";
import { statusLine, updateAction } from "./update-model";
import { useUpdates } from "./update-provider";

const SHOWN_CHANGES = 8;

/**
 * Settings → General → Updates: the version, what's new, one click to update, and whether Inroad checks by
 * itself. Works the same in a browser (a git checkout) and in the Mac app.
 */
export function UpdatesGroup() {
  const { status, checking, check, setAutoCheck } = useUpdates();
  const [allChanges, setAllChanges] = useState(false);
  const action = updateAction(status);

  const hint =
    status?.channel === "desktop"
      ? "New versions download in the background. Restarting into one backs up your workspace first; if the new version can't be installed, the one you have stays."
      : "Updating backs up your workspace first, then pulls, installs and builds the new version and restarts Inroad. If any step fails, Inroad goes back to the version you had.";

  return (
    <Group id="updates" title="Updates" hint={hint}>
      {!status ? (
        <div className="space-y-2 px-4 py-3.5">
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
            <div className="space-y-2 px-4 py-3.5">
              {status.last?.ok === false && (
                <Callout tone="warning" title="The last update didn't finish">
                  {status.last.error}
                </Callout>
              )}
              {status.blocked && (
                <Callout tone="warning" title={status.phase === "unavailable" ? "Updating by hand" : "Can't update in one click"}>
                  {status.blocked}
                </Callout>
              )}
              {status.error && <Callout tone="neutral" title="Last check">{status.error}</Callout>}
            </div>
          )}

          {status.latest && (status.latest.changes?.length || status.latest.notes || status.latest.url) ? (
            <div className="px-4 py-3.5">
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
                        {c.date && <span className="shrink-0 font-mono text-[11.5px] tnum text-fg-3">{shortDate(c.date)}</span>}
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
            <Row
              label="Check for updates by itself"
              hint={
                status.channel === "desktop"
                  ? "Every 6 hours, Inroad asks GitHub for its latest release. Nothing about your work is sent."
                  : "Every 6 hours, Inroad asks GitHub what's new on the branch this copy follows (a git fetch). Nothing about your work is sent."
              }
            >
              <div className="flex sm:justify-end">
                <Switch checked={status.autoCheck} onChange={(on) => void setAutoCheck(on)} label="Check for updates by itself" />
              </div>
            </Row>
          )}
        </>
      )}
    </Group>
  );
}
