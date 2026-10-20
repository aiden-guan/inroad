"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Orb } from "@/components/ui/orb";

export default function Home() {
  const { ws, loading, error } = useWorkspace();
  const router = useRouter();
  useEffect(() => {
    if (loading || !ws) return;
    router.replace(ws.onboarding.status === "hired" ? "/today" : "/welcome");
  }, [ws, loading, router]);
  return (
    <div className="flex min-h-dvh items-center justify-center">
      {error ? <p className="text-[13px] text-danger">{error}</p> : <Orb size={28} />}
    </div>
  );
}
