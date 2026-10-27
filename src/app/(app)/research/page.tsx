import { Suspense } from "react";
import type { Metadata } from "next";
import { ResearchWorkbench } from "@/components/research/research-workbench";
import { PageTransition } from "@/components/shell/page-transition";
export const metadata: Metadata = { title: "Research" };
export default function Page() {
  return (
    <PageTransition>
      <Suspense fallback={null}>
        <ResearchWorkbench />
      </Suspense>
    </PageTransition>
  );
}
