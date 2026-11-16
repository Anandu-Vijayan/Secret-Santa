// Applies migrations/*.sql in order as the owner role, then (re)grants the app role.
// Usage: npm run migrate            (uses MIGRATION_DATABASE_URL + APP_DB_PASSWORD from .env)
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

export async function migrate(ownerUrl: string, appPassword: string, log = console.log) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const enc = (await client.query("SHOW server_encoding")).rows[0].server_encoding;
    if (enc !== "UTF8") throw new Error(`Database encoding is ${enc}; it must be UTF8.`);
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

    // App role: login only, owns nothing, cannot bypass RLS.
    await client.query("SELECT set_config('ss.app_pw', $1, false)", [appPassword]);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ss_app') THEN
        EXECUTE format('CREATE ROLE ss_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', current_setting('ss.app_pw'));
      ELSE
        EXECUTE format('ALTER ROLE ss_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', current_setting('ss.app_pw'));
      END IF; END $$`);
    await client.query("SELECT set_config('ss.app_pw', '', false)");

    const dir = resolve(import.meta.dirname, "../migrations");
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      log(`applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(resolve(dir, file), "utf8"));
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }

    // Least privilege for the app role. No DELETE on audit_log; no TRUNCATE anywhere.
    await client.query(`
      REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ss_app;
      GRANT USAGE ON SCHEMA public TO ss_app;
      GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, members, wishes, events, assignments TO ss_app;
      GRANT SELECT, UPDATE ON organizations TO ss_app;
      GRANT SELECT, INSERT ON audit_log TO ss_app;
      GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ss_app;
      GRANT EXECUTE ON FUNCTION app_org(), claim_memberships(uuid, citext), user_orgs(uuid),
        create_org(uuid, text, citext, citext, text) TO ss_app;
    `);
    log("migrations up to date");
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    await client.end();
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.MIGRATION_DATABASE_URL;
  const pw = process.env.APP_DB_PASSWORD;
  if (!url || !pw) {
    console.error("MIGRATION_DATABASE_URL and APP_DB_PASSWORD are required");
    process.exit(1);
  }
  migrate(url, pw).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
