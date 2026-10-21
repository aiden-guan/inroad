import type { Metadata } from "next";
import { Suspense } from "react";
import { IntrosPage } from "@/components/intros/intros-page";

export const metadata: Metadata = { title: "Intros" };

export default function Page() {
  return (
    <Suspense>
      <IntrosPage />
    </Suspense>
  );
}
