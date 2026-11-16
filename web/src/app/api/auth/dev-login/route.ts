import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/server/api";
import { env } from "@/server/env";
import { convexClient, csrfBlock, json, newToken, setSession, sha256Hex, toResponse } from "@/server/session";

// Local development only: sign in as any email without Google.
// Not available when DEV_LOGIN is off, and env() refuses DEV_LOGIN=true in production.
export async function POST(req: NextRequest) {
  if (!env().DEV_LOGIN || env().NODE_ENV === "production") return json(404, "not_found", "Not found.");
  const blocked = csrfBlock(req);
  if (blocked) return blocked;

  const b = (await req.json().catch(() => null)) as { email?: unknown; name?: unknown; intent?: unknown } | null;
  const email = typeof b?.email === "string" ? b.email.trim() : "";
  const name = typeof b?.name === "string" ? b.name.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return json(400, "invalid_input", "Enter a valid email address.");
  if (!name || name.length > 60) return json(400, "invalid_input", "Name is required (60 characters max).");

  const token = newToken();
  try {
    const { next } = await convexClient().mutation(api.auth.signIn, {
      secret: env().CONVEX_SERVER_SECRET,
      sub: `dev:${email.toLowerCase()}`,
      email,
      name,
      tokenHash: sha256Hex(token),
      intent: b?.intent === "admin" ? "admin" : "staff",
    });
    const res = NextResponse.json({ next }, { headers: { "Cache-Control": "no-store" } });
    setSession(res, token);
    return res;
  } catch (e) {
    return toResponse(e);
  }
}
