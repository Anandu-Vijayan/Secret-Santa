"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/share";

type Props = {
  giver: string;
  recipient: string;
  budget: string;
  date: string;
  eventName: string;
  /** Called when the person hides their result. Omit on the private-link page. */
  onDone?: () => void;
  /** Skip the "is this you?" step (private links are already personal). */
  skipConfirm?: boolean;
};

type Stage = "confirm" | "wrapped" | "open";

export function GiftReveal({ giver, recipient, budget, date, eventName, onDone, skipConfirm }: Props) {
  const [stage, setStage] = useState<Stage>(skipConfirm ? "wrapped" : "confirm");
  const primary = useRef<HTMLButtonElement>(null);
  const when = formatDate(date);

  useEffect(() => {
    primary.current?.focus();
  }, [stage]);

  return (
    <div className="stage" data-stage={stage}>
      {stage === "confirm" && (
        <div className="stage-confirm">
          <p className="stage-kicker">This one is for</p>
          <h2 className="stage-name">{giver}</h2>
          <p className="stage-note">If you&rsquo;re not {giver}, close this and hand the phone back.</p>
          <div className="stage-actions">
            <button ref={primary} className="btn btn-gold" onClick={() => setStage("wrapped")}>
              I&rsquo;m {giver}
            </button>
            {onDone && (
              <button className="btn btn-quiet" onClick={onDone}>
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {stage !== "confirm" && (
        <>
          <div className="gift-area">
            <button
              ref={stage === "wrapped" ? primary : undefined}
              className="gift"
              onClick={() => setStage("open")}
              disabled={stage === "open"}
              aria-label="Unwrap your gift"
            >
              <span className="gift-box" />
              <span className="gift-ribbon-v" />
              <span className="gift-lid">
                <span className="gift-ribbon-lid" />
              </span>
              <span className="gift-bow" aria-hidden>
                <span />
                <span />
              </span>
            </button>

            <div className="reveal" aria-live="polite">
              {stage === "open" && (
                <div className="reveal-tag">
                  <div className="reveal-card">
                    <p className="reveal-kicker">{giver}, you&rsquo;re buying for</p>
                    <p className="reveal-name">{recipient}</p>
                    <dl className="reveal-meta">
                      {budget && (
                        <div>
                          <dt>Budget</dt>
                          <dd>{budget}</dd>
                        </div>
                      )}
                      {when && (
                        <div>
                          <dt>Exchange</dt>
                          <dd>{when}</dd>
                        </div>
                      )}
                    </dl>
                    <p className="reveal-event">{eventName}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {stage === "wrapped" && <p className="stage-hint">Tap the gift to unwrap it, {giver}.</p>}

          {stage === "open" && (
            <div className="stage-actions stage-actions-after">
              {onDone ? (
                <button ref={primary} className="btn btn-gold" onClick={onDone}>
                  Hide it and pass the phone
                </button>
              ) : (
                <p className="stage-note">Keep it to yourself until the exchange.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
