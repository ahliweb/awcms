-- email -- advisory DNS evidence (SPF, DKIM, DMARC) of a tenant sender identity
-- (Issue #1479; ADR-0151 sections 2 and Q9; owner decision K19.2 of
-- 24 November 2026: the evidence is ADVISORY ONLY and never changes a sender's
-- status; DNS egress is allowed from the jobs container only). Forward-only.
--
-- ## What a row is
--
-- At most ONE row per sender identity (primary key `tenant_id, account_id`),
-- overwritten by the latest check of `email:senders:verify`: the domain checked,
-- one CLOSED state per record kind, the DMARC policy tag, and WHEN the check ran.
-- No record text, no selector, no resolver answer is stored: only closed codes,
-- so nothing a tenant publishes in its DNS reaches this table as free text.
--
-- ## What it is NOT
--
-- It is not a verdict. A sender becomes usable only when the PROVIDER reports it
-- verified (`awcms_channel_account_health`, `sql/348`), and nothing in this table
-- is read by the dispatcher or by `recordAccountHealth`. A failing record is
-- shown to the operator with its check date and never switches the sender.
--
-- ## Who writes it
--
-- Only `email:senders:verify`, as `awcms_email_senders_verify` (`sql/460`), whose
-- grant here is column-only and whose RESTRICTIVE policy below limits it to the
-- live Mailketing sender identities and to the domain of THAT sender's own
-- address (it cannot record evidence for a domain the sender does not use).

CREATE TABLE IF NOT EXISTS awcms_email_sender_dns_evidence (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The Mailketing `sender_identity` account the evidence is about.
  account_id uuid NOT NULL,
  -- The domain of the sender's address, lower case, as it was checked.
  domain text NOT NULL,
  -- present: a well-formed record was found. absent: the name has no such
  -- record. invalid: a record was found but is malformed or ambiguous (two SPF
  -- records). unavailable: the resolver could not tell (never read as absent).
  -- not_checked: DKIM when no selector is configured.
  spf_state text NOT NULL,
  dkim_state text NOT NULL,
  dmarc_state text NOT NULL,
  -- The `p=` tag of a present DMARC record; NULL otherwise.
  dmarc_policy text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, account_id),
  CONSTRAINT awcms_email_sender_dns_evidence_domain_check CHECK (
    char_length(domain) BETWEEN 3 AND 253
    AND domain = lower(domain)
    AND domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  CONSTRAINT awcms_email_sender_dns_evidence_spf_check CHECK (
    spf_state IN ('present', 'absent', 'invalid', 'unavailable')
  ),
  CONSTRAINT awcms_email_sender_dns_evidence_dkim_check CHECK (
    dkim_state IN ('present', 'absent', 'invalid', 'unavailable', 'not_checked')
  ),
  CONSTRAINT awcms_email_sender_dns_evidence_dmarc_check CHECK (
    dmarc_state IN ('present', 'absent', 'invalid', 'unavailable')
  ),
  CONSTRAINT awcms_email_sender_dns_evidence_policy_check CHECK (
    (dmarc_state = 'present' AND dmarc_policy IN ('none', 'quarantine', 'reject'))
    OR (dmarc_state <> 'present' AND dmarc_policy IS NULL)
  ),
  CONSTRAINT awcms_email_sender_dns_evidence_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id)
);

COMMENT ON TABLE awcms_email_sender_dns_evidence IS
  'Issue #1479 / ADR-0151 Q9 - ADVISORY SPF, DKIM and DMARC evidence per tenant sender identity, with the date of the last check. Closed codes only. Never read by the dispatcher or the health writer and never changes a sender status.';

ALTER TABLE awcms_email_sender_dns_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_email_sender_dns_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_email_sender_dns_evidence_tenant_isolation
  ON awcms_email_sender_dns_evidence
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- The verify role: column-only grants (the upsert needs the conflict columns
-- readable) ...
GRANT SELECT (
  tenant_id, account_id, domain, spf_state, dkim_state, dmarc_state,
  dmarc_policy, checked_at
) ON awcms_email_sender_dns_evidence TO awcms_email_senders_verify;
GRANT INSERT (
  tenant_id, account_id, domain, spf_state, dkim_state, dmarc_state,
  dmarc_policy, checked_at
) ON awcms_email_sender_dns_evidence TO awcms_email_senders_verify;
GRANT UPDATE (
  domain, spf_state, dkim_state, dmarc_state, dmarc_policy, checked_at,
  updated_at
) ON awcms_email_sender_dns_evidence TO awcms_email_senders_verify;

-- ... and rows only of a live (not revoked or disabled) Mailketing sender
-- identity, for the domain of that
-- sender's own address.
DROP POLICY IF EXISTS awcms_email_sender_dns_evidence_verify_role
  ON awcms_email_sender_dns_evidence;

CREATE POLICY awcms_email_sender_dns_evidence_verify_role
  ON awcms_email_sender_dns_evidence
  AS RESTRICTIVE
  FOR ALL
  TO awcms_email_senders_verify
  USING (
    EXISTS (
      SELECT 1 FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_email_sender_dns_evidence.tenant_id
        AND a.id = awcms_email_sender_dns_evidence.account_id
        AND a.provider = 'mailketing'
        AND a.account_kind = 'sender_identity'
        AND a.deleted_at IS NULL
        AND a.status IN ('pending', 'connected', 'degraded')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_email_sender_dns_evidence.tenant_id
        AND a.id = awcms_email_sender_dns_evidence.account_id
        AND a.provider = 'mailketing'
        AND a.account_kind = 'sender_identity'
        AND a.deleted_at IS NULL
        AND a.status IN ('pending', 'connected', 'degraded')
        AND lower(split_part(a.external_id, '@', 2))
            = awcms_email_sender_dns_evidence.domain
    )
  );
