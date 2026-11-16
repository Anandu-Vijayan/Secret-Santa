import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appUrl, login, ORIGIN, setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => ctx.close());

const event = { name: "Xmas 2026", budget: "₹1,000", exchangeDate: "2026-12-19" };

async function companyWithStaff(domain: string, n: number) {
  const admin = await login(ctx.app, `boss@${domain}`, "Boss", "admin");
  expect(admin.next).toBe("/admin/setup");
  const created = await admin.call("POST", "/orgs", { name: `Co ${domain}`, allowedDomain: domain, event });
  expect(created.statusCode, created.body).toBe(200);
  const staff = [];
  for (let i = 0; i < n; i++) {
    const email = `s${i}@${domain}`;
    expect((await admin.call("POST", "/admin/members", { name: `Staff ${i}`, email, department: "Eng" })).statusCode).toBe(200);
    staff.push(await login(ctx.app, email, `Staff ${i}`));
  }
  return { admin, staff, orgId: created.json().orgId as string };
}

describe("auth & CSRF", () => {
  it("rejects anonymous requests", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
  });

  it("rejects a forged or unknown session cookie", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/me", cookies: { ss: "x".repeat(43) } });
    expect(r.statusCode).toBe(401);
  });

  it("blocks state-changing requests without our Origin", async () => {
    const u = await login(ctx.app, "csrf@nowhere.test");
    const noOrigin = await ctx.app.inject({ method: "POST", url: "/auth/logout", cookies: { ss: u.cookie } });
    const evil = await ctx.app.inject({ method: "POST", url: "/auth/logout", cookies: { ss: u.cookie }, headers: { origin: "https://evil.example" } });
    expect(noOrigin.statusCode).toBe(403);
    expect(evil.statusCode).toBe(403);
  });

  it("blocks HTML form posts (non-JSON bodies)", async () => {
    const r = await ctx.app.inject({
      method: "POST",
      url: "/auth/dev-login",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      payload: "email=a@b.com&name=a",
    });
    expect(r.statusCode).toBe(415);
  });

  it("logout really ends the session", async () => {
    const u = await login(ctx.app, "bye@nowhere.test");
    expect((await u.call("POST", "/auth/logout")).statusCode).toBe(200);
    expect((await u.call("GET", "/me")).statusCode).toBe(401);
  });

  it("people who weren't invited land on an error, not inside a company", async () => {
    const u = await login(ctx.app, "stranger@nowhere.test");
    expect(u.next).toBe("/login?error=not_invited");
    expect((await u.call("GET", "/me/wishes")).statusCode).toBe(403);
  });

  it("sends security headers and no-store", async () => {
    const r = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});

