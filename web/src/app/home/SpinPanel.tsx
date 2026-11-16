"use client";

import { useRef, useState } from "react";
import { ErrorNote } from "@/components/States";
import { LockIcon } from "@/components/ui";
import { restingAngle, spinTo, Wheel } from "@/components/Wheel";
import { api, ApiError, type Me, type Reveal, type Wish } from "@/lib/api";

type Phase = "ready" | "spinning" | "done";
const PLACEHOLDER = Array.from({ length: 10 }, () => "🎁 ?");

/** The wheel, the one-time spin and the giftee reveal. Lives on the staff home page. */
export function SpinPanel({ me, initial }: { me: Me; initial: Reveal | null }) {
  const [phase, setPhase] = useState<Phase>(initial ? "done" : "ready");
  const [result, setResult] = useState<Reveal | null>(initial);
  const [rotation, setRotation] = useState(initial ? restingAngle(initial.wheel.targetIndex, initial.wheel.names.length) : 0);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const fallback = useRef<number | undefined>(undefined);

  const ev = me.event;
  const canSpin = !!ev && ev.status === "open" && ev.participant;

  function settle() {
    window.clearTimeout(fallback.current);
    setPhase((p) => (p === "spinning" ? "done" : p));
  }

  async function spin() {
    if (phase !== "ready" || !canSpin) return;
    setPhase("spinning");
    setError(null);
    try {
      // The server already drew the pairing; this call reveals it. The wheel just animates to it.
      const r = await api<Reveal>("/me/spin", { method: "POST", body: {} });
      setResult(r);
      setFresh(true);
      setRotation((from) => spinTo(from, r.wheel.targetIndex, r.wheel.names.length));
      fallback.current = window.setTimeout(settle, 6800);
    } catch (e) {
      if ((e as ApiError).code === "already_spun") {
        // Spun already (another tab, or a lost response): show the saved result, no second animation.
        try {
          const saved = await api<({ revealed: true } & Reveal) | { revealed: false }>("/me/assignment");
          if (saved.revealed) {
            setResult(saved);
            setRotation(restingAngle(saved.wheel.targetIndex, saved.wheel.names.length));
            setPhase("done");
            return;
          }
        } catch {
          /* fall through to the error note */
        }
      }
      setError((e as ApiError).message);
      setPhase("ready");
    }
  }

  const names = result?.wheel.names ?? PLACEHOLDER;

  return (
    <div className="spin-page compact">
      {phase === "done" ? (
        <h2>Ho ho ho, you got…</h2>
      ) : (
        <>
          <h2>Spin to find your giftee</h2>
          <p>You get one spin, and it counts. Nobody else will see the result, not even your admin.</p>
        </>
      )}

      <Wheel
        names={names}
        rotation={rotation}
        animate={phase === "spinning"}
        onSettled={settle}
        hub={
          <button className="hub" onClick={spin} disabled={phase !== "ready" || !canSpin} aria-label="Spin the wheel">
            {phase === "ready" ? "SPIN" : phase === "spinning" ? "…" : "🎁"}
          </button>
        }
      />

      <ErrorNote error={error} />

      {phase === "ready" &&
        (canSpin ? (
          <button className="btn btn-gold btn-big" onClick={spin}>
            Spin the wheel
          </button>
        ) : (
          <p className="lock-note">
            <LockIcon />
            {ev?.status === "draft"
              ? "The wheel unlocks once your organiser runs the draw. Meanwhile, fill in your wishlist."
              : "You joined after the names were drawn. Ask your organiser to redraw (possible until someone spins)."}
          </p>
        ))}
      {phase === "spinning" && (
        <p className="muted" aria-live="polite">
          Spinning…
        </p>
      )}

      {phase === "done" && result && (
        <>
          {fresh && <Confetti />}
          <section className="result" aria-live="polite">
            <div className="card">
              <span className="kicker">You are Secret Santa for</span>
              <p className="result-name">{result.giftee.name}</p>
              <p className="muted">{[result.giftee.department, ev?.budget && `Budget ${ev.budget}`].filter(Boolean).join(" · ")}</p>
              <h3 style={{ fontSize: "1.3rem", marginTop: 22, textAlign: "left" }}>Their wishlist</h3>
              <WishPreview wishes={result.giftee.wishes} />
            </div>
          </section>
          <span className="lock-note">
            <LockIcon />
            Locked in. Only you can see this.
          </span>
        </>
      )}
    </div>
  );
}

function WishPreview({ wishes }: { wishes: Wish[] }) {
  if (!wishes.length) return <p className="wish-empty">No wishes yet. Check back later, or go with a surprise!</p>;
  return (
    <ul className="wish-list">
      {wishes.map((w, i) => (
        <li key={w.id ?? i} className="wish" style={{ gridTemplateColumns: "40px minmax(0,1fr)" }}>
          <span className="wish-ic" aria-hidden="true">
            🎁
          </span>
          <div>
            <div className="wish-title">{w.title}</div>
            <div className="wish-meta">
              {w.price && <span>~{w.price}</span>}
              {w.note && <span>{w.note}</span>}
              {w.link?.startsWith("https://") && (
                <a href={w.link} target="_blank" rel="noopener noreferrer nofollow">
                  View link
                </a>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Confetti() {
  const colors = ["#f0be4b", "#fffbf4", "#1f5141", "#c8283f"];
  const bits = Array.from({ length: 70 }, (_, i) => ({
    left: `${(i * 37) % 100}%`,
    ["--c" as string]: colors[i % colors.length],
    ["--d" as string]: `${2.2 + ((i * 13) % 20) / 10}s`,
    ["--delay" as string]: `${((i * 7) % 10) / 20}s`,
    ["--x" as string]: `${((i * 53) % 160) - 80}px`,
    ["--r" as string]: `${(i * 97) % 720}deg`,
  }));
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((s, i) => (
        <i key={i} style={s} />
      ))}
    </div>
  );
}
