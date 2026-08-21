-- Issue #615 — a photograph can say who took it, and whether anyone checked.
--
-- `awcms_news_media_objects` has carried `alt_text` and `caption` since sql/041.
-- Neither is a rights statement: alt text is ACCESSIBILITY (what a screen reader
-- says) and a caption is EDITORIAL (what the reader is told about the scene).
-- A newsroom that publishes a wire photo owes a credit line and a licence, and
-- neither of the two existing columns can hold one without becoming ambiguous
-- about what "required" means — alt text is required for a11y, a credit is
-- required for legality, and they fail for different reasons and to different
-- people.
--
-- ## The five columns
--
-- `credit_line` is what gets PRINTED beside the image ("Foto: Nama/Kantor
-- Berita"). `source_name` is where it came from, which is often not the same
-- thing: a photo credited to a stringer may have arrived through an agency, and
-- a takedown request names the agency.
--
-- `copyright_status` is a closed vocabulary rather than free text, because the
-- question it answers is legal and its answers are finite. `'unknown'` is the
-- default and is a real answer — most of a legacy archive is exactly that, and
-- recording "we do not know" is more useful than an empty column that could mean
-- either "not checked" or "nothing to declare".
--
-- `rights_verification_status` + `rights_verified_by`/`_at` record the HUMAN
-- judgement, and they are deliberately NOT the existing `status = 'verified'`.
--
-- ## Why rights verification is not `media.verify`
--
-- `media.verify` and `status = 'verified'` mean the BYTES were checked — MIME
-- sniffed from magic bytes, checksum matched, dimensions read
-- (`media-r2-verification.ts`). That is a machine answering a question about a
-- file. Whether a licence permits publication is a person answering a question
-- about a contract. Reusing one word for both would make one of them wrong, and
-- the one that would end up wrong is the legal one — a file that passes a MIME
-- sniff would read as rights-cleared to anyone glancing at a column called
-- `verified`.
--
-- So: separate column, separate vocabulary, separate permission
-- (`media_library.media.update`, seeded below), and an audit event on every
-- change of the rights status.
--
-- ## The CHECK
--
-- `verified`/`rejected` are ADJUDICATIONS: somebody decided, and the row must
-- say who and when. `unverified` is the absence of one, so both must be null —
-- otherwise a row can claim a verifier for a verification that did not happen,
-- which is precisely the record a rights dispute would be argued from.
--
-- Deliberately NOT comparing `rights_verified_at` to `now()`: a CHECK that ties
-- an application-supplied instant to the transaction clock rejects ordinary rows
-- for reasons nobody can reproduce (this repo has paid for that once already).

ALTER TABLE awcms_news_media_objects
  ADD COLUMN IF NOT EXISTS credit_line text,
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS copyright_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS rights_notes text,
  ADD COLUMN IF NOT EXISTS rights_verification_status text NOT NULL
    DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS rights_verified_by uuid,
  ADD COLUMN IF NOT EXISTS rights_verified_at timestamptz;

ALTER TABLE awcms_news_media_objects
  DROP CONSTRAINT IF EXISTS awcms_news_media_objects_copyright_status_check;

ALTER TABLE awcms_news_media_objects
  ADD CONSTRAINT awcms_news_media_objects_copyright_status_check
  CHECK (copyright_status IN (
    'unknown', 'owned', 'licensed', 'public_domain',
    'permission_granted', 'fair_use'
  ));

ALTER TABLE awcms_news_media_objects
  DROP CONSTRAINT IF EXISTS awcms_news_media_objects_rights_status_check;

ALTER TABLE awcms_news_media_objects
  ADD CONSTRAINT awcms_news_media_objects_rights_status_check
  CHECK (rights_verification_status IN ('unverified', 'verified', 'rejected'));

ALTER TABLE awcms_news_media_objects
  DROP CONSTRAINT IF EXISTS awcms_news_media_objects_rights_adjudication_check;

ALTER TABLE awcms_news_media_objects
  ADD CONSTRAINT awcms_news_media_objects_rights_adjudication_check
  CHECK (
    (rights_verification_status = 'unverified'
      AND rights_verified_by IS NULL AND rights_verified_at IS NULL)
    OR
    (rights_verification_status <> 'unverified'
      AND rights_verified_by IS NOT NULL AND rights_verified_at IS NOT NULL)
  );

COMMENT ON COLUMN awcms_news_media_objects.credit_line IS
  'Issue #615 — the credit printed beside the image. Not alt_text (accessibility) and not caption (editorial).';

COMMENT ON COLUMN awcms_news_media_objects.source_name IS
  'Issue #615 — where the file came from, which is often not who is credited.';

COMMENT ON COLUMN awcms_news_media_objects.rights_verification_status IS
  'Issue #615 — a HUMAN judgement about a licence. Distinct from status = ''verified'', which means the BYTES passed a MIME/checksum check.';

-- The permission the new PATCH endpoint checks. Nine media permissions existed
-- and not one of them permitted editing metadata: `create`, `read`, `verify`,
-- `delete`, `restore`, `purge`, `cancel` plus the two `enforcement.*`. So the
-- rights columns above would have been unreachable from a browser without this
-- row, and reusing `verify` for it would have collapsed the very distinction
-- the columns exist to draw.
--
-- Only tenants created AFTER this migration pick it up automatically, via the
-- setup bootstrap's `INSERT INTO awcms_role_permissions ... SELECT ... FROM
-- awcms_permissions`. That is the same limitation every permission-seed
-- migration here carries, and sql/132 states the reason for not working around
-- it: granting a new capability to every role on the deployment behind an
-- operator's back is not a migration's decision to make.
--
-- The supported way forward for an existing tenant already exists and needs no
-- new tooling here: `bun run identity-access:permissions:backfill` grants an
-- owner role every catalog permission NEWER than that role, dry-run by default,
-- `--tenant <code>` for a staged rollout. So a tenant that opens /admin/media
-- and finds the rights fields refused has one command to run rather than a
-- silent 403 with nothing in the release notes about it.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('media_library', 'media', 'update', 'Edit media object metadata — credit line, source, copyright status, and the rights verification decision')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
