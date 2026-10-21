import type { Metadata } from "next";
import { Suspense } from "react";
import { IntrosPage } from "@/components/intros/intros-page";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Intros" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense>
        <IntrosPage />
      </Suspense>
    </PageTransition>
  );
}
