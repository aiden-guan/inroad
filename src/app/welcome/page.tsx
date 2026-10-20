import type { Metadata } from "next";
import { WelcomeFlow } from "@/components/onboarding/welcome-flow";

export const metadata: Metadata = { title: "Welcome" };

export default function Page() {
  return <WelcomeFlow />;
}
