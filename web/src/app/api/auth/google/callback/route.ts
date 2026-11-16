import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/server/api";
import { env } from "@/server/env";
import { googleConfig, oidc, redirectUri } from "@/server/google";
import { clearTx, convexClient, newToken, setSession, sha256Hex, TX_COOKIE, verifyTx } from "@/server/session";

const to = (path: string) => {
  const res = NextResponse.redirect(new URL(path, env().APP_ORIGIN));
  res.headers.set("Cache-Control", "no-store");
  clearTx(res);
  return res;
};

// Step 2: Google sends the user back. openid-client checks state, PKCE, nonce, issuer,
// audience, expiry and the ID token signature.
export async function GET(req: NextRequest) {
  let g: oidc.Configuration | null = null;
  try {
    g = await googleConfig();
  } catch (e) {
    console.warn("google discovery failed:", (e as Error).message);
    return to("/login?error=google_failed");
  }
  const t = verifyTx<{ verifier: string; state: string; nonce: string; intent: "admin" | "staff" }>(req.cookies.get(TX_COOKIE)?.value);
  if (!g || !t) return to("/login?error=expired");

  let claims: oidc.IDToken | undefined;
  try {
    const tokens = await oidc.authorizationCodeGrant(g, new URL(`${redirectUri()}${req.nextUrl.search}`), {
      pkceCodeVerifier: t.verifier,
      expectedState: t.state,
      expectedNonce: t.nonce,
      idTokenExpected: true,
    });
    claims = tokens.claims();
  } catch (e) {
    console.warn("google callback rejected:", (e as Error).message);
    return to("/login?error=google_failed");
  }
  if (!claims || claims.email_verified !== true || typeof claims.email !== "string") return to("/login?error=email_unverified");

  const token = newToken();
  try {
    const { next } = await convexClient().mutation(api.auth.signIn, {
      secret: env().CONVEX_SERVER_SECRET,
      sub: claims.sub,
      email: claims.email,
      name: typeof claims.name === "string" ? claims.name : claims.email,
      tokenHash: sha256Hex(token),
      intent: t.intent === "admin" ? "admin" : "staff",
    });
    const res = to(next);
    setSession(res, token);
    return res;
  } catch (e) {
    console.error("sign-in failed:", (e as Error).message);
    return to("/login?error=google_failed");
  }
}
