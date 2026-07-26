-- Email-based password reset (Wave 2 delta auth, adapted from awcms-micro
-- Issue #496). The FIRST real producer of `awcms_email_messages` (sql/014) in
-- this repo: `email`'s `auth.password_reset` template category and default
-- template have shipped since sql/014 with no caller — this migration adds the
-- table that makes that flow real.
--
-- `awcms_password_reset_tokens` mirrors `awcms_sessions`'s shape (sql/004) —
-- `token_hash` (never the raw token), `expires_at` — plus `used_at` for
-- single-use enforcement. A session needs no such column (it is valid until it
-- expires or is explicitly revoked); a reset token must never be redeemable
-- twice even while it is still fresh, and `used_at` is also what
-- `requestPasswordReset` writes when it supersedes an older outstanding token.
--
-- RLS is ENABLE **and** FORCE inline. `awcms_sessions` itself is only
-- `ENABLE`d in sql/004 and was FORCE'd retroactively later; every table added
-- since follows the convention directly, because `ENABLE` without `FORCE` is
-- inert for the table owner and would leave this table's rows readable
-- cross-tenant by any connection that owns it.
CREATE TABLE IF NOT EXISTS awcms_password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  identity_id uuid NOT NULL REFERENCES awcms_identities (id),
  token_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Redemption lookup path: WHERE tenant_id = ? AND token_hash = ?. UNIQUE on the
-- hash alone (not per tenant) because a collision would otherwise let one raw
-- token match two rows — astronomically unlikely for sha256 over 32 CSPRNG
-- bytes, but the constraint costs nothing and writes the invariant down.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_password_reset_tokens_hash_key
  ON awcms_password_reset_tokens (token_hash);

-- Supersede-outstanding-tokens path at request time:
-- WHERE tenant_id = ? AND identity_id = ? AND used_at IS NULL.
CREATE INDEX IF NOT EXISTS awcms_password_reset_tokens_identity_idx
  ON awcms_password_reset_tokens (tenant_id, identity_id)
  WHERE used_at IS NULL;

-- Purge cursor path for the data_lifecycle GENERIC engine, which sweeps
-- WHERE tenant_id = ? AND created_at < ? (see the `identity_access.password_reset_tokens`
-- descriptor in identity-access/module.ts).
CREATE INDEX IF NOT EXISTS awcms_password_reset_tokens_tenant_created_idx
  ON awcms_password_reset_tokens (tenant_id, created_at);

ALTER TABLE awcms_password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_password_reset_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_password_reset_tokens_tenant_isolation
  ON awcms_password_reset_tokens
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Least-privilege `awcms_worker` grant
-- ---------------------------------------------------------------------------
-- `awcms_app` inherits its table privileges from the blanket grant in migration
-- 019; RLS FORCE above is what actually confines it to one tenant.
--
-- The worker role runs the data_lifecycle GENERIC purge engine over this table
-- (same pattern as `awcms_site_search_query_log` in migration 064 and
-- `awcms_comments_abuse_events` in migration 066), which needs SELECT + DELETE
-- and nothing else: the worker never issues a reset token and never redeems
-- one, so no INSERT and no UPDATE. RLS FORCE applies to the worker too, so each
-- withTenant-scoped pass still sees only its own tenant's rows.
GRANT SELECT, DELETE ON awcms_password_reset_tokens TO awcms_worker;
