-- `whatsapp_delivery` sender routing (Issue #1141, ADR-0148 section 4,
-- capability C2; design in docs/awcms/omnichannel-foundation.md sections 2.2
-- and 4). Forward-only and ADDITIVE (invariant I13): no applied migration is
-- rewritten, no existing column changes meaning, and a deployment that
-- configures no sender behaves byte for byte as it did.
--
-- ## One queue, and the sender is a KEY on it (I4)
--
-- There is no second WhatsApp queue and no dual write. The one queue
-- (`awcms_whatsapp_messages`) gains an immutable, NULLABLE `sender_account_id`.
-- NULL IS today's deployment sender: the provider still comes from the
-- environment and every existing row keeps meaning exactly what it meant. A
-- non-NULL value names a tenant-owned `awcms_channel_accounts` row (sql/318) and
-- is snapshotted at enqueue.
--
-- ## What the database enforces (defence in depth, for EVERY role)
--
--   * TENANT CONSISTENCY. `(tenant_id, sender_account_id)` is a composite
--     foreign key into `awcms_channel_accounts (tenant_id, id)`, so a row can
--     never point at another tenant's account (RLS does not apply to FK checks,
--     so the composite shape is what carries the isolation).
--   * LIVE SENDER AT INSERT. A BEFORE INSERT guard refuses a sender that is not
--     `connected`, is soft-deleted, or is bound to a business scope other than
--     the message's own. The application checks all of this first (and the
--     capability evidence, which a trigger cannot evaluate); the guard is the
--     backstop a buggy or compromised caller cannot step around.
--   * IMMUTABILITY. The sender, how it was chosen, the policy version that chose
--     it and the business scope never change after INSERT. A queued message is
--     NEVER re-pointed at another sender or provider; a different sender is a
--     NEW message (ADR-0148 I5).
--
-- ## The default sender is a PROSPECTIVE policy, never a code default
--
-- `awcms_whatsapp_sender_policies` holds at most one row per business scope per
-- tenant (and one tenant-wide row). `default_sender_account_id` is the sender a
-- message gets when its caller names none; NULL is an explicit decision to use
-- the deployment sender. `config_version` increases on every change and is
-- snapshotted on the message (`sender_policy_version`), so changing the default
-- affects LATER messages only: rows already queued keep the sender they were
-- given. There is no provider default anywhere in code.
--
-- ## Per-sender health, quota and the breaker
--
-- Nothing new is persisted for these, on purpose. Quota is counted from the
-- queue itself (messages with this sender that were `sent` in the trailing hour
-- and day, plus those in flight), which cannot drift from what was really sent;
-- the breaker is the in-process `getProviderCircuitBreaker` keyed per sender,
-- the same mechanism the deployment sender uses. The partial indexes below serve
-- those counts and the dispatcher's per-sender lanes.
--
-- ## Worker grants (the dispatcher decrypts; ADR-0148 section 5)
--
-- `whatsapp:dispatch` runs as `awcms_worker` and must resolve a sender's
-- credential in memory for the claimed row's tenant. It is granted COLUMN-ONLY
-- SELECT on exactly the columns that resolution reads: see the block at the end
-- and the matching entries in `scripts/security-readiness.ts`
-- (`WORKER_COLUMN_GRANTS`, and the documented `ciphertext` exception in
-- `WORKER_CREDENTIAL_COLUMN_EXCEPTIONS`).

-- ---------------------------------------------------------------------------
-- The queue row: an immutable sender snapshot
-- ---------------------------------------------------------------------------
ALTER TABLE awcms_whatsapp_messages
  ADD COLUMN IF NOT EXISTS sender_account_id uuid,
  -- How the sender was chosen: `deployment` (NULL sender), `explicit` (the caller
  -- named it), `policy` (the business scope's default), `reply` (the thread's
  -- sender, by affinity).
  ADD COLUMN IF NOT EXISTS sender_selection text NOT NULL DEFAULT 'deployment',
  -- The `config_version` of the policy row that was consulted, when one was.
  ADD COLUMN IF NOT EXISTS sender_policy_version integer,
  -- The business scope the message was enqueued under (both NULL = tenant-wide).
  -- Not a new ABAC attribute: the generic pair of sql/027.
  ADD COLUMN IF NOT EXISTS business_scope_type text,
  ADD COLUMN IF NOT EXISTS business_scope_id uuid;

ALTER TABLE awcms_whatsapp_messages
  ADD CONSTRAINT awcms_whatsapp_messages_sender_selection_check
    CHECK (sender_selection IN ('deployment', 'explicit', 'policy', 'reply')),
  -- NULL sender if and only if the deployment sender.
  ADD CONSTRAINT awcms_whatsapp_messages_sender_null_check
    CHECK ((sender_account_id IS NULL) = (sender_selection = 'deployment')),
  ADD CONSTRAINT awcms_whatsapp_messages_sender_policy_version_check
    CHECK (
      sender_policy_version IS NULL
      OR (sender_policy_version >= 1
          AND sender_selection IN ('policy', 'deployment'))
    ),
  ADD CONSTRAINT awcms_whatsapp_messages_scope_pair_check
    CHECK (
      (business_scope_type IS NULL AND business_scope_id IS NULL)
      OR (
        business_scope_type IS NOT NULL
        AND business_scope_id IS NOT NULL
        AND business_scope_type ~ '^[a-z][a-z0-9_]*$'
      )
    ),
  ADD CONSTRAINT awcms_whatsapp_messages_sender_account_fk
    FOREIGN KEY (tenant_id, sender_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id);

