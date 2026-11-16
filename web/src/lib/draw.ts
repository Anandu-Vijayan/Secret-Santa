export type Person = { id: string; name: string };
export type Rule = { a: string; b: string };
export type Draw = Record<string, string>; // giverId -> recipientId

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Random assignment where nobody draws themselves and no "keep apart"
 * pair draws each other (rules are two-way). Returns null when the
 * rules leave no valid assignment.
 */
export function drawNames(people: Person[], rules: Rule[]): Draw | null {
  if (people.length < 3) return null;

  const blocked = new Map<string, Set<string>>();
  for (const p of people) blocked.set(p.id, new Set([p.id]));
  for (const { a, b } of rules) {
    blocked.get(a)?.add(b);
    blocked.get(b)?.add(a);
  }

  // Most constrained givers first keeps backtracking short.
  const givers = shuffle(people).sort((x, y) => blocked.get(y.id)!.size - blocked.get(x.id)!.size);
  const taken = new Set<string>();
  const result: Draw = {};
  let steps = 0;

  const place = (i: number): boolean => {
    if (i === givers.length) return true;
    if (++steps > 200_000) return false;
    const giver = givers[i];
    for (const r of shuffle(people)) {
      if (taken.has(r.id) || blocked.get(giver.id)!.has(r.id)) continue;
      taken.add(r.id);
      result[giver.id] = r.id;
      if (place(i + 1)) return true;
      taken.delete(r.id);
      delete result[giver.id];
    }
    return false;
  };

  return place(0) ? result : null;
}
