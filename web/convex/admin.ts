import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  activeEvent,
  audit,
  authM,
  authQ,
  badRequest,
  conflict,
  domainOf,
  domainOk,
  emailOf,
  invalid,
  isEmail,
  isoDate,
  needAdmin,
  needUser,
  notFound,
  text,
} from "./lib/common";
import { drawCycle, encrypt } from "./lib/crypto";

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
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

/** Create a company. The signed-in user becomes its admin. */
export const createOrg = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    allowedDomain: v.optional(v.string()),
    event: v.object({ name: v.string(), budget: v.optional(v.string()), exchangeDate: v.optional(v.union(v.string(), v.null())) }),
  },
  handler: async (ctx, a) => {
    const u = needUser(await authM(ctx, a.token));
    const name = text(a.name, "Company name", 1, 80);
    const domain = a.allowedDomain?.trim() ? domainOf(a.allowedDomain) : undefined;
    const evName = text(a.event.name, "Event name", 1, 80);
    const budget = text(a.event.budget ?? "", "Budget", 0, 20);
    const exchangeDate = a.event.exchangeDate ? isoDate(a.event.exchangeDate) : undefined;

    const mine = await ctx.db.query("organizations").withIndex("by_creator", (q) => q.eq("createdBy", u.userId)).collect();
    if (mine.length >= 3) conflict("org_limit", "You can create up to 3 companies.");

    const orgId = await ctx.db.insert("organizations", { name, allowedDomain: domain, status: "active", createdBy: u.userId });
    const memberId = await ctx.db.insert("members", {
      orgId,
      userId: u.userId,
      email: u.email,
      name: u.name.slice(0, 60),
      department: "",
      role: "admin",
      status: "active",
    });
    await ctx.db.insert("events", { orgId, name: evName, budget, exchangeDate, status: "draft" });
    await audit(ctx, orgId, memberId, "org.create", { name });
    await ctx.db.patch(u.sessionId, { orgId });
    return { orgId: orgId as string };
  },
});

export const overview = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = needAdmin(await authQ(ctx, token));
    const org = await ctx.db.get(a.member.orgId);
    const ev = await activeEvent(ctx, a.member.orgId);
    const members = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", a.member.orgId)).collect();
    let withWishes = 0;
    for (const m of members) {
      if (await ctx.db.query("wishes").withIndex("by_member", (q) => q.eq("memberId", m._id)).first()) withWishes++;
    }
    let draw = { participants: 0, revealed: 0 };
    if (ev) {
      const asg = await ctx.db.query("assignments").withIndex("by_event", (q) => q.eq("eventId", ev._id)).collect();
      draw = { participants: asg.length, revealed: asg.filter((x) => x.revealedAt).length };
    }
    return {
      org: { name: org?.name, allowedDomain: org?.allowedDomain ?? null },
      event: ev ? { name: ev.name, budget: ev.budget, exchangeDate: ev.exchangeDate ?? null, status: ev.status, drawnAt: ev.drawnAt ? new Date(ev.drawnAt).toISOString() : null } : null,
      members: { total: members.length, active: members.filter((m) => m.status === "active").length, withWishes },
      draw,
    };
  },
});

/** Admins see who has spun, never who they got. */
export const members = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = needAdmin(await authQ(ctx, token));
    const ev = await activeEvent(ctx, a.member.orgId);
    const asg = ev ? await ctx.db.query("assignments").withIndex("by_event", (q) => q.eq("eventId", ev._id)).collect() : [];
    const byGiver = new Map(asg.map((x) => [x.giverId as string, x]));
    const rows = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", a.member.orgId)).collect();
    rows.sort((x, y) => y._creationTime - x._creationTime);
    const out = [];
    for (const m of rows) {
      const wishCount = (await ctx.db.query("wishes").withIndex("by_member", (q) => q.eq("memberId", m._id)).collect()).length;
      const x = byGiver.get(m._id);
      out.push({
        id: m._id as string,
        name: m.name,
        email: m.email,
        department: m.department,
        role: m.role,
        status: m.status,
        wishCount,
        inDraw: !!x,
        hasSpun: !!x?.revealedAt,
      });
    }
    return { members: out };
  },
});

