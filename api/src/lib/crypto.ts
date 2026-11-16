import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomInt } from "node:crypto";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Separate keys for separate jobs, derived from one master key (HKDF). */
export function deriveKeys(masterB64: string) {
  const master = Buffer.from(masterB64, "base64");
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), info, 32));
  return { assignment: derive("secret-santa/assignment/v1"), cookie: derive("secret-santa/cookie/v1") };
}

/**
 * AES-256-GCM. The AAD binds a ciphertext to its row (event + giver), so a DB user
 * can't swap encrypted values between rows to change who gets whom.
 */
export function encrypt(key: Buffer, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), body.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

export function decrypt(key: Buffer, token: string, aad: string): string {
  const [v, iv, body, tag] = token.split(".");
  if (v !== "v1" || !iv || !body || !tag) throw new Error("bad ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

/** Unbiased CSPRNG shuffle. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
