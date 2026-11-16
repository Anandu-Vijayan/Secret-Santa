// Web Crypto only (the Convex runtime has no node:crypto).
// Same scheme as the old API: AES-256-GCM, key derived with HKDF from ASSIGNMENT_KEY,
// ciphertext bound to its row through the AAD, format "v1.<iv>.<body>.<tag>".

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Accepts base64 and base64url, with or without padding. */
function b64Decode(str: string): Uint8Array {
  const b = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(value: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function assignmentKey(): Promise<CryptoKey> {
  const raw = b64Decode(process.env.ASSIGNMENT_KEY ?? "");
  if (raw.length !== 32) throw new Error("ASSIGNMENT_KEY must be set (Convex env) to 32 bytes, base64-encoded");
  const ikm = await crypto.subtle.importKey("raw", raw as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("secret-santa/assignment/v1") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encrypt(plaintext: string, aad: string): Promise<string> {
  const key = await assignmentKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(aad) as BufferSource, tagLength: 128 },
      key,
      enc.encode(plaintext) as BufferSource,
    ),
  );
  const body = out.slice(0, out.length - 16);
  const tag = out.slice(out.length - 16);
  return ["v1", b64urlEncode(iv), b64urlEncode(body), b64urlEncode(tag)].join(".");
}

export async function decrypt(token: string, aad: string): Promise<string> {
  const [ver, iv, body, tag] = token.split(".");
  if (ver !== "v1" || !iv || !body || !tag) throw new Error("bad ciphertext");
  const key = await assignmentKey();
  const b = b64Decode(body);
  const t = b64Decode(tag);
  const joined = new Uint8Array(b.length + t.length);
  joined.set(b);
  joined.set(t, b.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64Decode(iv) as BufferSource, additionalData: enc.encode(aad) as BufferSource, tagLength: 128 },
    key,
    joined as BufferSource,
  );
  return dec.decode(plain);
}

/** Uniform integer in [0, max) from the CSPRNG (rejection sampling, no modulo bias). */
function randomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % max;
  }
}

/** Unbiased CSPRNG Fisher-Yates shuffle. (Math.random is seeded and predictable in Convex.) */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Uniformly random single cycle: shuffle everyone, each person gives to the next, the last to the
 * first. Nobody draws themselves and, for 3+ people, no two people draw each other.
 * Returns [giverId, gifteeId] pairs.
 */
export function drawCycle(ids: readonly string[]): [string, string][] {
  if (ids.length < 3) throw new Error("need at least 3 participants");
  if (new Set(ids).size !== ids.length) throw new Error("duplicate participant");
  const order = shuffle(ids);
  return order.map((giver, i) => [giver, order[(i + 1) % order.length]!] as [string, string]);
}
