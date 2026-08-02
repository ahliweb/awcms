---
"awcms": minor
---

Add `listMediaObjects` and `GET /api/v1/media/objects/list` (ADR-0056 §C) — the last piece before `/admin/media`.

Until now the application layer had only point lookups: `fetchNewsMediaObjectById`, `fetchNewsMediaObjectsByIds`, `fetchNewsMediaObjectByObjectKey`. There was no way to ask "what media does this tenant have", so a browse screen could not be built on the existing surface at all, whatever the permission catalog said.

**It gets its own route rather than a mode on the resolver.** `GET /api/v1/media/objects` demands `?ids=` — it is a batch resolver built for the `awcms-astro` build to swap ids for public URLs. Teaching it a "no `ids` means list everything" branch would turn a request that is a 400 today into a dump of the entire registry: a contract change wearing the clothes of an addition, and one no existing caller could opt out of.

`list` cannot be read as an object id, because `[id].ts` and its children now require a uuid and answer 400 otherwise. That closes the path ambiguity from the other side, so Astro's static-before-dynamic precedence is not the only thing keeping `/list` and `/{id}` apart.

**The listing deliberately outgrows the resolver's safety rule.** It returns rows in any status — `pending_upload`, `failed`, `orphaned` — and, with `deletion=deleted|all`, soft-deleted ones. `isNewsMediaObjectSafeForPublicReference` admits only `verified`/`attached`; an administrator opens this list precisely because of the objects that are *not* healthy, and §B's lifecycle endpoints would otherwise have no way to find their targets. `media.read` keeps it inside the tenant, and nothing returned here may be used as a public reference.

`deletion` is three states rather than a boolean `includeDeleted`: "show me what I deleted" is the question restore and purge exist to answer, and a boolean cannot ask it. It defaults to `live`, so deleted objects are opt-in.

Filters and cursors are **refused when malformed, never ignored** — a silently dropped filter answers 200 with a page nobody asked for, and a corrupt cursor treated as "no cursor" serves page 1 to a caller paging through page 4, forever.

The cursor carries full-precision `created_at` text, never a JS `Date`. A media registry is one of the likeliest places to resurrect Issue #158, because a batch upload writes many rows inside a single millisecond. `tests/integration/media-object-list.integration.test.ts` inserts 107 rows in ONE statement — so they share a transaction timestamp exactly — and walks every page; reverting the cursor to `Date` loses 57 of them and turns four tests red.

The projection omits `bucket_name`/`storage_driver` (deployment facts a browse screen has no use for) and `owner_resource_type`/`owner_resource_id` (vestigial since ADR-0036 moved attachment to the consumer's FK — shipping them would invite a screen to present them as current).

ADR-0056 is now complete. What remains is the `/admin/media` screen itself.
