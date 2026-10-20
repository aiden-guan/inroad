import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaybookSkeleton, PlaybookView } from "@/components/playbook/playbook-view";

export const metadata: Metadata = { title: "Playbook" };

export default function Page() {
  return (
    <Suspense fallback={<PlaybookSkeleton />}>
      <PlaybookView />
    </Suspense>
  );
}
