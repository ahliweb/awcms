-- social_publishing -- the dispatch-time re-check of the SOURCE of a publication
-- (Issue #1145 residual L8 of ADR-0157, condition before the first connector
-- #1146 may publish). Forward-only; sql/330, sql/358 and sql/373 are applied and
-- are NOT edited.
--
-- ## The gap
--
-- A publication's content is frozen at enqueue (ADR-0157 section 4): text, link
-- and a media snapshot whose rights status `media_library` had verified. That
-- freeze is right for WHAT is sent (an article edited later must not change an
-- approved post), but it also froze WHETHER it may be sent: an article that was
-- unpublished, archived, made private or deleted, a media object that was taken
-- down (soft-deleted, or no longer `verified`/`attached`), or a rights
-- adjudication that was withdrawn after the job was queued did not stop the job.
--
-- ## The fix: two narrow answers, not a wider view
--
-- Right before the provider call the dispatcher asks two questions, through the
-- ports of the modules that own the facts (`article_publication_status` of
-- `blog_content`, `media_library` 1.1.0), and the adapters answer them by calling
-- the two functions below. Each takes a (tenant, id) pair and returns ONE closed
-- code; neither returns a row, a title, a URL, a credit or any other column.
--
-- Why SECURITY DEFINER functions and not column grants to the dispatcher: the
-- dispatcher role `awcms_social_dispatch` holds the channel key ring. A column
-- grant of `status`, `visibility` and `deleted_at` on `awcms_blog_posts` (and
-- the rights columns of `awcms_news_media_objects`) would let it enumerate every
-- article and media object of a tenant it sets, and a RESTRICTIVE policy could
-- only narrow the rows, not the question. These functions narrow both: the role
-- learns one code for one id it already holds on a claimed job, and gains NO
-- privilege on either table (security:readiness pins its column matrix, which
-- does not name them, and probes that a direct read is refused).
--
-- Safeguards (the sql/303 / sql/316 definer pattern):
--
--   * the functions are owned by `awcms_social_source_check`, a NEW role that is
--     NOLOGIN, NOSUPERUSER, NOBYPASSRLS and memberless (security:readiness
--     check 7e), and that holds COLUMN-level SELECT on exactly the columns the
--     two bodies read, nothing else;
--   * `search_path = public, pg_temp` (pg_temp last: a caller's temp table
--     cannot shadow a relation; db:function-search-path:check);
--   * static SQL, no dynamic statement, no relation named by a string;
--   * the tenant is bound twice: the argument must equal the transaction's
--     `app.current_tenant_id` (else 42501, loudly: a mismatch is a bug, never a
--     "retracted" verdict), and the owner reads under the tables' FORCE RLS
--     tenant policy as well as an explicit `tenant_id =` predicate, so another
--     tenant's id answers "not available", never a fact about that tenant;
--   * EXECUTE is revoked from PUBLIC and granted to `awcms_social_dispatch`
--     only; security:readiness pins the body, owner, search_path, volatility and
--     the grantee list exactly, and probes the codes in a rolled-back
--     transaction.
--
-- ## The policies (the same as at enqueue, never weaker)
--
-- Article (`blog_content`'s own public-detail predicate, plus the scheduled
-- unpublish moment so a job cannot win the race against the unpublish worker):
-- not deleted, `status = 'published'`, `visibility` `public` or `unlisted` (the
-- link a post carries still resolves), `published_at` set and not in the future,
-- and `unpublish_at` unset or in the future. Anything else is `SOURCE_RETRACTED`.
--
-- Media (`media_library`'s safe-to-reference rule plus the rights gate of
-- `resolvePublicMediaRightsFields` and the enqueue rule of
-- `evaluateMediaEligibility`): a row that is missing, soft-deleted or not
-- `verified`/`attached` is `MEDIA_UNAVAILABLE`; a row whose rights are no longer
-- `verified`, or whose copyright status is unknown (or anything outside the
-- known statuses), is `MEDIA_RIGHTS_REVOKED`. `fair_use` stays accepted, as at
-- enqueue (ADR-0157 L8 records it as accepted).
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_social_source_check'
  ) THEN
    CREATE ROLE awcms_social_source_check
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_social_source_check
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_social_source_check;

-- Exactly the columns the two bodies read. Column-only, read-only.
GRANT SELECT (
  tenant_id, id, status, visibility, published_at, unpublish_at, deleted_at
) ON awcms_blog_posts TO awcms_social_source_check;

