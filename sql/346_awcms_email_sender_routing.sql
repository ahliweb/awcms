-- `email` sender routing: tenant-scoped Mailketing accounts and verified
-- senders on the ONE email queue (Issue #1160, ADR-0151 sections 2 and 4,
-- invariants M4 to M6, M9, M11). Forward-only and ADDITIVE (ADR-0148 I13): no
-- applied migration is rewritten, no existing column changes meaning, and a
-- deployment that configures no sender behaves byte for byte as it did.
--
-- It is the email twin of the WhatsApp sender routing (`sql/322`, `sql/324`,
-- `sql/329`) and deliberately follows that pattern rather than inventing one.
--
-- ## One queue, and the sender is a KEY on it (M4)
--
-- There is no second email queue, no queue per account, brand or tenant, and no
-- dual write. `awcms_email_messages` gains an immutable, NULLABLE
-- `sender_account_id`. NULL IS today's deployment sender (`EMAIL_FROM_ADDRESS`
-- and the deployment token): every existing row keeps meaning exactly what it
-- meant. A non-NULL value names a tenant-owned `awcms_channel_accounts` row of
-- provider `mailketing`, kind `sender_identity` (a verified from-address that is
-- a child of the tenant's Mailketing `esp_account`, which holds the API token
-- as a `channel_secrets` row, ADR-0151 section 2).
--
-- The verified address and the display name are SNAPSHOTTED on the row at
-- enqueue (`sender_address`, `sender_name`) and never change. The dispatcher
-- refuses to send when the account's address no longer equals the snapshot, so
-- a queued message can never go out under a different identity than the one
-- the enqueuing caller was authorised for.
--
-- ## What the database enforces (defence in depth, for EVERY role)
--
--   * TENANT CONSISTENCY. `(tenant_id, sender_account_id)` is a composite
--     foreign key into `awcms_channel_accounts (tenant_id, id)`: a row can never
--     point at another tenant's account (RLS does not apply to FK checks, so the
--     composite shape is what carries the isolation).
--   * LIVE, VERIFIED SENDER AT INSERT. A BEFORE INSERT guard refuses a sender
--     that is not `connected` (a sender identity becomes `connected` only when
--     the provider's `GET /senders` reports it verified, see
--     `email:senders:verify`), is soft-deleted, is not a Mailketing
--     `sender_identity`, is bound to another business scope, or whose address
--     is not the snapshot. The application checks all of this first (and the
--     capability evidence, which a trigger cannot evaluate).
--   * IMMUTABILITY. The sender, its snapshot, how it was chosen, the policy
--     version, the business scope and the purpose never change after INSERT. A
--     queued message is NEVER re-pointed at another sender (M5, M6): a
--     different sender is a NEW message. There is no rotation.
--   * SECURITY MAIL STAYS ON THE DEPLOYMENT SENDER (ADR-0151 Q7). A `security`
--     message (password reset, invitation, security notice) cannot carry a
--     tenant sender, so account recovery never depends on a tenant's credit or
--     verification.
--
-- ## Purpose classes (ADR-0151 section 4)
--
-- `purpose` is `transactional` or `security`. `marketing` is NOT admitted by
-- this migration on purpose: no code path in this repository enqueues
-- marketing email, and admitting the value before its consent gate exists
-- (ADR-0151 section 4 rule 3) would let a caller label a campaign as something
-- the dispatcher has no rule for. The campaign issue widens the CHECK in its
-- own migration together with that gate. Existing rows take the default
-- `transactional`; nothing reads `purpose` for a NULL-sender row.
--
-- ## The default sender is a PROSPECTIVE policy, never a code default
--
-- `awcms_email_sender_policies` mirrors `awcms_whatsapp_sender_policies`: at
-- most one row per business scope per tenant (and one tenant-wide row);
-- `default_sender_account_id` NULL is an explicit decision to use the
-- deployment sender; `config_version` only moves forward and is snapshotted on
-- each message it selects, so a change affects LATER messages only. A policy is
-- never deleted.
--
-- ## Credit, quota and the breaker
--
-- Nothing new is persisted for these. Per-sender quota is counted from the
-- queue itself (what was really `sent` in the trailing hour plus what is in
-- flight) under a per-sender advisory lock, the breaker is the in-process
-- `getProviderCircuitBreaker` keyed per Mailketing ACCOUNT (per connection, so
-- one tenant's bad token cannot open another tenant's lane, M9), and the
-- credit balance and sender verification are the latest
-- `awcms_channel_account_health` rows the verify job writes.

