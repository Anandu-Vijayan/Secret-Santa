import type { Metadata } from "next";
import { Suspense } from "react";
import { Snow, TopBar } from "@/components/ui";
import { LoginCard } from "./LoginCard";

export const metadata: Metadata = { title: "Sign in · Secret Santa" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <Snow />
      <main className="page page-narrow">
        <TopBar />
        <div className="auth">
          <Suspense>
            <LoginBody searchParams={searchParams} />
          </Suspense>
        </div>
      </main>
    </>
  );
}

async function LoginBody({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { as, error } = await searchParams;
  return <LoginCard initial={as === "admin" ? "admin" : "staff"} error={typeof error === "string" ? error : undefined} />;
}
