-- BFF session handoff (ADR-0050) — the awcms half of "`awcms-astro` obtains a
-- human session with a one-time code, never by proxying a password".
--
-- ## The problem this closes
--
-- `awcms` sets `awcms_session`/`awcms_tenant_id` as httpOnly cookies on its OWN
-- origin. A browser on the `awcms-astro` origin will never send them, and must
-- not — that is an origin boundary working, not a gap to patch. So a BFF had no
-- way to obtain a session for a human at all, and the obvious workaround (a
-- login form in `awcms-astro` that proxies `POST /api/v1/auth/login`) was
-- rejected twice over: it puts a password through a repo that is not the
-- identity store, and login here is NOT one step — it can answer
-- `401 MFA_REQUIRED`, redirect into a tenant's OIDC provider, or demand a
-- Turnstile token. Proxying it means a second implementation of MFA
-- continuation, OIDC callback, and the Turnstile widget in a second repo.
--
-- The handoff code is the part of an OIDC authorization-code flow that is
-- actually needed, without building a provider (discovery, JWKS, refresh,
-- userinfo, consent) for one trusted client on the same network.
--
-- ## Why the code does NOT carry a session token
--
-- The obvious shape — mint the code at login, store the session token beside
-- it, hand the token back at redeem — stores a live credential at rest for up
-- to a minute. This table stores `identity_id` and the assurance level the
-- login actually REACHED instead, and redemption mints a fresh session through
-- `createSessionWithAssurance`. Nothing credential-bearing is stored anywhere
-- but the one-way hash of the code itself.
--
-- That also composes correctly with MFA rather than around it: a login that
-- ended at `aal2` yields a `aal2` BFF session, and one that did not cannot be
-- upgraded by the handoff.

-- ---------------------------------------------------------------------------
-- Registered BFF clients
-- ---------------------------------------------------------------------------
-- A client is registered by an operator, not self-served. There is exactly one
-- today (`awcms-astro`); ADR-0050 says a THIRD, untrusted client is a decision
-- to revisit with its own ADR, not something to accommodate in advance.
CREATE TABLE IF NOT EXISTS awcms_bff_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Public identifier, appears in the `/login?handoff=` URL. Not a secret, and
  -- must never be treated as one — the secret below is what authenticates.
  client_key text NOT NULL,
  name text NOT NULL,
  -- `bff-sha256:<hex>`, its own namespace so a session hash (`sha256:…`) or a
  -- machine-credential hash (`mc-sha256:…`) can never be stored here and be
  -- accepted as a client secret. Same one-way function, same
  -- shown-once-never-stored discipline as `awcms_machine_credentials`.
  secret_hash text NOT NULL,
  -- EXACT-match allow-list. ADR-0050 names the open-redirect here as the way
  -- this design fails: a redirect_uri a caller can influence hands the code to
  -- an attacker, and every other property of the flow stops mattering. Never a
  -- prefix or pattern match — see the format check below.
  redirect_uris text[] NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_bff_clients_client_key_format_check
    CHECK (client_key ~ '^[a-z][a-z0-9_-]{2,63}$'),
  CONSTRAINT awcms_bff_clients_name_not_blank_check
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT awcms_bff_clients_secret_hash_format_check
    CHECK (secret_hash ~ '^bff-sha256:[0-9a-f]{64}$'),
  CONSTRAINT awcms_bff_clients_redirect_uris_not_empty_check
    CHECK (cardinality(redirect_uris) > 0),
  -- `array_position` on a NULL element: `array_to_string` SKIPS nulls, so the
  -- format check below would pass an array whose only entry is NULL.
  CONSTRAINT awcms_bff_clients_redirect_uris_no_null_check
    CHECK (array_position(redirect_uris, NULL) IS NULL),
  -- Every entry absolute `https://`, no query, no fragment. A fragment would
  -- be dropped by the browser before the BFF ever saw it; a query would make
  -- "exact match" ambiguous the moment anyone appended a parameter. `http://`
  -- is refused outright — the code would cross the wire in clear text.
  -- Expressed over the joined string because a CHECK may not contain a
  -- subquery, and the element pattern excludes the `,` separator.
  CONSTRAINT awcms_bff_clients_redirect_uris_format_check
    CHECK (
      array_to_string(redirect_uris, ',')
        ~ '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?(/[a-zA-Z0-9._~/-]*)?(,https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?(/[a-zA-Z0-9._~/-]*)?)*$'
    ),
  CONSTRAINT awcms_bff_clients_tenant_key_unique UNIQUE (tenant_id, client_key),
  -- Target for the composite FK below: a plain FK to `(id)` is enforced by the
  -- FK machinery, which BYPASSES RLS, so it would not stop a handoff row
  -- pointing at another tenant's client.
  CONSTRAINT awcms_bff_clients_tenant_id_unique UNIQUE (tenant_id, id)
);

