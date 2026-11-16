import * as oidc from "openid-client";
import { env } from "./env";

let cached: oidc.Configuration | null = null;

/** Google's OIDC configuration, or null when credentials aren't set. */
export async function googleConfig(): Promise<oidc.Configuration | null> {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
  if (!GOOGLE_CLIENT_ID) return null;
  cached ??= await oidc.discovery(new URL("https://accounts.google.com"), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  return cached;
}

export const redirectUri = () => `${env().APP_ORIGIN}/api/auth/google/callback`;
export { oidc };