describe("full exchange", () => {
  it("draw → spin → everyone gets exactly one other person, privately", async () => {
    const { admin, staff } = await companyWithStaff("north.test", 4);

    // staff add wishes; bad links are refused
    const bad = await staff[0]!.call("PUT", "/me/wishes", { wishes: [{ title: "x", link: "javascript:alert(1)" }] });
    expect(bad.statusCode).toBe(400);
    expect((await staff[0]!.call("PUT", "/me/wishes", { wishes: [{ title: "Socks", price: "₹300", link: "https://shop.test/s" }] })).statusCode).toBe(200);
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `w${i}` }));
    expect((await staff[1]!.call("PUT", "/me/wishes", { wishes: six })).statusCode).toBe(400);

    // can't spin before the draw
    expect((await staff[0]!.call("POST", "/me/spin")).statusCode).toBe(409);

    const draw = await admin.call("POST", "/admin/event/draw");
    expect(draw.statusCode).toBe(200);
    expect(draw.json().participants).toBe(5); // admin + 4 staff

    // signing in after the draw opens the home page (wheel + wishlist); no wishes yet goes to onboarding
    expect((await login(ctx.app, "s0@north.test", "Staff 0")).next).toBe("/home");
    expect((await login(ctx.app, "s1@north.test", "Staff 1")).next).toBe("/onboarding");

    const people = [admin, ...staff];
    const me = await Promise.all(people.map(async (p) => (await p.call("GET", "/me")).json().current.name as string));
    const giftees: string[] = [];
    for (const [i, p] of people.entries()) {
      const r = await p.call("POST", "/me/spin");
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.giftee.name).not.toBe(me[i]);
      expect(body.wheel.names[body.wheel.targetIndex]).toBe(body.giftee.name);
      expect(body.wheel.names.length).toBeLessThanOrEqual(12);
      // no second spin, but the saved result stays readable
      const again = await p.call("POST", "/me/spin");
      expect(again.statusCode).toBe(409);
      expect(again.json().error).toBe("already_spun");
      expect((await p.call("GET", "/me/assignment")).json().giftee.name).toBe(body.giftee.name);
      giftees.push(body.giftee.name);
    }
    expect(new Set(giftees).size).toBe(5);


    // whoever got Staff 0 sees their wishlist
    const santa = people[giftees.indexOf("Staff 0")]!;
    const seen = (await santa.call("GET", "/me/assignment")).json();
    expect(seen.giftee.wishes[0].title).toBe("Socks");

    // admin sees progress but never pairings
    const list = await admin.call("GET", "/admin/members");
    expect(list.json().members.every((m: { hasSpun: boolean }) => m.hasSpun)).toBe(true);
    expect(list.body).not.toMatch(/giftee/i);

    // once anyone has spun, the draw is locked
    expect((await admin.call("POST", "/admin/event/draw")).statusCode).toBe(409);
  });

  it("refuses a draw with fewer than 3 signed-in people", async () => {
    const { admin } = await companyWithStaff("tiny.test", 1);
    expect((await admin.call("POST", "/admin/event/draw")).statusCode).toBe(409);
  });

  it("enforces the company email domain", async () => {
    const { admin } = await companyWithStaff("dom.test", 0);
    const r = await admin.call("POST", "/admin/members", { name: "Out", email: "out@gmail.com" });
    expect(r.statusCode).toBe(400);
    const csv = await admin.call("POST", "/admin/members/import", { csv: "name,email\nA,a@dom.test\nB,b@gmail.com\nbad,notanemail", dryRun: true });
    expect(csv.json().toAdd).toBe(1);
    expect(csv.json().skipped).toHaveLength(2);
  });
});

describe("tenant isolation", () => {
  it("one company can never see or touch another's data", async () => {
    const a = await companyWithStaff("alpha.test", 3);
    const b = await companyWithStaff("beta.test", 3);

    const aMembers = (await a.admin.call("GET", "/admin/members")).json().members as { id: string; email: string }[];
    const bMembers = (await b.admin.call("GET", "/admin/members")).json().members as { id: string; email: string }[];
    expect(aMembers.every((m) => m.email.endsWith("alpha.test"))).toBe(true);
    expect(bMembers.every((m) => m.email.endsWith("beta.test"))).toBe(true);

    // B's admin tries to delete A's member by id: RLS makes it invisible
    const victim = aMembers.find((m) => m.email.startsWith("s0"))!;
    expect((await b.admin.call("DELETE", `/admin/members/${victim.id}`)).statusCode).toBe(404);
    expect((await a.admin.call("GET", "/admin/members")).json().members).toHaveLength(aMembers.length);

    // A staff member can't switch their session into company B
    expect((await a.staff[0]!.call("POST", "/me/org", { orgId: b.orgId })).statusCode).toBe(400);
  });

  it("staff can't use admin endpoints", async () => {
    const { staff } = await companyWithStaff("gamma.test", 1);
    for (const [m, u] of [["GET", "/admin/members"], ["GET", "/admin/overview"], ["POST", "/admin/event/draw"]] as const) {
      expect((await staff[0]!.call(m, u)).statusCode).toBe(403);
    }
  });

  it("the database itself hides rows when no company is set (RLS backstop)", async () => {
    const c = new pg.Client({ connectionString: appUrl });
    await c.connect();
    try {
      expect((await c.query("SELECT * FROM members")).rowCount).toBe(0);
      expect((await c.query("SELECT * FROM assignments")).rowCount).toBe(0);
      expect((await c.query("SELECT * FROM organizations")).rowCount).toBe(0);
      // and the app role can't turn RLS off or read the audit trail's deletions
      await expect(c.query("ALTER TABLE members DISABLE ROW LEVEL SECURITY")).rejects.toThrow();
      await expect(c.query("DELETE FROM audit_log")).rejects.toThrow();
    } finally {
      await c.end();
    }
  });
});
