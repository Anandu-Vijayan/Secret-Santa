import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./lib/db.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
const app = await buildApp(cfg, db);

// Bind to loopback in dev; in production the platform sets HOST (only the web proxy should reach it).
await app.listen({ port: cfg.PORT, host: process.env.HOST ?? "127.0.0.1" });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await db.end();
    process.exit(0);
  });
}
