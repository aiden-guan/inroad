import type { Metadata } from "next";
import { Suspense } from "react";
import { EventsPage } from "@/components/events/events-page";

export const metadata: Metadata = { title: "Events" };

export default function Page() {
  return (
    <Suspense>
      <EventsPage />
    </Suspense>
  );
}
