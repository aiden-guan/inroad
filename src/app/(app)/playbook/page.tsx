import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaybookSkeleton, PlaybookView } from "@/components/playbook/playbook-view";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Playbook" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense fallback={<PlaybookSkeleton />}>
        <PlaybookView />
      </Suspense>
    </PageTransition>
  );
}
