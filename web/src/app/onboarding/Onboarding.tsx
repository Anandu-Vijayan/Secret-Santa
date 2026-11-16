"use client";

import { useState, type FormEvent } from "react";
import { FormError, Loading } from "@/components/States";
import { TopBar } from "@/components/ui";
import { WishlistEditor } from "@/components/WishlistEditor";
import { api, ApiError, useApi, type Me, type Wish } from "@/lib/api";
import { firstName } from "@/lib/format";

const toPayload = (w: Wish[]) => w.map(({ title, price, link, note }) => ({ title, price: price ?? "", link: link ?? "", note: note ?? "" }));

export function Onboarding() {
  const { data: me } = useApi<Me>("/me");
  const [step, setStep] = useState<1 | 2>(1);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!me) return <Loading />;
  if (!me.current) {
    if (typeof window !== "undefined") window.location.assign(me.orgs.length ? "/choose-company" : "/login?error=not_invited");
    return <Loading />;
  }
  const cur = me.current;
  const budget = me.event?.budget || "your budget";

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      await api("/me/profile", { method: "PATCH", body: { name: f.get("name"), department: f.get("department") } });
      setStep(2);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveWishes() {
    setBusy(true);
    setErr(null);
    try {
      await api("/me/wishes", { method: "PUT", body: { wishes: toPayload(wishes) } });
      window.location.assign("/home");
    } catch (e) {
      setErr((e as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar user={me.user.name} />
      <div style={{ paddingBottom: 48 }}>
        <div className="stepper" aria-label={`Step ${step} of 2`}>
          <span data-on="true" />
          <span data-on={step === 2} />
        </div>

        {step === 1 ? (
          <form onSubmit={saveProfile}>
            <div className="onb-head">
              <span className="kicker">
                {cur.orgName}
                {me.event ? ` · ${me.event.name}` : ""}
              </span>
              <h1>Hi {firstName(cur.name)}, welcome in 🎄</h1>
              <p>Check your details. Your Santa sees your name and team, nothing else.</p>
            </div>
            <div className="card" style={{ marginTop: 22 }}>
              <div className="form-grid">
                <label className="lbl">
                  Display name
                  <input className="input" name="name" defaultValue={cur.name} required maxLength={60} />
                </label>
                <div className="form-row">
                  <label className="lbl">
                    Team
                    <input className="input" name="department" defaultValue={cur.department} maxLength={40} />
                  </label>
                  <label className="lbl">
                    Email
                    <input className="input" value={me.user.email} readOnly aria-describedby="email-hint" />
                  </label>
                </div>
                <p id="email-hint" className="hint">
                  Email comes from your Google account and can&apos;t be changed here.
                </p>
                <FormError message={err} />
              </div>
            </div>
            <div className="onb-actions">
              <span />
              <button className="btn btn-gold" type="submit" disabled={busy}>
                Next: my wishlist →
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="onb-head">
              <span className="kicker">Step 2 of 2</span>
              <h1>What would you love to unwrap?</h1>
              <p>Add up to 5 gifts within {budget}. Your Santa sees this list after they spin.</p>
            </div>
            <div className="card" style={{ marginTop: 22 }}>
              <WishlistEditor wishes={wishes} onChange={setWishes} budget={budget} />
              <div style={{ marginTop: 12 }}>
                <FormError message={err} />
              </div>
            </div>
            <div className="onb-actions">
              <button className="btn btn-quiet" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button className="btn btn-gold" onClick={saveWishes} disabled={busy}>
                {wishes.length ? "Save & continue" : "Skip for now"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
