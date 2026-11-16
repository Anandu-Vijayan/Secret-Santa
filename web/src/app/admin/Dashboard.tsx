"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorNote, FormError, Loading } from "@/components/States";
import { LockIcon, TopBar } from "@/components/ui";
import { adminNav } from "@/lib/adminNav";
import { api, ApiError, useApi, type Me } from "@/lib/api";
import { formatDate } from "@/lib/format";

export type Overview = {
  org: { name: string; allowedDomain: string | null };
  event: null | { name: string; budget: string; exchangeDate: string | null; status: "draft" | "open" | "closed"; drawnAt: string | null };
  members: { total: number; active: number; withWishes: number };
  draw: { participants: number; revealed: number };
};

export function Dashboard() {
  const { data: me } = useApi<Me>("/me");
  const { data: o, error, reload } = useApi<Overview>("/admin/overview");

  if (error?.status === 403) return <ErrorNote error="Only organisers can open this page." />;
  if (!me || !o) return <Loading />;

  const ev = o.event;
  const drawn = ev?.status === "open";
  const stats = [
    { label: "Staff added", value: o.members.total, of: null as number | null },
    { label: "Signed in", value: o.members.active, of: o.members.total },
    { label: "Wishlists ready", value: o.members.withWishes, of: o.members.total },
    { label: "Spun the wheel", value: o.draw.revealed, of: drawn ? o.draw.participants : o.members.active },
  ];
  const pct = (v: number, of: number) => `${of ? Math.round((v / of) * 100) : 0}%`;

  return (
    <>
      <TopBar user={me.user.name} nav={[...adminNav("/admin"), { href: "/home", label: "My spin" }]} />
      <div className="admin-head">
        <div>
          <span className="kicker">{o.org.name} · Admin</span>
          <h1>{ev?.name ?? "No active event"}</h1>
          {ev && (
            <p>
              Budget {ev.budget || "not set"} · Exchange on {formatDate(ev.exchangeDate)}
            </p>
          )}
        </div>
        <Link href="/admin/staff" className="btn btn-gold">
          + Add staff
        </Link>
      </div>

      <dl className="stats">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <dt>{s.label}</dt>
            <dd>
              {s.value}
              {s.of !== null && <small> / {s.of}</small>}
            </dd>
            {s.of !== null && (
              <div className="bar" aria-hidden="true">
                <span style={{ width: pct(s.value, s.of) }} />
              </div>
            )}
          </div>
        ))}
      </dl>

      <div className="admin-grid">
        <section className="card">
          <h2 style={{ fontSize: "1.6rem" }}>Event progress</h2>
          <ol className="timeline">
            <Step n={1} state={o.members.total > 1 ? "done" : "now"} title="Add your team" sub={`${o.members.total} people on the list`} />
            <Step
              n={2}
              state={o.members.active >= 3 ? "done" : o.members.total > 1 ? "now" : "todo"}
              title="Everyone signs in & writes a wishlist"
              sub={`${o.members.active} signed in · ${o.members.withWishes} wishlists`}
            />
            <Step
              n={3}
              state={drawn ? "done" : o.members.active >= 3 ? "now" : "todo"}
              title="Draw names"
              sub={drawn ? `${o.draw.participants} people in the draw` : "Pairs everyone who has signed in"}
            />
            <Step
              n={4}
              state={drawn && o.draw.revealed === o.draw.participants ? "done" : drawn ? "now" : "todo"}
              title="Everyone spins"
              sub={drawn ? `${o.draw.revealed} of ${o.draw.participants} have spun` : "Opens after the draw"}
            />
            <Step n={5} state="todo" title="Gift exchange day" sub={formatDate(ev?.exchangeDate)} />
          </ol>
        </section>

        <aside className="stack">
          <DrawCard o={o} onDone={reload} />
          <ShareCard />
          <section className="card">
            <h2 style={{ fontSize: "1.4rem" }}>Who got whom?</h2>
            <div className="secret-note">
              <LockIcon />
              <span>Hidden from admins too, by design. Pairings are encrypted. You see who has spun, never who they got.</span>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function Step({ n, state, title, sub }: { n: number; state: "done" | "now" | "todo"; title: string; sub: string }) {
  return (
    <li>
      <span className="tl-dot" data-state={state === "todo" ? undefined : state}>
        {state === "done" ? "✓" : n}
      </span>
      <div>
        <div className="tl-title">{title}</div>
        <div className="tl-sub">{sub}</div>
      </div>
      <span className={`pill ${state === "done" ? "pill-green" : state === "now" ? "pill-gold pill-dot" : "pill-grey"}`}>
        {state === "done" ? "Done" : state === "now" ? "Now" : "Later"}
      </span>
    </li>
  );
}

function DrawCard({ o, onDone }: { o: Overview; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!o.event) return null;
  const drawn = o.event.status === "open";
  const locked = drawn && o.draw.revealed > 0;
  const waiting = o.members.total - o.members.active;

  async function draw() {
    const msg = drawn
      ? `Redraw names for ${o.members.active} people? Current pairings will be replaced.`
      : `Draw names for the ${o.members.active} people who have signed in?${waiting ? ` ${waiting} who haven't signed in yet will be left out.` : ""}`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/admin/event/draw", { method: "POST", body: {} });
      onDone();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: "1.4rem" }}>{drawn ? "Names are drawn 🎉" : "Draw names"}</h2>
      <p className="muted" style={{ marginTop: 6, fontSize: "0.95rem" }}>
        {locked
          ? "Someone has already spun, so the draw is locked for fairness."
          : drawn
            ? "Nobody has spun yet, so you can still redraw to include late joiners."
            : o.members.active < 3
              ? "At least 3 people need to sign in first."
              : `${o.members.active} people are ready.${waiting ? ` ${waiting} haven't signed in yet.` : ""}`}
      </p>
      <FormError message={err} />
      {!locked && (
        <button className="btn btn-red btn-sm" style={{ marginTop: 14 }} onClick={draw} disabled={busy || o.members.active < 3}>
          {busy ? "Drawing…" : drawn ? "Redraw names" : "Draw names now"}
        </button>
      )}
    </section>
  );
}

function ShareCard() {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  return (
    <section className="card">
      <h2 style={{ fontSize: "1.4rem" }}>Invite your team</h2>
      <p className="muted" style={{ marginTop: 6, fontSize: "0.95rem" }}>
        Share this link. People you&apos;ve added sign in with Google using that email.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input className="input" readOnly value={link} aria-label="Sign-in link" style={{ flex: 1, minWidth: 0 }} />
        <button
          className="btn btn-ghost-ink btn-sm"
          onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </section>
  );
}
