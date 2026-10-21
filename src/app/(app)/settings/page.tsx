import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsSkeleton, SettingsView } from "@/components/settings/settings-view";
import { PageTransition } from "@/components/shell/page-transition";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <PageTransition>
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsView />
      </Suspense>
    </PageTransition>
  );
}