-- The index `db:fk-index:check` requires for the composite FK, shaped for the
-- dispatcher's per-sender lane (due rows of one sender).
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_sender_lane_idx
  ON awcms_whatsapp_messages (tenant_id, sender_account_id, status, next_attempt_at)
  WHERE sender_account_id IS NOT NULL;

-- Per-sender quota and diagnostics: what this sender really sent, lately.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_sender_sent_idx
  ON awcms_whatsapp_messages (tenant_id, sender_account_id, sent_at)
  WHERE sender_account_id IS NOT NULL AND status = 'sent';

COMMENT ON COLUMN awcms_whatsapp_messages.sender_account_id IS
  'Issue #1141 / ADR-0148 section 4 - the tenant-owned channel account that sends this message, snapshotted at enqueue and IMMUTABLE. NULL is the deployment sender (today''s behaviour, byte for byte). Never a token, a phone number id or a device id: the adapter and the credential are resolved from the account record of this row''s tenant.';
COMMENT ON COLUMN awcms_whatsapp_messages.sender_selection IS
  'Issue #1141 - how the sender was chosen: deployment, explicit, policy or reply (thread affinity). Immutable.';
COMMENT ON COLUMN awcms_whatsapp_messages.sender_policy_version IS
  'Issue #1141 - the config_version of the sender policy consulted at enqueue. A later change of the policy never touches this row.';

-- Immutability and the live-sender backstop. Pins `search_path`.
CREATE OR REPLACE FUNCTION awcms_whatsapp_messages_sender_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  account_status text;
  account_scope_type text;
  account_scope_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sender_account_id IS DISTINCT FROM OLD.sender_account_id
       OR NEW.sender_selection IS DISTINCT FROM OLD.sender_selection
       OR NEW.sender_policy_version IS DISTINCT FROM OLD.sender_policy_version
       OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id THEN
      RAISE EXCEPTION 'a WhatsApp message sender snapshot is immutable'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.sender_account_id IS NOT NULL THEN
    SELECT status, business_scope_type, business_scope_id
      INTO account_status, account_scope_type, account_scope_id
    FROM awcms_channel_accounts
    WHERE tenant_id = NEW.tenant_id AND id = NEW.sender_account_id
      AND deleted_at IS NULL;

    IF NOT FOUND OR account_status <> 'connected' THEN
      RAISE EXCEPTION 'a WhatsApp message needs a connected sender account of its own tenant'
        USING ERRCODE = '23514';
    END IF;

    IF account_scope_type IS NOT NULL
       AND (account_scope_type IS DISTINCT FROM NEW.business_scope_type
            OR account_scope_id IS DISTINCT FROM NEW.business_scope_id) THEN
      RAISE EXCEPTION 'a scoped sender account may only send within its own business scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_whatsapp_messages_sender_guard
  BEFORE INSERT OR UPDATE ON awcms_whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION awcms_whatsapp_messages_sender_guard();

