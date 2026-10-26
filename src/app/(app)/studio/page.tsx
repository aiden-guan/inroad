import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTransition } from "@/components/shell/page-transition";
import { StudioPage } from "@/components/studio/studio-page";

export const metadata: Metadata = { title: "Studio" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense>
        <StudioPage />
      </Suspense>
    </PageTransition>
  );
}