export const addMember = mutation({
  args: { token: v.string(), name: v.string(), email: v.string(), department: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const adm = needAdmin(await authM(ctx, a.token));
    const name = text(a.name, "Name", 1, 60);
    const email = emailOf(a.email);
    const department = text(a.department ?? "", "Department", 0, 40);
    const org = await ctx.db.get(adm.member.orgId);
    if (!domainOk(email, org?.allowedDomain)) badRequest("wrong_domain", "That email isn't on your company domain.");
    const dup = await ctx.db.query("members").withIndex("by_org_email", (q) => q.eq("orgId", adm.member.orgId).eq("email", email)).first();
    if (dup) conflict("duplicate", "That email is already on the list.");
    const id = await ctx.db.insert("members", { orgId: adm.member.orgId, email, name, department, role: "staff", status: "invited" });
    // If this person has already signed in to the app, link them now.
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (user) await ctx.db.patch(id, { userId: user._id, status: "active" });
    await audit(ctx, adm.member.orgId, adm.member.memberId, "member.add", { email });
    return { id: id as string };
  },
});

/**
 * Fix a mistyped email on someone who hasn't signed in yet. Once a person has signed in, their account is
 * linked to the old email, so changing it would orphan the link: remove and re-add them instead.
 */
export const updateMemberEmail = mutation({
  args: { token: v.string(), id: v.string(), email: v.string() },
  handler: async (ctx, a) => {
    const adm = needAdmin(await authM(ctx, a.token));
    const id = ctx.db.normalizeId("members", a.id);
    const m = id ? await ctx.db.get(id) : null;
    if (!id || !m || m.orgId !== adm.member.orgId) notFound(); // never touch another company's member
    if (m!.role === "admin" || m!.status !== "invited" || m!.userId) {
      conflict("already_signed_in", "This person has already signed in, so their email can't be changed. Remove them and add them again.");
    }
    const email = emailOf(a.email);
    if (email === m!.email) return { ok: true };
    const org = await ctx.db.get(adm.member.orgId);
    if (!domainOk(email, org?.allowedDomain)) badRequest("wrong_domain", "That email isn't on your company domain.");
    const dup = await ctx.db.query("members").withIndex("by_org_email", (q) => q.eq("orgId", adm.member.orgId).eq("email", email)).first();
    if (dup) conflict("duplicate", "That email is already on the list.");
    await ctx.db.patch(id!, { email });
    // Same as adding: if this email already belongs to someone who has signed in, link them now.
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (user) await ctx.db.patch(id!, { userId: user._id, status: "active" });
    await audit(ctx, adm.member.orgId, adm.member.memberId, "member.email_update", { id: a.id, from: m!.email, to: email });
    return { ok: true };
  },
});

export const importMembers = mutation({
  args: { token: v.string(), csv: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const adm = needAdmin(await authM(ctx, a.token));
    if (a.csv.length > 1_000_000) invalid("That file is too large.");
    const dryRun = a.dryRun ?? true;
    let rows = parseCsv(a.csv);
    if (rows[0] && /email/i.test(rows[0].join(","))) rows = rows.slice(1); // header
    if (rows.length > 1000) badRequest("too_many_rows", "Up to 1,000 rows per import.");

    const org = await ctx.db.get(adm.member.orgId);
    const existing = await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", adm.member.orgId)).collect();
    const seen = new Set(existing.map((e) => e.email.toLowerCase()));
    const valid: { name: string; email: string; department: string }[] = [];
    const skipped: { row: number; reason: string }[] = [];
    rows.forEach((r, i) => {
      const name = (r[0] ?? "").trim();
      const email = (r[1] ?? "").trim().toLowerCase();
      const department = (r[2] ?? "").trim();
      if (!name || name.length > 60 || department.length > 40 || !isEmail(email)) return skipped.push({ row: i + 1, reason: "Missing name or invalid email" });
      if (!domainOk(email, org?.allowedDomain)) return skipped.push({ row: i + 1, reason: "Not on company domain" });
      if (seen.has(email)) return skipped.push({ row: i + 1, reason: "Already added" });
      seen.add(email);
      valid.push({ name, email, department });
    });
    if (!dryRun) {
      for (const m of valid) {
        await ctx.db.insert("members", { orgId: adm.member.orgId, ...m, role: "staff", status: "invited" });
      }
      await audit(ctx, adm.member.orgId, adm.member.memberId, "member.import", { count: valid.length });
    }
    return { dryRun, toAdd: valid.length, preview: valid.slice(0, 20), skipped };
  },
});

