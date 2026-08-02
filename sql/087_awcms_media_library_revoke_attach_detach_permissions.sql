-- ADR-0056 §A — revoke `media_library.media.attach` and `media_library.media.detach`.
--
-- ## Why these two rows describe an action nobody can perform
--
-- Before ADR-0036's ownership inversion, `news_media` OWNED the object→content
-- relation: `awcms_news_media_objects.owner_resource_type`/`.owner_resource_id`
-- were how a media object knew what it belonged to, and `attach`/`detach` were
-- real writes on this module's own table.
--
-- The inversion moved that relation to the CONSUMER. A post's image is
-- `awcms_blog_posts.featured_media_id`; an ad's image is
-- `awcms_news_portal_ad_placements.media_object_id`. Changing either means
-- updating the consumer's row, gated by the consumer's permission
-- (`blog_content.posts.update`, `blog_content.ads.update`) — never by anything
-- in `media_library`. The two functions that used to write the old relation
-- (`attachNewsMediaObject`/`detachNewsMediaObject`) had zero callers anywhere in
-- `src/`, `scripts/`, or `tests/`; they are deleted in this same change.
--
-- So the catalog rows advertised a surface that does not exist — and, because
-- `POST /api/v1/setup/initialize` grants the whole catalog to each new tenant's
-- `owner` role, every tenant owner has been holding authority over an action no
-- code path checks. Same shape as ADR-0052/`sql/084`: not exploitable today
-- (nothing reads them), but it is exactly the ambiguity that makes the NEXT
-- permission review guess whether an unused row is a gap or a leftover.
--
-- ## What does NOT change
--
-- The `attached` value of `awcms_news_media_objects.status` stays: the CHECK
-- constraint in `sql/041` still admits it, `isNewsMediaObjectSafeForPublicReference`
-- still treats it as safe to reference, and any row already in that state keeps
-- resolving exactly as before. What goes away is the ability to write it from
-- this module — which nothing did.
--
-- The other three ungated permissions (`delete`/`restore`/`purge`) are
-- deliberately NOT touched here. ADR-0056 §B gives them the endpoints they
-- always should have had, because unlike these two they describe real operator
-- needs that today have no answer at all.
--
-- ## Order matters
--
-- `awcms_role_permissions` references `awcms_permissions`, so the grants go
-- first or the catalog delete hits the FK. Deleting the grants is the half that
-- actually removes the authority from every role that already holds it; the
-- catalog delete alone would leave live grants pointing at nothing.
--
-- Idempotent: both statements are unconditional deletes matched by natural key,
-- so re-running is a no-op. No rollback statement is provided deliberately —
-- restoring these grants would re-advertise a surface that ADR-0036 removed.

DELETE FROM awcms_role_permissions rp
USING awcms_permissions p
WHERE rp.permission_id = p.id
  AND p.module_key = 'media_library'
  AND p.activity_code = 'media'
  AND p.action IN ('attach', 'detach');

DELETE FROM awcms_permissions
WHERE module_key = 'media_library'
  AND activity_code = 'media'
  AND action IN ('attach', 'detach');
