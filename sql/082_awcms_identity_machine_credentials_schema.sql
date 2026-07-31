-- Machine credentials — read-only, scope-narrowed bearer tokens for callers
-- that are not people (ADR-0049). Closes the second of the two contract defects
-- ADR-0047 verified against staging: the only bearer this repo accepts is a
-- hashed SESSION token, and nothing in the family can issue one to a build.
--
-- ## A credential AUTHENTICATES; it never AUTHORIZES
--
-- Every row is bound to an existing `awcms_tenant_users` row (a service
-- account). Once the principal resolves, the chain below it is untouched:
-- module-enabled -> granted permission keys -> `evaluateAccess` (RBAC + ABAC
-- DSL, default-deny, deny-overrides-allow) -> decision log -> SoD chokepoint.
-- A credential carrying its own permission list would be a SECOND authorization
-- surface, which ADR-0048 §1 forbids.
--
-- ## `allowed_permission_keys` narrows and can never widen
--
-- Effective permissions are the INTERSECTION of the service account's granted
-- keys and this list. Granting the service account another role does not widen
-- an already-issued credential. The list may not be empty: empty means "can do
-- nothing" (fail-closed), never "unrestricted" — the opposite default is how an
-- allow-list becomes decoration.
--
-- ## Why not a `kind` column on `awcms_sessions`
--
-- Every invariant of that table assumes a person. "Revoke all sessions on
-- password reset" (sql/073) would silently kill builds; step-up rotation
-- (sql/024) assumes someone can step up.
CREATE TABLE IF NOT EXISTS awcms_machine_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The service account this credential authenticates AS. Composite FK
  -- (tenant_id, tenant_user_id): a plain FK to `awcms_tenant_users (id)` is
  -- checked by the FK machinery, which bypasses RLS, so it would not stop a row
  -- pointing at another tenant's user. `awcms_tenant_users` already carries the
  -- matching UNIQUE (tenant_id, id) added for exactly this reason.
  tenant_user_id uuid NOT NULL,
  name text NOT NULL,
  -- `mc-sha256:<hex>` of the full token: the same one-way function sessions
  -- use, in a namespace tagged so the guard chokepoint can tell the two kinds
  -- of bearer apart from the hash alone. The plaintext is shown once at
  -- issuance and never stored.
  token_hash text NOT NULL,
  -- Permission keys (`module.activity.action`) this credential may use, as an
  -- intersection filter over what the service account was granted.
  allowed_permission_keys text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_tenant_user_id uuid,
  created_by_tenant_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_machine_credentials_tenant_user_fk
    FOREIGN KEY (tenant_id, tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_machine_credentials_name_not_blank_check
    CHECK (length(btrim(name)) > 0),
  -- A session-namespace hash (`sha256:…`) must never be storable here: that
  -- would be a session token masquerading as a credential.
  CONSTRAINT awcms_machine_credentials_token_hash_format_check
    CHECK (token_hash ~ '^mc-sha256:[0-9a-f]{64}$'),
  -- Non-empty, and every entry a well-formed permission key. A malformed entry
  -- would silently never intersect anything, which reads as "the credential is
  -- broken" instead of "the list is wrong".
  CONSTRAINT awcms_machine_credentials_allowed_keys_not_empty_check
    CHECK (cardinality(allowed_permission_keys) > 0),
  -- No NULL element: `array_to_string` SKIPS nulls, so the format check below
  -- would happily pass an array whose only entry is NULL.
  CONSTRAINT awcms_machine_credentials_allowed_keys_no_null_check
    CHECK (array_position(allowed_permission_keys, NULL) IS NULL),
  -- Every element matches `module.activity.action`. Expressed over the joined
  -- string because a CHECK constraint may not contain a subquery, and there is
  -- no subquery-free way to say "every element matches" (`unnest` is one).
  -- Safe: the element pattern itself excludes the `,` separator.
  CONSTRAINT awcms_machine_credentials_allowed_keys_format_check
    CHECK (
      array_to_string(allowed_permission_keys, ',')
        ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*(,[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)*$'
    ),
  CONSTRAINT awcms_machine_credentials_expiry_after_creation_check
    CHECK (expires_at > created_at),
  CONSTRAINT awcms_machine_credentials_revoked_consistency_check
    CHECK (
      (revoked_at IS NULL AND revoked_by_tenant_user_id IS NULL)
      OR
      (revoked_at IS NOT NULL AND revoked_by_tenant_user_id IS NOT NULL)
    )
);

-- The authentication lookup path: WHERE tenant_id = ? AND token_hash = ?.
-- UNIQUE because two live credentials sharing a hash would mean a collision in
-- the token generator, and resolving it "somehow" is worse than refusing.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_machine_credentials_token_key
  ON awcms_machine_credentials (tenant_id, token_hash);

-- Admin listing path: WHERE tenant_id = ? ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS awcms_machine_credentials_tenant_created_idx
  ON awcms_machine_credentials (tenant_id, created_at DESC);

-- FK index (the composite FK's own leading column is `tenant_id`, which is not
-- selective on its own) — used when a service account is inspected or removed.
CREATE INDEX IF NOT EXISTS awcms_machine_credentials_tenant_user_idx
  ON awcms_machine_credentials (tenant_id, tenant_user_id);

ALTER TABLE awcms_machine_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_machine_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_machine_credentials_tenant_isolation
  ON awcms_machine_credentials
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- No `awcms_worker` grant, deliberately
-- ---------------------------------------------------------------------------
-- No scheduled job touches this table. Expiry is evaluated at authentication
-- time from `expires_at`, so there is nothing for a worker to sweep — and a
-- worker able to write here could mint a credential. Expired rows are kept as
-- an audit trail of what once existed.

-- ---------------------------------------------------------------------------
-- Decision log: WHICH credential, not just which account
-- ---------------------------------------------------------------------------
-- Several credentials may point at the same service account, so
-- `tenant_user_id` alone cannot answer the forensic question ("which token read
-- this"). Nullable: every human decision keeps writing NULL here, unchanged.
-- No FK — the decision log outlives the credential row it references, and an FK
-- would either block deletion or cascade away the audit trail.
ALTER TABLE awcms_abac_decision_logs
  ADD COLUMN IF NOT EXISTS machine_credential_id uuid;

CREATE INDEX IF NOT EXISTS awcms_abac_decision_logs_machine_credential_idx
  ON awcms_abac_decision_logs (tenant_id, machine_credential_id, created_at DESC)
  WHERE machine_credential_id IS NOT NULL;
