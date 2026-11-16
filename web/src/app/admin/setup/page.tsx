import type { Metadata } from "next";
import { Snow, TopBar } from "@/components/ui";
import { SetupForm } from "./SetupForm";

export const metadata: Metadata = { title: "Set up your company · Secret Santa", robots: { index: false } };

export default function AdminSetup() {
  return (
    <>
      <Snow />
      <main className="page page-narrow">
        <TopBar />
        <div className="onb-head" style={{ padding: "8px 0 22px" }}>
          <span className="kicker">Organiser setup</span>
          <h1>Create your company space</h1>
          <p>Takes a minute. You can change the event details later.</p>
        </div>
        <SetupForm />
        <div style={{ height: 48 }} />
      </main>
    </>
  );
}
