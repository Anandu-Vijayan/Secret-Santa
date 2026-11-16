import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser } from "../auth.js";
import { encrypt } from "../lib/crypto.js";
import { withOrg, type Db, type Tx } from "../lib/db.js";
import { drawCycle } from "../lib/draw.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a domain like company.com")
  .max(100);

const eventSchema = z.object({
  name: z.string().trim().min(1).max(80),
  budget: z.string().trim().max(20).default(""),
  exchangeDate: z.iso.date().nullable().optional(),
});

const memberSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.email().max(120).transform((e) => e.toLowerCase()),
  department: z.string().trim().max(40).default(""),
});

async function audit(c: Tx, orgId: string, actorId: string, action: string, meta: object = {}) {
  await c.query("INSERT INTO audit_log (org_id, actor_id, action, meta) VALUES ($1, $2, $3, $4)", [orgId, actorId, action, meta]);
}

async function allowedDomain(c: Tx): Promise<string | null> {
  const { rows } = await c.query("SELECT allowed_domain FROM organizations LIMIT 1");
  return rows[0]?.allowed_domain ?? null;
}

function domainOk(email: string, domain: string | null) {
  return !domain || email.endsWith(`@${domain}`);
}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

export async function adminRoutes(app: FastifyInstance, { db, assignmentKey }: { db: Db; assignmentKey: Buffer }) {
  // Create a company. The signed-in user becomes its admin.
  app.post("/orgs", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req) => {
    const a = requireUser(req);
    const body = z
      .object({ name: z.string().trim().min(1).max(80), allowedDomain: domainSchema.optional().or(z.literal("")), event: eventSchema })
      .parse(req.body);
    let orgId: string;
    try {
      const { rows } = await db.query("SELECT create_org($1, $2, $3, $4, $5) AS id", [a.userId, body.name, body.allowedDomain || null, a.email, a.name]);
      orgId = rows[0].id;
    } catch (e) {
      if ((e as { message?: string }).message?.includes("org_limit")) throw conflict("org_limit", "You can create up to 3 companies.");
      throw e;
    }
    await withOrg(db, orgId, async (c) => {
      await c.query("INSERT INTO events (org_id, name, budget, exchange_date) VALUES ($1, $2, $3, $4)", [orgId, body.event.name, body.event.budget, body.event.exchangeDate ?? null]);
      const { rows } = await c.query("SELECT id FROM members WHERE user_id = $1", [a.userId]);
      await audit(c, orgId, rows[0].id, "org.create", { name: body.name });
    });
    await db.query("UPDATE sessions SET org_id = $1 WHERE id = $2", [orgId, a.sessionId]);
    return { orgId };
  });

  app.get("/admin/overview", async (req) => {
    const a = requireAdmin(req);
    return withOrg(db, a.member.orgId, async (c) => {
      const { rows: org } = await c.query("SELECT name, allowed_domain FROM organizations");
      const { rows: ev } = await c.query(
        "SELECT id, name, budget, to_char(exchange_date, 'YYYY-MM-DD') AS exchange_date, status, drawn_at FROM events WHERE status <> 'closed' LIMIT 1",
      );
      const { rows: m } = await c.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'active')::int AS active,
               count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wishes w WHERE w.member_id = members.id))::int AS with_wishes
          FROM members`);
      let draw = { participants: 0, revealed: 0 };
      if (ev[0]) {
        const { rows } = await c.query(
          "SELECT count(*)::int AS participants, count(revealed_at)::int AS revealed FROM assignments WHERE event_id = $1",
          [ev[0].id],
        );
        draw = rows[0];
      }
      return {
        org: { name: org[0]?.name, allowedDomain: org[0]?.allowed_domain ?? null },
        event: ev[0] ? { name: ev[0].name, budget: ev[0].budget, exchangeDate: ev[0].exchange_date, status: ev[0].status, drawnAt: ev[0].drawn_at } : null,
        members: { total: m[0].total, active: m[0].active, withWishes: m[0].with_wishes },
        draw,
      };
    });
  });

  // Admins see who has spun, never who they got.
  app.get("/admin/members", async (req) => {
    const a = requireAdmin(req);
    const { rows } = await withOrg(db, a.member.orgId, (c) =>
      c.query(`
        SELECT m.id, m.name, m.email, m.department, m.role, m.status,
               (SELECT count(*)::int FROM wishes w WHERE w.member_id = m.id) AS wish_count,
               EXISTS (SELECT 1 FROM assignments x JOIN events e ON e.id = x.event_id
                        WHERE x.giver_id = m.id AND e.status <> 'closed') AS in_draw,
               EXISTS (SELECT 1 FROM assignments x JOIN events e ON e.id = x.event_id
                        WHERE x.giver_id = m.id AND e.status <> 'closed' AND x.revealed_at IS NOT NULL) AS has_spun
          FROM members m ORDER BY m.created_at DESC`),
    );
    return {
      members: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        department: r.department,
        role: r.role,
        status: r.status,
        wishCount: r.wish_count,
        inDraw: r.in_draw,
        hasSpun: r.has_spun,
      })),
    };
  });

  app.post("/admin/members", async (req) => {
    const a = requireAdmin(req);
    const body = memberSchema.parse(req.body);
    return withOrg(db, a.member.orgId, async (c) => {
      if (!domainOk(body.email, await allowedDomain(c))) throw badRequest("wrong_domain", "That email isn't on your company domain.");
      const { rows } = await c.query(
        "INSERT INTO members (org_id, email, name, department) VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, email) DO NOTHING RETURNING id",
        [a.member.orgId, body.email, body.name, body.department],
      );
      if (!rows[0]) throw conflict("duplicate", "That email is already on the list.");
      // If this person has already signed in to the app, link them now.
      await c.query("UPDATE members SET user_id = u.id, status = 'active' FROM users u WHERE members.id = $1 AND u.email = members.email", [rows[0].id]);
      await audit(c, a.member.orgId, a.member.memberId, "member.add", { email: body.email });
      return { id: rows[0].id };
    });
  });

  app.post("/admin/members/import", { bodyLimit: 1_048_576 }, async (req) => {
    const a = requireAdmin(req);
    const { csv, dryRun } = z.object({ csv: z.string().max(1_000_000), dryRun: z.boolean().default(true) }).parse(req.body);
    let rows = parseCsv(csv);
    if (rows[0] && /email/i.test(rows[0].join(","))) rows = rows.slice(1); // header
    if (rows.length > 1000) throw badRequest("too_many_rows", "Up to 1,000 rows per import.");

    return withOrg(db, a.member.orgId, async (c) => {
      const domain = await allowedDomain(c);
      const { rows: existing } = await c.query("SELECT email FROM members");
      const seen = new Set(existing.map((e) => String(e.email).toLowerCase()));
      const valid: z.infer<typeof memberSchema>[] = [];
      const skipped: { row: number; reason: string }[] = [];
      rows.forEach((r, i) => {
        const parsed = memberSchema.safeParse({ name: r[0] ?? "", email: (r[1] ?? "").trim(), department: r[2] ?? "" });
        if (!parsed.success) return skipped.push({ row: i + 1, reason: "Missing name or invalid email" });
        if (!domainOk(parsed.data.email, domain)) return skipped.push({ row: i + 1, reason: "Not on company domain" });
        if (seen.has(parsed.data.email)) return skipped.push({ row: i + 1, reason: "Already added" });
        seen.add(parsed.data.email);
        valid.push(parsed.data);
      });
      if (!dryRun) {
        for (const m of valid) {
          await c.query("INSERT INTO members (org_id, email, name, department) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [
            a.member.orgId,
            m.email,
            m.name,
            m.department,
          ]);
        }
        await audit(c, a.member.orgId, a.member.memberId, "member.import", { count: valid.length });
      }
      return { dryRun, toAdd: valid.length, preview: valid.slice(0, 20), skipped };
    });
  });

  app.delete("/admin/members/:id", async (req) => {
    const a = requireAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    if (id === a.member.memberId) throw badRequest("self", "You can't remove yourself.");
    return withOrg(db, a.member.orgId, async (c) => {
      const { rows: inDraw } = await c.query(
        "SELECT 1 FROM assignments x JOIN events e ON e.id = x.event_id WHERE e.status = 'open' AND (x.giver_id = $1) LIMIT 1",
        [id],
      );
      if (inDraw[0]) throw conflict("in_draw", "This person is in the current draw. Redraw first, or wait until the event closes.");
      const { rowCount } = await c.query("DELETE FROM members WHERE id = $1", [id]);
      if (!rowCount) throw notFound();
      await audit(c, a.member.orgId, a.member.memberId, "member.remove", { id });
      return { ok: true };
    });
  });

  app.patch("/admin/event", async (req) => {
    const a = requireAdmin(req);
    const body = eventSchema.partial().parse(req.body);
    return withOrg(db, a.member.orgId, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE events SET name = coalesce($1, name), budget = coalesce($2, budget),
                exchange_date = CASE WHEN $4 THEN $3::date ELSE exchange_date END
          WHERE status <> 'closed'`,
        [body.name ?? null, body.budget ?? null, body.exchangeDate ?? null, body.exchangeDate !== undefined],
      );
      if (!rowCount) throw notFound();
      await audit(c, a.member.orgId, a.member.memberId, "event.update", body);
      return { ok: true };
    });
  });

  /**
   * Draw names among everyone who has signed in. Allowed again (a redraw) only while
   * nobody has spun yet, so nobody's revealed result ever changes.
   */
  app.post("/admin/event/draw", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const a = requireAdmin(req);
    return withOrg(db, a.member.orgId, async (c) => {
      const { rows: ev } = await c.query("SELECT id, status FROM events WHERE status <> 'closed' LIMIT 1 FOR UPDATE");
      if (!ev[0]) throw notFound();
      const eventId: string = ev[0].id;
      const { rows: rev } = await c.query("SELECT count(revealed_at)::int AS n FROM assignments WHERE event_id = $1", [eventId]);
      if (rev[0].n > 0) throw conflict("already_spun", "Someone has already spun, so the draw is locked.");

      const { rows: people } = await c.query("SELECT id FROM members WHERE status = 'active'");
      if (people.length < 3) throw conflict("too_few", "At least 3 people need to have signed in before the draw.");
      const pairs = drawCycle(people.map((p) => p.id as string));

      await c.query("DELETE FROM assignments WHERE event_id = $1", [eventId]);
      for (const [giver, giftee] of pairs) {
        await c.query("INSERT INTO assignments (event_id, org_id, giver_id, giftee_enc) VALUES ($1, $2, $3, $4)", [
          eventId,
          a.member.orgId,
          giver,
          encrypt(assignmentKey, giftee, `${eventId}:${giver}`),
        ]);
      }
      await c.query("UPDATE events SET status = 'open', drawn_at = now() WHERE id = $1", [eventId]);
      await audit(c, a.member.orgId, a.member.memberId, "event.draw", { participants: pairs.size, redraw: ev[0].status === "open" });
      return { participants: pairs.size };
    });
  });
}
