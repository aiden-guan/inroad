"use client";

import Link from "next/link";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { MonidPanel } from "./monid-panel";

export function CitationMonitor() {
  const { ws } = useWorkspace();
  if (!ws?.integrations.monid?.enabled || ws.sample) return <Link href="/integrations#monid" className="inline-block py-2 text-[13px] font-medium underline underline-offset-4">Connect Monid for AI citation snapshots →</Link>;
  return <div className="mt-5 border-t border-border pt-5"><MonidPanel initialKind="citations" /></div>;
}
