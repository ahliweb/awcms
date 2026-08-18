-- Issue #591 — an article can be scheduled to appear and never scheduled to stop.
--
-- `scheduled_at` + `blog:publish:scheduled` have handled the appearing half
-- since Issue #541. The other half does not exist: the transition table in
-- `domain/post-status.ts` offers `published -> archived | draft`, both MANUAL,
-- and there is no `unpublish` anywhere in `src/` or `sql/`.
--
-- For a newsroom that is not an edge case. An embargo that lifts, a campaign
-- page whose contract ends, partner content with a paid window — today all of
-- them are held open by somebody remembering to archive the post, at an hour
-- nobody is monitoring. What fails silently is not the system; it is the person.
--
-- ## Why the column lives on posts and NOT on pages
--
-- `awcms_blog_pages` carries Redaksi, Pedoman Media Siber, Disclaimer — the
-- legal and identity surface a news site is REQUIRED to keep reachable. A
-- scheduled unpublish there would let a tenant silently remove the page a press
-- council expects to find, on a timer, with no editor in the loop. If a page
-- ever needs a window, it needs a different conversation than this one, so the
-- column is deliberately withheld rather than added "for symmetry".
--
-- ## Why the CHECK compares against BOTH timestamps
--
-- `unpublish_at` must come after whichever moment the post actually becomes
-- visible, and which moment that is depends on the row: a scheduled post uses
-- `scheduled_at`, a live one uses `published_at`. Comparing against only one
-- would leave the other free to express a window that closes before it opens —
-- a post that publishes at 09:00 and unpublishes at 08:00 is not a strange
-- edge case, it is a typo an editor makes at the end of a shift, and the
-- symptom is an article that flashes into existence and vanishes on the next
-- sweep with nothing explaining it.
--
-- NULL on either side is permitted: a draft with an unpublish date but no
-- publish date yet is a legitimate work-in-progress state, and the comparison
-- is re-checked at every write, so it becomes binding the moment the other
-- timestamp is set.

BEGIN;

ALTER TABLE awcms_blog_posts
  ADD COLUMN IF NOT EXISTS unpublish_at timestamptz;

COMMENT ON COLUMN awcms_blog_posts.unpublish_at IS
  'Issue #591 — the moment `blog:publish:scheduled` transitions this post to `archived`. NULL = stays published until an editor archives it by hand, which is the behaviour every post had before this column existed. Deliberately absent from `awcms_blog_pages`: the legal/identity pages must not be removable on a timer.';

ALTER TABLE awcms_blog_posts
  DROP CONSTRAINT IF EXISTS awcms_blog_posts_unpublish_after_publish_check;

ALTER TABLE awcms_blog_posts
  ADD CONSTRAINT awcms_blog_posts_unpublish_after_publish_check
    CHECK (
      unpublish_at IS NULL
      OR (
        (scheduled_at IS NULL OR unpublish_at > scheduled_at)
        AND (published_at IS NULL OR unpublish_at > published_at)
      )
    );

-- Mirrors `awcms_blog_posts_scheduled_due_idx` exactly, one status along: the
-- sweep reads `status = 'published' AND unpublish_at <= now()`, orders by
-- `unpublish_at ASC`, and takes `FOR UPDATE SKIP LOCKED` on a bounded batch.
-- Partial on the same two predicates so it stays the size of the pending set
-- rather than the size of the archive — the overwhelming majority of published
-- posts will never carry an `unpublish_at` at all.
CREATE INDEX IF NOT EXISTS awcms_blog_posts_unpublish_due_idx
  ON awcms_blog_posts (tenant_id, unpublish_at)
  WHERE status = 'published' AND unpublish_at IS NOT NULL AND deleted_at IS NULL;

-- `awcms_worker` already holds SELECT + UPDATE on this table (sql/035, granted
-- for `blog:publish:scheduled`). The unpublish sweep is the SAME job touching
-- the SAME table, so it needs nothing new — and re-granting here would widen
-- the worker's surface the moment the two statements disagreed.

COMMIT;
