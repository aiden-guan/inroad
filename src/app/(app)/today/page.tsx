import type { Metadata } from "next";
import { TodayView } from "@/components/today/today-view";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Today" };

export default function Page() {
  return (
    <PageTransition>
      <TodayView />
    </PageTransition>
  );
}