export const removeMember = mutation({
  args: { token: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const adm = needAdmin(await authM(ctx, a.token));
    if (a.id === adm.member.memberId) badRequest("self", "You can't remove yourself.");
    const id = ctx.db.normalizeId("members", a.id);
    const m = id ? await ctx.db.get(id) : null;
    if (!id || !m || m.orgId !== adm.member.orgId) notFound(); // never touch another company's member
    const ev = await activeEvent(ctx, adm.member.orgId);
    if (ev?.status === "open") {
      const inDraw = await ctx.db.query("assignments").withIndex("by_event_giver", (q) => q.eq("eventId", ev._id).eq("giverId", id!)).first();
      if (inDraw) conflict("in_draw", "This person is in the current draw. Redraw first, or wait until the event closes.");
    }
    for (const w of await ctx.db.query("wishes").withIndex("by_member", (q) => q.eq("memberId", id!)).collect()) await ctx.db.delete(w._id);
    await ctx.db.delete(id!);
    await audit(ctx, adm.member.orgId, adm.member.memberId, "member.remove", { id: a.id });
    return { ok: true };
  },
});

export const updateEvent = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    budget: v.optional(v.string()),
    exchangeDate: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, a) => {
    const adm = needAdmin(await authM(ctx, a.token));
    const ev = await activeEvent(ctx, adm.member.orgId);
    if (!ev) notFound();
    const patch: { name?: string; budget?: string; exchangeDate?: string | undefined } = {};
    if (a.name !== undefined) patch.name = text(a.name, "Event name", 1, 80);
    if (a.budget !== undefined) patch.budget = text(a.budget, "Budget", 0, 20);
    if (a.exchangeDate !== undefined) patch.exchangeDate = a.exchangeDate ? isoDate(a.exchangeDate) : undefined; // undefined clears the field
    await ctx.db.patch(ev!._id, patch);
    await audit(ctx, adm.member.orgId, adm.member.memberId, "event.update", { name: a.name, budget: a.budget, exchangeDate: a.exchangeDate });
    return { ok: true };
  },
});

/**
 * Draw names among everyone who has signed in. Allowed again (a redraw) only while
 * nobody has spun yet, so nobody's revealed result ever changes.
 */
export const draw = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const adm = needAdmin(await authM(ctx, token));
    const ev = await activeEvent(ctx, adm.member.orgId);
    if (!ev) notFound();
    const old = await ctx.db.query("assignments").withIndex("by_event", (q) => q.eq("eventId", ev!._id)).collect();
    if (old.some((x) => x.revealedAt)) conflict("already_spun", "Someone has already spun, so the draw is locked.");

    const people = (await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", adm.member.orgId)).collect()).filter(
      (m) => m.status === "active",
    );
    if (people.length < 3) conflict("too_few", "At least 3 people need to have signed in before the draw.");
    const pairs = drawCycle(people.map((p) => p._id as string));

    for (const x of old) await ctx.db.delete(x._id);
    for (const [giver, giftee] of pairs) {
      await ctx.db.insert("assignments", {
        eventId: ev!._id,
        orgId: adm.member.orgId,
        giverId: giver as Id<"members">,
        gifteeEnc: await encrypt(giftee, `${ev!._id}:${giver}`),
      });
    }
    await ctx.db.patch(ev!._id, { status: "open", drawnAt: Date.now() });
    await audit(ctx, adm.member.orgId, adm.member.memberId, "event.draw", { participants: pairs.length, redraw: ev!.status === "open" });
    return { participants: pairs.length };
  },
});
