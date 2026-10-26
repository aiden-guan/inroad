"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useRuns } from "@/components/providers/runs-provider";
import { Orb } from "@/components/ui/orb";
import { ease } from "@/lib/motion";
import type { DesktopBridge, UpdateStatus } from "@/lib/updates/types";
import { UPDATE_STEPS } from "../../../scripts/updating-page.mjs";

/**
 * One place that knows where Inroad stands on updates, for the sidebar notice and Settings → Updates.
 * In the Mac app it asks the shell (window.inroadDesktop, which downloads and swaps the app); in a browser it
 * asks the server (GET /api/update), whose launcher pulls, installs, builds and restarts. While a browser
 * update runs, the page shows what step it's on and reloads itself into the new version.
 */

/** How often the page asks; the server only goes to GitHub every 6 hours unless asked to check now. */
const POLL_MS = 30 * 60 * 1000;
const SEEN_KEY = "inroad:update-seen";

interface UpdateContextValue {
  status: UpdateStatus | null;
  checking: boolean;
  /** Ask GitHub now. */
  check: () => Promise<void>;
  /** Update now (source) or restart into the downloaded version (Mac app). */
  install: () => Promise<void>;
  setAutoCheck: (on: boolean) => Promise<void>;
  /** Runs that an update would stop, so the button can say so first. */
  busyRuns: number;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

function bridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { inroadDesktop?: DesktopBridge }).inroadDesktop ?? null;
}

async function getSource(check = false): Promise<UpdateStatus> {
  const res = await fetch(`/api/update${check ? "?check=1" : ""}`, { cache: "no-store" });
  const body = (await res.json()) as UpdateStatus & { error?: string };
  // 503 is the launcher's "Updating" page answering for a moment: keep what's shown.
  if (!res.ok) throw new Error(body.error ?? "Couldn't read the update status.");
  return body;
}

/** Says once how the last update went: after the page reloads into it, or the Mac app reopens. */
function announce(s: UpdateStatus) {
  const last = s.last;
  if (!last) return;
  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEN_KEY);
  } catch {
    // private mode: it may say so twice
  }
  if (seen === last.at) return;
  try {
    localStorage.setItem(SEEN_KEY, last.at);
  } catch {
    // ignore
  }
  // Only fresh news: an update from long ago (another browser, a cleared storage) isn't announced.
  if (Date.now() - new Date(last.at).getTime() > 60 * 60 * 1000) return;
  const backup = last.backedUp ? " Your workspace was backed up first, under Settings → Data → Backups." : "";
  if (last.ok) toast.success(`Inroad is updated${s.channel === "desktop" && last.to ? ` to ${last.to}` : ""}.`, backup ? { description: backup.trim() } : undefined);
  else toast.error("Inroad didn't update.", { description: `${last.error ?? ""}${backup}`.trim(), duration: 20_000 });
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<{ step: string | null; since: number; backedUp: boolean } | null>(null);
  const { runs } = useRuns();
  const busyRuns = Object.values(runs).filter((r) => r.status === "running" || r.status === "queued").length;
  const announced = useRef(false);

  const take = useCallback((s: UpdateStatus) => {
    // Never urgent: it mustn't interrupt a navigation's view transition (the orb flying into the sidebar).
    startTransition(() => setStatus(s));
    if (!announced.current && s.last) {
      announced.current = true;
      announce(s);
    }
  }, []);

  // Where it stands now, and again every so often (the Mac app tells the page itself).
  useEffect(() => {
    const desktop = bridge();
    if (desktop) {
      void desktop.updates.get().then((s) => s && take(s));
      return desktop.updates.subscribe(take);
    }
    let cancelled = false;
    const load = () =>
      getSource()
        .then((s) => !cancelled && take(s))
        .catch(() => {});
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [take]);

  // A browser update in progress: follow the launcher's steps, then load the new version.
  const updatingSince = updating?.since;
  useEffect(() => {
    if (!updatingSince) return;
    let stop = false;
    // The old server answers for a moment after the click; only a server that went away and came back is the new one.
    let wentAway = false;
    const tick = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await fetch("/api/update", { cache: "no-store" });
          const body = (await res.json()) as Partial<UpdateStatus>;
          const finished = body.last && new Date(body.last.at).getTime() >= updatingSince;
          if (res.status === 503 || body.phase === "updating") {
            wentAway = true;
            setUpdating((u) => (u ? { ...u, step: body.step ?? u.step } : u));
          } else if (res.ok && (wentAway || finished)) {
            window.location.reload();
            return;
          }
        } catch {
          // Between the old server stopping and the "Updating" page starting, nothing answers.
          wentAway = true;
        }
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [updatingSince]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const desktop = bridge();
      const s = desktop ? await desktop.updates.check() : await getSource(true);
      take(s);
      if (s.error) toast.error(s.error);
      else if (s.phase === "up-to-date") toast(`Inroad is up to date (${s.current}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't check for updates. Try again.");
    } finally {
      setChecking(false);
    }
  }, [take]);

  const install = useCallback(async () => {
    const desktop = bridge();
    if (desktop) {
      const r = await desktop.updates.install();
      if (!r.ok) toast.error(r.error ?? "Inroad didn't update. Try again.");
      return;
    }
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string; backedUp?: boolean } | null;
      if (res.status !== 202) throw new Error(body?.error ?? "The update didn't start. Try again.");
      setUpdating({ step: "stopping", since: Date.now(), backedUp: body?.backedUp === true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The update didn't start. Try again.");
    }
  }, []);

  const setAutoCheck = useCallback(
    async (on: boolean) => {
      const desktop = bridge();
      try {
        if (desktop) {
          take(await desktop.updates.setAutoCheck(on));
          return;
        }
        const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updateCheck: on ? "on" : "off" }) });
        if (!res.ok) throw new Error();
        take(await getSource());
      } catch {
        toast.error("That didn't save. Try again.");
      }
    },
    [take],
  );

  const value = useMemo(() => ({ status, checking, check, install, setAutoCheck, busyRuns }), [status, checking, check, install, setAutoCheck, busyRuns]);

  return (
    <UpdateContext.Provider value={value}>
      {children}
      <UpdatingOverlay updating={updating} />
    </UpdateContext.Provider>
  );
}

export function useUpdates(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdates must be used inside UpdateProvider");
  return ctx;
}

const stepLabel = (step: string | null | undefined) => (UPDATE_STEPS as Record<string, string>)[step ?? ""] ?? "Updating";

/** Over everything while a browser update runs: nothing on the page can be used until the new version loads. */
function UpdatingOverlay({ updating }: { updating: { step: string | null; since: number; backedUp: boolean } | null }) {
  // Read in an effect, never while rendering: a prerender has no "now".
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!updating) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [updating]);
  const slow = updating && now > 0 && now - updating.since > 15 * 60 * 1000;
  return (
    <AnimatePresence>
      {updating && (
        <motion.div
          key="updating"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="updating-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: ease.out }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-bg/95 px-4 text-center backdrop-blur"
        >
          <Orb state="working" size={28} />
          <h2 id="updating-title" className="text-[17px] font-semibold text-fg">
            Updating Inroad
          </h2>
          <p role="status" className="text-[14px] text-fg-2">
            {stepLabel(updating.step)}…
          </p>
          <p className="max-w-[42ch] text-[13px] leading-5 text-fg-3 text-pretty">
            {slow
              ? `This is taking longer than it should. The terminal Inroad runs in shows what it's doing. Your work is saved${updating.backedUp ? " and backed up" : ""}.`
              : `Your work is saved${updating.backedUp ? " and backed up" : ""}. This page opens the new version by itself when it's ready.`}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
