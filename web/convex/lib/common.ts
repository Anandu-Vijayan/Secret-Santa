import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256Hex } from "./crypto";

// ---------------------------------------------------------------- errors
// The Next.js proxy turns these into the same JSON the old API returned: { error, message } + status.
export function fail(status: number, code: string, message: string): never {
  throw new ConvexError({ status, code, message });
}
export const badRequest = (code: string, msg = "Invalid request.") => fail(400, code, msg);
export const invalid = (msg: string) => fail(400, "invalid_input", msg);
export const unauthorized = () => fail(401, "unauthorized", "Please sign in.");
export const forbidden = () => fail(403, "forbidden", "You don't have access to this.");
export const notFound = () => fail(404, "not_found", "Not found.");
export const conflict = (code: string, msg: string) => fail(409, code, msg);

// ---------------------------------------------------------------- validation
// Convex has no DB CHECK constraints, so the length / format rules live here.
export function text(value: string, label: string, min: number, max: number): string {
  const t = value.trim();
  if (t.length < min) invalid(`${label} is required.`);
  if (t.length > max) invalid(`${label} must be at most ${max} characters.`);
  return t;
}

/** Optional text: blank becomes null. */
export function optText(value: string | null | undefined, label: string, max: number): string | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  if (t.length > max) invalid(`${label} must be at most ${max} characters.`);
  return t;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function emailOf(value: string): string {
  const e = value.trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 120) invalid("Enter a valid email address.");
  return e;
}
export function isEmail(value: string): boolean {
  const e = value.trim().toLowerCase();
  return EMAIL.test(e) && e.length <= 120;
}

export function domainOf(value: string): string {
  const d = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) || d.length > 100) invalid("Enter a domain like company.com");
  return d;
}

export function isoDate(value: string): string {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!ok) invalid("Enter a valid date.");
  return value;
}

export const domainOk = (email: string, domain: string | undefined) => !domain || email.endsWith(`@${domain}`);

// ---------------------------------------------------------------- sessions and auth
const DAY = 24 * 3600 * 1000;
export const ABSOLUTE_MS = 14 * DAY; // hard expiry
const IDLE_MS = 3 * DAY; // without use
const TOUCH_MS = 5 * 60 * 1000;

export type Membership = {
  orgId: Id<"organizations">;
  orgName: string;
  memberId: Id<"members">;
  role: "admin" | "staff";
  orgStatus: "active" | "suspended";
};

export type Auth = {
  sessionId: Id<"sessions">;
  userId: Id<"users">;
  email: string;
  name: string;
  orgs: Membership[];
  /** Selected company membership, if any. */
  member: Membership | null;
};

/** Companies this user belongs to, oldest first. */
export async function userOrgs(ctx: QueryCtx, userId: Id<"users">): Promise<Membership[]> {
  const ms = await ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  const rows: (Membership & { created: number })[] = [];
  for (const m of ms) {
    const o = await ctx.db.get(m.orgId);
    if (o) rows.push({ orgId: o._id, orgName: o.name, memberId: m._id, role: m.role, orgStatus: o.status, created: o._creationTime });
  }
  return rows.sort((a, b) => a.created - b.created).map(({ created: _c, ...rest }) => rest);
}

async function build(ctx: QueryCtx, s: Doc<"sessions">): Promise<Auth | null> {
  const user = await ctx.db.get(s.userId);
  if (!user) return null;
  const orgs = await userOrgs(ctx, s.userId);
  const member = orgs.find((o) => o.orgId === s.orgId && o.orgStatus === "active") ?? null;
  return { sessionId: s._id, userId: user._id, email: user.email, name: user.name, orgs, member };
}

/** Read-only: for queries. Cannot delete expired sessions or refresh last-seen. */
export async function authQ(ctx: QueryCtx, token: string): Promise<Auth | null> {
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const s = await ctx.db.query("sessions").withIndex("by_hash", (q) => q.eq("tokenHash", hash)).unique();
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt < now || s.lastSeen + IDLE_MS < now) return null;
  return build(ctx, s);
}

/** For mutations: also drops expired sessions and refreshes last-seen (at most every 5 minutes). */
export async function authM(ctx: MutationCtx, token: string): Promise<Auth | null> {
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const s = await ctx.db.query("sessions").withIndex("by_hash", (q) => q.eq("tokenHash", hash)).unique();
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt < now || s.lastSeen + IDLE_MS < now) {
    await ctx.db.delete(s._id);
    return null;
  }
  if (s.lastSeen + TOUCH_MS < now) await ctx.db.patch(s._id, { lastSeen: now });
  return build(ctx, s);
}

export function needUser(a: Auth | null): Auth {
  if (!a) unauthorized();
  return a as Auth;
}
export function needMember(a: Auth | null): Auth & { member: Membership } {
  const u = needUser(a);
  if (!u.member) fail(403, "no_company", "Pick a company first.");
  return u as Auth & { member: Membership };
}
export function needAdmin(a: Auth | null): Auth & { member: Membership } {
  const m = needMember(a);
  if (m.member.role !== "admin") forbidden();
  return m;
}

// ---------------------------------------------------------------- shared data helpers
export async function audit(ctx: MutationCtx, orgId: Id<"organizations">, actorId: Id<"members">, action: string, meta: object = {}) {
  await ctx.db.insert("auditLog", { orgId, actorId, action, meta });
}

/** v1: one active (non-closed) event per company. */
export async function activeEvent(ctx: QueryCtx, orgId: Id<"organizations">): Promise<Doc<"events"> | null> {
  const evs = await ctx.db.query("events").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  return evs.find((e) => e.status !== "closed") ?? null;
}

export async function wishesOf(ctx: QueryCtx, memberId: Id<"members">) {
  const ws = await ctx.db.query("wishes").withIndex("by_member", (q) => q.eq("memberId", memberId)).collect();
  return ws
    .sort((a, b) => a.position - b.position)
    .map((w) => ({ id: w._id as string, title: w.title, price: w.price, link: w.link, note: w.note }));
}
