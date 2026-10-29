import type { Metadata } from "next";
import { Suspense } from "react";
import { GrowthPage } from "@/components/growth/growth-page";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Growth" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense>
        <GrowthPage />
      </Suspense>
    </PageTransition>
  );
}
