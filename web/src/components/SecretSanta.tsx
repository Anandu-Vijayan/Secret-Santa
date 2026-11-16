"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { drawNames } from "@/lib/draw";
import { encodeReveal } from "@/lib/share";
import { newId, setState, useStore } from "@/lib/store";
import { GiftReveal } from "./GiftReveal";

export function SecretSanta() {
  const s = useStore();
  const byId = useMemo(() => new Map(s.people.map((p) => [p.id, p])), [s.people]);

  return (
    <main className="shell">
      <EventHeader />
      {s.draw ? <Board byId={byId} /> : <Setup byId={byId} />}
      <footer className="foot">Everything is saved in this browser only. Nothing is sent anywhere.</footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function EventHeader() {
  const s = useStore();
  return (
    <header className="event">
      <label className="sr-only" htmlFor="event-name">
        Event name
      </label>
      <input
        id="event-name"
        className="event-title"
        value={s.eventName}
        onChange={(e) => setState({ eventName: e.target.value })}
        placeholder="Name your exchange"
        spellCheck={false}
      />
      <div className="event-details">
        <label className="detail">
          <span>Budget</span>
          <input
            value={s.budget}
            onChange={(e) => setState({ budget: e.target.value })}
            placeholder="₹1,000"
            inputMode="text"
          />
        </label>
        <label className="detail">
          <span>Exchange day</span>
          <input type="date" value={s.date} onChange={(e) => setState({ date: e.target.value })} />
        </label>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

function Setup({ byId }: { byId: Map<string, { id: string; name: string }> }) {
  const s = useStore();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [drawError, setDrawError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);

  const addPerson = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return;
    const existing = s.people.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (existing) {
      setNameError(`${existing.name} is already in the group.`);
      return;
    }
    setState({ people: [...s.people, { id: newId(), name: clean }] });
    setName("");
    setNameError("");
    setDrawError("");
    nameInput.current?.focus();
  };

  const removePerson = (id: string) => {
    setState({
      people: s.people.filter((p) => p.id !== id),
      rules: s.rules.filter((r) => r.a !== id && r.b !== id),
    });
    setDrawError("");
  };

  const addRule = (e: FormEvent) => {
    e.preventDefault();
    if (!a || !b || a === b) return;
    const exists = s.rules.some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    if (!exists) setState({ rules: [...s.rules, { a, b }] });
    setA("");
    setB("");
    setDrawError("");
  };

  const runDraw = () => {
    const result = drawNames(s.people, s.rules);
    if (!result) {
      setDrawError("These rules leave no valid draw. Remove a rule or add more people.");
      return;
    }
    setDrawError("");
    setState({ draw: result, opened: [] });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const enough = s.people.length >= 3;

  return (
    <ol className="steps">
      <li className="step">
        <div className="step-head">
          <h2>Who&rsquo;s in</h2>
          <p>
            {s.people.length === 0
              ? "Add everyone taking part, including yourself."
              : `${s.people.length} ${s.people.length === 1 ? "person" : "people"} so far.`}
          </p>
        </div>

        <form className="add-row" onSubmit={addPerson}>
          <label className="sr-only" htmlFor="person-name">
            Name
          </label>
          <input
            id="person-name"
            ref={nameInput}
            className="field"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError("");
            }}
            placeholder="Type a name"
            autoComplete="off"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "name-error" : undefined}
          />
          <button className="btn btn-paper" type="submit" disabled={!name.trim()}>
            Add
          </button>
        </form>
        {nameError && (
          <p className="error" id="name-error" role="alert">
            {nameError}
          </p>
        )}

        {s.people.length > 0 && (
          <ul className="tags" aria-label="People in the exchange">
            {s.people.map((p, i) => (
              <li key={p.id} className="tag" style={{ ["--tilt" as string]: `${tilt(i)}deg` }}>
                <span className="tag-name">{p.name}</span>
                <button className="tag-x" onClick={() => removePerson(p.id)} aria-label={`Remove ${p.name}`}>
                  <svg viewBox="0 0 12 12" aria-hidden>
                    <path d="M2 2l8 8M10 2l-8 8" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>

      <li className="step">
        <div className="step-head">
          <h2>Keep apart</h2>
          <p>Optional. Stop partners or housemates from drawing each other.</p>
        </div>

        {s.people.length < 2 ? (
          <p className="muted">Add at least two people to set a rule.</p>
        ) : (
          <form className="rule-row" onSubmit={addRule}>
            <label className="sr-only" htmlFor="rule-a">
              First person
            </label>
            <select id="rule-a" className="field" value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">Choose someone</option>
              {s.people.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === b}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="rule-and">and</span>
            <label className="sr-only" htmlFor="rule-b">
              Second person
            </label>
            <select id="rule-b" className="field" value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">Choose someone</option>
              {s.people.map((p) => (
                <option key={p.id} value={p.id} disabled={p.id === a}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn btn-paper" type="submit" disabled={!a || !b || a === b}>
              Keep apart
            </button>
          </form>
        )}

        {s.rules.length > 0 && (
          <ul className="rules">
            {s.rules.map((r) => (
              <li key={`${r.a}-${r.b}`}>
                <span>
                  <strong>{byId.get(r.a)?.name}</strong> and <strong>{byId.get(r.b)?.name}</strong>{" "}
                  won&rsquo;t draw each other
                </span>
                <button
                  className="link-btn"
                  onClick={() => setState({ rules: s.rules.filter((x) => x !== r) })}
                  aria-label={`Remove rule for ${byId.get(r.a)?.name} and ${byId.get(r.b)?.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>

      <li className="step step-draw">
        <div className="step-head">
          <h2>Draw names</h2>
          <p>
            {enough
              ? "Everyone gets one person to buy for. Nobody draws themselves."
              : `Add at least 3 people to draw names. ${3 - s.people.length} more to go.`}
          </p>
        </div>
        <button className="btn btn-gold btn-big" onClick={runDraw} disabled={!enough}>
          Draw names
        </button>
        {drawError && (
          <p className="error" role="alert">
            {drawError}
          </p>
        )}
      </li>
    </ol>
  );
}

/* ------------------------------------------------------------------ */

function Board({ byId }: { byId: Map<string, { id: string; name: string }> }) {
  const s = useStore();
  const [active, setActive] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const draw = s.draw!;
  const opened = new Set(s.opened);

  const linkFor = (giverId: string) => {
    const token = encodeReveal({
      e: s.eventName,
      g: byId.get(giverId)?.name ?? "",
      r: byId.get(draw[giverId])?.name ?? "",
      b: s.budget,
      d: s.date,
    });
    return `${window.location.origin}/reveal#${token}`;
  };

  const copyLink = async (giverId: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(giverId));
      setCopied(giverId);
      window.setTimeout(() => setCopied((c) => (c === giverId ? null : c)), 2200);
    } catch {
      window.prompt("Copy this private link:", linkFor(giverId));
    }
  };

  const finish = () => {
    if (active && !opened.has(active)) setState({ opened: [...s.opened, active] });
    setActive(null);
  };

  return (
    <section className="board" aria-labelledby="board-title">
      <div className="board-head">
        <div>
          <h2 id="board-title">Names are drawn</h2>
          <p>
            Pass the phone around. Each person taps their own tag, unwraps it, then hides it before handing
            the phone on.
          </p>
        </div>
        <p className="progress" aria-live="polite">
          <span className="progress-num">{opened.size}</span>
          <span>of {s.people.length} have looked</span>
        </p>
      </div>

      <ul className="tags tags-board">
        {s.people.map((p, i) => {
          const seen = opened.has(p.id);
          return (
            <li key={p.id} className="board-item" style={{ ["--tilt" as string]: `${tilt(i)}deg` }}>
              <button className={`tag tag-lg ${seen ? "is-seen" : ""}`} onClick={() => setActive(p.id)}>
                <span className="tag-name">{p.name}</span>
                <span className="tag-status">{seen ? "Opened" : "Tap to open"}</span>
              </button>
              <button className="link-btn link-btn-light" onClick={() => copyLink(p.id)}>
                {copied === p.id ? "Link copied" : "Copy private link"}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="board-note">
        Private links let someone check from their own phone. Send each link only to its owner, and
        don&rsquo;t open them yourself: they show the match.
      </p>

      <div className="board-actions">
        <ConfirmButton
          label="Draw again"
          confirmLabel="Everyone gets a new match. Draw again?"
          onConfirm={() => {
            const result = drawNames(s.people, s.rules);
            if (result) setState({ draw: result, opened: [] });
          }}
        />
        <ConfirmButton
          label="Edit the group"
          confirmLabel="This clears the draw. Edit the group?"
          onConfirm={() => setState({ draw: null, opened: [] })}
        />
      </div>

      {active && (
        <Modal onClose={() => setActive(null)} label={`Gift for ${byId.get(active)?.name}`}>
          <GiftReveal
            key={active}
            giver={byId.get(active)?.name ?? ""}
            recipient={byId.get(draw[active])?.name ?? ""}
            budget={s.budget}
            date={s.date}
            eventName={s.eventName}
            onDone={finish}
          />
        </Modal>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Modal({
  children,
  onClose,
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-label={label}>
      <button className="backdrop-close" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 12 12" aria-hidden>
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
      {children}
    </div>
  );
}

function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <button
      className={`btn ${armed ? "btn-warn" : "btn-quiet"}`}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

// Small, stable rotation per tag so the row looks hand-hung, not gridded.
function tilt(i: number) {
  return [-2.5, 1.5, -1, 2.5, -1.8, 0.8, 2, -2.2][i % 8];
}
