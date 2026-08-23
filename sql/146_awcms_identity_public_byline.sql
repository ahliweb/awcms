-- 146_awcms_identity_public_byline.sql
--
-- ADR-0109 — an author's OPT-IN public byline (Issue #597 item 4).
--
-- `awcms_blog_posts.author_tenant_user_id` has recorded who wrote every article
-- since sql/035, and nothing public has ever resolved it.
-- `structured-data-rendering.ts` says why, in its own comment: emitting an
-- individual editor's identity would be "a new PII surface", so the JSON-LD
-- `author` is the ORGANISATION. The result is a news platform whose articles are
-- attributed to a masthead and never to a journalist.
--
-- ## Why a new column rather than the name that already exists
--
-- The obvious move is to publish `awcms_profiles.display_name` — the name the
-- person is known by inside the tenant. Rejected: that turns every internal
-- account name into public data the moment an article publishes, for every
-- author, with nobody having chosen it. A byline is a decision a writer makes,
-- and in a newsroom it is frequently NOT their account name (a pen name, an
-- initialled form, a name in a different script).
--
-- So: a separate, nullable, opt-in field. NULL — the value every existing row
-- gets and the default for every row created after this — means "no byline",
-- and the organisation-level attribution ADR-0102 already ships stays exactly
-- as it is. Nothing about any existing article changes until a person fills
-- this in.
--
-- ## Why it lives HERE and not on `awcms_profiles`
--
-- `awcms_profiles` holds every party this tenant knows — customers and
-- organisations included — and a byline on a customer record is meaningless.
-- `awcms_tenant_users` is exactly the population that can author: a person who
-- works in this tenant. It also makes the byline per-TENANT, which is correct
-- for a principal who writes for two newsrooms under two names, and it puts the
-- resolution one join from the post rather than two.
--
-- ## Erasure
--
-- This is the first personal detail `awcms_tenant_users` has ever carried, so
-- the table's subject-data descriptor moves back from
-- `severed_with_subject_row` to `anonymize` naming this column (ADR-0108). A
-- byline is the person's name in public; an erasure that left it standing would
-- leave their name under their articles.
--
-- 120 characters: the same ceiling `awcms_comments_comments.author_display_name`
-- uses for the same kind of value, and well under the 200 of an internal
-- display name, because this one is rendered inline in a page's chrome.

ALTER TABLE awcms_tenant_users
  ADD COLUMN IF NOT EXISTS public_byline_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'awcms_tenant_users_public_byline_name_len'
  ) THEN
    ALTER TABLE awcms_tenant_users
      ADD CONSTRAINT awcms_tenant_users_public_byline_name_len
      CHECK (
        public_byline_name IS NULL
        OR (
          char_length(public_byline_name) BETWEEN 1 AND 120
          -- No leading/trailing whitespace and no control characters: the value
          -- is rendered inline in a byline and carried into JSON-LD, and a
          -- newline inside it would break both. The API normalises before it
          -- writes; this is the constraint that makes a hand-written INSERT
          -- obey the same rule.
          AND public_byline_name = btrim(public_byline_name)
          AND public_byline_name !~ '[[:cntrl:]]'
        )
      );
  END IF;
END
$$;

COMMENT ON COLUMN awcms_tenant_users.public_byline_name IS
  'ADR-0109 — the name this person is published under in this tenant. NULL (the default) means no byline: the article keeps the organisation-level attribution. Set only by the person themselves through PATCH /api/v1/auth/profile.';
