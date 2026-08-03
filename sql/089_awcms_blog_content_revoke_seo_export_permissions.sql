-- ADR-0058 §C/§D — revoke `blog_content.seo.configure` and
-- `blog_content.posts.export`.
--
-- ## Why these two rows describe an action nobody can perform
--
-- Both were seeded by `sql/036` and declared by the descriptor. Neither has ever
-- had an enforcer: `bun run access:permissions:enforcement:check` (ADR-0057 §F)
-- found them and they are the last two entries in its exception list. They are
-- revoked rather than given a surface for two DIFFERENT reasons, which is why
-- ADR-0058 treats them as separate sections:
--
-- `seo.configure` is a SECOND AUTHORISATION AXIS over data that already has
-- one. The only occurrence of `activityCode: "seo"` anywhere in the repo is the
-- descriptor declaration itself, and the SEO defaults it promises authority
-- over — `seo_default_title` / `seo_default_description` in
-- `awcms_blog_settings` — are in fact written through
-- `PATCH /api/v1/blog/settings` under `blog_content.settings.configure`. Two
-- permissions naming authority over one column is a question the next
-- permission review has to answer again; only one of them was ever asked.
--
-- `posts.export` has NO MACHINERY AT ALL. No route, no application function, no
-- serializer, no job, no column. Unlike ADR-0056 §B's `delete`/`restore`/`purge`
-- — which described real operator needs with no answer — nothing here is half
-- built. Building an export feature to justify a catalogue row is the tail
-- wagging the dog. If post export is genuinely wanted later it arrives with its
-- own ADR, its own permission and its own machinery, not on the strength of a
-- row that predates the need.
--
-- ## Why an unused row is still worth removing
--
-- `POST /api/v1/setup/initialize` grants the WHOLE catalogue to each new
-- tenant's `owner` role, so every tenant owner has been holding authority over
-- two actions no code path checks. Not exploitable today — nothing reads them —
-- and that is exactly the ambiguity that makes the next review guess whether an
-- unused row is a gap or a leftover. ADR-0052/`sql/084` and ADR-0056 §A/`sql/087`
-- closed the same shape.
--
-- ## What does NOT change
--
-- Nothing about blog SEO: `seo_default_title`/`seo_default_description`,
-- `PATCH /api/v1/blog/settings`, `blog_content.settings.configure`, and
-- `seo_distribution`'s renderer are all untouched. The capability
-- `blog_content` provides to `seo_distribution` (`seo_facts`) is a module
-- capability, not a permission, and is unaffected.
--
-- ## Order matters
--
-- `awcms_role_permissions` references `awcms_permissions`, so the grants go
-- first or the catalogue delete hits the FK. Deleting the grants is the half
-- that actually removes the authority from every role that already holds it;
-- the catalogue delete alone would leave live grants pointing at nothing.
--
-- Unlike a seed, a revocation reaches every tenant at once: `DELETE` matched by
-- natural key does not care when a tenant was created, which is the opposite of
-- the gap `bun run identity-access:permissions:backfill` exists for.
--
-- Idempotent: both statements are unconditional deletes matched by natural key,
-- so re-running is a no-op. No rollback statement is provided deliberately —
-- restoring these grants would re-advertise a surface ADR-0058 states does not
-- exist.

DELETE FROM awcms_role_permissions rp
USING awcms_permissions p
WHERE rp.permission_id = p.id
  AND p.module_key = 'blog_content'
  AND (
    (p.activity_code = 'seo' AND p.action = 'configure')
    OR (p.activity_code = 'posts' AND p.action = 'export')
  );

DELETE FROM awcms_permissions
WHERE module_key = 'blog_content'
  AND (
    (activity_code = 'seo' AND action = 'configure')
    OR (activity_code = 'posts' AND action = 'export')
  );
