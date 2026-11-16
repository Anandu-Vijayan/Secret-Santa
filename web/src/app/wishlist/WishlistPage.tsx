"use client";

import Link from "next/link";
import { useState } from "react";
import { FormError, Loading } from "@/components/States";
import { TopBar } from "@/components/ui";
import { WishlistEditor } from "@/components/WishlistEditor";
import { api, ApiError, useApi, type Me, type Wish } from "@/lib/api";

export function WishlistPage() {
  const { data: me } = useApi<Me>("/me");
  const { data } = useApi<{ wishes: Wish[] }>("/me/wishes");
  const [draft, setDraft] = useState<Wish[] | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState<string | null>(null);

  if (!me || !data) return <Loading />;
  const wishes = draft ?? data.wishes;

  async function save() {
    setStatus("saving");
    setErr(null);
    try {
      await api("/me/wishes", {
        method: "PUT",
        body: { wishes: wishes.map(({ title, price, link, note }) => ({ title, price: price ?? "", link: link ?? "", note: note ?? "" })) },
      });
      setStatus("saved");
    } catch (e) {
      setErr((e as ApiError).message);
      setStatus("idle");
    }
  }

  return (
    <>
      <TopBar
        user={me.user.name}
        nav={[
          { href: "/home", label: "Home" },
          { href: "/wishlist", label: "My wishlist", current: true, hideSm: true },
        ]}
      />
      <div className="onb-head" style={{ padding: "12px 0 22px" }}>
        <span className="kicker">{me.event?.name}</span>
        <h1>My wishlist</h1>
        <p>Your Santa sees the latest version whenever they open it.</p>
      </div>
      <div className="card">
        <WishlistEditor
          wishes={wishes}
          onChange={(w) => {
            setDraft(w);
            setStatus("idle");
          }}
          budget={me.event?.budget || "your budget"}
        />
        <div style={{ marginTop: 12 }}>
          <FormError message={err} />
        </div>
      </div>
      <div className="onb-actions" style={{ paddingBottom: 48 }}>
        <Link href="/home" className="btn btn-quiet">
          ← Home
        </Link>
        <button className="btn btn-gold" onClick={save} disabled={status !== "idle" || !draft}>
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save changes"}
        </button>
      </div>
    </>
  );
}
