import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { ABSOLUTE_MS, fail, userOrgs, type Membership } from "./lib/common";
import { safeEqual } from "./lib/crypto";

/** Only the Next.js server knows SERVER_SECRET, so only it can open a session for an asserted identity. */
function checkSecret(secret: string) {
  const expected = process.env.SERVER_SECRET ?? "";
  if (!expected || !safeEqual(secret, expected)) fail(403, "forbidden", "You don't have access to this.");
}

/** Where to send someone after sign-in. First-time staff go to onboarding. */
async function landing(ctx: MutationCtx, intent: "admin" | "staff", orgs: Membership[], orgId: Id<"organizations"> | undefined) {
  if (intent === "admin" && !orgs.some((o) => o.role === "admin")) return "/admin/setup";
  if (orgs.length === 0) return "/login?error=not_invited";
  if (!orgId) return "/choose-company";
  const m = orgs.find((o) => o.orgId === orgId)!;
  // The organiser tab opens the dashboard; "I'm joining" always opens the member pages, even for an admin.
  if (m.role === "admin" && intent === "admin") return "/admin";
  const first = await ctx.db.query("wishes").withIndex("by_member", (q) => q.eq("memberId", m.memberId)).first();
  return first ? "/home" : "/onboarding";
}

/**
 * Shared by Google and dev login: upsert the user, link invites, open a session.
 * The raw session token never reaches Convex, only its SHA-256.
 */
export const signIn = mutation({
  args: {
    secret: v.string(),
    sub: v.string(),
    email: v.string(),
    name: v.string(),
    tokenHash: v.string(),
    intent: v.union(v.literal("admin"), v.literal("staff")),
  },
  handler: async (ctx, a) => {
    checkSecret(a.secret);
    const email = a.email.trim().toLowerCase();
    const name = a.name.trim().slice(0, 60) || email;
    const now = Date.now();

    const existing = await ctx.db.query("users").withIndex("by_sub", (q) => q.eq("googleSub", a.sub)).unique();
    let userId: Id<"users">;
    if (existing) {
      userId = existing._id;
      await ctx.db.patch(userId, { email, name, lastLogin: now });
    } else {
      userId = await ctx.db.insert("users", { googleSub: a.sub, email, name, lastLogin: now });
    }

    // Attach this user to every company that invited their verified email.
    const invites = await ctx.db.query("members").withIndex("by_email", (q) => q.eq("email", email)).collect();
    for (const m of invites) if (!m.userId) await ctx.db.patch(m._id, { userId, status: "active" });

    const orgs = await userOrgs(ctx, userId);
    const orgId = orgs.length === 1 ? orgs[0]!.orgId : undefined;
    await ctx.db.insert("sessions", { tokenHash: a.tokenHash, userId, orgId, expiresAt: now + ABSOLUTE_MS, lastSeen: now });
    return { next: await landing(ctx, a.intent, orgs, orgId) };
  },
});

export const signOut = mutation({
  args: { secret: v.string(), tokenHash: v.string() },
  handler: async (ctx, a) => {
    checkSecret(a.secret);
    const s = await ctx.db.query("sessions").withIndex("by_hash", (q) => q.eq("tokenHash", a.tokenHash)).unique();
    if (s) await ctx.db.delete(s._id);
    return { ok: true };
  },
});
