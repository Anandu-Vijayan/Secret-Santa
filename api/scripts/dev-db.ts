// Local-only Postgres for development and tests. Production uses a managed Postgres via DATABASE_URL.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "../.pgdata");
const port = Number(process.env.DEV_PG_PORT ?? 54329);
const password = process.env.DEV_PG_PASSWORD ?? "dev-only-owner-password";

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "ss_owner",
  password,
  port,
  persistent: true,
  // UTF-8 regardless of the Windows code page (otherwise characters like ₹ fail).
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (!existsSync(resolve(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("secret_santa");
} catch {
  /* already exists */
}
try {
  await pg.createDatabase("secret_santa_test");
} catch {
  /* already exists */
}
console.log(`Postgres ready on 127.0.0.1:${port} (databases: secret_santa, secret_santa_test). Ctrl+C to stop.`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
