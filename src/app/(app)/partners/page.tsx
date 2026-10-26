import type { Metadata } from "next";
import { Suspense } from "react";
import { PartnersPage } from "@/components/partners/partners-page";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Creators and communities" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense>
        <PartnersPage />
      </Suspense>
    </PageTransition>
  );
}
