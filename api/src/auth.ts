import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import { newToken, sha256 } from "./lib/crypto.js";
import { tx, type Db } from "./lib/db.js";
import { forbidden, HttpError, unauthorized } from "./lib/errors.js";

const ABSOLUTE_MS = 14 * 24 * 3600 * 1000; // 14 days
const IDLE_MS = 3 * 24 * 3600 * 1000; // 3 days without use
const TOUCH_MS = 5 * 60 * 1000;

export type Membership = { orgId: string; orgName: string; memberId: string; role: "admin" | "staff"; orgStatus: string };

export type Auth = {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  orgs: Membership[];
  /** Selected company membership, if any. */
  member: Membership | null;
};

declare module "fastify" {
  interface FastifyRequest {
    auth: Auth | null;
  }
}

export function cookieName(cfg: Config) {
  // __Host- prefix: Secure, Path=/, no Domain. A subdomain can't plant or overwrite it.
  return cfg.APP_ORIGIN.startsWith("https://") ? "__Host-ss" : "ss";
}

export function cookieOptions(cfg: Config) {
  return {
    httpOnly: true,
    secure: cfg.APP_ORIGIN.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function userOrgs(db: Db, userId: string): Promise<Membership[]> {
  const { rows } = await db.query("SELECT * FROM user_orgs($1)", [userId]);
  return rows.map((r) => ({ orgId: r.org_id, orgName: r.org_name, memberId: r.member_id, role: r.role, orgStatus: r.org_status }));
}

export async function createSession(db: Db, cfg: Config, reply: FastifyReply, userId: string) {
  const token = newToken();
  const orgs = await userOrgs(db, userId);
  const orgId = orgs.length === 1 ? orgs[0]!.orgId : null;
  await db.query("INSERT INTO sessions (token_hash, user_id, org_id, expires_at) VALUES ($1, $2, $3, $4)", [
    sha256(token),
    userId,
    orgId,
    new Date(Date.now() + ABSOLUTE_MS),
  ]);
  reply.setCookie(cookieName(cfg), token, { ...cookieOptions(cfg), maxAge: ABSOLUTE_MS / 1000 });
  return { orgs, orgId };
}

export async function destroySession(db: Db, cfg: Config, req: FastifyRequest, reply: FastifyReply) {
  if (req.auth) await db.query("DELETE FROM sessions WHERE id = $1", [req.auth.sessionId]);
  reply.clearCookie(cookieName(cfg), cookieOptions(cfg));
}

/** onRequest hook: resolve the session cookie into req.auth. */
export function loadAuth(db: Db, cfg: Config) {
  return async (req: FastifyRequest) => {
    req.auth = null;
    const token = req.cookies[cookieName(cfg)];
    if (!token || token.length > 100) return;
    const { rows } = await db.query(
      `SELECT s.id, s.user_id, s.org_id, s.last_seen, s.expires_at, u.email, u.name
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [sha256(token)],
    );
    const s = rows[0];
    if (!s) return;
    const now = Date.now();
    if (new Date(s.expires_at).getTime() < now || new Date(s.last_seen).getTime() + IDLE_MS < now) {
      await db.query("DELETE FROM sessions WHERE id = $1", [s.id]);
      return;
    }
    if (new Date(s.last_seen).getTime() + TOUCH_MS < now) {
      await db.query("UPDATE sessions SET last_seen = now() WHERE id = $1", [s.id]);
    }
    const orgs = await userOrgs(db, s.user_id);
    const member = orgs.find((o) => o.orgId === s.org_id && o.orgStatus === "active") ?? null;
    req.auth = { sessionId: s.id, userId: s.user_id, email: s.email, name: s.name, orgs, member };
  };
}

/**
 * CSRF defence for state-changing requests: the Origin must be our app, and the body
 * must be JSON (a cross-site HTML form can't send application/json without a CORS
 * preflight, which we never approve). SameSite=Lax cookies are the third layer.
 */
export function csrfGuard(cfg: Config) {
  const allowed = new URL(cfg.APP_ORIGIN).origin;
  return async (req: FastifyRequest) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.headers.origin !== allowed) throw new HttpError(403, "bad_origin", "Request blocked.");
    const ct = req.headers["content-type"] ?? "";
    if (req.headers["content-length"] !== "0" && req.body !== undefined && !ct.startsWith("application/json")) {
      throw new HttpError(415, "json_only", "Send JSON.");
    }
  };
}

export function requireUser(req: FastifyRequest): Auth {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requireMember(req: FastifyRequest): Auth & { member: Membership } {
  const a = requireUser(req);
  if (!a.member) throw new HttpError(403, "no_company", "Pick a company first.");
  return a as Auth & { member: Membership };
}

export function requireAdmin(req: FastifyRequest): Auth & { member: Membership } {
  const a = requireMember(req);
  if (a.member.role !== "admin") throw forbidden();
  return a;
}

/** Shared by Google and dev login: upsert the user, link invites, open a session. */
export async function signIn(
  db: Db,
  cfg: Config,
  reply: FastifyReply,
  p: { sub: string; email: string; name: string },
) {
  const userId = await tx(db, async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users (google_sub, email, name, last_login) VALUES ($1, $2, $3, now())
       ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login = now()
       RETURNING id`,
      [p.sub, p.email.toLowerCase(), p.name.slice(0, 60) || p.email],
    );
    const id: string = rows[0].id;
    await c.query("SELECT claim_memberships($1, $2)", [id, p.email.toLowerCase()]);
    return id;
  });
  return { userId, ...(await createSession(db, cfg, reply, userId)) };
}
