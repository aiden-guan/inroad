import type { Metadata } from "next";
import { PlaysPage } from "@/components/plays/plays-page";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Plays" };

export default function Page() {
  return (
    <PageTransition>
      <PlaysPage />
    </PageTransition>
  );
}
