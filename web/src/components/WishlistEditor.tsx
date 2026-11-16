"use client";

import { useState, type FormEvent } from "react";
import type { Wish } from "@/lib/api";

const MAX = 5;
const ICONS = ["🎁", "🧸", "📚", "🎧", "🕯️"];

export function WishlistEditor({ wishes, onChange, budget }: { wishes: Wish[]; onChange: (w: Wish[]) => void; budget: string }) {

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return setError("Give the gift a name.");
    if (link && !/^https:\/\//i.test(link.trim())) return setError("Links must start with https://");
    onChange([
      ...wishes,
      { id: `new-${Date.now()}`, title: t.slice(0, 80), price: price.trim() || null, link: link.trim() || null, note: note.trim() || null },
    ]);
    setTitle("");
    setPrice("");
    setLink("");
    setNote("");
    setError("");
  }

  return (
    <div>
      {wishes.length === 0 ? (
        <p className="wish-empty">Nothing here yet. Add the first gift you&apos;d love.</p>
      ) : (
        <ul className="wish-list">
          {wishes.map((w, i) => (
            <li key={w.id ?? i} className="wish">
              <span className="wish-ic" aria-hidden="true">
                {ICONS[i % ICONS.length]}
              </span>
              <div>
                <div className="wish-title">{w.title}</div>
                <div className="wish-meta">
                  {w.price && <span>~{w.price}</span>}
                  {w.note && <span>{w.note}</span>}
                  {w.link && (
                    <a href={w.link} target="_blank" rel="noopener noreferrer nofollow">
                      Link
                    </a>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${w.title}`}
                onClick={() => onChange(wishes.filter((x) => x !== w))}
              >
                <svg viewBox="0 0 12 12">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {wishes.length < MAX ? (
        <form className="wish-add" onSubmit={add} noValidate>
          <div className="wish-add-row">
            <label className="lbl">
              Gift
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cosy socks" maxLength={80} />
            </label>
            <label className="lbl">
              Approx. price
              <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={budget} maxLength={20} />
            </label>
          </div>
          <label className="lbl">
            <span>
              Link <span className="hint">(optional)</span>
            </span>
            <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" maxLength={500} />
          </label>
          <label className="lbl">
            <span>
              Note for your Santa <span className="hint">(size, colour, brand…)</span>
            </span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Size M, anything green" maxLength={120} />
          </label>
          {error && (
            <p role="alert" style={{ color: "var(--cranberry)", fontWeight: 600, fontSize: "0.9rem" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span className="wish-count">
              {wishes.length} of {MAX} · Budget {budget}
            </span>
            <button className="btn btn-red btn-sm" type="submit">
              + Add to wishlist
            </button>
          </div>
        </form>
      ) : (
        <p className="wish-count" style={{ marginTop: 14 }}>
          That&apos;s {MAX}, the maximum. Remove one to add another.
        </p>
      )}
    </div>
  );
}
