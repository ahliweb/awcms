-- `whatsapp_delivery` marketing consent records the business scope (brand) it was
-- collected for (Issue #1231 M4, owner decision 2026-11-11: option (c);
-- ADR-0148 I8, `docs/awcms/omnichannel-foundation.md` section 4 rule 6).
-- Forward-only; `sql/178` is applied and is NOT edited.
--
-- ## The decision, in database terms
--
--   * The consent KEY does not change: one row per (tenant, recipient, purpose),
--     `awcms_whatsapp_consents_recipient_unique` (sql/178) is untouched. Its
--     `status` stays the tenant-wide answer, so a withdrawal (opt-out) still
--     stops every brand and every sender of the tenant at once.
--   * What an opt-in COVERS is recorded on that row:
--       - `business_scopes`: the brands the person opted in for, one element per
--         brand, `{type, id, source, grantedAt}`. A second brand is a second,
--         explicit grant that APPENDS an element; nothing ever infers it.
--       - `unscoped_granted`: the opt-in was collected for the tenant itself,
--         with no brand. It covers ONLY marketing that names no business scope.
--   * A marketing message whose business scope is B is eligible only when the
--     granted row lists B. An unscoped opt-in never covers a brand, and a brand
--     opt-in never covers an unscoped send (the application check, at enqueue
--     AND again at dispatch; `domain/whatsapp-eligibility.ts`).
--
-- ## Rows that existed before this file (legacy)
--
-- `unscoped_granted` is added NULLABLE and NULL means "recorded before brands
-- were recorded". No brand is backfilled: nobody knows which brand a historical
-- opt-in was collected for, and inventing one would manufacture consent. A
-- legacy `granted` row is read exactly like an unscoped opt-in: it keeps
-- authorising marketing that names no business scope (today's behaviour for a
-- single-brand tenant) and authorises NO brand-scoped marketing until a grant
-- for that brand is recorded. Adding the column is metadata only; this file runs
-- no DML (the table is FORCE RLS and keyed by tenant context).
--
-- ## Guards (CHECK, so every role and every code path is bound)
--
--   * `business_scopes` is a JSON array of at most 256 elements, each an object
--     `{type, id, source, grantedAt}` with a snake_case `type`, a lower-case uuid
--     `id`, string `source` and `grantedAt`, and no `(type, id)` twice
--     (`awcms_whatsapp_consent_scopes_valid`, IMMUTABLE: it reads only its
--     argument).
--   * A WITHDRAWN row covers nothing: it carries no brand and no unscoped grant
--     (`unscoped_granted` is NULL for a legacy row or false). Withdrawing clears
--     both in the same statement, so a reinstatement can never resurrect a brand
--     the person withdrew from; reinstating records only the brand the
--     reinstating request names. The application's grant UPDATEs are themselves
--     guarded by `status = 'granted'`, so a withdrawal that lands first makes the
--     grant a clean "withdrawn" answer (409), never this CHECK.
--
-- ## Row-level `source` and `granted_at`
--
-- They keep their meaning: the first recording, or the latest UNSCOPED grant or
-- reinstatement. A brand grant does not rewrite them (each brand carries its own
-- `source` and `grantedAt` inside `business_scopes`), so recording brand B never
-- changes the provenance shown for the tenant-level opt-in.
--
-- ## Which scope types exist
--
-- Today the only business-scope type this base can RESOLVE is `office`
-- (`tenant_admin`'s hierarchy adapter, ADR-0060). The column accepts any
-- snake_case type, but the routes and the marketing enqueue refuse a scope that
-- does not resolve in the tenant, so in practice every element is an office.
--
-- Not guarded here, on purpose: a trigger on `awcms_whatsapp_messages` that
-- refuses a marketing row without a matching consent. The recipient hash is
-- keyed by a ring that lives OUTSIDE the database; a consent recorded under an
-- older ring key has a different hash, so a trigger could only ever match the
-- active key. It would refuse lawful sends after a key rotation, and a guard that
-- tolerated the miss would guard nothing. The application re-reads consent under
-- every ring key at enqueue and again immediately before each send.

CREATE OR REPLACE FUNCTION awcms_whatsapp_consent_scopes_valid(p_scopes jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_scopes IS NULL OR jsonb_typeof(p_scopes) <> 'array' THEN false
    WHEN jsonb_array_length(p_scopes) > 256 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_scopes) AS element
      WHERE jsonb_typeof(element) <> 'object'
         OR jsonb_typeof(element -> 'type') IS DISTINCT FROM 'string'
         OR jsonb_typeof(element -> 'id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(element -> 'source') IS DISTINCT FROM 'string'
         OR jsonb_typeof(element -> 'grantedAt') IS DISTINCT FROM 'string'
         OR NOT ((element ->> 'type') ~ '^[a-z][a-z0-9_]{0,63}$')
         OR NOT ((element ->> 'id')
                 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    )
    AND (
      SELECT count(*) = count(DISTINCT (element ->> 'type') || ':' || (element ->> 'id'))
      FROM jsonb_array_elements(p_scopes) AS element
    )
  END
$function$;

ALTER TABLE awcms_whatsapp_consents
  ADD COLUMN IF NOT EXISTS business_scopes jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE awcms_whatsapp_consents
  ADD COLUMN IF NOT EXISTS unscoped_granted boolean;

ALTER TABLE awcms_whatsapp_consents
  ADD CONSTRAINT awcms_whatsapp_consents_business_scopes_check
    CHECK (awcms_whatsapp_consent_scopes_valid(business_scopes));

ALTER TABLE awcms_whatsapp_consents
  ADD CONSTRAINT awcms_whatsapp_consents_withdrawn_covers_nothing_check
    CHECK (
      status = 'granted'
      OR (business_scopes = '[]'::jsonb AND unscoped_granted IS NOT TRUE)
    );

COMMENT ON COLUMN awcms_whatsapp_consents.business_scopes IS
  'Issue #1231 M4 -- the business scopes (brands) this marketing opt-in was collected for: [{type, id, source, grantedAt}]. A marketing message of scope B is eligible only when B is listed here AND status is granted. Empty for a withdrawn row. Only `office` resolves today.';

COMMENT ON COLUMN awcms_whatsapp_consents.unscoped_granted IS
  'Issue #1231 M4 -- true when an opt-in was collected for the tenant itself with no brand; it covers only marketing that names no business scope. NULL = recorded before sql/354 (legacy), read like true for unscoped sends and never for a brand. Never true on a withdrawn row.';
