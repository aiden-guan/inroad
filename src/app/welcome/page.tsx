import type { Metadata } from "next";
import { Suspense } from "react";
import { Canvas } from "@/components/onboarding/shared";
import { WelcomeFlow } from "@/components/onboarding/welcome-flow";
import { LoadingSignal } from "@/components/ui/loading";

export const metadata: Metadata = { title: "Welcome" };

export default function Page() {
  // The flow reads ?start= (which way in), so it renders below a boundary; the fallback is its own loading state.
  return (
    <Suspense
      fallback={
        <Canvas>
          <div className="flex justify-center pt-[30vh]">
            <LoadingSignal />
          </div>
        </Canvas>
      }
    >
      <WelcomeFlow />
    </Suspense>
  );
}
