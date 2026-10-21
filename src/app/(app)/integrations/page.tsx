import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsHub } from "@/components/integrations/integrations-hub";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense>
        <IntegrationsHub />
      </Suspense>
    </PageTransition>
  );
}
