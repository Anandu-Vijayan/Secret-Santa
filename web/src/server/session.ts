import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "./env";

const ABSOLUTE_S = 14 * 24 * 3600;

export const convexClient = () => new ConvexHttpClient(env().CONVEX_URL, { logger: false });

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");

const isHttps = () => env().APP_ORIGIN.startsWith("https://");

/** __Host- prefix: Secure, Path=/, no Domain. A subdomain can't plant or overwrite it. */
export const cookieName = () => (isHttps() ? "__Host-ss" : "ss");

const base = () => ({ httpOnly: true, secure: isHttps(), sameSite: "lax" as const });

export function setSession(res: NextResponse, token: string) {
  res.cookies.set(cookieName(), token, { ...base(), path: "/", maxAge: ABSOLUTE_S });
}
export function clearSession(res: NextResponse) {
  res.cookies.set(cookieName(), "", { ...base(), path: "/", maxAge: 0 });
}
export const sessionToken = (req: NextRequest) => {
  const t = req.cookies.get(cookieName())?.value ?? "";
  return t.length > 100 ? "" : t;
};

// ---- signed, short-lived OAuth transaction cookie (PKCE verifier + state + nonce) ----
export const TX_COOKIE = "ss_oauth";
export const TX_PATH = "/api/auth";
const mac = (payload: string) => createHmac("sha256", env().COOKIE_SECRET).update(payload).digest("base64url");

const TX_MAX_AGE_MS = 10 * 60 * 1000;

export function signTx(value: object): string {
  // The timestamp is inside the signed payload, so an old captured cookie can't be replayed after it expires.
  const payload = Buffer.from(JSON.stringify({ ...value, iat: Date.now() })).toString("base64url");
  return `${payload}.${mac(payload)}`;
}
export function verifyTx<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(mac(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, "base64url").toString()) as T & { iat?: unknown };
    if (typeof v.iat !== "number" || Date.now() - v.iat > TX_MAX_AGE_MS || v.iat > Date.now() + 60_000) return null;
    return v;
  } catch {
    return null;
  }
}
export const txCookieOptions = () => ({ ...base(), path: TX_PATH, maxAge: 600 });
export const clearTx = (res: NextResponse) => res.cookies.set(TX_COOKIE, "", { ...base(), path: TX_PATH, maxAge: 0 });

// ---- CSRF + error mapping ----
/**
 * State-changing requests must come from our own origin and carry JSON (a cross-site HTML form can't
 * send application/json without a CORS preflight, which we never approve). SameSite=Lax is the 3rd layer.
 */
export function csrfBlock(req: NextRequest): NextResponse | null {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return null;
  if (req.headers.get("origin") !== new URL(env().APP_ORIGIN).origin) return json(403, "bad_origin", "Request blocked.");
  const ct = req.headers.get("content-type") ?? "";
  if (req.headers.get("content-length") !== "0" && req.headers.has("content-length") && !ct.startsWith("application/json")) {
    return json(415, "json_only", "Send JSON.");
  }
  return null;
}

export const json = (status: number, error: string, message: string) =>
  NextResponse.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });

export const ok = (data: unknown) => NextResponse.json(data ?? {}, { headers: { "Cache-Control": "no-store" } });

/** Convex errors carry { status, code, message } (see convex/lib/common.ts). Anything else is a 500. */
export function toResponse(e: unknown): NextResponse {
  if (e instanceof ConvexError && e.data && typeof e.data === "object") {
    const d = e.data as { status?: number; code?: string; message?: string };
    return json(d.status ?? 400, d.code ?? "error", d.message ?? "Something went wrong.");
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/ArgumentValidationError|Validator error|Object contains extra field/i.test(msg)) return json(400, "invalid_input", "Invalid input.");
  console.error("api error:", msg);
  return json(500, "server_error", "Something went wrong.");
}
