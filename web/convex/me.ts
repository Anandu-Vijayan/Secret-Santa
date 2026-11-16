import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import {
  activeEvent,
  authM,
  authQ,
  badRequest,
  conflict,
  fail,
  invalid,
  needMember,
  needUser,
  optText,
  text,
  wishesOf,
} from "./lib/common";
import { decrypt, shuffle } from "./lib/crypto";

/** The giftee's name + wishlist, and the names to paint on the wheel. */
async function reveal(ctx: QueryCtx, orgId: Id<"organizations">, eventId: Id<"events">, giverId: Id<"members">, gifteeEnc: string) {
  const gifteeId = (await decrypt(gifteeEnc, `${eventId}:${giverId}`)) as Id<"members">;
  const g = await ctx.db.get(gifteeId);
  // Belt and braces: Convex has no row-level security, so re-check the tenant here.
  if (!g || g.orgId !== orgId) fail(410, "giftee_gone", "Your giftee left the company. Ask your admin to redraw.");
  const all = await ctx.db.query("assignments").withIndex("by_event", (q) => q.eq("eventId", eventId)).collect();
  const others: string[] = [];
  for (const a of all) {
    if (a.giverId === giverId || a.giverId === gifteeId) continue;
    const m = await ctx.db.get(a.giverId);
    if (m && m.orgId === orgId) others.push(m.name);
  }
  const names = shuffle([g.name, ...shuffle(others).slice(0, 11)]);
  return {
    giftee: { name: g.name, department: g.department, wishes: await wishesOf(ctx, gifteeId) },
    wheel: { names, targetIndex: names.indexOf(g.name) },
  };
}

/** GET /me. A mutation (not a query) so each page load refreshes the session's idle timer. */
export const load = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = needUser(await authM(ctx, token));
    const base = { user: { name: a.name, email: a.email }, orgs: a.orgs.map(({ orgId, orgName, role }) => ({ orgId: orgId as string, orgName, role })) };
    const member = a.member;
    if (!member) return { ...base, current: null };
    const me = await ctx.db.get(member.memberId);
    const event = await activeEvent(ctx, member.orgId);
    let mine = { participant: false, revealed: false };
    if (event) {
      const asg = await ctx.db
        .query("assignments")
        .withIndex("by_event_giver", (q) => q.eq("eventId", event._id).eq("giverId", member.memberId))
        .unique();
      mine = { participant: !!asg, revealed: !!asg?.revealedAt };
    }
    const wishCount = (await ctx.db.query("wishes").withIndex("by_member", (q) => q.eq("memberId", member.memberId)).collect()).length;
    return {
      ...base,
      current: {
        orgId: member.orgId as string,
        orgName: member.orgName,
        role: member.role,
        name: me?.name,
        department: me?.department,
        wishCount,
      },
      event: event && {
        name: event.name,
        budget: event.budget,
        exchangeDate: event.exchangeDate ?? null,
        status: event.status,
        ...mine,
      },
    };
  },
});

export const selectOrg = mutation({
  args: { token: v.string(), orgId: v.string() },
  handler: async (ctx, { token, orgId }) => {
    const a = needUser(await authM(ctx, token));
    const o = a.orgs.find((x) => x.orgId === orgId && x.orgStatus === "active");
    if (!o) badRequest("not_member");
    await ctx.db.patch(a.sessionId, { orgId: o!.orgId });
    return { ok: true };
  },
});

export const updateProfile = mutation({
  args: { token: v.string(), name: v.string(), department: v.string() },
  handler: async (ctx, { token, name, department }) => {
    const a = needMember(await authM(ctx, token));
    await ctx.db.patch(a.member.memberId, { name: text(name, "Name", 1, 60), department: text(department, "Department", 0, 40) });
    return { ok: true };
  },
});

export const wishes = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = needMember(await authQ(ctx, token));
    return { wishes: await wishesOf(ctx, a.member.memberId) };
  },
});

const wishArg = v.object({
  title: v.string(),
  price: v.optional(v.union(v.string(), v.null())),
  link: v.optional(v.union(v.string(), v.null())),
  note: v.optional(v.union(v.string(), v.null())),
});

/** Replace the whole list (max 5). Simple and race-free (one transaction). */
export const setWishes = mutation({
  args: { token: v.string(), wishes: v.array(wishArg) },
  handler: async (ctx, { token, wishes }) => {
    const a = needMember(await authM(ctx, token));
    if (wishes.length > 5) invalid("You can add up to 5 wishes.");
    const clean = wishes.map((w) => {
      const link = optText(w.link, "Link", 500);
      if (link !== null && !/^https:\/\/[^\s<>"]+$/i.test(link)) invalid("Links must start with https://");
      return { title: text(w.title, "Title", 1, 80), price: optText(w.price, "Price", 20), link, note: optText(w.note, "Note", 120) };
    });
    if (!(await activeEvent(ctx, a.member.orgId))) conflict("no_event", "There's no active event.");
    const old = await ctx.db.query("wishes").withIndex("by_member", (q) => q.eq("memberId", a.member.memberId)).collect();
    for (const w of old) await ctx.db.delete(w._id);
    for (const [i, w] of clean.entries()) {
      await ctx.db.insert("wishes", { orgId: a.member.orgId, memberId: a.member.memberId, position: i, ...w });
    }
    return { ok: true };
  },
});

/**
 * One spin, ever. The pairing was fixed at draw time; this only reveals it. Convex runs the mutation
 * serializably, so two concurrent spins cannot both see revealedAt unset: the loser gets 409.
 */
export const spin = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = needMember(await authM(ctx, token));
    const ev = await activeEvent(ctx, a.member.orgId);
    if (!ev || ev.status !== "open") conflict("not_open", "The draw hasn't happened yet.");
    const asg: Doc<"assignments"> | null = await ctx.db
      .query("assignments")
      .withIndex("by_event_giver", (q) => q.eq("eventId", ev!._id).eq("giverId", a.member.memberId))
      .unique();
    if (!asg) conflict("not_in_draw", "You joined after the draw. Ask your admin to redraw.");
    if (asg!.revealedAt) conflict("already_spun", "You've already spun. Your result is saved.");
    await ctx.db.patch(asg!._id, { revealedAt: Date.now() });
    return reveal(ctx, a.member.orgId, ev!._id, a.member.memberId, asg!.gifteeEnc);
  },
});

export const assignment = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const a = needMember(await authQ(ctx, token));
    const ev = await activeEvent(ctx, a.member.orgId);
    if (!ev) return { revealed: false as const };
    const asg = await ctx.db
      .query("assignments")
      .withIndex("by_event_giver", (q) => q.eq("eventId", ev._id).eq("giverId", a.member.memberId))
      .unique();
    if (!asg?.revealedAt) return { revealed: false as const };
    return { revealed: true as const, ...(await reveal(ctx, a.member.orgId, ev._id, a.member.memberId, asg.gifteeEnc)) };
  },
});
