import type { Metadata } from "next";
import { Snow } from "@/components/ui";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = { title: "Admin · Secret Santa", robots: { index: false } };

export default function AdminPage() {
  return (
    <>
      <Snow count={24} />
      <main className="page">
        <Dashboard />
      </main>
    </>
  );
}
