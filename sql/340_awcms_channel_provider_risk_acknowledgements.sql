-- Provider risk acknowledgements (Issue #1142, ADR-0148 section 4 and 7).
--
-- StarSender is an UNOFFICIAL WhatsApp gateway, the single recorded exception to
-- "official interfaces only" (ADR-0148 I6). Its adapter is OFF by default and a
-- device may become `connected` only after an accountable person has recorded an
-- acknowledgement of the risk: WHICH provider, WHO, WHEN, and WHICH version of the
-- text (with the SHA-256 of the exact words shown). An acknowledgement is revocable
-- and is never edited or deleted: a revocation is a stamp on the row, so the record
-- of who accepted what, and when it was withdrawn, survives.
--
-- ## What the database decides, and what it leaves to the application
--
--   * The rows are append-only except for the revocation stamp (one NULL -> value
--     transition of `revoked_at`/`revoked_by`), and are never deleted.
--   * A `starsender` account cannot be INSERTed or moved to `connected` while the
--     tenant holds no active acknowledgement of that provider. The database cannot
--     know which text version is CURRENT (that is code and a human approval), so it
--     checks that SOME acknowledgement is active; the application checks the current
--     version at every send decision (`ChannelAccountPort`), at enqueue and again at
--     dispatch. The trigger is the net under the application, not a replacement.
--
-- ## Who reads it
--
-- `awcms_worker` (the WhatsApp dispatcher resolves a sender through
-- `ChannelAccountPort`) gets COLUMN-ONLY SELECT on the columns the check needs and
-- nothing else: not the acting person, not the hash. It writes nothing.
--
-- Pure DDL. Both functions pin `search_path` and run as the invoker.
CREATE TABLE IF NOT EXISTS awcms_channel_provider_risk_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  provider text NOT NULL,
  tenant_user_id uuid NOT NULL,
  text_version text NOT NULL,
  text_sha256 text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_channel_provider_risk_acks_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_channel_provider_risk_acks_provider_check
    CHECK (provider IN ('starsender')),
  CONSTRAINT awcms_channel_provider_risk_acks_text_version_check
    CHECK (char_length(text_version) BETWEEN 1 AND 80),
  CONSTRAINT awcms_channel_provider_risk_acks_text_sha256_check
    CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_channel_provider_risk_acks_revocation_check
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT awcms_channel_provider_risk_acks_user_fk
    FOREIGN KEY (tenant_id, tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_channel_provider_risk_acks_revoked_by_fk
    FOREIGN KEY (tenant_id, revoked_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- One ACTIVE acknowledgement per (person, provider, text version): a double
-- submit is a no-op answered with the existing row, never a second record.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_channel_provider_risk_acks_active_key
  ON awcms_channel_provider_risk_acknowledgements
    (tenant_id, provider, tenant_user_id, text_version)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_provider_risk_acks_active_provider_idx
  ON awcms_channel_provider_risk_acknowledgements
    (tenant_id, provider, text_version)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_channel_provider_risk_acks_list_idx
  ON awcms_channel_provider_risk_acknowledgements
    (tenant_id, acknowledged_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS awcms_channel_provider_risk_acks_user_idx
  ON awcms_channel_provider_risk_acknowledgements (tenant_id, tenant_user_id);

CREATE INDEX IF NOT EXISTS awcms_channel_provider_risk_acks_revoked_by_idx
  ON awcms_channel_provider_risk_acknowledgements (tenant_id, revoked_by)
  WHERE revoked_by IS NOT NULL;

COMMENT ON TABLE awcms_channel_provider_risk_acknowledgements IS
  'Issue #1142 / ADR-0148 section 7 — a person''s recorded acknowledgement of the risk of an UNOFFICIAL provider (provider, who, when, text version and hash). Revocable by stamp; never edited or deleted. A starsender device cannot be connected without an active one.';

ALTER TABLE awcms_channel_provider_risk_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_channel_provider_risk_acknowledgements FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_channel_provider_risk_acks_tenant_isolation
  ON awcms_channel_provider_risk_acknowledgements
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- The dispatcher resolves a sender through the channel-account port and must see
-- whether the tenant's acknowledgement of this version is still in force.
GRANT SELECT (id, tenant_id, provider, text_version, revoked_at)
  ON awcms_channel_provider_risk_acknowledgements TO awcms_worker;

-- Append-only apart from the revocation stamp; never deleted.
CREATE OR REPLACE FUNCTION awcms_channel_provider_risk_acks_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a provider risk acknowledgement is never deleted: it is revoked'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.tenant_user_id IS DISTINCT FROM OLD.tenant_user_id
     OR NEW.text_version IS DISTINCT FROM OLD.text_version
     OR NEW.text_sha256 IS DISTINCT FROM OLD.text_sha256
     OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a provider risk acknowledgement is immutable; only its revocation stamp is set'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
          OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by) THEN
    RAISE EXCEPTION 'a revoked provider risk acknowledgement is terminal'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_provider_risk_acks_guard
  BEFORE UPDATE OR DELETE ON awcms_channel_provider_risk_acknowledgements
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_provider_risk_acks_guard();

-- A starsender account may not be connected while the tenant has no active
-- acknowledgement of the provider's risk. Fires on INSERT and when `status` moves
-- INTO `connected`; any other change (a name, a degrade, a disable) is untouched,
-- so an account whose acknowledgement was revoked can still be degraded, disabled
-- or deleted.
CREATE OR REPLACE FUNCTION awcms_channel_accounts_risk_ack_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_entering boolean;
BEGIN
  -- Computed in two steps: `OLD` does not exist on INSERT, and SQL gives no
  -- guarantee about which side of an OR is evaluated first.
  IF TG_OP = 'INSERT' THEN
    v_entering := true;
  ELSE
    v_entering := OLD.status IS DISTINCT FROM 'connected';
  END IF;

  IF NEW.provider = 'starsender' AND NEW.status = 'connected' AND v_entering THEN
    IF NOT EXISTS (
      SELECT 1
      FROM awcms_channel_provider_risk_acknowledgements
      WHERE tenant_id = NEW.tenant_id
        AND provider = 'starsender'
        AND revoked_at IS NULL
    ) THEN
      RAISE EXCEPTION 'an unofficial-provider account cannot be connected without an active risk acknowledgement'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_accounts_risk_ack_guard
  BEFORE INSERT OR UPDATE OF status ON awcms_channel_accounts
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_accounts_risk_ack_guard();