-- The authentication lookup: WHERE tenant_id = ? AND client_key = ?. Already
-- served by `awcms_bff_clients_tenant_key_unique`.

ALTER TABLE awcms_bff_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_bff_clients FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_bff_clients_tenant_isolation
  ON awcms_bff_clients
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- One-time handoff codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_session_handoff_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  client_id uuid NOT NULL,
  -- `ho-sha256:<hex>`. The plaintext is returned once, to the browser that just
  -- authenticated, and never stored.
  code_hash text NOT NULL,
  -- WHO the code will mint a session for. Not a session id and not a token:
  -- see this file's header for why nothing credential-bearing is stored.
  identity_id uuid NOT NULL,
  -- The assurance the login actually reached. Redemption mints a session AT
  -- this level — never above it, so a handoff can never launder an aal1 login
  -- into an aal2 session.
  assurance_level text NOT NULL,
  -- Pinned at issuance and re-checked at redemption. Binding the code to one
  -- URI is what makes a leaked code useless somewhere else.
  redirect_uri text NOT NULL,
  -- The session that asked for this code. Kept for forensics: "which login
  -- produced this handoff" is the question an incident actually asks.
  issued_by_session_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_session_handoff_codes_client_fk
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES awcms_bff_clients (tenant_id, id),
  CONSTRAINT awcms_session_handoff_codes_code_hash_format_check
    CHECK (code_hash ~ '^ho-sha256:[0-9a-f]{64}$'),
  CONSTRAINT awcms_session_handoff_codes_assurance_check
    CHECK (assurance_level IN ('aal1', 'aal2')),
  CONSTRAINT awcms_session_handoff_codes_redirect_uri_format_check
    CHECK (redirect_uri ~ '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?(/[a-zA-Z0-9._~/-]*)?$'),
  -- ADR-0050 §2: short-lived, at most 60 seconds. Enforced by the DATABASE, not
  -- only by the constant in the code that writes it — a TTL that lives in one
  -- TypeScript constant is a TTL an edit can quietly widen to an hour.
  CONSTRAINT awcms_session_handoff_codes_ttl_check
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 seconds'),
  -- Two live codes sharing a hash would be a collision in the generator, and
  -- resolving it "somehow" is worse than refusing.
  CONSTRAINT awcms_session_handoff_codes_hash_unique UNIQUE (tenant_id, code_hash)
);

-- The redemption path: WHERE tenant_id = ? AND code_hash = ?, served by the
-- unique constraint above.

-- The sweep path for `awcms_worker`: expired-or-redeemed rows, oldest first.
CREATE INDEX IF NOT EXISTS awcms_session_handoff_codes_expiry_idx
  ON awcms_session_handoff_codes (tenant_id, expires_at);

ALTER TABLE awcms_session_handoff_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_session_handoff_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_session_handoff_codes_tenant_isolation
  ON awcms_session_handoff_codes
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Redeemed rows are KEPT, not deleted
-- ---------------------------------------------------------------------------
-- `redeemed_at` is set rather than the row removed, so a replayed code answers
-- "already redeemed" from evidence instead of from the absence of evidence.
-- A deleted row and a code that never existed are indistinguishable, and the
-- difference between them is exactly what an incident needs to know.
--
-- No worker grant and no purge job yet: nothing sweeps these today, and the
-- rows are tiny. When retention becomes a question it is `data_lifecycle`'s to
-- answer, not a bespoke sweeper here.
