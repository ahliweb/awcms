---
"awcms": minor
---

Revoke `media_library.media.attach` and `media_library.media.detach` (ADR-0056 §A).

Both were seeded into the global permission catalog by `sql/052`, and `POST /api/v1/setup/initialize` grants that catalog whole to every new tenant's `owner` role. Neither was ever checked: no route, no application function, no job. They named a write that stopped existing at ADR-0036 — before that inversion, `awcms_news_media_objects.owner_resource_type`/`.owner_resource_id` held the object→content relation and attach/detach were real operations on this module's own table; after it, a media object's attachment is stated by the consumer's FK (`awcms_blog_posts.featured_media_id`, `awcms_news_portal_ad_placements.media_object_id`), so attaching means updating the consumer's row under the consumer's permission.

`sql/087` deletes the grants first, then the catalog rows — reversed, the catalog delete hits the `awcms_role_permissions` FK. The two zero-caller functions (`attachNewsMediaObject`, `detachNewsMediaObject`) are deleted with them, and `media-object-directory.ts` keeps a marker where they were so the next reader learns why the module has no attach path rather than assuming one is missing.

The `attached` **status** survives deliberately: `sql/041`'s CHECK still admits it and `isNewsMediaObjectSafeForPublicReference` still treats it as safe to reference, so any row already in that state keeps resolving. What is gone is the ability to write it — which nothing did. `verified` is what the finalize flow produces and it is equally referenceable.

This is a real authorization change, and it is the narrow half of the ADR: `delete`/`restore`/`purge` are equally ungated today and are deliberately left alone here, because unlike these two they describe operator needs that currently have no answer at all. §B gives them endpoints.

Also corrects ADR-0056 §A, whose first edition said all five dead functions were deleted — contradicting §B, which uses three of them. Two are deleted; three are kept and given a surface.
