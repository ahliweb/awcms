-- website_engagement -- integrity guards (Issue #1153, ADR-0155).
--
-- Three database-level refusals that hold whatever the application does:
--
--   1. a source's identity (tenant, id, code) is immutable and a deleted source
--      is terminal;
--   2. a source may only list a domain that belongs to ITS OWN tenant (a plain
--      foreign key to awcms_tenant_domains(id) would accept another tenant's
--      domain id, because a foreign-key check does not go through RLS);
--   3. a submission is append-only EVIDENCE: after insert, only the withdrawal
--      columns may change, and a withdrawal is one-way. Its consent provenance,
--      encrypted contact blob and attribution can never be rewritten.

CREATE OR REPLACE FUNCTION awcms_engagement_sources_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'a website source tenant, id and code are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a deleted website source is terminal'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'revoked' AND NEW.status IS DISTINCT FROM 'revoked' THEN
    RAISE EXCEPTION 'a revoked website source cannot be reactivated; rotate or create a source instead'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_engagement_sources_identity_guard
  BEFORE UPDATE ON awcms_engagement_sources
  FOR EACH ROW
  EXECUTE FUNCTION awcms_engagement_sources_identity_guard();

CREATE OR REPLACE FUNCTION awcms_engagement_source_domains_same_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Runs in the caller's tenant context, so another tenant's domain is
  -- invisible here (RLS) and the lookup finds nothing: the same refusal for
  -- "no such domain" and "somebody else's domain".
  IF NOT EXISTS (
    SELECT 1
    FROM awcms_tenant_domains
    WHERE id = NEW.tenant_domain_id
      AND tenant_id = NEW.tenant_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a website source may only list a live domain of its own tenant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_engagement_source_domains_same_tenant_guard
  BEFORE INSERT ON awcms_engagement_source_domains
  FOR EACH ROW
  EXECUTE FUNCTION awcms_engagement_source_domains_same_tenant_guard();

CREATE OR REPLACE FUNCTION awcms_engagement_submissions_evidence_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.interaction_type IS DISTINCT FROM OLD.interaction_type
     OR NEW.topic IS DISTINCT FROM OLD.topic
     OR NEW.locale IS DISTINCT FROM OLD.locale
     OR NEW.privacy_class IS DISTINCT FROM OLD.privacy_class
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.contact_encrypted IS DISTINCT FROM OLD.contact_encrypted
     OR NEW.email_hash IS DISTINCT FROM OLD.email_hash
     OR NEW.phone_hash IS DISTINCT FROM OLD.phone_hash
     OR NEW.email_masked IS DISTINCT FROM OLD.email_masked
     OR NEW.phone_masked IS DISTINCT FROM OLD.phone_masked
     OR NEW.consent_purposes IS DISTINCT FROM OLD.consent_purposes
     OR NEW.consent_copy_version IS DISTINCT FROM OLD.consent_copy_version
     OR NEW.consent_page_path IS DISTINCT FROM OLD.consent_page_path
     OR NEW.consent_at IS DISTINCT FROM OLD.consent_at
     OR NEW.landing_path IS DISTINCT FROM OLD.landing_path
     OR NEW.referrer_host IS DISTINCT FROM OLD.referrer_host
     OR NEW.utm_source IS DISTINCT FROM OLD.utm_source
     OR NEW.utm_medium IS DISTINCT FROM OLD.utm_medium
     OR NEW.utm_campaign IS DISTINCT FROM OLD.utm_campaign
     OR NEW.utm_term IS DISTINCT FROM OLD.utm_term
     OR NEW.utm_content IS DISTINCT FROM OLD.utm_content
     OR NEW.origin_host IS DISTINCT FROM OLD.origin_host
     OR NEW.origin_via IS DISTINCT FROM OLD.origin_via
     OR NEW.challenge_outcome IS DISTINCT FROM OLD.challenge_outcome
     OR NEW.contract_version IS DISTINCT FROM OLD.contract_version THEN
    RAISE EXCEPTION 'a website submission is evidence; only its withdrawal may change'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'withdrawn'
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
          OR NEW.withdrawal_reason IS DISTINCT FROM OLD.withdrawal_reason
          OR NEW.withdrawn_by IS DISTINCT FROM OLD.withdrawn_by) THEN
    RAISE EXCEPTION 'a withdrawal is one-way'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_engagement_submissions_evidence_guard
  BEFORE UPDATE ON awcms_engagement_submissions
  FOR EACH ROW
  EXECUTE FUNCTION awcms_engagement_submissions_evidence_guard();
