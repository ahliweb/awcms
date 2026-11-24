-- social_publishing -- the social dispatcher's secret view narrows to what the
-- credential adapter actually decrypts, and the free-text values it writes are
-- bounded to a closed vocabulary (the #1145 credential-path security review,
-- MEDIUM-1, L3 and L1). Forward-only; sql/358 and sql/373 are applied and are
-- NOT edited: each policy below is dropped and re-created under its own name.
--
-- ## MEDIUM-1 + L3: the secret policy admitted more than is ever decrypted
--
-- `awcms_channel_secrets_social_dispatch_publish` (sql/358) let the role read
-- the access token of a connection whose grant is `active` OR `expired`, used by
-- an account that is `connected` OR `degraded`, of any of SIX social providers.
-- The only reader, `resolvePublishCredential`, refuses all of the extra rows
-- before reading a secret (a `degraded` account, an `expired` grant), and only
-- Facebook has an admitted connector (#1146). So a compromised dispatcher could
-- read and decrypt tokens no legitimate path uses: the token of an account the
-- provider had just refused, of a grant past its expiry, of a provider that has
-- no adapter. The policy now admits exactly what the adapter decrypts:
-- `grant_state = 'active'`, `status = 'connected'`, provider `facebook`. A
-- second connector (#1147 Instagram) widens the provider test in its own
-- migration, reviewed with its adapter.
--
-- The account and connection READ policies of sql/358 (six providers, no secret
-- material) are unchanged.
--
-- ## L1: column grants bounded the columns, not the values
--
-- The role could write anything up to 300 characters into
-- `awcms_social_publish_jobs.last_error` and
-- `awcms_social_publish_attempts.error_message`, and any message, attributes,
-- action, actor or correlation into a `social_publishing` audit row. A token
-- copied there lands in rows the app role, exports and backups all read (as the
-- role, `INSERT ... attributes '{"token": "EAAG-..."}'` succeeded). Each write
-- is now bounded to the dispatcher's CLOSED vocabulary
-- (`src/modules/social-publishing/domain/social-dispatch-vocabulary.ts`):
--
--   * `last_error` and `error_message`: NULL or one of the fixed phrases;
--   * audit rows: one of the three dispatcher actions, resource type
--     `social_publish_job` with a uuid id, severity info/warning, no actor and
--     no delegated grant, a uuid-shaped (or no) correlation id, one of the six
--     fixed messages, and attributes that are an object whose keys are among
--     seven, each with its value shape (uuids, a provider key, an attempt number
--     of at most four digits, two failure codes, a boolean);
--   * every failure code (`failure_code`, `error_code`, the audit `code` and
--     `failureCode`, the `job.failed` payload) is one of an ENUMERATED list,
--     not a shape (a 64-character upper-case string can carry an encoded
--     token);
--   * `external_post_id` has the admitted adapter's shape (Facebook
--     `<page>_<post>`) and `external_post_url` is NULL or exactly
--     `https://www.facebook.com/` followed by that id (no query, no fragment,
--     no other host);
--   * the two domain events the role emits carry exactly their documented
--     envelope and payload (`order_key` derived from the aggregate, no actor,
--     no causation, payload keys and value shapes per event type).
--
-- What this does NOT remove (stated, the re-audit of #1483): a role that may
-- choose AMONG valid values (which code, which attempt number, which valid
-- post id, when to write) can still encode a few bits per row. The bound
-- removes free text, not every covert channel.
--
-- `security:readiness` builds its exact pins from the same vocabulary file, so
-- a phrase or code added in code without a migration fails readiness (and the
-- reverse).
--
-- sql/427 was revised before it was applied anywhere (#1483 was not merged):
-- one definition per policy is easier to review and to pin than a second
-- migration that drops and re-creates the same four policies.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

-- ---------------------------------------------------------------------------
-- MEDIUM-1 + L3: the secret view.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS awcms_channel_secrets_social_dispatch_publish
  ON awcms_channel_secrets;

CREATE POLICY awcms_channel_secrets_social_dispatch_publish
  ON awcms_channel_secrets
  AS RESTRICTIVE
  FOR SELECT
  TO awcms_social_dispatch
  USING (
    purpose = 'provider_access_token'
    AND EXISTS (
      SELECT 1
      FROM awcms_channel_provider_connections c
      JOIN awcms_channel_accounts a
        ON a.tenant_id = c.tenant_id
       AND a.connection_id = c.id
       AND a.provider = c.provider
      JOIN awcms_channel_account_capabilities k
        ON k.tenant_id = a.tenant_id
       AND k.account_id = a.id
      WHERE c.tenant_id = awcms_channel_secrets.tenant_id
        AND c.access_secret_id = awcms_channel_secrets.id
        AND c.provider = 'facebook'
        AND c.grant_state = 'active'
        AND a.deleted_at IS NULL
        AND a.status = 'connected'
        AND k.capability = 'publish'
        AND k.state = 'granted'
    )
  );

-- ---------------------------------------------------------------------------
-- L1: the job row. Same row and status bounds as sql/373, plus `last_error`.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS awcms_social_publish_jobs_social_dispatch_update
  ON awcms_social_publish_jobs;

CREATE POLICY awcms_social_publish_jobs_social_dispatch_update
  ON awcms_social_publish_jobs
  AS RESTRICTIVE
  FOR UPDATE
  TO awcms_social_dispatch
  USING (status IN ('queued', 'retry_wait', 'publishing'))
  WITH CHECK (
    status IN (
      'queued', 'publishing', 'retry_wait', 'published', 'failed',
      'needs_reconciliation'
    )
    AND (
      last_error IS NULL
      OR last_error IN (
        'Published.',
        'No adapter is registered for this provider.',
        'The provider adapter failed unexpectedly.',
        'The provider did not answer in time.',
        'The provider reported a post this adapter cannot identify: the post may exist. An operator must check before it is sent again.',
        'The outcome is unknown: the post may already exist. An operator must check before it is sent again.',
        'The provider was failing; the attempt was not made.',
        'The retry budget is spent.',
        'The account stayed unavailable for too long.',
        'The account must be re-authorised.',
        'The provider refused this content.',
        'The source article is no longer published; nothing was sent.',
        'The media object is no longer available; nothing was sent.',
        'The media object''s rights no longer clear it; nothing was sent.',
        'Whether the source may still be published could not be checked; nothing was sent.',
        'The account cannot publish.',
        'Waiting for the account to be usable.',
        'The attempt did not succeed.'
      )
    )
    AND (
      failure_code IS NULL
      OR failure_code IN (
        'ACCOUNT_ACCOUNT_DEGRADED', 'ACCOUNT_ACCOUNT_DISABLED',
        'ACCOUNT_ACCOUNT_NOT_FOUND', 'ACCOUNT_ACCOUNT_PENDING',
        'ACCOUNT_ACCOUNT_REVOKED', 'ACCOUNT_CAPABILITY_DENIED',
        'ACCOUNT_CHANNEL_ACCOUNTS_DISABLED', 'ACCOUNT_CONNECTION_EXPIRED',
        'ACCOUNT_CONNECTION_NOT_ACTIVE', 'ACCOUNT_CONTAINER_BINDING_INVALID',
        'ACCOUNT_CREDENTIAL_UNAVAILABLE', 'ACCOUNT_NOT_A_PUBLISHER',
        'ACCOUNT_NOT_A_WHATSAPP_SENDER', 'ACCOUNT_PROVIDER_ADAPTER_DISABLED',
        'ACCOUNT_RISK_ACKNOWLEDGEMENT_REQUIRED',
        'ACCOUNT_SECRET_STORE_UNAVAILABLE', 'ADAPTER_ERROR', 'CIRCUIT_OPEN',
        'CREDENTIAL_UNAVAILABLE', 'FB_ANSWER_LOST', 'FB_DUPLICATE_POST',
        'FB_INVALID_PARAMETER', 'FB_MEDIA_INVALID', 'FB_MEDIA_REJECTED',
        'FB_NETWORK_NOT_SENT', 'FB_PAGE_ID_INVALID', 'FB_PERMISSION_DENIED',
        'FB_POLICY_BLOCK', 'FB_RATE_LIMITED', 'FB_REQUEST_REJECTED',
        'FB_RESPONSE_UNREADABLE', 'FB_TEMPORARY_OUTAGE', 'FB_TOKEN_INVALID',
        'FB_UPSTREAM_UNKNOWN', 'FB_VARIANT_UNSUPPORTED',
        'HELD_ACCOUNT_DEGRADED', 'HELD_ACCOUNT_DISABLED',
        'HELD_ACCOUNT_NOT_FOUND', 'HELD_ACCOUNT_PENDING',
        'HELD_ACCOUNT_REVOKED', 'HELD_CAPABILITY_DENIED',
        'HELD_CHANNEL_ACCOUNTS_DISABLED', 'HELD_CONNECTION_EXPIRED',
        'HELD_CONNECTION_NOT_ACTIVE', 'HELD_CONTAINER_BINDING_INVALID',
        'HELD_CREDENTIAL_UNAVAILABLE', 'HELD_NOT_A_PUBLISHER',
        'HELD_NOT_A_WHATSAPP_SENDER', 'HELD_PROVIDER_ADAPTER_DISABLED',
        'HELD_RISK_ACKNOWLEDGEMENT_REQUIRED',
        'HELD_SECRET_STORE_UNAVAILABLE', 'HOLD_EXHAUSTED', 'INVALID_POST_ID',
        'LEASE_EXPIRED_UNKNOWN', 'MEDIA_RIGHTS_REVOKED', 'MEDIA_UNAVAILABLE',
        'NEEDS_REAUTH', 'OUTCOME_UNKNOWN', 'PROVIDER_ADAPTER_UNAVAILABLE',
        'PROVIDER_TIMEOUT', 'RATE_LIMITED', 'REJECTED', 'RETRIES_EXHAUSTED',
        'SOURCE_CHECK_UNAVAILABLE', 'SOURCE_RETRACTED'
      )
    )
    AND (
      external_post_id IS NULL
      OR external_post_id ~ '^[0-9]{1,32}_[0-9]{1,32}$'
    )
    AND (
      external_post_url IS NULL
      OR external_post_url = 'https://www.facebook.com/' || external_post_id
    )
  );

-- ---------------------------------------------------------------------------
-- L1: the attempt ledger (no role policy existed: the grant was the only bound).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS awcms_social_publish_attempts_social_dispatch_insert
  ON awcms_social_publish_attempts;

CREATE POLICY awcms_social_publish_attempts_social_dispatch_insert
  ON awcms_social_publish_attempts
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_social_dispatch
  WITH CHECK (
    (
      error_code IS NULL
      OR error_code IN (
        'ACCOUNT_ACCOUNT_DEGRADED', 'ACCOUNT_ACCOUNT_DISABLED',
        'ACCOUNT_ACCOUNT_NOT_FOUND', 'ACCOUNT_ACCOUNT_PENDING',
        'ACCOUNT_ACCOUNT_REVOKED', 'ACCOUNT_CAPABILITY_DENIED',
        'ACCOUNT_CHANNEL_ACCOUNTS_DISABLED', 'ACCOUNT_CONNECTION_EXPIRED',
        'ACCOUNT_CONNECTION_NOT_ACTIVE', 'ACCOUNT_CONTAINER_BINDING_INVALID',
        'ACCOUNT_CREDENTIAL_UNAVAILABLE', 'ACCOUNT_NOT_A_PUBLISHER',
        'ACCOUNT_NOT_A_WHATSAPP_SENDER', 'ACCOUNT_PROVIDER_ADAPTER_DISABLED',
        'ACCOUNT_RISK_ACKNOWLEDGEMENT_REQUIRED',
        'ACCOUNT_SECRET_STORE_UNAVAILABLE', 'ADAPTER_ERROR', 'CIRCUIT_OPEN',
        'CREDENTIAL_UNAVAILABLE', 'FB_ANSWER_LOST', 'FB_DUPLICATE_POST',
        'FB_INVALID_PARAMETER', 'FB_MEDIA_INVALID', 'FB_MEDIA_REJECTED',
        'FB_NETWORK_NOT_SENT', 'FB_PAGE_ID_INVALID', 'FB_PERMISSION_DENIED',
        'FB_POLICY_BLOCK', 'FB_RATE_LIMITED', 'FB_REQUEST_REJECTED',
        'FB_RESPONSE_UNREADABLE', 'FB_TEMPORARY_OUTAGE', 'FB_TOKEN_INVALID',
        'FB_UPSTREAM_UNKNOWN', 'FB_VARIANT_UNSUPPORTED',
        'HELD_ACCOUNT_DEGRADED', 'HELD_ACCOUNT_DISABLED',
        'HELD_ACCOUNT_NOT_FOUND', 'HELD_ACCOUNT_PENDING',
        'HELD_ACCOUNT_REVOKED', 'HELD_CAPABILITY_DENIED',
        'HELD_CHANNEL_ACCOUNTS_DISABLED', 'HELD_CONNECTION_EXPIRED',
        'HELD_CONNECTION_NOT_ACTIVE', 'HELD_CONTAINER_BINDING_INVALID',
        'HELD_CREDENTIAL_UNAVAILABLE', 'HELD_NOT_A_PUBLISHER',
        'HELD_NOT_A_WHATSAPP_SENDER', 'HELD_PROVIDER_ADAPTER_DISABLED',
        'HELD_RISK_ACKNOWLEDGEMENT_REQUIRED',
        'HELD_SECRET_STORE_UNAVAILABLE', 'HOLD_EXHAUSTED', 'INVALID_POST_ID',
        'LEASE_EXPIRED_UNKNOWN', 'MEDIA_RIGHTS_REVOKED', 'MEDIA_UNAVAILABLE',
        'NEEDS_REAUTH', 'OUTCOME_UNKNOWN', 'PROVIDER_ADAPTER_UNAVAILABLE',
        'PROVIDER_TIMEOUT', 'RATE_LIMITED', 'REJECTED', 'RETRIES_EXHAUSTED',
        'SOURCE_CHECK_UNAVAILABLE', 'SOURCE_RETRACTED'
      )
    )
    AND (
      error_message IS NULL
      OR error_message IN (
        'Published.',
        'No adapter is registered for this provider.',
        'The provider adapter failed unexpectedly.',
        'The provider did not answer in time.',
        'The provider reported a post this adapter cannot identify: the post may exist. An operator must check before it is sent again.',
        'The outcome is unknown: the post may already exist. An operator must check before it is sent again.',
        'The provider was failing; the attempt was not made.',
        'The retry budget is spent.',
        'The account stayed unavailable for too long.',
        'The account must be re-authorised.',
        'The provider refused this content.',
        'The source article is no longer published; nothing was sent.',
        'The media object is no longer available; nothing was sent.',
        'The media object''s rights no longer clear it; nothing was sent.',
        'Whether the source may still be published could not be checked; nothing was sent.',
        'The account cannot publish.',
        'Waiting for the account to be usable.',
        'The attempt did not succeed.'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- L1: the dispatcher's audit rows.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS awcms_audit_events_social_dispatch_insert
  ON awcms_audit_events;

CREATE POLICY awcms_audit_events_social_dispatch_insert
  ON awcms_audit_events
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_social_dispatch
  WITH CHECK (
    module_key = 'social_publishing'
    AND action IN (
      'social_publishing.job.published',
      'social_publishing.job.failed',
      'social_publishing.job.outcome_unknown'
    )
    AND resource_type = 'social_publish_job'
    AND resource_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND severity IN ('info', 'warning')
    AND actor_tenant_user_id IS NULL
    AND actor_tenant_id IS NULL
    AND delegated_grant_id IS NULL
    AND (
      correlation_id IS NULL
      OR correlation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND message IN (
      'A social publish job lost its lease while in flight; its outcome is unknown and it waits for an operator.',
      'A social publish job failed because its account cannot publish.',
      'A social publish job was accepted by the provider.',
      'A social publish job''s outcome is unknown; it waits for an operator and will not be retried automatically.',
      'A social publish job was stopped before sending: its source can no longer be published.',
      'A social publish job failed.'
    )
    AND jsonb_typeof(attributes) = 'object'
    AND (
      attributes - ARRAY[
        'publicationId', 'accountId', 'provider', 'attemptNo', 'code',
        'failureCode', 'accountDegraded'
      ]
    ) = '{}'::jsonb
    AND (
      NOT attributes ? 'publicationId'
      OR (attributes ->> 'publicationId')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND (
      NOT attributes ? 'accountId'
      OR (attributes ->> 'accountId')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND (
      NOT attributes ? 'provider'
      OR (attributes ->> 'provider') IN (
        'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
      )
    )
    AND (
      NOT attributes ? 'attemptNo'
      OR (
        jsonb_typeof(attributes -> 'attemptNo') = 'number'
        AND (attributes ->> 'attemptNo') ~ '^[0-9]{1,4}$'
      )
    )
    AND (
      NOT attributes ? 'code'
      OR (attributes ->> 'code') IN (
        'ACCOUNT_ACCOUNT_DEGRADED', 'ACCOUNT_ACCOUNT_DISABLED',
        'ACCOUNT_ACCOUNT_NOT_FOUND', 'ACCOUNT_ACCOUNT_PENDING',
        'ACCOUNT_ACCOUNT_REVOKED', 'ACCOUNT_CAPABILITY_DENIED',
        'ACCOUNT_CHANNEL_ACCOUNTS_DISABLED', 'ACCOUNT_CONNECTION_EXPIRED',
        'ACCOUNT_CONNECTION_NOT_ACTIVE', 'ACCOUNT_CONTAINER_BINDING_INVALID',
        'ACCOUNT_CREDENTIAL_UNAVAILABLE', 'ACCOUNT_NOT_A_PUBLISHER',
        'ACCOUNT_NOT_A_WHATSAPP_SENDER', 'ACCOUNT_PROVIDER_ADAPTER_DISABLED',
        'ACCOUNT_RISK_ACKNOWLEDGEMENT_REQUIRED',
        'ACCOUNT_SECRET_STORE_UNAVAILABLE', 'ADAPTER_ERROR', 'CIRCUIT_OPEN',
        'CREDENTIAL_UNAVAILABLE', 'FB_ANSWER_LOST', 'FB_DUPLICATE_POST',
        'FB_INVALID_PARAMETER', 'FB_MEDIA_INVALID', 'FB_MEDIA_REJECTED',
        'FB_NETWORK_NOT_SENT', 'FB_PAGE_ID_INVALID', 'FB_PERMISSION_DENIED',
        'FB_POLICY_BLOCK', 'FB_RATE_LIMITED', 'FB_REQUEST_REJECTED',
        'FB_RESPONSE_UNREADABLE', 'FB_TEMPORARY_OUTAGE', 'FB_TOKEN_INVALID',
        'FB_UPSTREAM_UNKNOWN', 'FB_VARIANT_UNSUPPORTED',
        'HELD_ACCOUNT_DEGRADED', 'HELD_ACCOUNT_DISABLED',
        'HELD_ACCOUNT_NOT_FOUND', 'HELD_ACCOUNT_PENDING',
        'HELD_ACCOUNT_REVOKED', 'HELD_CAPABILITY_DENIED',
        'HELD_CHANNEL_ACCOUNTS_DISABLED', 'HELD_CONNECTION_EXPIRED',
        'HELD_CONNECTION_NOT_ACTIVE', 'HELD_CONTAINER_BINDING_INVALID',
        'HELD_CREDENTIAL_UNAVAILABLE', 'HELD_NOT_A_PUBLISHER',
        'HELD_NOT_A_WHATSAPP_SENDER', 'HELD_PROVIDER_ADAPTER_DISABLED',
        'HELD_RISK_ACKNOWLEDGEMENT_REQUIRED',
        'HELD_SECRET_STORE_UNAVAILABLE', 'HOLD_EXHAUSTED', 'INVALID_POST_ID',
        'LEASE_EXPIRED_UNKNOWN', 'MEDIA_RIGHTS_REVOKED', 'MEDIA_UNAVAILABLE',
        'NEEDS_REAUTH', 'OUTCOME_UNKNOWN', 'PROVIDER_ADAPTER_UNAVAILABLE',
        'PROVIDER_TIMEOUT', 'RATE_LIMITED', 'REJECTED', 'RETRIES_EXHAUSTED',
        'SOURCE_CHECK_UNAVAILABLE', 'SOURCE_RETRACTED'
      )
    )
    AND (
      NOT attributes ? 'failureCode'
      OR (attributes ->> 'failureCode') IN (
        'ACCOUNT_ACCOUNT_DEGRADED', 'ACCOUNT_ACCOUNT_DISABLED',
        'ACCOUNT_ACCOUNT_NOT_FOUND', 'ACCOUNT_ACCOUNT_PENDING',
        'ACCOUNT_ACCOUNT_REVOKED', 'ACCOUNT_CAPABILITY_DENIED',
        'ACCOUNT_CHANNEL_ACCOUNTS_DISABLED', 'ACCOUNT_CONNECTION_EXPIRED',
        'ACCOUNT_CONNECTION_NOT_ACTIVE', 'ACCOUNT_CONTAINER_BINDING_INVALID',
        'ACCOUNT_CREDENTIAL_UNAVAILABLE', 'ACCOUNT_NOT_A_PUBLISHER',
        'ACCOUNT_NOT_A_WHATSAPP_SENDER', 'ACCOUNT_PROVIDER_ADAPTER_DISABLED',
        'ACCOUNT_RISK_ACKNOWLEDGEMENT_REQUIRED',
        'ACCOUNT_SECRET_STORE_UNAVAILABLE', 'ADAPTER_ERROR', 'CIRCUIT_OPEN',
        'CREDENTIAL_UNAVAILABLE', 'FB_ANSWER_LOST', 'FB_DUPLICATE_POST',
        'FB_INVALID_PARAMETER', 'FB_MEDIA_INVALID', 'FB_MEDIA_REJECTED',
        'FB_NETWORK_NOT_SENT', 'FB_PAGE_ID_INVALID', 'FB_PERMISSION_DENIED',
        'FB_POLICY_BLOCK', 'FB_RATE_LIMITED', 'FB_REQUEST_REJECTED',
        'FB_RESPONSE_UNREADABLE', 'FB_TEMPORARY_OUTAGE', 'FB_TOKEN_INVALID',
        'FB_UPSTREAM_UNKNOWN', 'FB_VARIANT_UNSUPPORTED',
        'HELD_ACCOUNT_DEGRADED', 'HELD_ACCOUNT_DISABLED',
        'HELD_ACCOUNT_NOT_FOUND', 'HELD_ACCOUNT_PENDING',
        'HELD_ACCOUNT_REVOKED', 'HELD_CAPABILITY_DENIED',
        'HELD_CHANNEL_ACCOUNTS_DISABLED', 'HELD_CONNECTION_EXPIRED',
        'HELD_CONNECTION_NOT_ACTIVE', 'HELD_CONTAINER_BINDING_INVALID',
        'HELD_CREDENTIAL_UNAVAILABLE', 'HELD_NOT_A_PUBLISHER',
        'HELD_NOT_A_WHATSAPP_SENDER', 'HELD_PROVIDER_ADAPTER_DISABLED',
        'HELD_RISK_ACKNOWLEDGEMENT_REQUIRED',
        'HELD_SECRET_STORE_UNAVAILABLE', 'HOLD_EXHAUSTED', 'INVALID_POST_ID',
        'LEASE_EXPIRED_UNKNOWN', 'MEDIA_RIGHTS_REVOKED', 'MEDIA_UNAVAILABLE',
        'NEEDS_REAUTH', 'OUTCOME_UNKNOWN', 'PROVIDER_ADAPTER_UNAVAILABLE',
        'PROVIDER_TIMEOUT', 'RATE_LIMITED', 'REJECTED', 'RETRIES_EXHAUSTED',
        'SOURCE_CHECK_UNAVAILABLE', 'SOURCE_RETRACTED'
      )
    )
    AND (
      NOT attributes ? 'accountDegraded'
      OR jsonb_typeof(attributes -> 'accountDegraded') = 'boolean'
    )
  );

-- ---------------------------------------------------------------------------
-- L1 (the re-audit of #1483): the two domain events the role emits. sql/373
-- bounded only `producer_module` and `event_type`; the payload (up to 64 KiB,
-- into the outbox) and `order_key` were free.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS awcms_domain_events_social_dispatch_insert
  ON awcms_domain_events;

CREATE POLICY awcms_domain_events_social_dispatch_insert
  ON awcms_domain_events
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_social_dispatch
  WITH CHECK (
    producer_module = 'social_publishing'
    AND event_type IN (
      'awcms.social_publishing.job.published',
      'awcms.social_publishing.job.failed'
    )
    AND event_version = '1.0'
    AND aggregate_type = 'social_publish_job'
    AND aggregate_version IS NULL
    AND order_key = 'social_publish_job:' || aggregate_id::text
    AND (
      correlation_id IS NULL
      OR correlation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND causation_id IS NULL
    AND schema_ref IS NULL
    AND actor_tenant_user_id IS NULL
    AND actor_profile_id IS NULL
    AND jsonb_typeof(payload) = 'object'
    AND (
      payload - ARRAY[
        'jobId', 'publicationId', 'accountId', 'provider', 'attemptNo',
        'failureCode'
      ]
    ) = '{}'::jsonb
    AND (payload ->> 'jobId') = aggregate_id::text
    AND (payload ->> 'publicationId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (payload ->> 'accountId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (payload ->> 'provider') IN (
      'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
    )
    AND jsonb_typeof(payload -> 'attemptNo') = 'number'
    AND (payload ->> 'attemptNo') ~ '^[0-9]{1,4}$'
    AND (
      (
        event_type = 'awcms.social_publishing.job.published'
        AND NOT payload ? 'failureCode'
      )
      OR (
        event_type = 'awcms.social_publishing.job.failed'
        AND (payload ->> 'failureCode') IN (
          'ACCOUNT_ACCOUNT_DEGRADED', 'ACCOUNT_ACCOUNT_DISABLED',
          'ACCOUNT_ACCOUNT_NOT_FOUND', 'ACCOUNT_ACCOUNT_PENDING',
          'ACCOUNT_ACCOUNT_REVOKED', 'ACCOUNT_CAPABILITY_DENIED',
          'ACCOUNT_CHANNEL_ACCOUNTS_DISABLED', 'ACCOUNT_CONNECTION_EXPIRED',
          'ACCOUNT_CONNECTION_NOT_ACTIVE',
          'ACCOUNT_CONTAINER_BINDING_INVALID',
          'ACCOUNT_CREDENTIAL_UNAVAILABLE', 'ACCOUNT_NOT_A_PUBLISHER',
          'ACCOUNT_NOT_A_WHATSAPP_SENDER',
          'ACCOUNT_PROVIDER_ADAPTER_DISABLED',
          'ACCOUNT_RISK_ACKNOWLEDGEMENT_REQUIRED',
          'ACCOUNT_SECRET_STORE_UNAVAILABLE', 'ADAPTER_ERROR',
          'CIRCUIT_OPEN', 'CREDENTIAL_UNAVAILABLE', 'FB_ANSWER_LOST',
          'FB_DUPLICATE_POST', 'FB_INVALID_PARAMETER', 'FB_MEDIA_INVALID',
          'FB_MEDIA_REJECTED', 'FB_NETWORK_NOT_SENT', 'FB_PAGE_ID_INVALID',
          'FB_PERMISSION_DENIED', 'FB_POLICY_BLOCK', 'FB_RATE_LIMITED',
          'FB_REQUEST_REJECTED', 'FB_RESPONSE_UNREADABLE',
          'FB_TEMPORARY_OUTAGE', 'FB_TOKEN_INVALID', 'FB_UPSTREAM_UNKNOWN',
          'FB_VARIANT_UNSUPPORTED', 'HELD_ACCOUNT_DEGRADED',
          'HELD_ACCOUNT_DISABLED', 'HELD_ACCOUNT_NOT_FOUND',
          'HELD_ACCOUNT_PENDING', 'HELD_ACCOUNT_REVOKED',
          'HELD_CAPABILITY_DENIED', 'HELD_CHANNEL_ACCOUNTS_DISABLED',
          'HELD_CONNECTION_EXPIRED', 'HELD_CONNECTION_NOT_ACTIVE',
          'HELD_CONTAINER_BINDING_INVALID', 'HELD_CREDENTIAL_UNAVAILABLE',
          'HELD_NOT_A_PUBLISHER', 'HELD_NOT_A_WHATSAPP_SENDER',
          'HELD_PROVIDER_ADAPTER_DISABLED',
          'HELD_RISK_ACKNOWLEDGEMENT_REQUIRED',
          'HELD_SECRET_STORE_UNAVAILABLE', 'HOLD_EXHAUSTED',
          'INVALID_POST_ID', 'LEASE_EXPIRED_UNKNOWN', 'MEDIA_RIGHTS_REVOKED',
          'MEDIA_UNAVAILABLE', 'NEEDS_REAUTH', 'OUTCOME_UNKNOWN',
          'PROVIDER_ADAPTER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'RATE_LIMITED',
          'REJECTED', 'RETRIES_EXHAUSTED', 'SOURCE_CHECK_UNAVAILABLE',
          'SOURCE_RETRACTED'
        )
      )
    )
  );
