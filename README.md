# Secret Santa

Companies sign up, add their staff, everyone signs in with Google, writes a wishlist and spins a wheel once to see who they're buying for.

- `web/`: Next.js frontend. The browser only talks to `/api/*` on the same origin, which Next proxies to the API.
- `api/`: Node.js (Fastify + TypeScript) API with PostgreSQL.

## Run it locally

Needs Node 22+. No Docker and no Postgres install: dev uses `embedded-postgres`, a real PostgreSQL 17 stored in `api/.pgdata`.

```bash
cd api && npm install
cp .env.example .env    # then fill ASSIGNMENT_KEY, APP_DB_PASSWORD (see comments in the file)
npm run db:start        # terminal 1: leaves Postgres running
npm run migrate
npm run dev             # terminal 2: API on 127.0.0.1:4000
```

```bash
cd web && npm install
cp .env.example .env.local   # set NEXT_PUBLIC_DEV_LOGIN=true for local testing
npm run dev                  # http://localhost:3000
```

Without Google credentials, use the "Developer sign-in" form on `/login`. It needs `DEV_LOGIN=true` in `api/.env`, and the API refuses to start with it in production.

Tests (they use the `secret_santa_test` database, so Postgres must be running):

```bash
cd api && npm test
```

## Turn on Google sign-in

1. Google Cloud Console → APIs & Services → OAuth consent screen: set it up (External, or Internal if everyone is in one Workspace).
2. Credentials → Create credentials → OAuth client ID → Web application.
3. Authorized redirect URI: `http://localhost:3000/api/auth/google/callback` (plus your production `https://<domain>/api/auth/google/callback`).
4. Put the client ID and secret in `api/.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Never commit them.

## How the security works

| Risk | Control |
|---|---|
| Stolen passwords | No passwords. Google OIDC with PKCE, state and nonce; ID token signature, issuer, audience and expiry checked; only verified emails accepted. |
| Session theft / fixation | Random 256-bit session token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` + `Secure` in production). Only its SHA-256 is stored. 14-day absolute and 3-day idle expiry. Logout deletes it server-side. |
| CSRF | State-changing requests must carry our `Origin` and a JSON body; SameSite cookies on top. |
| One company seeing another's data | Every query runs inside a transaction that sets `app.org_id`, and Postgres row-level security filters every tenant table. The app connects as `ss_app`, which owns nothing and can't bypass RLS. Tests prove cross-company reads and deletes fail. |
| Admin peeking at pairings | Pairings are AES-256-GCM encrypted, bound to their row (AAD = event + giver), and no endpoint returns them to admins. Admins only see "has spun". |
| Rigged or broken draw | The server draws one random cycle with a CSPRNG before anyone spins: nobody gets themselves, no A-B-A pairs. The wheel only animates to the server's answer. A redraw is allowed only until the first spin. |
| Abuse / brute force | Rate limits per signed-in user (offices share one IP) and per IP for anonymous traffic; tighter limits on sign-in, spin, draw and company creation (3 per user). |
| Bad input | Zod validation on every body; length limits in both API and DB; wishlist links must be `https://`. |
| Leaky errors and logs | Generic 500 messages; cookies and auth headers redacted from logs; config errors print field names, never values. |
| Headers | Helmet on the API; CSP, `nosniff`, `frame-ancestors 'none'`, HSTS (production) on the web app. |

## Before production

- Point `DATABASE_URL` (app role) and `MIGRATION_DATABASE_URL` (owner role) at a managed Postgres with TLS, and run `npm run migrate` on deploy.
- `NODE_ENV=production`, `APP_ORIGIN=https://…`, `DEV_LOGIN=false`, a fresh `ASSIGNMENT_KEY` kept in the host's secret manager. **Losing `ASSIGNMENT_KEY` makes existing pairings unreadable.**
- The API should only be reachable from the web app (private networking or an allowlist). It trusts exactly one proxy hop for client IPs.
- Not built yet: invite and reminder emails (needs an email provider), exclusion rules (couples, same team), closing an event or starting next year's, and nonce-based CSP.
