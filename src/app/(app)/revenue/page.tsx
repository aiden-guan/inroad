import type { Metadata } from "next";
import { Suspense } from "react";
import { RevenuePage } from "@/components/revenue/revenue-page";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Revenue" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense>
        <RevenuePage />
      </Suspense>
    </PageTransition>
  );
}
