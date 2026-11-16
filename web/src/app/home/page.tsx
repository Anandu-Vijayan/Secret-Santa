import type { Metadata } from "next";
import { Snow } from "@/components/ui";
import { HomeClient } from "./HomeClient";

export const metadata: Metadata = { title: "Home · Secret Santa", robots: { index: false } };

export default function HomePage() {
  return (
    <>
      <Snow />
      <main className="page">
        <HomeClient />
      </main>
    </>
  );
}
