// One-time setup of the secrets this app needs. Run it yourself:   node scripts/setup-secrets.mjs
//
// It generates random values locally and puts them where they belong, WITHOUT printing them:
//   - Convex deployment env:  SERVER_SECRET, ASSIGNMENT_KEY   (via `npx convex env set`)
//   - web/.env.local:         CONVEX_SERVER_SECRET (same value as SERVER_SECRET), COOKIE_SECRET, APP_ORIGIN, DEV_LOGIN
// Existing values are never overwritten. Run `npx convex dev` once first so the deployment exists.
//
// You still add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to web/.env.local yourself.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(import.meta.dirname, "..", ".env.local");
const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const has = (k) => new RegExp(`^${k}=.+`, "m").test(text);
const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
const b64 = (n) => randomBytes(n).toString("base64");

const convex = (...args) =>
  spawnSync("npx", ["convex", ...args], { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", shell: true });

// Convex env vars: only set when missing.
const existing = convex("env", "list");
if (existing.status !== 0) {
  console.error("Could not read the Convex deployment. Run `npx convex dev` first (log in / create the project), then re-run this.");
  process.exit(1);
}
const convexHas = (k) => new RegExp(`^${k}=`, "m").test(existing.stdout);

// SERVER_SECRET must equal CONVEX_SERVER_SECRET in .env.local.
let serverSecret = get("CONVEX_SERVER_SECRET");
const additions = [];
if (!serverSecret) {
  serverSecret = b64(32);
  additions.push(`CONVEX_SERVER_SECRET=${serverSecret}`);
}
if (!convexHas("SERVER_SECRET")) {
  const r = convex("env", "set", "SERVER_SECRET", serverSecret);
  if (r.status !== 0) throw new Error("convex env set SERVER_SECRET failed:\n" + r.stderr);
  console.log("Convex: SERVER_SECRET set");
} else if (additions.length) {
  console.error(
    "Convex already has a SERVER_SECRET but web/.env.local has no CONVEX_SERVER_SECRET.\nCopy the existing value across, or run `npx convex env remove SERVER_SECRET` and re-run this script.",
  );
  process.exit(1);
}
if (!convexHas("ASSIGNMENT_KEY")) {
  const r = convex("env", "set", "ASSIGNMENT_KEY", b64(32));
  if (r.status !== 0) throw new Error("convex env set ASSIGNMENT_KEY failed:\n" + r.stderr);
  console.log("Convex: ASSIGNMENT_KEY set (losing it makes existing pairings unreadable: keep a copy in your secret manager)");
}

if (!has("COOKIE_SECRET")) additions.push(`COOKIE_SECRET=${b64(32)}`);
if (!has("APP_ORIGIN")) additions.push("APP_ORIGIN=http://localhost:3000");
if (!has("DEV_LOGIN")) additions.push("DEV_LOGIN=true");
if (!has("NEXT_PUBLIC_DEV_LOGIN")) additions.push("NEXT_PUBLIC_DEV_LOGIN=true");

if (additions.length) {
  writeFileSync(envFile, text + (text && !text.endsWith("\n") ? "\n" : "") + additions.join("\n") + "\n");
  console.log(`web/.env.local: added ${additions.map((a) => a.split("=")[0]).join(", ")}`);
}
console.log("\nNext: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to web/.env.local, then restart `npm run dev`.");
