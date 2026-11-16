import { randomBytes } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/lib/db.js";
import { migrate } from "../scripts/migrate.js";

process.loadEnvFile(new URL("../.env", import.meta.url));
const toTestDb = (url: string) => url.replace(/\/secret_santa(\?|$)/, "/secret_santa_test$1");

export const ORIGIN = "http://localhost:3000";
export const ownerUrl = toTestDb(process.env.MIGRATION_DATABASE_URL!);
export const appUrl = toTestDb(process.env.DATABASE_URL!);

export async function setup() {
  await migrate(ownerUrl, process.env.APP_DB_PASSWORD!, () => {});
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("TRUNCATE users, sessions, organizations, members, wishes, events, assignments, audit_log CASCADE");
  await owner.end();

  const cfg = loadConfig({
    NODE_ENV: "test",
    APP_ORIGIN: ORIGIN,
    DATABASE_URL: appUrl,
    ASSIGNMENT_KEY: randomBytes(32).toString("base64"),
    DEV_LOGIN: "true",
  });
  const db = createPool(appUrl);
  const app = await buildApp(cfg, db);
  return { app, db, close: async () => (await app.close(), await db.end()) };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

/** A signed-in browser: keeps its session cookie and sends our Origin. */
export async function login(app: App, email: string, name = email.split("@")[0]!, intent: "admin" | "staff" = "staff") {
  const res = await app.inject({ method: "POST", url: "/auth/dev-login", headers: { origin: ORIGIN }, payload: { email, name, intent } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === "ss")!;
  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { origin: ORIGIN }, cookies: { ss: cookie.value } });
  return { cookie: cookie.value, next: res.json().next as string, call };
}
