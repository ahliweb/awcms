-- website_engagement -- tenant-scoped website lead/contact capture and inbound
-- website interaction events (Issue #1153, ADR-0155).
--
-- INTAKE ONLY. This module owns exactly three things: SOURCES (one row per
-- website/form channel of a tenant), SUBMISSIONS (what a visitor submitted,
-- with its provenance and consent) and the outbox EVENT that announces one
-- (domain_event_runtime, ADR-0134). It is not a CRM, not a lead pipeline, not a
-- forms engine and not a chat widget; it creates, matches and merges no person
-- (ADR-0148 I7, section 6).
--
-- ## awcms_engagement_sources
--
-- Three websites of one tenant are three sources; two tenant domains may map to
-- one or more sources (`awcms_engagement_source_domains`). The public endpoint
-- authenticates a request by the source's bearer TOKEN, stored only as a KEYED
-- hash (`token_hash`, HMAC under the module's key ring, never the token) with a
-- six-character non-sensitive `token_prefix` so an administrator can tell which
-- token is on which site. The token is shown once at creation or rotation.
--
-- ## awcms_engagement_submissions
--
-- A submission's direct identifiers (name, email, phone, company, subject and
-- the message) are ONE envelope-encrypted blob (`contact_encrypted`, AES-256-GCM
-- through the shared field-encryption helper, AAD bound to purpose, tenant and
-- row id), with keyed hashes of the email and phone for lookup and MASKED
-- display values so no list ever decrypts. No IP address, fingerprint, cookie or
-- user agent is stored anywhere in this schema: the only per-IP state is a
-- short-lived rate-limit bucket that never reaches a row.
--
-- Consent provenance is explicit: `consent_purposes` (closed list; a stored
-- contact/lead MUST include respond_to_inquiry, and marketing_follow_up is a
-- separate purpose that is never implied), `consent_copy_version` (the exact
-- text version the website showed), the page path it was shown on, and
-- `consent_at`. An `interaction` carries no contact details and no consent.
--
-- The replay key is UNIQUE (tenant_id, source_id, event_id): a duplicate
-- submission inserts nothing and publishes nothing.
--
-- ## RLS / GRANT
--
-- Every table is FORCE ROW LEVEL SECURITY with the standard tenant_isolation
-- policy. awcms_app may not DELETE or TRUNCATE a submission (retention owns
-- removal, through the generic data_lifecycle purge). awcms_worker gets exactly
-- what that purge needs and nothing that could read a credential or a
-- identifier: SELECT on (id, tenant_id, received_at) and DELETE.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

CREATE TABLE IF NOT EXISTS awcms_engagement_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Unique per tenant among live rows; shown in events and admin lists.
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  -- The PUBLIC submission contract version this source was created for.
  contract_version text NOT NULL DEFAULT '1',
  accepted_kinds text[] NOT NULL DEFAULT ARRAY['contact', 'lead', 'interaction'],
  -- The exact consent copy version the website currently shows. A submission
  -- carrying another version is refused: a site cannot claim an older text.
  consent_copy_version text NOT NULL,
  -- `turnstile` asks for the challenge wherever the deployment runs it;
  -- `none` is the explicit, visible statement that the source relies on the
  -- non-third-party controls alone.
  challenge_mode text NOT NULL DEFAULT 'turnstile',
  -- Keyed hash (`keyId:hex`) of the token's secret half. Never the token.
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  token_rotated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_engagement_sources_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_engagement_sources_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_engagement_sources_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_engagement_sources_deleted_by_fk
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_engagement_sources_code_check
    CHECK (code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  CONSTRAINT awcms_engagement_sources_name_check
    CHECK (btrim(name) <> '' AND char_length(name) <= 120),
  CONSTRAINT awcms_engagement_sources_status_check
    CHECK (status IN ('active', 'paused', 'revoked')),
  CONSTRAINT awcms_engagement_sources_contract_version_check
    CHECK (contract_version IN ('1')),
  CONSTRAINT awcms_engagement_sources_accepted_kinds_check
    CHECK (
      accepted_kinds <@ ARRAY['contact', 'lead', 'interaction']::text[]
      AND cardinality(accepted_kinds) >= 1
    ),
  CONSTRAINT awcms_engagement_sources_consent_copy_version_check
    CHECK (consent_copy_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  CONSTRAINT awcms_engagement_sources_challenge_mode_check
    CHECK (challenge_mode IN ('turnstile', 'none')),
  CONSTRAINT awcms_engagement_sources_token_hash_check
    CHECK (token_hash ~ '^[a-z0-9]{1,8}:[0-9a-f]{64}$'),
  CONSTRAINT awcms_engagement_sources_token_prefix_check
    CHECK (token_prefix ~ '^[A-Za-z0-9_-]{6}$'),
  -- A revoked source says when, and a live one does not.
  CONSTRAINT awcms_engagement_sources_revoked_check
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT awcms_engagement_sources_deleted_check
    CHECK (deleted_at IS NOT NULL OR (deleted_by IS NULL AND delete_reason IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_engagement_sources_code_dedup
  ON awcms_engagement_sources (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_engagement_sources_status_idx
  ON awcms_engagement_sources (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_engagement_sources_created_by_idx
  ON awcms_engagement_sources (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_engagement_sources_updated_by_idx
  ON awcms_engagement_sources (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_engagement_sources_deleted_by_idx
  ON awcms_engagement_sources (tenant_id, deleted_by)
  WHERE deleted_by IS NOT NULL;

ALTER TABLE awcms_engagement_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_engagement_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_engagement_sources_tenant_isolation
  ON awcms_engagement_sources
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_engagement_sources FROM awcms_app;
REVOKE ALL ON awcms_engagement_sources FROM awcms_worker;

COMMENT ON TABLE awcms_engagement_sources IS
  'Issue #1153 / ADR-0155 -- one row per website/form channel of a tenant. Authenticated on the public intake by a bearer token stored only as a keyed hash (token_hash). Soft-deleted, never hard-deleted: a submission references it.';

COMMENT ON COLUMN awcms_engagement_sources.token_hash IS
  'ADR-0155 section 3 -- HMAC-SHA256 under the module key ring (`keyId:hex`) of the token secret. The token itself is shown once and never stored; the hash is verified inside the tenant context named by the token.';

-- The hosts a source accepts a browser request from. Many-to-many: two tenant
-- domains may map to one source, and one domain may serve several sources.
CREATE TABLE IF NOT EXISTS awcms_engagement_source_domains (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  source_id uuid NOT NULL,
  tenant_domain_id uuid NOT NULL REFERENCES awcms_tenant_domains (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT awcms_engagement_source_domains_pkey
    PRIMARY KEY (tenant_id, source_id, tenant_domain_id),
  CONSTRAINT awcms_engagement_source_domains_source_fk
    FOREIGN KEY (tenant_id, source_id)
    REFERENCES awcms_engagement_sources (tenant_id, id),
  CONSTRAINT awcms_engagement_source_domains_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_engagement_source_domains_domain_idx
  ON awcms_engagement_source_domains (tenant_domain_id);

CREATE INDEX IF NOT EXISTS awcms_engagement_source_domains_created_by_idx
  ON awcms_engagement_source_domains (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

ALTER TABLE awcms_engagement_source_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_engagement_source_domains FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_engagement_source_domains_tenant_isolation
  ON awcms_engagement_source_domains
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE TRUNCATE ON awcms_engagement_source_domains FROM awcms_app;
REVOKE ALL ON awcms_engagement_source_domains FROM awcms_worker;

COMMENT ON TABLE awcms_engagement_source_domains IS
  'Issue #1153 / ADR-0155 -- the tenant domains a source accepts browser submissions from. A cross-tenant link is refused by the sql/327 guard; the public intake matches the request Origin host against the ACTIVE, non-deleted domains listed here.';

CREATE TABLE IF NOT EXISTS awcms_engagement_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  source_id uuid NOT NULL,
  -- The client-supplied idempotency/replay key.
  event_id text NOT NULL,
  kind text NOT NULL,
  interaction_type text,
  topic text,
  locale text,
  status text NOT NULL DEFAULT 'received',
  -- `personal` for contact/lead, `anonymous` for an interaction.
  privacy_class text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- Envelope-encrypted JSON of the visitor's own words and identifiers.
  contact_encrypted text,
  -- Keyed hashes (`keyId:hex`) for lookup (e.g. a subject-rights request).
  email_hash text,
  phone_hash text,
  -- Display projections only; the raw value is never recoverable from these.
  email_masked text,
  phone_masked text,
  -- Consent provenance.
  consent_purposes text[] NOT NULL DEFAULT ARRAY[]::text[],
  consent_copy_version text,
  consent_page_path text,
  consent_at timestamptz,
  -- Source attribution. A path, never a URL with a query.
  landing_path text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  -- Authenticated provenance: where the browser request came from and what
  -- protected it.
  origin_host text NOT NULL,
  origin_via text NOT NULL,
  challenge_outcome text NOT NULL,
  contract_version text NOT NULL DEFAULT '1',
  -- Withdrawal (opt-out). Set by a controller action, never by the public.
  withdrawn_at timestamptz,
  withdrawal_reason text,
  withdrawn_by uuid,
  CONSTRAINT awcms_engagement_submissions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_engagement_submissions_replay_key
    UNIQUE (tenant_id, source_id, event_id),
  CONSTRAINT awcms_engagement_submissions_source_fk
    FOREIGN KEY (tenant_id, source_id)
    REFERENCES awcms_engagement_sources (tenant_id, id),
  CONSTRAINT awcms_engagement_submissions_withdrawn_by_fk
    FOREIGN KEY (tenant_id, withdrawn_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_engagement_submissions_event_id_check
    CHECK (event_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT awcms_engagement_submissions_kind_check
    CHECK (kind IN ('contact', 'lead', 'interaction')),
  CONSTRAINT awcms_engagement_submissions_interaction_type_check
    CHECK (interaction_type IS NULL OR interaction_type IN (
      'form_view', 'form_start', 'cta_click', 'call_click',
      'whatsapp_click', 'map_click', 'download_click')),
  CONSTRAINT awcms_engagement_submissions_topic_check
    CHECK (topic IS NULL OR topic ~ '^[a-z][a-z0-9_.-]{0,59}$'),
  CONSTRAINT awcms_engagement_submissions_locale_check
    CHECK (locale IS NULL OR locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT awcms_engagement_submissions_status_check
    CHECK (status IN ('received', 'withdrawn')),
  CONSTRAINT awcms_engagement_submissions_privacy_class_check
    CHECK (privacy_class IN ('personal', 'anonymous')),
  CONSTRAINT awcms_engagement_submissions_origin_via_check
    CHECK (origin_via IN ('origin', 'referer')),
  CONSTRAINT awcms_engagement_submissions_challenge_outcome_check
    CHECK (challenge_outcome IN ('turnstile_verified', 'not_required', 'source_none')),
  CONSTRAINT awcms_engagement_submissions_contract_version_check
    CHECK (contract_version IN ('1')),
  CONSTRAINT awcms_engagement_submissions_consent_purposes_check
    CHECK (consent_purposes <@ ARRAY['respond_to_inquiry', 'marketing_follow_up']::text[]),
  CONSTRAINT awcms_engagement_submissions_copy_version_check
    CHECK (consent_copy_version IS NULL OR consent_copy_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  CONSTRAINT awcms_engagement_submissions_paths_check
    CHECK (
      (consent_page_path IS NULL OR (consent_page_path ~ '^/[^?#[:space:]]*$' AND char_length(consent_page_path) <= 200))
      AND (landing_path IS NULL OR (landing_path ~ '^/[^?#[:space:]]*$' AND char_length(landing_path) <= 200))
    ),
  CONSTRAINT awcms_engagement_submissions_utm_check
    CHECK (
      (utm_source IS NULL OR char_length(utm_source) <= 100)
      AND (utm_medium IS NULL OR char_length(utm_medium) <= 100)
      AND (utm_campaign IS NULL OR char_length(utm_campaign) <= 100)
      AND (utm_term IS NULL OR char_length(utm_term) <= 100)
      AND (utm_content IS NULL OR char_length(utm_content) <= 100)
      AND (referrer_host IS NULL OR char_length(referrer_host) <= 253)
    ),
  CONSTRAINT awcms_engagement_submissions_hash_shape_check
    CHECK (
      (email_hash IS NULL OR email_hash ~ '^[a-z0-9]{1,8}:[0-9a-f]{64}$')
      AND (phone_hash IS NULL OR phone_hash ~ '^[a-z0-9]{1,8}:[0-9a-f]{64}$')
    ),
  CONSTRAINT awcms_engagement_submissions_withdrawal_reason_check
    CHECK (withdrawal_reason IS NULL OR withdrawal_reason IN (
      'data_subject_request', 'consent_withdrawn', 'controller_decision')),
  -- An interaction carries no person and no consent; a contact/lead carries
  -- both. The database refuses the combinations the validator should not send.
  CONSTRAINT awcms_engagement_submissions_shape_check
    CHECK (
      (kind = 'interaction'
        AND interaction_type IS NOT NULL
        AND privacy_class = 'anonymous'
        AND contact_encrypted IS NULL
        AND email_hash IS NULL AND phone_hash IS NULL
        AND email_masked IS NULL AND phone_masked IS NULL
        AND cardinality(consent_purposes) = 0
        AND consent_copy_version IS NULL
        AND consent_at IS NULL)
      OR
      (kind IN ('contact', 'lead')
        AND interaction_type IS NULL
        AND privacy_class = 'personal'
        AND contact_encrypted IS NOT NULL
        AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)
        AND consent_purposes @> ARRAY['respond_to_inquiry']::text[]
        AND consent_copy_version IS NOT NULL
        AND consent_at IS NOT NULL)
    ),
  CONSTRAINT awcms_engagement_submissions_withdrawn_check
    CHECK (
      (status = 'withdrawn') = (withdrawn_at IS NOT NULL AND withdrawal_reason IS NOT NULL)
    )
);

-- (tenant, cursor): what the generic retention purge filters and orders by,
-- and the admin list's order.
CREATE INDEX IF NOT EXISTS awcms_engagement_submissions_received_at_idx
  ON awcms_engagement_submissions (tenant_id, received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS awcms_engagement_submissions_source_idx
  ON awcms_engagement_submissions (tenant_id, source_id, received_at DESC);

CREATE INDEX IF NOT EXISTS awcms_engagement_submissions_email_hash_idx
  ON awcms_engagement_submissions (tenant_id, email_hash)
  WHERE email_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_engagement_submissions_phone_hash_idx
  ON awcms_engagement_submissions (tenant_id, phone_hash)
  WHERE phone_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_engagement_submissions_withdrawn_by_idx
  ON awcms_engagement_submissions (tenant_id, withdrawn_by)
  WHERE withdrawn_by IS NOT NULL;

ALTER TABLE awcms_engagement_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_engagement_submissions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_engagement_submissions_tenant_isolation
  ON awcms_engagement_submissions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_engagement_submissions FROM awcms_app;
REVOKE ALL ON awcms_engagement_submissions FROM awcms_worker;
-- The generic data_lifecycle purge: find aged rows (id, tenant, cursor) and
-- delete them. No other column is readable by the worker, so a compromised
-- job can read no identifier, hash or ciphertext.
GRANT SELECT (id, tenant_id, received_at) ON awcms_engagement_submissions TO awcms_worker;
GRANT DELETE ON awcms_engagement_submissions TO awcms_worker;

COMMENT ON TABLE awcms_engagement_submissions IS
  'Issue #1153 / ADR-0155 -- what a visitor submitted through a website form, with authenticated provenance and explicit consent provenance. Direct identifiers are one encrypted blob plus keyed hashes and masked projections; no IP, fingerprint, cookie or user agent is stored. Removed only by the data_lifecycle retention purge.';

COMMENT ON COLUMN awcms_engagement_submissions.contact_encrypted IS
  'ADR-0155 section 5 -- v2 field-encryption envelope (AES-256-GCM, AAD = purpose + tenant + row id) of the JSON {name, email, phone, company, subject, message}. Decrypted only by the audited reveal endpoint.';

COMMENT ON COLUMN awcms_engagement_submissions.consent_purposes IS
  'ADR-0155 section 5 / ADR-0148 I8 -- the purposes the visitor explicitly ticked. respond_to_inquiry and marketing_follow_up are separate; the second is never implied by the first, and a contact/lead without the first is refused by the shape CHECK.';
