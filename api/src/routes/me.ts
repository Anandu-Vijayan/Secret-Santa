import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember, requireUser } from "../auth.js";
import { decrypt, shuffle } from "../lib/crypto.js";
import { withOrg, type Db, type Tx } from "../lib/db.js";
import { badRequest, conflict, HttpError } from "../lib/errors.js";

export const wishSchema = z.object({
  title: z.string().trim().min(1).max(80),
  price: z.string().trim().max(20).optional().transform((v) => v || null),
  link: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^https:\/\/[^\s<>"]+$/i.test(v), "Links must start with https://"),
  note: z.string().trim().max(120).optional().transform((v) => v || null),
});

async function activeEvent(c: Tx) {
  const { rows } = await c.query(
    "SELECT id, name, budget, to_char(exchange_date, 'YYYY-MM-DD') AS exchange_date, status, drawn_at FROM events WHERE status <> 'closed' LIMIT 1",
  );
  return rows[0] ?? null;
}

async function wishesOf(c: Tx, memberId: string) {
  const { rows } = await c.query("SELECT id, title, price, link, note FROM wishes WHERE member_id = $1 ORDER BY position", [memberId]);
  return rows;
}

/** The giftee's name + wishlist, and the names to paint on the wheel. */
async function reveal(c: Tx, key: Buffer, eventId: string, giverId: string, gifteeEnc: string) {
  const gifteeId = decrypt(key, gifteeEnc, `${eventId}:${giverId}`);
  const { rows: g } = await c.query("SELECT id, name, department FROM members WHERE id = $1", [gifteeId]);
  if (!g[0]) throw new HttpError(410, "giftee_gone", "Your giftee left the company. Ask your admin to redraw.");
  const { rows: others } = await c.query(
    "SELECT m.name FROM assignments a JOIN members m ON m.id = a.giver_id WHERE a.event_id = $1 AND a.giver_id NOT IN ($2, $3)",
    [eventId, giverId, gifteeId],
  );
  const names = shuffle([g[0].name as string, ...shuffle(others.map((o) => o.name as string)).slice(0, 11)]);
  return {
    giftee: { name: g[0].name, department: g[0].department, wishes: await wishesOf(c, gifteeId) },
    wheel: { names, targetIndex: names.indexOf(g[0].name) },
  };
}

export async function meRoutes(app: FastifyInstance, { db, assignmentKey }: { db: Db; assignmentKey: Buffer }) {
  app.get("/me", async (req) => {
    const a = requireUser(req);
    const base = { user: { name: a.name, email: a.email }, orgs: a.orgs.map(({ orgId, orgName, role }) => ({ orgId, orgName, role })) };
    if (!a.member) return { ...base, current: null };
    return withOrg(db, a.member.orgId, async (c) => {
      const { rows } = await c.query("SELECT name, department FROM members WHERE id = $1", [a.member!.memberId]);
      const event = await activeEvent(c);
      let mine = { participant: false, revealed: false };
      if (event) {
        const { rows: as } = await c.query("SELECT revealed_at FROM assignments WHERE event_id = $1 AND giver_id = $2", [event.id, a.member!.memberId]);
        mine = { participant: !!as[0], revealed: !!as[0]?.revealed_at };
      }
      const { rows: wc } = await c.query("SELECT count(*)::int AS n FROM wishes WHERE member_id = $1", [a.member!.memberId]);
      return {
        ...base,
        current: { orgId: a.member!.orgId, orgName: a.member!.orgName, role: a.member!.role, name: rows[0]?.name, department: rows[0]?.department, wishCount: wc[0].n },
        event: event && { name: event.name, budget: event.budget, exchangeDate: event.exchange_date, status: event.status, ...mine },
      };
    });
  });

  app.post("/me/org", async (req) => {
    const a = requireUser(req);
    const { orgId } = z.object({ orgId: z.uuid() }).parse(req.body);
    if (!a.orgs.some((o) => o.orgId === orgId && o.orgStatus === "active")) throw badRequest("not_member");
    await db.query("UPDATE sessions SET org_id = $1 WHERE id = $2", [orgId, a.sessionId]);
    return { ok: true };
  });

  app.patch("/me/profile", async (req) => {
    const a = requireMember(req);
    const body = z.object({ name: z.string().trim().min(1).max(60), department: z.string().trim().max(40) }).parse(req.body);
    await withOrg(db, a.member.orgId, (c) =>
      c.query("UPDATE members SET name = $1, department = $2 WHERE id = $3", [body.name, body.department, a.member.memberId]),
    );
    return { ok: true };
  });

  app.get("/me/wishes", async (req) => {
    const a = requireMember(req);
    return { wishes: await withOrg(db, a.member.orgId, (c) => wishesOf(c, a.member.memberId)) };
  });

  // Replace the whole list (max 5). Simple and race-free.
  app.put("/me/wishes", async (req) => {
    const a = requireMember(req);
    const { wishes } = z.object({ wishes: z.array(wishSchema).max(5) }).parse(req.body);
    await withOrg(db, a.member.orgId, async (c) => {
      const ev = await activeEvent(c);
      if (!ev) throw conflict("no_event", "There's no active event.");
      await c.query("DELETE FROM wishes WHERE member_id = $1", [a.member.memberId]);
      for (const [i, w] of wishes.entries()) {
        await c.query("INSERT INTO wishes (org_id, member_id, position, title, price, link, note) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
          a.member.orgId,
          a.member.memberId,
          i,
          w.title,
          w.price,
          w.link,
          w.note,
        ]);
      }
    });
    return { ok: true };
  });

  // One spin, ever. The pairing was fixed at draw time; this only reveals it. The UPDATE only matches
  // while revealed_at is NULL, so a repeat or concurrent call gets 409 and the result is read via /me/assignment.
  app.post("/me/spin", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const a = requireMember(req);
    return withOrg(db, a.member.orgId, async (c) => {
      const ev = await activeEvent(c);
      if (!ev || ev.status !== "open") throw conflict("not_open", "The draw hasn't happened yet.");
      const { rows } = await c.query(
        "UPDATE assignments SET revealed_at = now() WHERE event_id = $1 AND giver_id = $2 AND revealed_at IS NULL RETURNING giftee_enc",
        [ev.id, a.member.memberId],
      );
      if (!rows[0]) {
        const { rows: had } = await c.query("SELECT 1 FROM assignments WHERE event_id = $1 AND giver_id = $2", [ev.id, a.member.memberId]);
        if (had[0]) throw conflict("already_spun", "You've already spun. Your result is saved.");
        throw conflict("not_in_draw", "You joined after the draw. Ask your admin to redraw.");
      }
      return reveal(c, assignmentKey, ev.id, a.member.memberId, rows[0].giftee_enc);
    });
  });

  app.get("/me/assignment", async (req) => {
    const a = requireMember(req);
    return withOrg(db, a.member.orgId, async (c) => {
      const ev = await activeEvent(c);
      if (!ev) return { revealed: false };
      const { rows } = await c.query("SELECT giftee_enc, revealed_at FROM assignments WHERE event_id = $1 AND giver_id = $2", [ev.id, a.member.memberId]);
      if (!rows[0]?.revealed_at) return { revealed: false };
      return { revealed: true, ...(await reveal(c, assignmentKey, ev.id, a.member.memberId, rows[0].giftee_enc)) };
    });
  });
}
