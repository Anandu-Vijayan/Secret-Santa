import { type NextRequest, type NextResponse } from "next/server";
import { api } from "@/server/api";
import { convexClient, csrfBlock, json, ok, sessionToken, toResponse } from "@/server/session";

/**
 * The browser's only door to the data. It keeps the HttpOnly session cookie out of JavaScript:
 * this handler reads the cookie, calls the Convex function as that session, and returns the same
 * JSON the old REST API did, so the pages didn't need to change.
 * (Google sign-in, dev-login and logout have their own route files, which win over this catch-all.)
 */
type Ctx = { c: ReturnType<typeof convexClient>; token: string; body: Record<string, unknown>; id?: string };
type Handler = (x: Ctx) => Promise<unknown>;

const T = (x: Ctx) => ({ token: x.token });
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

const routes: { method: string; path: string; run: Handler }[] = [
  // ---- me ----
  { method: "GET", path: "/me", run: (x) => x.c.mutation(api.me.load, T(x)) },
  { method: "POST", path: "/me/org", run: (x) => x.c.mutation(api.me.selectOrg, { ...T(x), orgId: str(x.body.orgId) as string }) },
  {
    method: "PATCH",
    path: "/me/profile",
    run: (x) => x.c.mutation(api.me.updateProfile, { ...T(x), name: str(x.body.name) as string, department: str(x.body.department) as string }),
  },
  { method: "GET", path: "/me/wishes", run: (x) => x.c.query(api.me.wishes, T(x)) },
  {
    method: "PUT",
    path: "/me/wishes",
    run: (x) => x.c.mutation(api.me.setWishes, { ...T(x), wishes: x.body.wishes as never }),
  },
  { method: "POST", path: "/me/spin", run: (x) => x.c.mutation(api.me.spin, T(x)) },
  { method: "GET", path: "/me/assignment", run: (x) => x.c.query(api.me.assignment, T(x)) },
  // ---- companies and admin ----
  {
    method: "POST",
    path: "/orgs",
    run: (x) =>
      x.c.mutation(api.admin.createOrg, {
        ...T(x),
        name: str(x.body.name) as string,
        allowedDomain: str(x.body.allowedDomain),
        event: x.body.event as never,
      }),
  },
  { method: "GET", path: "/admin/overview", run: (x) => x.c.query(api.admin.overview, T(x)) },
  { method: "GET", path: "/admin/members", run: (x) => x.c.query(api.admin.members, T(x)) },
  {
    method: "POST",
    path: "/admin/members",
    run: (x) =>
      x.c.mutation(api.admin.addMember, { ...T(x), name: str(x.body.name) as string, email: str(x.body.email) as string, department: str(x.body.department) }),
  },
  {
    method: "POST",
    path: "/admin/members/import",
    run: (x) =>
      x.c.mutation(api.admin.importMembers, {
        ...T(x),
        csv: str(x.body.csv) as string,
        dryRun: typeof x.body.dryRun === "boolean" ? x.body.dryRun : undefined,
      }),
  },
  {
    method: "PATCH",
    path: "/admin/members/:id",
    run: (x) => x.c.mutation(api.admin.updateMemberEmail, { ...T(x), id: x.id as string, email: str(x.body.email) as string }),
  },
  { method: "DELETE", path: "/admin/members/:id", run: (x) => x.c.mutation(api.admin.removeMember, { ...T(x), id: x.id as string }) },
  {
    method: "PATCH",
    path: "/admin/event",
    run: (x) =>
      x.c.mutation(api.admin.updateEvent, {
        ...T(x),
        name: str(x.body.name),
        budget: str(x.body.budget),
        exchangeDate: x.body.exchangeDate === null ? null : str(x.body.exchangeDate),
      }),
  },
  { method: "POST", path: "/admin/event/draw", run: (x) => x.c.mutation(api.admin.draw, T(x)) },
];

function match(method: string, segments: string[]): { run: Handler; id?: string } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const parts = r.path.split("/").filter(Boolean);
    if (parts.length !== segments.length) continue;
    let id: string | undefined;
    const hit = parts.every((p, i) => (p === ":id" ? ((id = segments[i]), true) : p === segments[i]));
    if (hit) return { run: r.run, id };
  }
  return null;
}

async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const blocked = csrfBlock(req);
  if (blocked) return blocked;

  const { path } = await params;
  const found = match(req.method, path);
  if (!found) return json(404, "not_found", "Not found.");

  let body: Record<string, unknown> = {};
  if (!["GET", "HEAD", "DELETE"].includes(req.method)) {
    const raw = await req.text();
    if (raw.length > 1_100_000) return json(413, "too_large", "That request is too large.");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
        else return json(400, "invalid_input", "Invalid input.");
      } catch {
        return json(400, "invalid_input", "Invalid input.");
      }
    }
  }

  try {
    return ok(await found.run({ c: convexClient(), token: sessionToken(req), body, id: found.id }));
  } catch (e) {
    return toResponse(e);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
