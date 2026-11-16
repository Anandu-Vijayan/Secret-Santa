import type { Metadata } from "next";
import { RevealFromLink } from "@/components/RevealFromLink";

export const metadata: Metadata = {
  title: "Your Secret Santa",
  description: "Unwrap to see who you're buying for.",
  robots: { index: false },
};

export default function RevealPage() {
  return <RevealFromLink />;
}
