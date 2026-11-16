"use client";

import { useEffect, useState } from "react";

export function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(`${to}T09:00:00`).getTime();
    const tick = () => setLeft(Math.max(0, target - Date.now()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [to]);

  const d = left === null ? "--" : Math.floor(left / 86_400_000);
  const h = left === null ? "--" : Math.floor((left / 3_600_000) % 24);
  const m = left === null ? "--" : Math.floor((left / 60_000) % 60);

  return (
    <div className="countdown" role="timer" aria-label="Time until the gift exchange">
      <div>
        <b>{d}</b>
        <small>days</small>
      </div>
      <div>
        <b>{h}</b>
        <small>hours</small>
      </div>
      <div>
        <b>{m}</b>
        <small>mins</small>
      </div>
    </div>
  );
}
