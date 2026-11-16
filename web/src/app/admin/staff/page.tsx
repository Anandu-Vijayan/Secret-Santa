import type { Metadata } from "next";
import { Snow } from "@/components/ui";
import { StaffTable } from "./StaffTable";

export const metadata: Metadata = { title: "Staff · Secret Santa", robots: { index: false } };

export default function StaffPage() {
  return (
    <>
      <Snow count={24} />
      <main className="page">
        <StaffTable />
        <div style={{ height: 48 }} />
      </main>
    </>
  );
}
