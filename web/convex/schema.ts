import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Secret Santa data model (ported from the Postgres schema).
 *
 * Convex has no row-level security and no unique constraints, so:
 *  - every function resolves the caller's session and checks the company itself
 *    (see lib/common.ts: needMember / needAdmin, and the `orgId ===` checks), and
 *  - "unique" rules are enforced inside mutations, which Convex runs serializably.
 * Emails are stored lower-cased (the old schema used citext).
 */
export default defineSchema({
  // ---- identities (global) ----
  users: defineTable({
    googleSub: v.string(),
    email: v.string(),
    name: v.string(),
    lastLogin: v.optional(v.number()),
  })
    .index("by_sub", ["googleSub"])
    .index("by_email", ["email"]),

  sessions: defineTable({
    tokenHash: v.string(), // sha256 hex of the cookie value; the raw token is never stored
    userId: v.id("users"),
    orgId: v.optional(v.id("organizations")), // currently selected company
    expiresAt: v.number(),
    lastSeen: v.number(),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  // ---- tenants ----
  organizations: defineTable({
    name: v.string(),
    allowedDomain: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("suspended")),
    createdBy: v.id("users"),
  }).index("by_creator", ["createdBy"]),

  members: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")), // unset until they first sign in
    email: v.string(),
    name: v.string(),
    department: v.string(),
    role: v.union(v.literal("admin"), v.literal("staff")),
    status: v.union(v.literal("invited"), v.literal("active")),
  })
    .index("by_org", ["orgId"])
    .index("by_org_email", ["orgId", "email"])
    .index("by_user", ["userId"])
    .index("by_email", ["email"]),

  wishes: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    position: v.number(),
    title: v.string(),
    price: v.union(v.string(), v.null()),
    link: v.union(v.string(), v.null()),
    note: v.union(v.string(), v.null()),
  }).index("by_member", ["memberId"]),

  events: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    budget: v.string(),
    exchangeDate: v.optional(v.string()), // YYYY-MM-DD
    status: v.union(v.literal("draft"), v.literal("open"), v.literal("closed")),
    drawnAt: v.optional(v.number()),
  }).index("by_org", ["orgId"]),

  assignments: defineTable({
    eventId: v.id("events"),
    orgId: v.id("organizations"),
    giverId: v.id("members"),
    gifteeEnc: v.string(), // AES-256-GCM(giftee member id), AAD = eventId:giverId
    revealedAt: v.optional(v.number()),
  })
    .index("by_event", ["eventId"])
    .index("by_event_giver", ["eventId", "giverId"]),

  auditLog: defineTable({
    orgId: v.id("organizations"),
    actorId: v.optional(v.id("members")),
    action: v.string(),
    meta: v.any(),
  }).index("by_org", ["orgId"]),
});
