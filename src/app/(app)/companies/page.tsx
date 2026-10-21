import type { Metadata } from "next";
import { Suspense } from "react";
import { CompaniesView } from "@/components/companies/list/companies-view";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Companies" };

// The view reads its state from the URL (?view, ?c, ?add, ?log), so it renders below a Suspense boundary.
export default function Page() {
  return (
    <PageTransition>
      <Suspense fallback={null}>
        <CompaniesView />
      </Suspense>
    </PageTransition>
  );
}
