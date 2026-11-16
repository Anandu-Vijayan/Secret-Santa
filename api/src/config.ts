import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_ORIGIN: z.url(),
    DATABASE_URL: z.string().min(1),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    ASSIGNMENT_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "ASSIGNMENT_KEY must be 32 bytes, base64-encoded"),
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

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Print only the field names and messages, never the values.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "config"}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
