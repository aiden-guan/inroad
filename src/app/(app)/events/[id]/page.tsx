import type { Metadata } from "next";
import { Suspense } from "react";
import { EventPage } from "@/components/events/event-page";

export const metadata: Metadata = { title: "Event" };

// Event ids are user data, unknown at build time, and the page reads them on the client, so this
// segment opts out of instant-navigation validation. (The shell's pathname readers sit under Suspense.)
export const instant = false;

export default async function Page({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  return (
    <Suspense>
      <EventPage id={decodeURIComponent(id)} />
    </Suspense>
  );
}
