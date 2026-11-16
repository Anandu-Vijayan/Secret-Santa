import type { Metadata } from "next";
import { Snow } from "@/components/ui";
import { Onboarding } from "./Onboarding";

export const metadata: Metadata = { title: "Welcome · Secret Santa", robots: { index: false } };

export default function OnboardingPage() {
  return (
    <>
      <Snow />
      <main className="page page-narrow">
        <Onboarding />
      </main>
    </>
  );
}
