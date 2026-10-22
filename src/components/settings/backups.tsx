"use client";

import { History, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { backupWhen, describeSummary, fileSize, REASON_LABEL, restoredMessage, summarizeFile, uploadBody, type BackupEntry, type BackupsResponse, type BackupSummary } from "./backup-model";
import { Expand, Group, Row } from "./parts";

const SHOWN = 5;
const LIST_ERROR = "Couldn't list your backups. Is the app still running?";

async function fetchBackups(): Promise<BackupsResponse> {
  const res = await fetch("/api/workspace/backups", { cache: "no-store" });
  if (!res.ok) throw new Error(LIST_ERROR);
  return (await res.json()) as BackupsResponse;
}

/** The automatic backups, and restoring one of them or a downloaded file. Restores confirm inline. */
export function BackupsGroup({ refresh, version }: { refresh: () => Promise<void>; version: string }) {
  const [list, setList] = useState<BackupsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchBackups()
      .then((r) => {
        setList(r);
        setError(null);
      })
      .catch(() => setError(LIST_ERROR));
  }, []);

  // Again whenever the workspace is replaced (`version` is its createdAt): a reset or the sample saves a backup first.
  useEffect(() => {
    let cancelled = false;
    fetchBackups()
      .then((r) => !cancelled && setList(r))
      .catch(() => !cancelled && setError(LIST_ERROR));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const restored = async (from: string, keptSuppressions?: number) => {
    setOpen(null);
    await refresh();
    load();
    toast(restoredMessage(from, keptSuppressions));
  };

  const backups = list?.backups ?? [];
  const shown = all ? backups : backups.slice(0, SHOWN);

  return (
    <Group
      id="backups"
      title="Backups"
      hint={
        <>
          I save a copy of everything every day you open Inroad, and before a reset, the sample or a restore. The last 14 days stay in{" "}
          <span className="font-mono text-[12px] text-fg-2">backups</span>, inside the folder above.
        </>
      }
    >
      {!list && !error && (
        <div className="space-y-2 px-4 py-3.5">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-44" />
        </div>
      )}
      {error && <p className="px-4 py-3.5 text-[12.5px] text-danger">{error}</p>}
      {list && backups.length === 0 && (
        <Row
          label={
            <span className="flex items-center gap-2">
              <History className="size-3.5 text-fg-3" aria-hidden />
              No backups yet
            </span>
          }
          hint="The first one is saved as soon as there's work of yours to keep."
        />
      )}
      {shown.map((b) => (
        <BackupRow key={b.name} entry={b} open={open === b.name} onToggle={() => setOpen(open === b.name ? null : b.name)} onRestored={restored} />
      ))}
      {backups.length > SHOWN && (
        <div className="px-4 py-2">
          <Button size="xs" variant="ghost" className="-ml-2" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? "Show fewer" : `Show all ${backups.length}`}
          </Button>
        </div>
      )}
      <RestoreFromFile onRestored={restored} />
    </Group>
  );
}

type OnRestored = (from: string, keptSuppressions?: number) => Promise<void>;

function BackupRow({ entry, open, onToggle, onRestored }: { entry: BackupEntry; open: boolean; onToggle: () => void; onRestored: OnRestored }) {
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const when = backupWhen(entry.at);

  const toggle = () => {
    onToggle();
    if (summary || open) return;
    fetch(`/api/workspace/backups?name=${encodeURIComponent(entry.name)}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { summary: BackupSummary }).summary : null))
      .then((s) => s && setSummary(s))
      .catch(() => undefined);
  };

  const restore = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/workspace/restore?backup=${encodeURIComponent(entry.name)}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't restore. Try again.");
      await onRestored(when, body?.restored?.keptSuppressions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't restore. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Row
        label={when}
        hint={
          <>
            {REASON_LABEL[entry.reason]} <span aria-hidden>·</span> <span className="font-mono text-[11.5px] tnum">{fileSize(entry.bytes)}</span>
          </>
        }
      >
        <div className="flex sm:justify-end">
          <Button size="sm" aria-expanded={open} onClick={toggle}>
            Restore…
          </Button>
        </div>
      </Row>
      <Expand open={open}>
        <ConfirmRestore
          text={
            <>
              Replace what&apos;s here now with the backup from {when.replace(/^(Today|Yesterday)/, (d) => d.toLowerCase())}
              {summary ? <> ({describeSummary(summary)})</> : null}? I&apos;ll back up the current workspace first, and everyone on your suppression list stays on it.
            </>
          }
          busy={busy}
          onCancel={onToggle}
          onConfirm={() => void restore()}
        />
      </Expand>
    </div>
  );
}

function ConfirmRestore({ text, busy, onCancel, onConfirm }: { text: React.ReactNode; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="flex flex-col gap-3 bg-warning-subtle/60 px-4 py-3 sm:flex-row sm:items-center">
      <p className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-fg text-pretty">{text}</p>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={onConfirm}>
          Restore
        </Button>
      </div>
    </div>
  );
}

function RestoreFromFile({ onRestored }: { onRestored: OnRestored }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ file: File; info: ReturnType<typeof summarizeFile> } | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    const gz = /\.gz$/i.test(f.name);
    setFile({ file: f, info: gz ? null : summarizeFile(await f.text()) });
  };

  const restore = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspace/restore", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: await uploadBody(file.file) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "That didn't restore. Try again.");
      setFile(null);
      if (input.current) input.current.value = "";
      await onRestored(body?.restored?.createdAt ? backupWhen(body.restored.createdAt) : file.file.name, body?.restored?.keptSuppressions);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't restore. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const info = file?.info;
  return (
    <div>
      <Row label="Restore from a file" hint="A backup you downloaded (inroad-backup-….json), here or on another computer, or a workspace .json from an older version.">
        <div className="flex sm:justify-end">
          <input
            ref={input}
            type="file"
            accept=".json,.gz,application/json,application/gzip"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Button icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>
            Choose file…
          </Button>
        </div>
      </Row>
      <Expand open={!!file}>
        {file && (
          <ConfirmRestore
            text={
              <>
                Replace what&apos;s here now with <span className="font-medium">{file.file.name}</span>
                {info ? <> ({describeSummary(info.summary)})</> : null}? I&apos;ll back up the current workspace first, and everyone on your suppression list stays on it.
                {info?.workspaceOnly ? " This file is from an older version, so it holds the workspace only; Ask threads and LinkedIn connections stay as they are." : ""}
              </>
            }
            busy={busy}
            onCancel={() => {
              setFile(null);
              if (input.current) input.current.value = "";
            }}
            onConfirm={() => void restore()}
          />
        )}
      </Expand>
    </div>
  );
}
