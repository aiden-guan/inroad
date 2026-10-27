"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { actionLabel } from "./update-model";
import { useUpdates } from "./update-provider";

/**
 * "Update now" / "Restart to update". When research or drafting is running, the first click says the update
 * would stop it and the second goes ahead, so nothing in progress ends by surprise.
 */
export function UpdateButton({ action, size = "sm", className }: { action: "update" | "restart"; size?: ButtonProps["size"]; className?: string }) {
  const { install, busyRuns } = useUpdates();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(t);
  }, [confirming]);
  const go = async () => {
    if (busyRuns > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    await install();
    setBusy(false);
  };
  return (
    <Button size={size} variant={confirming ? "danger" : "primary"} loading={busy} icon={<RefreshCw className="size-3.5" aria-hidden />} onClick={() => void go()} className={className}>
      {actionLabel(action, busyRuns, confirming)}
    </Button>
  );
}
