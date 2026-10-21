import type { Metadata } from "next";
import { Suspense } from "react";
import { EventsPage } from "@/components/events/events-page";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Events" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense>
        <EventsPage />
      </Suspense>
    </PageTransition>
  );
}
