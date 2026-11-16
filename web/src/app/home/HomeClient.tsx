"use client";

import Link from "next/link";
import { Countdown } from "@/components/Countdown";
import { Loading } from "@/components/States";
import { LockIcon, TopBar } from "@/components/ui";
import { useApi, type Me, type Reveal, type Wish } from "@/lib/api";
import { firstName, formatDate } from "@/lib/format";
import { SpinPanel } from "./SpinPanel";

export function HomeClient() {
  const { data: me } = useApi<Me>("/me");
  const revealed = !!me?.event?.revealed;
  const { data: wishes } = useApi<{ wishes: Wish[] }>(me?.current ? "/me/wishes" : null);
  const { data: result } = useApi<({ revealed: true } & Reveal) | { revealed: false }>(revealed ? "/me/assignment" : null);

  if (!me?.current) return <Loading />;
  const cur = me.current;
  const ev = me.event;

  return (
    <>
      <TopBar
        user={me.user.name}
        nav={[
          { href: "/home", label: "Home", current: true },
          { href: "/wishlist", label: "My wishlist", hideSm: true },
          ...(cur.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
        ]}
      />
      <section className="greet">
        <span className="kicker">{cur.orgName}</span>
        <h1>Merry Christmas, {firstName(cur.name)}!</h1>
        <p>Here&apos;s everything for this year&apos;s exchange.</p>
      </section>

      <div className="home-grid">
        <div className="card event-card">
          <span className="kicker">🎄 This year&apos;s exchange</span>
          {!ev ? (
            <p className="muted" style={{ marginTop: 10 }}>
              No event yet. Your organiser will set one up.
            </p>
          ) : (
            <>
              <h2>{ev.name}</h2>
              <dl className="facts">
                <div className="fact">
                  <dt>Budget</dt>
                  <dd>{ev.budget || "Not set"}</dd>
                </div>
                <div className="fact">
                  <dt>Exchange day</dt>
                  <dd>{formatDate(ev.exchangeDate)}</dd>
                </div>
                <div className="fact">
                  <dt>Your status</dt>
                  <dd>{ev.revealed ? "Spun ✓" : ev.participant ? "Ready to spin" : "Waiting"}</dd>
                </div>
              </dl>
              <SpinArea me={me} result={result && result.revealed ? result : null} />
            </>
          )}
        </div>

        <div className="stack">
          {ev?.exchangeDate && (
            <div className="card card-dark">
              <span className="kicker">Gift exchange in</span>
              <div style={{ marginTop: 14 }}>
                <Countdown to={ev.exchangeDate} />
              </div>
            </div>
          )}

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h2 style={{ fontSize: "1.5rem" }}>My wishlist</h2>
              <Link href="/wishlist" className="btn btn-ghost-ink btn-sm">
                Edit
              </Link>
            </div>
            {!wishes ? null : wishes.wishes.length === 0 ? (
              <p className="wish-empty" style={{ marginTop: 14 }}>
                Empty so far. <Link href="/wishlist">Add a few ideas</Link> so your Santa isn&apos;t guessing.
              </p>
            ) : (
              <ul className="wish-list" style={{ marginTop: 14 }}>
                {wishes.wishes.map((w, i) => (
                  <li key={w.id ?? i} className="wish" style={{ gridTemplateColumns: "minmax(0,1fr)", padding: "10px 14px" }}>
                    <div>
                      <div className="wish-title">{w.title}</div>
                      {(w.price || w.note) && <div className="wish-meta">{[w.price && `~${w.price}`, w.note].filter(Boolean).join(" · ")}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="secret-note" style={{ marginTop: 14 }}>
              <LockIcon />
              Your Santa sees this list. Nobody sees who your Santa is.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function SpinArea({ me, result }: { me: Me; result: Reveal | null }) {
  const ev = me.event!;
  // Already spun: wait for the saved result so the wheel mounts in its resting state, never ready to spin again.
  if (ev.revealed && !result) return <Loading />;
  return <SpinPanel me={me} initial={result} />;
}
