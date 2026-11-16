-- Secret Santa: initial schema.
-- Runs as the owner role. The app connects as ss_app, which owns nothing and
-- cannot bypass row-level security. Every tenant table is filtered by
-- current_setting('app.org_id'), set per transaction by the API.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- identities (global)
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  text NOT NULL UNIQUE,
  email       citext NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_login  timestamptz
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  bytea NOT NULL UNIQUE,          -- sha256 of the cookie value; raw token never stored
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      uuid,                           -- currently selected company
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ---------------------------------------------------------------- tenants
CREATE TABLE organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  allowed_domain  citext CHECK (allowed_domain IS NULL OR allowed_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,   -- null until they first sign in
  email       citext NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  department  text NOT NULL DEFAULT '' CHECK (length(department) <= 40),
  role        text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  status      text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email),
  UNIQUE (org_id, user_id)
);
CREATE INDEX members_email_idx ON members(email);

CREATE TABLE wishes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  position    smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  price       text CHECK (length(price) <= 20),
  link        text CHECK (link IS NULL OR (link ~ '^https://' AND length(link) <= 500)),
  note        text CHECK (length(note) <= 120),
  UNIQUE (member_id, position)
);

CREATE TABLE events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  budget         text NOT NULL DEFAULT '' CHECK (length(budget) <= 20),
  exchange_date  date,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  drawn_at       timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- v1: one active (non-closed) event per company
CREATE UNIQUE INDEX events_one_active ON events(org_id) WHERE status <> 'closed';

CREATE TABLE assignments (
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  giver_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  giftee_enc   text NOT NULL,                -- AES-256-GCM(giftee member id), AAD = event_id:giver_id
  revealed_at  timestamptz,
  PRIMARY KEY (event_id, giver_id)
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES members(id) ON DELETE SET NULL,
  action      text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- row-level security
CREATE FUNCTION app_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant ON organizations USING (id = app_org()) WITH CHECK (id = app_org());
CREATE POLICY tenant ON members       USING (org_id = app_org()) WITH CHECK (org_id = app_org());
CREATE POLICY tenant ON wishes        USING (org_id = app_org()) WITH CHECK (org_id = app_org());
CREATE POLICY tenant ON events        USING (org_id = app_org()) WITH CHECK (org_id = app_org());
CREATE POLICY tenant ON assignments   USING (org_id = app_org()) WITH CHECK (org_id = app_org());
CREATE POLICY tenant ON audit_log     USING (org_id = app_org()) WITH CHECK (org_id = app_org());

-- ---------------------------------------------------------------- narrow cross-tenant helpers
-- The only paths that cross tenants. SECURITY DEFINER with a pinned search_path.

-- After Google sign-in: attach this user to every company that invited their verified email.
CREATE FUNCTION claim_memberships(p_user uuid, p_email citext) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE members SET user_id = p_user, status = 'active'
   WHERE email = p_email AND user_id IS NULL;
$$;

-- Companies this user belongs to (for the org picker / auto-select).
CREATE FUNCTION user_orgs(p_user uuid)
  RETURNS TABLE (org_id uuid, org_name text, member_id uuid, role text, org_status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, o.name, m.id, m.role, o.status
    FROM members m JOIN organizations o ON o.id = m.org_id
   WHERE m.user_id = p_user
   ORDER BY o.created_at;
$$;

-- Create a company plus its first admin atomically (the org row doesn't exist yet,
-- so RLS can't be satisfied by the caller). Caps companies per user to limit abuse.
CREATE FUNCTION create_org(p_user uuid, p_name text, p_domain citext, p_admin_email citext, p_admin_name text)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org uuid;
BEGIN
  IF (SELECT count(*) FROM organizations WHERE created_by = p_user) >= 3 THEN
    RAISE EXCEPTION 'org_limit' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO organizations (name, allowed_domain, created_by) VALUES (p_name, p_domain, p_user) RETURNING id INTO v_org;
  INSERT INTO members (org_id, user_id, email, name, role, status)
       VALUES (v_org, p_user, p_admin_email, p_admin_name, 'admin', 'active');
  RETURN v_org;
END $$;

REVOKE ALL ON FUNCTION claim_memberships(uuid, citext) FROM PUBLIC;
REVOKE ALL ON FUNCTION user_orgs(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_org(uuid, text, citext, citext, text) FROM PUBLIC;
