import { shuffle } from "./crypto.js";

/**
 * Uniformly random single cycle: shuffle everyone (CSPRNG Fisher-Yates), then each
 * person gives to the next one, the last to the first. Each of the (n-1)! cycles is
 * produced by exactly n orderings, so all are equally likely.
 * Guarantees nobody draws themselves and, for 3+ people, no two people draw each other.
 * Returns giverId -> gifteeId.
 */
export function drawCycle(ids: readonly string[]): Map<string, string> {
  if (ids.length < 3) throw new Error("need at least 3 participants");
  if (new Set(ids).size !== ids.length) throw new Error("duplicate participant");
  const order = shuffle(ids);
  const out = new Map<string, string>();
  order.forEach((giver, i) => out.set(giver, order[(i + 1) % order.length]!));
  return out;
}
