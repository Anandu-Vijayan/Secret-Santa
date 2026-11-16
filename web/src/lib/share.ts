export type RevealPayload = {
  e: string; // event name
  g: string; // giver
  r: string; // recipient
  b: string; // budget
  d: string; // exchange date (yyyy-mm-dd or "")
};

// Light scrambling so the recipient's name isn't readable at a glance in the
// URL. This is not encryption: anyone determined can decode a link.
const SALT = "ho-ho-ho";

function scramble(bytes: Uint8Array) {
  return bytes.map((b, i) => b ^ SALT.charCodeAt(i % SALT.length));
}

export function encodeReveal(p: RevealPayload): string {
  const bytes = scramble(new TextEncoder().encode(JSON.stringify(p)));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeReveal(token: string): RevealPayload | null {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = scramble(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof p?.g !== "string" || typeof p?.r !== "string") return null;
    return p as RevealPayload;
  } catch {
    return null;
  }
}

export function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long" });
}
