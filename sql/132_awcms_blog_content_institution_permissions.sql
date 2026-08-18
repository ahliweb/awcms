-- `blog_content` — permission catalog seed for the institution registry
-- introduced by sql/131 (PRD LenteraKalteng §12.2, FR-CNT-007/FR-CNT-008).
--
-- Verbatim match to the `INSTITUTION_*` constants in
-- `src/modules/blog-content/domain/institution-permissions.ts` and to this
-- module's `module.ts` `permissions` array — the same single source of truth
-- the route guards call `authorizeInTransaction` with.
--
-- Extends the global ABAC permission catalog only; no roles or access
-- assignments are wired here. **Only tenants created AFTER this migration runs
-- pick these up automatically**, via the setup bootstrap's
-- `INSERT INTO awcms_role_permissions ... SELECT ... FROM awcms_permissions` —
-- the same limitation every prior permission-seed migration in this repo
-- carries, and stated rather than quietly worked around. It does not bite the
-- tenant this work is for (PRD §20 creates Lentera fresh), but an EXISTING
-- tenant that wants institutions will 403 until an operator grants them; that
-- is a deliberate operator action, not something a migration should do behind
-- their back to every tenant on the deployment.
--
-- ## Why a separate activity instead of reusing `blog_content.terms.*`
--
-- sql/131 puts channels and topics into `awcms_blog_terms` precisely because
-- they are nothing more than labels. An institution is not: it owns a public
-- LANDING PAGE with its own `seo_title`/`seo_description` (PRD §12.2).
--
-- That is the same blast-radius argument sql/058 makes for splitting
-- `seo_distribution.config.read` from `.update` — changing what crawlers see is
-- a different power from reading it. Folding institutions into
-- `blog_content.terms.update` would hand every contributor who may fix a
-- tag's spelling the ability to rewrite the title tag of thirty landing pages,
-- and there would be no grantable way to separate the two afterwards.
--
-- ## Why `delete`, `restore` AND `purge` are all separately grantable
--
-- `awcms_blog_institutions` is soft-deleted (sql/131), and the partial unique
-- index releases the slug on delete, so an institution removed by mistake can
-- be re-created or restored under the URL its old articles already link to.
-- Both halves of that need to be separately grantable.
--
-- `purge` is the third, and it is a genuinely different power: it removes the
-- row permanently AND deletes every `awcms_blog_post_institutions` link, so an
-- archive of articles loses that classification with no way back. Holding
-- `delete` is reversible; holding `purge` is not, which is exactly the split
-- `blog_content.posts` and `.pages` already draw.
--
-- It is not seeded for tidiness. Without a purge, this table would have no
-- mechanism that ever removes a row, and the retention question
-- (`data-lifecycle:table-coverage:check`) could only be answered with an
-- ARGUMENT about how slowly it grows rather than a MECHANISM. The
-- `BOUNDED_BY_DESIGN` ledger is capped precisely to refuse that trade, so the
-- endpoint was built instead of the exemption. The `dataLifecycle` descriptors
-- in `blog-content/module.ts` adopt this purge as their executor.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('blog_content', 'institutions', 'read',
   'Read this tenant''s institution registry (the legislative/executive bodies articles are filed against)'),
  ('blog_content', 'institutions', 'create',
   'Register a new institution, including the slug its public landing page is served at'),
  ('blog_content', 'institutions', 'update',
   'Update an institution — including its landing-page SEO title/description, which changes what search engines index'),
  ('blog_content', 'institutions', 'delete',
   'Soft-delete an institution; its slug is released and its articles keep their other classifications'),
  ('blog_content', 'institutions', 'restore',
   'Restore a soft-deleted institution'),
  ('blog_content', 'institutions', 'purge',
   'Permanently remove a soft-deleted institution and every article link pointing at it — irreversible, audited at critical severity')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
