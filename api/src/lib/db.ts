import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 10_000 });
}

/** Run `fn` in a transaction (no tenant set: only global tables are visible). */
export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * Run `fn` in a transaction scoped to one company. Row-level security in Postgres
 * filters every tenant table to this org, so a missing WHERE clause can't leak data.
 * set_config(..., true) is transaction-local, so pooled connections never carry it over.
 */
export function withOrg<T>(db: Db, orgId: string, fn: (c: Tx) => Promise<T>): Promise<T> {
  return tx(db, async (c) => {
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    return fn(c);
  });
}
