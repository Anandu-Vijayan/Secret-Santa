import { type NextRequest } from "next/server";
import { api } from "@/server/api";
import { env } from "@/server/env";
import { clearSession, convexClient, csrfBlock, ok, sessionToken, sha256Hex, toResponse } from "@/server/session";

export async function POST(req: NextRequest) {
  const blocked = csrfBlock(req);
  if (blocked) return blocked;
  const token = sessionToken(req);
  try {
    if (token) await convexClient().mutation(api.auth.signOut, { secret: env().CONVEX_SERVER_SECRET, tokenHash: sha256Hex(token) });
  } catch (e) {
    return toResponse(e);
  }
  const res = ok({ ok: true });
  clearSession(res);
  return res;
}
