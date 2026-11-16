"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FormError } from "@/components/States";
import { api, ApiError } from "@/lib/api";

export function SetupForm() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      await api("/orgs", {
        method: "POST",
        body: {
          name: f.get("company"),
          allowedDomain: f.get("domain") || "",
          event: { name: f.get("event"), budget: f.get("budget"), exchangeDate: f.get("date") || null },
        },
      });
      window.location.assign("/admin/staff");
    } catch (e) {
      const a = e as ApiError;
      if (a.status === 401) return window.location.assign("/login?as=admin");
      setErr(a.message);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="form-grid">
        <label className="lbl">
          Company name
          <input className="input" name="company" placeholder="Northwind Labs" required maxLength={80} />
        </label>
        <label className="lbl">
          <span>
            Only allow staff emails from <span className="hint">(recommended)</span>
          </span>
          <input className="input" name="domain" placeholder="northwind.com" maxLength={100} />
          <span className="hint">You won&apos;t be able to add emails outside this domain.</span>
        </label>
        <hr style={{ border: 0, borderTop: "1px dashed rgb(43 15 20 / 0.2)", margin: "6px 0" }} />
        <label className="lbl">
          Event name
          <input className="input" name="event" defaultValue="Christmas Secret Santa 2026" required maxLength={80} />
        </label>
        <div className="form-row">
          <label className="lbl">
            Gift budget
            <input className="input" name="budget" defaultValue="₹1,000" maxLength={20} />
          </label>
          <label className="lbl">
            Exchange day
            <input className="input" type="date" name="date" defaultValue="2026-12-19" />
          </label>
        </div>
        <FormError message={err} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
        <Link href="/" className="btn btn-ghost-ink">
          Cancel
        </Link>
        <button className="btn btn-red" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create & add staff →"}
        </button>
      </div>
    </form>
  );
}
