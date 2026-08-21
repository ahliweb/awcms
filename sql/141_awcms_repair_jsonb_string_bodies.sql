-- Issue #641 — repair `body_portable_text` rows that were stored as a jsonb
-- STRING instead of a jsonb array.
--
-- WHAT HAPPENED
--
-- Bun.SQL JSON-ENCODES a string parameter bound to a jsonb slot. So
-- `${JSON.stringify(x)}::jsonb` stores the jsonb SCALAR STRING `"[{...}]"`,
-- not the array. Verified against a real PostgreSQL 18:
--
--   JSON.stringify + ::jsonb  ->  jsonb_typeof = 'string'
--   the JS value   + ::jsonb  ->  jsonb_typeof = 'array'
--
-- Seven live call sites carried the broken spelling, including
-- `blog:portable-text:backfill` — the job whose entire purpose is to populate
-- the canonical column ADR-0100 introduced.
--
-- WHY IT MATTERED RATHER THAN JUST LOOKED WRONG
--
-- ADR-0100 makes `body_portable_text` canonical and `content_json.blocks` a
-- lossy projection. `hasCanonicalPortableTextBody` (Issue #624) decides which
-- one the public page renders, and it asks `Array.isArray`. `Array.isArray` of
-- a string is false — so every post written through the normal path rendered
-- from the lossy projection, silently, which is precisely the defect #624 was
-- written to prevent.
--
-- WHY `#>> '{}'` AND NOT `::text::jsonb`
--
-- `#>> '{}'` extracts a jsonb scalar's UNQUOTED text; `::text` would give the
-- quoted JSON representation and re-casting that returns the same string. So
-- `(body_portable_text #>> '{}')::jsonb` is the one spelling that unwraps.
--
-- THE SHAPE GUARD IS NOT DECORATION
--
-- Every row this repairs was written by the code above, so its text starts with
-- `[`. A jsonb string containing something else was not produced by that path,
-- and casting it would abort the whole migration on one unexpected row — which
-- on a populated production database means the deployment stops. The predicate
-- leaves such a row exactly as it is, and the DO block at the end reports it
-- rather than letting it pass unmentioned.
--
-- FORCE RLS IS DROPPED FOR THE DURATION
--
-- These are tenant-scoped FORCE RLS tables, and FORCE applies to the owner too,
-- so a tenant-wide UPDATE inside a migration would silently match zero rows —
-- green on an empty CI database, inert on a populated one. `sql/018`, `sql/103`
-- and `sql/112` establish the pattern: drop FORCE for the statement, put it
-- back in the same transaction. The runner wraps each migration in one
-- transaction and `ALTER TABLE` takes ACCESS EXCLUSIVE, so no concurrent
-- session can observe the table while FORCE is off.

BEGIN;

ALTER TABLE awcms_blog_posts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_pages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_revisions NO FORCE ROW LEVEL SECURITY;

UPDATE awcms_blog_posts
SET body_portable_text = (body_portable_text #>> '{}')::jsonb
WHERE jsonb_typeof(body_portable_text) = 'string'
  AND (body_portable_text #>> '{}') ~ '^\s*\[';

UPDATE awcms_blog_pages
SET body_portable_text = (body_portable_text #>> '{}')::jsonb
WHERE jsonb_typeof(body_portable_text) = 'string'
  AND (body_portable_text #>> '{}') ~ '^\s*\[';

UPDATE awcms_blog_revisions
SET body_portable_text = (body_portable_text #>> '{}')::jsonb
WHERE body_portable_text IS NOT NULL
  AND jsonb_typeof(body_portable_text) = 'string'
  AND (body_portable_text #>> '{}') ~ '^\s*\[';

ALTER TABLE awcms_blog_posts FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_blog_revisions FORCE ROW LEVEL SECURITY;

-- `awcms_email_messages.variables` was written the same way. It is repaired for
-- the same reason and separately, because its content is an OBJECT rather than
-- an array and the shape guard has to say so.
ALTER TABLE awcms_email_messages NO FORCE ROW LEVEL SECURITY;

UPDATE awcms_email_messages
SET variables = (variables #>> '{}')::jsonb
WHERE variables IS NOT NULL
  AND jsonb_typeof(variables) = 'string'
  AND (variables #>> '{}') ~ '^\s*\{';

ALTER TABLE awcms_email_messages FORCE ROW LEVEL SECURITY;

-- A jsonb string that the guards above did not repair was not written by any
-- code path this issue found, so it is left untouched and NAMED. Silence here
-- would be the same failure mode the whole issue is about: a wrong value that
-- nothing complains about.
DO $$
DECLARE
  remaining bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM awcms_blog_posts WHERE jsonb_typeof(body_portable_text) = 'string')
    + (SELECT count(*) FROM awcms_blog_pages WHERE jsonb_typeof(body_portable_text) = 'string')
    + (SELECT count(*) FROM awcms_blog_revisions WHERE jsonb_typeof(body_portable_text) = 'string')
    + (SELECT count(*) FROM awcms_email_messages WHERE jsonb_typeof(variables) = 'string')
  INTO remaining;

  IF remaining > 0 THEN
    RAISE WARNING
      'sql/141: % jsonb value(s) are still stored as a STRING and did not match the repair shape guard. They were not written by any path Issue #641 identified — inspect them before assuming they are inert.',
      remaining;
  END IF;
END
$$;

COMMIT;
