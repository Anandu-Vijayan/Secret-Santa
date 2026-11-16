import type { FastifyInstance } from "fastify";
import * as oidc from "openid-client";
import { z } from "zod";
import { destroySession, signIn } from "../auth.js";
import type { Config } from "../config.js";
import { withOrg, type Db } from "../lib/db.js";

const TX_COOKIE = "ss_oauth";

/** Where to send someone after sign-in. First-time staff go to onboarding. */
async function landing(db: Db, intent: string, orgs: { orgId: string; memberId: string; role: string }[], orgId: string | null) {
  if (intent === "admin" && !orgs.some((o) => o.role === "admin")) return "/admin/setup";
  if (orgs.length === 0) return "/login?error=not_invited";
  if (!orgId) return "/choose-company";
  const m = orgs.find((o) => o.orgId === orgId)!;
  // The organiser tab opens the dashboard; "I'm joining" always opens the member pages, even for an admin.
  if (m.role === "admin" && intent === "admin") return "/admin";
  const { rows } = await withOrg(db, orgId, (c) => c.query("SELECT count(*)::int AS n FROM wishes WHERE member_id = $1", [m.memberId]));
  if (rows[0].n === 0) return "/onboarding";
  return "/home"; // the wheel and the wishlist both live on the home page
}

export async function authRoutes(app: FastifyInstance, { db, cfg }: { db: Db; cfg: Config }) {
  const redirectUri = `${cfg.APP_ORIGIN}/api/auth/google/callback`;
  const txCookie = { httpOnly: true, secure: cfg.APP_ORIGIN.startsWith("https://"), sameSite: "lax" as const, path: "/api/auth", signed: true, maxAge: 600 };

  let google: oidc.Configuration | null = null;
  const googleConfig = async () => {
    if (!cfg.GOOGLE_CLIENT_ID) return null;
    google ??= await oidc.discovery(new URL("https://accounts.google.com"), cfg.GOOGLE_CLIENT_ID, cfg.GOOGLE_CLIENT_SECRET);
    return google;
  };

  // Per IP (no session yet). Generous enough for a whole office signing in at once.
  const authLimit = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };

  // Step 1: send the browser to Google with PKCE + state + nonce.
  app.get("/auth/google/start", authLimit, async (req, reply) => {
    const g = await googleConfig();
    if (!g) return reply.redirect("/login?error=google_not_configured");
    const { intent } = z.object({ intent: z.enum(["admin", "staff"]).default("staff") }).parse(req.query);
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    reply.setCookie(TX_COOKIE, JSON.stringify({ verifier, state, nonce, intent }), txCookie);
    const url = oidc.buildAuthorizationUrl(g, {
      redirect_uri: redirectUri,
      scope: "openid email profile",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
      prompt: "select_account",
    });
    return reply.redirect(url.href);
  });

  // Step 2: Google sends the user back. openid-client checks state, PKCE, nonce, issuer,
  // audience, expiry and the ID token signature.
  app.get("/auth/google/callback", authLimit, async (req, reply) => {
    const g = await googleConfig();
    const raw = req.cookies[TX_COOKIE];
    reply.clearCookie(TX_COOKIE, { path: "/api/auth" });
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (!g || !unsigned?.valid || !unsigned.value) return reply.redirect("/login?error=expired");
    const t = z
      .object({ verifier: z.string(), state: z.string(), nonce: z.string(), intent: z.string() })
      .parse(JSON.parse(unsigned.value));

    let claims: oidc.IDToken | undefined;
    try {
      const query = new URL(req.url, "http://x").search;
      const tokens = await oidc.authorizationCodeGrant(g, new URL(`${redirectUri}${query}`), {
        pkceCodeVerifier: t.verifier,
        expectedState: t.state,
        expectedNonce: t.nonce,
        idTokenExpected: true,
      });
      claims = tokens.claims();
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, "google callback rejected");
      return reply.redirect("/login?error=google_failed");
    }
    if (!claims || claims.email_verified !== true || typeof claims.email !== "string") {
      return reply.redirect("/login?error=email_unverified");
    }
    const { orgs, orgId } = await signIn(db, cfg, reply, {
      sub: claims.sub,
      email: claims.email,
      name: typeof claims.name === "string" ? claims.name : claims.email,
    });
    return reply.redirect(await landing(db, t.intent, orgs, orgId));
  });

  // Local development only: sign in as any email without Google. Never registered in production
  // (config validation refuses DEV_LOGIN=true with NODE_ENV=production).
  if (cfg.DEV_LOGIN && cfg.NODE_ENV !== "production") {
    app.log.warn("DEV_LOGIN is enabled: /auth/dev-login accepts any email. Never enable this in production.");
    app.post("/auth/dev-login", authLimit, async (req, reply) => {
      const body = z
        .object({ email: z.email().max(120), name: z.string().trim().min(1).max(60), intent: z.enum(["admin", "staff"]).default("staff") })
        .parse(req.body);
      const { orgs, orgId } = await signIn(db, cfg, reply, { sub: `dev:${body.email.toLowerCase()}`, email: body.email, name: body.name });
      return { next: await landing(db, body.intent, orgs, orgId) };
    });
  }

  app.post("/auth/logout", async (req, reply) => {
    await destroySession(db, cfg, req, reply);
    return { ok: true };
  });
}