-- ---------------------------------------------------------------------------
-- The prospective default-sender policy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_whatsapp_sender_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Both NULL is the tenant-wide default; otherwise the generic business-scope
  -- pair of sql/027 (a brand or unit; no new ABAC attribute).
  business_scope_type text,
  business_scope_id uuid,
  -- NULL is an EXPLICIT decision to use the deployment sender for this scope
  -- (for example, to override a tenant-wide default). Never a provider name.
  default_sender_account_id uuid,
  -- Starts at 1 and only moves forward; snapshotted on each message it selects.
  config_version integer NOT NULL DEFAULT 1,
  effective_from timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_whatsapp_sender_policies_tenant_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT awcms_whatsapp_sender_policies_scope_pair_check CHECK (
    (business_scope_type IS NULL AND business_scope_id IS NULL)
    OR (
      business_scope_type IS NOT NULL
      AND business_scope_id IS NOT NULL
      AND business_scope_type ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  CONSTRAINT awcms_whatsapp_sender_policies_version_check
    CHECK (config_version >= 1),
  CONSTRAINT awcms_whatsapp_sender_policies_sender_fk
    FOREIGN KEY (tenant_id, default_sender_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_whatsapp_sender_policies_changed_by_fk
    FOREIGN KEY (tenant_id, changed_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- At most one policy per scope; two partial indexes because NULLs never collide
-- in a plain unique key.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_whatsapp_sender_policies_tenant_wide_key
  ON awcms_whatsapp_sender_policies (tenant_id)
  WHERE business_scope_type IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS awcms_whatsapp_sender_policies_scope_key
  ON awcms_whatsapp_sender_policies (tenant_id, business_scope_type, business_scope_id)
  WHERE business_scope_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_whatsapp_sender_policies_sender_idx
  ON awcms_whatsapp_sender_policies (tenant_id, default_sender_account_id)
  WHERE default_sender_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_whatsapp_sender_policies_changed_by_idx
  ON awcms_whatsapp_sender_policies (tenant_id, changed_by)
  WHERE changed_by IS NOT NULL;

COMMENT ON TABLE awcms_whatsapp_sender_policies IS
  'Issue #1141 / ADR-0148 section 4 - the prospective default WhatsApp sender per business scope (and tenant-wide), with a configuration version. A change affects later messages only. NULL default = the deployment sender, by explicit decision. No provider is ever a code default.';

ALTER TABLE awcms_whatsapp_sender_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_sender_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_sender_policies_tenant_isolation
  ON awcms_whatsapp_sender_policies
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- A policy's identity and scope never change (a different scope is a different
-- row), and its version only moves forward, so a recorded
-- `sender_policy_version` always names a real, ordered configuration. The
-- default must be a live sender of this tenant whose scope contains the
-- policy's: a scoped account may be the default of its own scope only.
CREATE OR REPLACE FUNCTION awcms_whatsapp_sender_policies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  account_status text;
  account_scope_type text;
  account_scope_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id THEN
      RAISE EXCEPTION 'a WhatsApp sender policy tenant and business scope are immutable'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.config_version < OLD.config_version THEN
      RAISE EXCEPTION 'a WhatsApp sender policy version only moves forward'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.default_sender_account_id IS NOT NULL THEN
    SELECT status, business_scope_type, business_scope_id
      INTO account_status, account_scope_type, account_scope_id
    FROM awcms_channel_accounts
    WHERE tenant_id = NEW.tenant_id AND id = NEW.default_sender_account_id
      AND deleted_at IS NULL;

    IF NOT FOUND OR account_status IN ('revoked', 'disabled', 'deleted') THEN
      RAISE EXCEPTION 'a WhatsApp sender policy default needs a live sender account of its own tenant'
        USING ERRCODE = '23514';
    END IF;

    IF account_scope_type IS NOT NULL
       AND (account_scope_type IS DISTINCT FROM NEW.business_scope_type
            OR account_scope_id IS DISTINCT FROM NEW.business_scope_id) THEN
      RAISE EXCEPTION 'a scoped sender account may only be the default of its own business scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_whatsapp_sender_policies_guard
  BEFORE INSERT OR UPDATE ON awcms_whatsapp_sender_policies
  FOR EACH ROW
  EXECUTE FUNCTION awcms_whatsapp_sender_policies_guard();

-- ---------------------------------------------------------------------------
-- Least-privilege grants
-- ---------------------------------------------------------------------------
-- `awcms_app` is covered by sql/019 default privileges (the policy is written by
-- an authenticated route, as the runtime role).
--
-- `awcms_worker` is granted READ-ONLY access to the policy table, and nothing
-- more. The DISPATCHER never reads it (the sender is pinned on the row at
-- enqueue), but a job that ENQUEUES through `WhatsappDeliveryPort` as the worker
-- does (`booking:reminders:dispatch`, `awcms_worker` since sql/284) selects the
-- default sender of the message's scope at enqueue. A worker that could WRITE it
-- could change which number and provider speak for a tenant, so it cannot.
--
-- The dispatcher resolves a claimed row's sender and credential through the
-- `channel_accounts` capability ports, in memory, inside the dispatch call, for
-- that row's tenant. It READS, never writes, these columns and no others:
--
--   awcms_channel_accounts                the sender's identity, status, scope,
--                                         credential reference and connection
--   awcms_channel_account_capabilities    the evidence that it may send
--   awcms_channel_provider_connections    the grant state, expiry and the
--                                         access-token reference
--   awcms_channel_secrets                 the ciphertext it decrypts. This is
--                                         the residual risk ADR-0148 section 5
--                                         ACCEPTS ("the dispatcher must
--                                         decrypt"): bounded by the tenant the
--                                         worker sets, by AES-GCM associated
--                                         data that binds purpose, tenant and
--                                         row, and by a key ring that is not in
--                                         the database or its backups.
--
-- Not granted: any column that holds a refresh-token reference, an OAuth state,
-- an authorisation-code reference, a webhook token hash, a display name or an
-- actor stamp. Any worker WRITE to these tables stays impossible.
GRANT SELECT (
  id, tenant_id, business_scope_type, business_scope_id, provider,
  account_kind, external_id, auth_mode, connection_id, parent_account_id,
  secret_id, status, deleted_at
) ON awcms_channel_accounts TO awcms_worker;

GRANT SELECT (
  tenant_id, account_id, capability, state, evidence_kind, evidence_ref,
  matrix_version
) ON awcms_channel_account_capabilities TO awcms_worker;

GRANT SELECT (
  id, tenant_id, provider, auth_mode, grant_state, access_secret_id,
  expires_at
) ON awcms_channel_provider_connections TO awcms_worker;

GRANT SELECT (id, tenant_id, purpose, ciphertext)
  ON awcms_channel_secrets TO awcms_worker;

GRANT SELECT ON awcms_whatsapp_sender_policies TO awcms_worker;
