# Secret Santa

Companies sign up, add their staff, everyone signs in with Google, writes a wishlist and spins a wheel once to see who they're buying for.

- `web/`: Next.js app. The browser only talks to `/api/*` on the same origin. Those are Next route handlers (`web/src/app/api`) that read the HttpOnly session cookie and call Convex.
- `web/convex/`: the backend and database ([Convex](https://convex.dev)): schema, auth/session logic, the draw, the one-time spin.
- `api/`: the Node.js backend (Fastify + TypeScript + PostgreSQL). It is kept in the repo, tracked and tested, and still runs standalone, but **the web app does not call it on this branch**: the Next route handlers talk to Convex instead. See "Node API (`api/`)" below. The original, pre-Convex state is also on the `legacy-postgres` branch.

## Run it locally

Needs Node 22+.

```bash
cd web && npm install
npx convex dev                # first time: log in, create the project. Leave it running (terminal 1)
npm run setup:secrets         # once: generates the secrets and puts them in Convex + web/.env.local (prints none)
# add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to web/.env.local yourself (see below)
npm run dev                   # http://localhost:3000 (terminal 2)
```

`web/.env.local` variables (all server-side except `NEXT_PUBLIC_*`):

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT` | Written by `npx convex dev` |
| `APP_ORIGIN` | Public URL of the app, e.g. `http://localhost:3000` (https in production) |
| `CONVEX_SERVER_SECRET` | Must equal `SERVER_SECRET` in the Convex env. Only the Next server can open sessions |
| `COOKIE_SECRET` | Signs the short-lived Google sign-in state cookie |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
| `DEV_LOGIN`, `NEXT_PUBLIC_DEV_LOGIN` | `true` for the "Developer sign-in" form, local only. The server refuses `DEV_LOGIN=true` in production |

Convex env (set by `setup:secrets`, view with `npx convex env list`): `SERVER_SECRET` and `ASSIGNMENT_KEY`. **Losing `ASSIGNMENT_KEY` makes existing pairings unreadable**, so keep a copy in your secret manager. Without Google credentials, use the "Developer sign-in" form on `/login`.

## Node API (`api/`)

The Fastify + PostgreSQL backend from before the Convex move. It is a complete, working API (Google OIDC, row-level security, the encrypted draw, the one-time spin, rate limits) with its own tests (`npm test`, 23 passing). It is kept so the Node code is in the project, but the running app does not use it:

| | `web/` + Convex (what runs) | `api/` (kept) |
|---|---|---|
| Database | Convex | PostgreSQL (`embedded-postgres` in dev) |
| Auth and data calls | Next route handlers in `web/src/app/api` | Fastify routes in `api/src/routes`, on port 4000 |
| Rate limiting | Not implemented yet | Implemented (`@fastify/rate-limit`) |

To run it on its own (needs Node 22+; it does not need Convex):

```bash
cd api && npm install
cp .env.example .env     # fill ASSIGNMENT_KEY and APP_DB_PASSWORD (see the comments in the file)
npm run db:start         # terminal 1: Postgres on 127.0.0.1:54329
npm run migrate
npm run dev              # terminal 2: API on 127.0.0.1:4000
npm test                 # needs Postgres running
```

Two things to know before relying on it:

- **Keep the two backends' rules in step.** The draw, the one-time spin and the sign-in landing rules exist twice (`api/src/routes/me.ts`, `auth.ts` and `web/convex/me.ts`, `auth.ts`). Change one, change the other, or they will drift.
- **To point the web app at it** you would have to replace the Next route handlers in `web/src/app/api` with a proxy to `http://127.0.0.1:4000` (the old `next.config.ts` rewrite). That is not wired up, and `api/` has its own `ASSIGNMENT_KEY`, so pairings do not move between the two backends.

## Turn on Google sign-in

1. Google Cloud Console → APIs & Services → OAuth consent screen: set it up (External, or Internal if everyone is in one Workspace).
2. Credentials → Create credentials → OAuth client ID → Web application.
3. Authorized redirect URI: `http://localhost:3000/api/auth/google/callback` (plus your production `https://<domain>/api/auth/google/callback`).
4. Put the client ID and secret in `web/.env.local` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, then restart `npm run dev`. Never commit them.

## How the security works

| Risk | Control |
|---|---|
| Stolen passwords | No passwords. Google OIDC with PKCE, state and nonce; ID token signature, issuer, audience and expiry checked; only verified emails accepted. |
| Session theft / fixation | Random 256-bit session token in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` + `Secure` in production). Only its SHA-256 is stored. 14-day absolute and 3-day idle expiry. Logout deletes it server-side. |
| CSRF | State-changing requests must carry our `Origin` and a JSON body; SameSite cookies on top. |
| One company seeing another's data | Convex has no row-level security, so isolation is enforced in code: every function resolves the caller's session, takes the company from that session (never from the request), and re-checks `orgId` on any record fetched by id. This is the weakest point of the migration: **every new function must do the same**. An end-to-end run covered cross-company delete and member listing. |
| Admin peeking at pairings | Pairings are AES-256-GCM encrypted, bound to their row (AAD = event + giver), and no endpoint returns them to admins. Admins only see "has spun". |
| Rigged or broken draw | The server draws one random cycle with a CSPRNG before anyone spins: nobody gets themselves, no A-B-A pairs. The wheel only animates to the server's answer. A redraw is allowed only until the first spin. |
| Abuse / brute force | Company creation is capped at 3 per user. **Request rate limits are not implemented yet** (the old Fastify limiter is gone). Add one (e.g. the Convex rate-limiter component, or your host's edge limits) before public launch. |
| Bad input | Every Convex function validates and trims its arguments (types via Convex validators, lengths and formats in `convex/lib/common.ts`); wishlist links must be `https://`. |
| Forged sessions | Convex functions are public, but they need a session token only the cookie holds. Opening a session (`auth:signIn`) additionally needs `SERVER_SECRET`, known only to the Next server and the Convex env. |
| Leaky errors and logs | Generic 500 messages; config errors print field names, never values. |
| Headers | CSP, `nosniff`, `frame-ancestors 'none'`, HSTS (production) on the web app. |

## Before production

- Create a production Convex deployment (`npx convex deploy`), set `SERVER_SECRET` and `ASSIGNMENT_KEY` on it (`npx convex env set --prod ...`), and give the web host `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_SERVER_SECRET` (same as `SERVER_SECRET`), `COOKIE_SECRET`, `GOOGLE_CLIENT_ID/SECRET` and `APP_ORIGIN`.
- `NODE_ENV=production`, `APP_ORIGIN=https://…`, `DEV_LOGIN=false`, and a fresh `ASSIGNMENT_KEY` kept in the host's secret manager. **Losing `ASSIGNMENT_KEY` makes existing pairings unreadable.**
- Add request rate limiting (see the table above).
- Not built yet: invite and reminder emails (needs an email provider), exclusion rules (couples, same team), closing an event or starting next year's, and nonce-based CSP.
