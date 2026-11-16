"use client";

import { useSyncExternalStore } from "react";
import { decodeReveal } from "@/lib/share";
import { GiftReveal } from "./GiftReveal";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function RevealFromLink() {
  // null on the server, the hash string in the browser
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => null,
  );

  if (hash === null) return <div className="stage-page" />;

  const payload = hash ? decodeReveal(hash) : null;

  if (!payload) {
    return (
      <main className="stage-page">
        <div className="stage stage-empty">
          <h1 className="stage-name">This link is incomplete</h1>
          <p className="stage-note">
            Part of the link may have been cut off when it was copied. Ask your organizer to send it again.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="stage-page">
      <GiftReveal
        giver={payload.g}
        recipient={payload.r}
        budget={payload.b}
        date={payload.d}
        eventName={payload.e}
        skipConfirm
      />
    </main>
  );
}
