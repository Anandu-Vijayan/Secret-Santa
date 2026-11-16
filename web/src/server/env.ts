import { z } from "zod";

// Server-only configuration for the /api route handlers. Values come from web/.env.local (dev)
// or the host's secret manager (prod). Errors name the field, never the value.
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ORIGIN: z.url(),
    CONVEX_URL: z.url(),
    /** Shared with the Convex deployment (its SERVER_SECRET env var). Lets only this server open sessions. */
    CONVEX_SERVER_SECRET: z.string().min(32),
    /** Signs the short-lived OAuth state cookie. */
    COOKIE_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    DEV_LOGIN: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === "production") {
      if (c.DEV_LOGIN) ctx.addIssue({ code: "custom", message: "DEV_LOGIN must be false in production" });
      if (!c.GOOGLE_CLIENT_ID || !c.GOOGLE_CLIENT_SECRET)
        ctx.addIssue({ code: "custom", message: "Google OAuth credentials are required in production" });
      if (!c.APP_ORIGIN.startsWith("https://")) ctx.addIssue({ code: "custom", message: "APP_ORIGIN must be https in production" });
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({
    ...process.env,
    CONVEX_URL: process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "config"}: ${i.message}`).join("\n");
    throw new Error(`Invalid server configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
