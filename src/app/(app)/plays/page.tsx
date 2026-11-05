import type { Metadata } from "next";
import { Suspense } from "react";
import { PlaysPage } from "@/components/plays/plays-page";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Plays" };

export default function Page() {
  return (
    <PageTransition>
      {/* The page reads ?play= (the open play), so it renders under a Suspense boundary. */}
      <Suspense>
        <PlaysPage />
      </Suspense>
    </PageTransition>
  );
}
