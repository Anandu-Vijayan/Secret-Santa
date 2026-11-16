"use client";

import { useState, type FormEvent } from "react";
import { GoogleButton } from "@/components/ui";
import { FormError } from "@/components/States";
import { api, ApiError } from "@/lib/api";

type Mode = "staff" | "admin";

const copy: Record<Mode, { title: string; lead: string; button: string }> = {
  staff: {
    title: "Join your team's Secret Santa",
    lead: "Sign in with the work Google account your admin added. You'll make a wishlist, then spin.",
    button: "Continue with Google",
  },
  admin: {
    title: "Set up Secret Santa for your company",
    lead: "Sign in with Google to create your company space. You'll add staff on the next screen.",
    button: "Sign up with Google",
  },
};

const ERRORS: Record<string, string> = {
  not_invited: "You're signed in, but no company has added this email yet. Ask your organiser to add you, or set up your own company.",
  expired: "That sign-in took too long. Please try again.",
  google_failed: "Google sign-in didn't complete. Please try again.",
  email_unverified: "Your Google email isn't verified, so we can't use it.",
  google_not_configured: "Google sign-in isn't set up on this server yet.",
};

const DEV_LOGIN = process.env.NEXT_PUBLIC_DEV_LOGIN === "true";

export function LoginCard({ initial, error }: { initial: Mode; error?: string }) {
  const [mode, setMode] = useState<Mode>(initial);
  const c = copy[mode];

  return (
    <div className="card">
      <div className="seg" role="group" aria-label="I am">
        <button type="button" aria-pressed={mode === "staff"} onClick={() => setMode("staff")}>
          I&apos;m joining
        </button>
        <button type="button" aria-pressed={mode === "admin"} onClick={() => setMode("admin")}>
          I&apos;m the organiser
        </button>
      </div>

      <span className="kicker">🎄 Christmas 2026</span>
      <h1>{c.title}</h1>
      <p className="lead muted">{c.lead}</p>

      {error && ERRORS[error] && (
        <div style={{ marginBottom: 18, textAlign: "left" }}>
          <FormError message={ERRORS[error]} />
          {error === "not_invited" && mode === "staff" && (
            <button type="button" className="btn btn-ghost-ink btn-sm" style={{ marginTop: 10 }} onClick={() => setMode("admin")}>
              Set up your own company
            </button>
          )}
        </div>
      )}

      {/* Full-page navigation: the API redirects to Google with PKCE, state and nonce. */}
      <GoogleButton href={`/api/auth/google/start?intent=${mode}`} label={c.button} wide />

      <p className="fine">We only read your name and email from Google. We never see your password.</p>

      {DEV_LOGIN && <DevLogin intent={mode} />}
    </div>
  );
}

/** Local development only (needs DEV_LOGIN=true on the API, refused in production). */
function DevLogin({ intent }: { intent: Mode }) {
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ next: string }>("/auth/dev-login", {
        method: "POST",
        body: { email: f.get("email"), name: f.get("name"), intent },
      });
      window.location.assign(r.next);
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }
  return (
    <form onSubmit={submit} className="form-grid" style={{ marginTop: 22, textAlign: "left" }}>
      <div className="divider">Developer sign-in (local only)</div>
      <div className="form-row">
        <label className="lbl">
          Name
          <input className="input" name="name" required maxLength={60} />
        </label>
        <label className="lbl">
          Email
          <input className="input" name="email" type="email" required maxLength={120} />
        </label>
      </div>
      <FormError message={err} />
      <button className="btn btn-ghost-ink btn-sm" type="submit">
        Sign in without Google
      </button>
    </form>
  );
}
