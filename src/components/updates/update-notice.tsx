"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ease } from "@/lib/motion";
import { UpdateButton } from "./update-button";
import { noticeFor } from "./update-model";
import { useUpdates } from "./update-provider";

const LATER_KEY = "inroad:update-later";

function laterFor(): string | null {
  try {
    return sessionStorage.getItem(LATER_KEY);
  } catch {
    return null;
  }
}

/**
 * A quiet card at the foot of the sidebar when an update is ready: one click installs it, "Later" hides it
 * until Inroad is opened again (or a newer version arrives). Settings → Updates always has it.
 */
export function UpdateNotice() {
  const { status } = useUpdates();
  const notice = noticeFor(status);
  const key = status?.latest?.label ?? "";
  const [later, setLater] = useState<string | null>(laterFor);
  const shown = notice && later !== key;
  const dismiss = () => {
    setLater(key);
    try {
      sessionStorage.setItem(LATER_KEY, key);
    } catch {
      // private mode: hidden until the page reloads
    }
  };
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key="update"
          role="status"
          aria-label="Update"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
          transition={{ duration: 0.22, ease: ease.out }}
          className="overflow-hidden"
        >
          <div className="mb-2 rounded-md bg-surface px-3 py-2.5 shadow-xs ring-1 ring-border">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-fg">
              <ArrowUpCircle className="size-3.5 text-fg-2" aria-hidden /> {notice.title}
            </p>
            <p className="mt-0.5 text-[12px] leading-[17px] text-fg-3 text-pretty">{notice.body}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {notice.action && <UpdateButton action={notice.action} size="xs" />}
              <Link href="/settings#updates" className="rounded-xs px-2 text-[12px] leading-6 text-fg-2 transition-colors hover:bg-bg-subtle hover:text-fg">
                What&rsquo;s new
              </Link>
              <Button size="xs" variant="ghost" onClick={dismiss} className="ml-auto">
                Later
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