-- ---------------------------------------------------------------------------
-- The queue row: an immutable sender snapshot and a purpose
-- ---------------------------------------------------------------------------
ALTER TABLE awcms_email_messages
  ADD COLUMN IF NOT EXISTS sender_account_id uuid,
  -- `deployment` (NULL sender), `explicit` (the caller named it), `policy` (the
  -- business scope's default). No `reply`: email has no thread affinity here.
  ADD COLUMN IF NOT EXISTS sender_selection text NOT NULL DEFAULT 'deployment',
  ADD COLUMN IF NOT EXISTS sender_policy_version integer,
  -- The verified from-address (the account's `external_id`, lower case) and the
  -- display name, as they were when the message was enqueued.
  ADD COLUMN IF NOT EXISTS sender_address text,
  ADD COLUMN IF NOT EXISTS sender_name text,
  -- The business scope the message was enqueued under (both NULL = tenant-wide).
  -- Not a new ABAC attribute: the generic pair of sql/027.
  ADD COLUMN IF NOT EXISTS business_scope_type text,
  ADD COLUMN IF NOT EXISTS business_scope_id uuid,
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'transactional';

ALTER TABLE awcms_email_messages
  ADD CONSTRAINT awcms_email_messages_sender_selection_check
    CHECK (sender_selection IN ('deployment', 'explicit', 'policy')),
  -- NULL sender if and only if the deployment sender.
  ADD CONSTRAINT awcms_email_messages_sender_null_check
    CHECK ((sender_account_id IS NULL) = (sender_selection = 'deployment')),
  -- A tenant sender always carries its snapshot; the deployment sender never.
  ADD CONSTRAINT awcms_email_messages_sender_snapshot_check
    CHECK (
      (sender_account_id IS NULL AND sender_address IS NULL AND sender_name IS NULL)
      OR (
        sender_account_id IS NOT NULL
        AND sender_address IS NOT NULL
        AND char_length(sender_address) BETWEEN 3 AND 254
        AND sender_address = lower(btrim(sender_address))
        AND sender_address ~ '^[^@[:space:]]+@[^@[:space:]]+$'
        AND (sender_name IS NULL OR char_length(sender_name) BETWEEN 1 AND 200)
      )
    ),
  ADD CONSTRAINT awcms_email_messages_sender_policy_version_check
    CHECK (
      sender_policy_version IS NULL
      OR (sender_policy_version >= 1
          AND sender_selection IN ('policy', 'deployment'))
    ),
  ADD CONSTRAINT awcms_email_messages_scope_pair_check
    CHECK (
      (business_scope_type IS NULL AND business_scope_id IS NULL)
      OR (
        business_scope_type IS NOT NULL
        AND business_scope_id IS NOT NULL
        AND business_scope_type ~ '^[a-z][a-z0-9_]*$'
      )
    ),
  ADD CONSTRAINT awcms_email_messages_purpose_check
    CHECK (purpose IN ('transactional', 'security')),
  -- ADR-0151 Q7: security mail is always the deployment sender.
  ADD CONSTRAINT awcms_email_messages_security_deployment_check
    CHECK (purpose <> 'security' OR sender_account_id IS NULL),
  ADD CONSTRAINT awcms_email_messages_sender_account_fk
    FOREIGN KEY (tenant_id, sender_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id);

-- The index `db:fk-index:check` requires for the composite FK, shaped for the
-- dispatcher's per-sender lane (due rows of one sender).
CREATE INDEX IF NOT EXISTS awcms_email_messages_sender_lane_idx
  ON awcms_email_messages (tenant_id, sender_account_id, status, next_attempt_at)
  WHERE sender_account_id IS NOT NULL;

-- Per-sender quota and diagnostics: what this sender really sent, lately.
CREATE INDEX IF NOT EXISTS awcms_email_messages_sender_sent_idx
  ON awcms_email_messages (tenant_id, sender_account_id, sent_at)
  WHERE sender_account_id IS NOT NULL AND status = 'sent';

COMMENT ON COLUMN awcms_email_messages.sender_account_id IS
  'Issue #1160 / ADR-0151 section 2 - the tenant-owned Mailketing sender identity (channel account) that sends this message, snapshotted at enqueue and IMMUTABLE. NULL is the deployment sender (today''s behaviour, byte for byte). Never a token: the credential is resolved from the account record of this row''s tenant at dispatch.';
COMMENT ON COLUMN awcms_email_messages.sender_address IS
  'Issue #1160 - the verified from-address of sender_account_id at enqueue (lower case). Immutable; the dispatcher refuses to send when the account no longer carries it.';
COMMENT ON COLUMN awcms_email_messages.purpose IS
  'Issue #1160 / ADR-0151 section 4 - transactional or security. Security mail always uses the deployment sender (Q7). Marketing is not admitted until its consent gate exists.';

-- Immutability and the live-sender backstop. Pins `search_path`; runs as the
-- invoker and reads only `awcms_channel_accounts` columns the inserting roles
-- already read.
CREATE OR REPLACE FUNCTION awcms_email_messages_sender_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_provider text;
  v_kind text;
  v_external text;
  v_scope_type text;
  v_scope_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sender_account_id IS DISTINCT FROM OLD.sender_account_id
       OR NEW.sender_selection IS DISTINCT FROM OLD.sender_selection
       OR NEW.sender_policy_version IS DISTINCT FROM OLD.sender_policy_version
       OR NEW.sender_address IS DISTINCT FROM OLD.sender_address
       OR NEW.sender_name IS DISTINCT FROM OLD.sender_name
       OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id
       OR NEW.purpose IS DISTINCT FROM OLD.purpose THEN
      RAISE EXCEPTION 'an email message sender snapshot and purpose are immutable'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.sender_account_id IS NOT NULL THEN
    SELECT status, provider, account_kind, external_id,
           business_scope_type, business_scope_id
      INTO v_status, v_provider, v_kind, v_external,
           v_scope_type, v_scope_id
    FROM awcms_channel_accounts
    WHERE tenant_id = NEW.tenant_id AND id = NEW.sender_account_id
      AND deleted_at IS NULL;

    IF NOT FOUND OR v_status <> 'connected' THEN
      RAISE EXCEPTION 'an email message needs a connected (verified) sender account of its own tenant'
        USING ERRCODE = '23514';
    END IF;

    IF NOT (v_provider = 'mailketing' AND v_kind = 'sender_identity') THEN
      RAISE EXCEPTION 'an email message sender account must be a Mailketing sender identity'
        USING ERRCODE = '23514';
    END IF;

    IF lower(btrim(v_external)) IS DISTINCT FROM NEW.sender_address THEN
      RAISE EXCEPTION 'an email message sender snapshot must be the account''s own address'
        USING ERRCODE = '23514';
    END IF;

    IF v_scope_type IS NOT NULL
       AND (v_scope_type IS DISTINCT FROM NEW.business_scope_type
            OR v_scope_id IS DISTINCT FROM NEW.business_scope_id) THEN
      RAISE EXCEPTION 'a scoped sender account may only send within its own business scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_email_messages_sender_guard
  BEFORE INSERT OR UPDATE ON awcms_email_messages
  FOR EACH ROW
  EXECUTE FUNCTION awcms_email_messages_sender_guard();

-- ---------------------------------------------------------------------------
-- The prospective default-sender policy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_email_sender_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Both NULL is the tenant-wide default; otherwise the generic business-scope
  -- pair of sql/027 (a brand or unit; no new ABAC attribute).
  business_scope_type text,
  business_scope_id uuid,
  -- NULL is an EXPLICIT decision to use the deployment sender for this scope.
  default_sender_account_id uuid,
  -- Starts at 1 and only moves forward; snapshotted on each message it selects.
  config_version integer NOT NULL DEFAULT 1,
  effective_from timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_email_sender_policies_tenant_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT awcms_email_sender_policies_scope_pair_check CHECK (
    (business_scope_type IS NULL AND business_scope_id IS NULL)
    OR (
      business_scope_type IS NOT NULL
      AND business_scope_id IS NOT NULL
      AND business_scope_type ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  CONSTRAINT awcms_email_sender_policies_version_check
    CHECK (config_version >= 1),
  CONSTRAINT awcms_email_sender_policies_sender_fk
    FOREIGN KEY (tenant_id, default_sender_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_email_sender_policies_changed_by_fk
    FOREIGN KEY (tenant_id, changed_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- At most one policy per scope; two partial indexes because NULLs never collide
-- in a plain unique key.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_email_sender_policies_tenant_wide_key
  ON awcms_email_sender_policies (tenant_id)
  WHERE business_scope_type IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS awcms_email_sender_policies_scope_key
  ON awcms_email_sender_policies (tenant_id, business_scope_type, business_scope_id)
  WHERE business_scope_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_email_sender_policies_sender_idx
  ON awcms_email_sender_policies (tenant_id, default_sender_account_id)
  WHERE default_sender_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_email_sender_policies_changed_by_idx
  ON awcms_email_sender_policies (tenant_id, changed_by)
  WHERE changed_by IS NOT NULL;

COMMENT ON TABLE awcms_email_sender_policies IS
  'Issue #1160 / ADR-0151 section 2 - the prospective default email sender (a verified Mailketing sender identity) per business scope and tenant-wide, with a configuration version. A change affects later messages only. NULL default = the deployment sender, by explicit decision. Never deleted.';

ALTER TABLE awcms_email_sender_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_email_sender_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_email_sender_policies_tenant_isolation
  ON awcms_email_sender_policies
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Identity and scope never change; the version only moves forward; a default is
-- a CONNECTED Mailketing sender identity of this tenant whose scope contains the
-- policy's (checked when a default is stored or changed, so a policy whose
-- sender later degrades can still be re-pointed or cleared).
CREATE OR REPLACE FUNCTION awcms_email_sender_policies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_provider text;
  v_kind text;
  v_scope_type text;
  v_scope_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id THEN
      RAISE EXCEPTION 'an email sender policy tenant and business scope are immutable'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.config_version < OLD.config_version THEN
      RAISE EXCEPTION 'an email sender policy version only moves forward'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.default_sender_account_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.default_sender_account_id IS DISTINCT FROM OLD.default_sender_account_id) THEN
    SELECT status, provider, account_kind, business_scope_type, business_scope_id
      INTO v_status, v_provider, v_kind, v_scope_type, v_scope_id
    FROM awcms_channel_accounts
    WHERE tenant_id = NEW.tenant_id AND id = NEW.default_sender_account_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'an email sender policy default needs a live sender account of its own tenant'
        USING ERRCODE = '23514';
    END IF;

    IF v_status <> 'connected' THEN
      RAISE EXCEPTION 'an email sender policy default needs a connected (verified) sender account'
        USING ERRCODE = '23514';
    END IF;

    IF NOT (v_provider = 'mailketing' AND v_kind = 'sender_identity') THEN
      RAISE EXCEPTION 'an email sender policy default must be a Mailketing sender identity'
        USING ERRCODE = '23514';
    END IF;

    IF v_scope_type IS NOT NULL
       AND (v_scope_type IS DISTINCT FROM NEW.business_scope_type
            OR v_scope_id IS DISTINCT FROM NEW.business_scope_id) THEN
      RAISE EXCEPTION 'a scoped sender account may only be the default of its own business scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_email_sender_policies_guard
  BEFORE INSERT OR UPDATE ON awcms_email_sender_policies
  FOR EACH ROW
  EXECUTE FUNCTION awcms_email_sender_policies_guard();

-- A policy is changed in place and its version only moves forward; DELETE then
-- INSERT would restart it at 1 and let a recorded `sender_policy_version` name
-- two configurations (the `sql/324` L2 lesson, applied from the start).
CREATE OR REPLACE FUNCTION awcms_email_sender_policies_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'an email sender policy is never deleted: set its default to NULL to select the deployment sender'
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER awcms_email_sender_policies_no_delete
  BEFORE DELETE ON awcms_email_sender_policies
  FOR EACH ROW
  EXECUTE FUNCTION awcms_email_sender_policies_no_delete();
