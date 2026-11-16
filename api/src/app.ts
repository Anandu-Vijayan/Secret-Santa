import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { csrfGuard, loadAuth } from "./auth.js";
import type { Config } from "./config.js";
import { deriveKeys } from "./lib/crypto.js";
import type { Db } from "./lib/db.js";
import { HttpError } from "./lib/errors.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { meRoutes } from "./routes/me.js";

export async function buildApp(cfg: Config, db: Db) {
  const app = Fastify({
    // The API sits behind exactly one proxy (the web app's /api rewrite).
    trustProxy: (_addr: string, hop: number) => hop < 1,
    bodyLimit: 64 * 1024,
    logger:
      cfg.NODE_ENV === "test"
        ? false
        : {
            level: cfg.NODE_ENV === "production" ? "info" : "debug",
            redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
          },
  });

  const keys = deriveKeys(cfg.ASSIGNMENT_KEY);

  await app.register(helmet, {
    // JSON API: lock everything down; the web app sets its own CSP for pages.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    hsts: cfg.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cookie, { secret: keys.cookie.toString("base64") });
  app.decorateRequest("auth", null);
  app.addHook("onRequest", loadAuth(db, cfg));

  // Offices share one public IP, so signed-in traffic is limited per verified user, not per IP.
  // Runs at preHandler so req.auth is already checked: a made-up cookie counts against the IP.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: (req) => (req.auth ? `u:${req.auth.userId}` : `ip:${req.ip}`),
  });
  app.addHook("preHandler", csrfGuard(cfg));
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "invalid_input",
        message: err.issues[0]?.message ?? "Invalid input.",
        fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) return reply.status(429).send({ error: "rate_limited", message: "Too many requests. Try again in a minute." });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.code ?? "bad_request", message: e.message });
    req.log.error(err);
    if (cfg.NODE_ENV === "test") return reply.status(500).send({ error: "server_error", detail: (err as Error).message });
    return reply.status(500).send({ error: "server_error", message: "Something went wrong." });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: "not_found", message: "Not found." }));

  app.get("/health", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });

  await app.register(authRoutes, { db, cfg });
  await app.register(meRoutes, { db, assignmentKey: keys.assignment });
  await app.register(adminRoutes, { db, assignmentKey: keys.assignment });
  return app;
}