GRANT SELECT (
  tenant_id, id, status, deleted_at, rights_verification_status,
  copyright_status
) ON awcms_news_media_objects TO awcms_social_source_check;

CREATE OR REPLACE FUNCTION awcms_social_source_article_state(
  p_tenant_id uuid,
  p_article_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_tenant_id IS NULL OR p_article_id IS NULL
     OR p_tenant_id IS DISTINCT FROM
        NULLIF(current_setting('app.current_tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'awcms_social_source_article_state: the tenant is not the transaction tenant'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM awcms_blog_posts AS p
    WHERE p.tenant_id = p_tenant_id
      AND p.id = p_article_id
      AND p.deleted_at IS NULL
      AND p.status = 'published'
      AND p.visibility IN ('public', 'unlisted')
      AND p.published_at IS NOT NULL
      AND p.published_at <= now()
      AND (p.unpublish_at IS NULL OR p.unpublish_at > now())
  ) THEN
    RETURN 'PUBLISHED';
  END IF;

  RETURN 'SOURCE_RETRACTED';
END;
$function$;

COMMENT ON FUNCTION awcms_social_source_article_state(uuid, uuid) IS
  'Issue #1145 / ADR-0157 L8. Dispatch-time re-check of a social publication''s source article: PUBLISHED when the post of the transaction tenant is not deleted, published, public or unlisted, published_at in the past and unpublish_at unset or in the future; SOURCE_RETRACTED otherwise. Returns one code, never a row. Raises 42501 when the tenant argument is not app.current_tenant_id. Owner awcms_social_source_check (column SELECT only); EXECUTE for awcms_social_dispatch only.';

REVOKE ALL ON FUNCTION awcms_social_source_article_state(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_social_source_article_state(uuid, uuid)
  TO awcms_social_dispatch;
ALTER FUNCTION awcms_social_source_article_state(uuid, uuid)
  OWNER TO awcms_social_source_check;

CREATE OR REPLACE FUNCTION awcms_social_source_media_state(
  p_tenant_id uuid,
  p_media_object_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_rights text;
  v_copyright text;
BEGIN
  IF p_tenant_id IS NULL OR p_media_object_id IS NULL
     OR p_tenant_id IS DISTINCT FROM
        NULLIF(current_setting('app.current_tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'awcms_social_source_media_state: the tenant is not the transaction tenant'
      USING ERRCODE = '42501';
  END IF;

  SELECT m.status, m.rights_verification_status, m.copyright_status
    INTO v_status, v_rights, v_copyright
  FROM awcms_news_media_objects AS m
  WHERE m.tenant_id = p_tenant_id
    AND m.id = p_media_object_id
    AND m.deleted_at IS NULL;

  IF NOT FOUND OR v_status IS NULL
     OR v_status NOT IN ('verified', 'attached') THEN
    RETURN 'MEDIA_UNAVAILABLE';
  END IF;

  IF v_rights IS DISTINCT FROM 'verified'
     OR v_copyright IS NULL
     OR v_copyright NOT IN (
       'owned', 'licensed', 'public_domain', 'permission_granted', 'fair_use'
     ) THEN
    RETURN 'MEDIA_RIGHTS_REVOKED';
  END IF;

  RETURN 'AVAILABLE';
END;
$function$;

COMMENT ON FUNCTION awcms_social_source_media_state(uuid, uuid) IS
  'Issue #1145 / ADR-0157 L8. Dispatch-time re-check of a social publication''s media object: MEDIA_UNAVAILABLE when the object of the transaction tenant is missing, soft-deleted or not verified/attached; MEDIA_RIGHTS_REVOKED when its rights are no longer verified or its copyright status is unknown; AVAILABLE otherwise (fair_use accepted, as at enqueue). Returns one code, never a row. Raises 42501 when the tenant argument is not app.current_tenant_id. Owner awcms_social_source_check (column SELECT only); EXECUTE for awcms_social_dispatch only.';

REVOKE ALL ON FUNCTION awcms_social_source_media_state(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_social_source_media_state(uuid, uuid)
  TO awcms_social_dispatch;
ALTER FUNCTION awcms_social_source_media_state(uuid, uuid)
  OWNER TO awcms_social_source_check;

-- The dispatcher reads which source a claimed job's publication names, so it
-- can ask the two questions above. Read-only, ids and a kind only: still no
-- grant on the article or the media object themselves.
GRANT SELECT (source_kind, source_id, media_object_id)
  ON awcms_social_publications TO awcms_social_dispatch;
