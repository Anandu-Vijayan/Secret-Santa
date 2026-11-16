import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { googleConfig, oidc, redirectUri } from "@/server/google";
import { signTx, TX_COOKIE, txCookieOptions } from "@/server/session";

const to = (path: string) => NextResponse.redirect(new URL(path, env().APP_ORIGIN));

// Step 1: send the browser to Google with PKCE + state + nonce.
export async function GET(req: NextRequest) {
  let g;
  try {
    g = await googleConfig();
  } catch (e) {
    // Google's discovery document couldn't be fetched (network, outage). Show the login error, not a raw 500.
    console.warn("google discovery failed:", (e as Error).message);
    return to("/login?error=google_failed");
  }
  if (!g) return to("/login?error=google_not_configured");

  const intent = req.nextUrl.searchParams.get("intent") === "admin" ? "admin" : "staff";
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const url = oidc.buildAuthorizationUrl(g, {
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "select_account",
  });
  const res = NextResponse.redirect(url.href);
  res.cookies.set(TX_COOKIE, signTx({ verifier, state, nonce, intent }), txCookieOptions());
  res.headers.set("Cache-Control", "no-store");
  return res;
}
