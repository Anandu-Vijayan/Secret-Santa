import type { Metadata } from "next";
import { Snow } from "@/components/ui";
import { WishlistPage } from "./WishlistPage";

export const metadata: Metadata = { title: "My wishlist · Secret Santa", robots: { index: false } };

export default function Page() {
  return (
    <>
      <Snow />
      <main className="page page-narrow">
        <WishlistPage />
      </main>
    </>
  );
}
