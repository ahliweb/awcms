🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# media_library

Tenant-scoped media object registry and upload flow — a System Foundation module
reusable by every website module ([ADR-0036](../../../docs/adr/0036-media-library-module-admission-ownership-inversion.md),
adapting awcms-micro ADR-0026).

## Origin — an ownership inversion, not a fresh port

This module was created by **extracting the media registry out of `news_portal`**.
Before ADR-0036, `news_portal` owned the registry (because the epic that needed
media happened to be the news portal) and exposed it as the `news_media`
capability; a brochure-site tenant (`blog_content` + `tenant_domain`, no news
portal) therefore had no managed media at all.

The coupling lived in the port contract itself
(`NewsMediaPort.isFullOnlineR2ModeActiveForTenant` — a `news_portal` editorial
question), so the port was **split**, not just renamed. `media_library` now owns:

- the registry table `awcms_news_media_objects` (kept its name deliberately — §3
  of the ADR: a hard composite FK from `awcms_news_portal_ad_placements` plus
  three migrations reference it), migrations `041`/`042`/`045`;
- the presigned direct-to-R2 upload/finalize/cancel flow
  (`/api/v1/media/news-images/upload-sessions/*`) with real magic-byte MIME
  sniffing and server-side SHA-256 verification;
- the `news-media:reconcile` background job (command name kept);
- the `media_library` capability (`_shared/ports/media-library-port.ts`,
  `MediaLibraryPort`), consumed by `blog_content` (optional) and `news_portal`
  (required — ad placements FK a media object).

`news_portal` keeps homepage sections + ad placements (and, where ported, the
R2-only editorial preset); it now **consumes** `media_library`.

## Managed-media enforcement (ADR-0036 step 5a) — one-way by construction

"Must this tenant's media references be registry-backed?" is answered by two
halves that both must hold:

1. **Deployment readiness** — `domain/managed-media-readiness.ts`
   (`evaluateManagedMediaReadiness`), pure: R2 enabled, config complete, and
   separated from `sync-storage`'s own `R2_*` credentials. Reason-code strings
   are identical to `news-portal-preset-readiness.ts`'s (the media half was
   carved out of it, and it now composes this).
2. **Per-tenant opt-in** — `application/media-library-tenant-state.ts`
   (`awcms_media_library_tenant_state`, migration `053`, RLS FORCE). The only
   writer is `markManagedMediaEnforced`, called only from the sanctioned entry
   point `application/enable-managed-media-enforcement.ts`, exposed as
   `POST /api/v1/media/enforcement` (permission `media_library.enforcement.enable`).

**Enforcement is one-way.** There is no `disable` action, no unmark function, and
no DELETE against the state table anywhere — a tenant able to switch its own media
validation off is the exploit `sql/043`'s header records as
confirmed-exploitable. The only rollback is a deployment-level `NEWS_MEDIA_R2_*`
change (fail-closed via readiness). Guarded by
`tests/media-enforcement-one-way.test.ts`.

## Layout

```
media-library/
  module.ts                                  # descriptor: system, provides media_library, 9 permissions, reconcile job
  domain/
    media-permissions.ts                     # MEDIA_PERMISSIONS (7) + MEDIA_ENFORCEMENT_PERMISSIONS (2)
    media-r2-config.ts                        # NEWS_MEDIA_R2_* config (names kept), separation-from-sync-storage checks
    managed-media-readiness.ts               # evaluateManagedMediaReadiness (media half of preset readiness)
    media-mime-sniffer.ts | media-object-key.ts | media-finalize-decision.ts
    media-upload-session-validation.ts | media-reconciliation-categorization.ts
  application/
    media-object-directory.ts                # registry data layer (internal symbols kept: fetchNewsMediaObjectById, ...)
    media-finalize-upload-session.ts | media-r2-verification.ts | media-reconciliation.ts
    media-library-port-adapter.ts            # mediaLibraryPortAdapter (imports ONLY media_library)
    media-library-tenant-state.ts            # markManagedMediaEnforced (only writer) + isManagedMediaEnforcedForTenant
    enable-managed-media-enforcement.ts      # sanctioned enforcement-enable entry point (readiness-gated + audited)
  infrastructure/
    media-r2-client.ts
```

## Migrations

| Migration | What                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `052`     | Repoint permission ownership `news_portal.media.*` → `media_library.media.*` (INSERT → repoint role grants → DELETE; order load-bearing) |
| `053`     | `awcms_media_library_tenant_state` (RLS ENABLE+FORCE + tenant_isolation) + backfill from `awcms_news_portal_tenant_state`                |
| `054`     | `media_library.enforcement.{read,enable}` permission catalog rows                                                                        |
| `087`     | REVOKE `media_library.media.{attach,detach}` — grants first, then catalog rows (ADR-0056 §A)                                             |

Registry/upload/homepage/ad-placement tables (`041`–`045`) were created before
the inversion and are unchanged.

## Object lifecycle ([ADR-0056](../../../docs/adr/0056-media-library-admin-surface.md) §B)

Three of this module's permissions sat in the catalog since `sql/052`, granted
to every tenant owner, and enforced by **nothing** — no route, no function, no
job. The functions behind them were written and had zero callers. So an object
uploaded by mistake, orphaned, or violating policy disappeared only if the
reconciliation job happened to categorise it that way, on the job's schedule.
There was no way for an administrator to remove one, and no way to undo it.

| Endpoint                                  | Permission                    | Notes                                                               |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| `DELETE /api/v1/media/objects/{id}`       | `media_library.media.delete`  | Body `{ reason }`, required and bounded. Soft delete; R2 untouched. |
| `POST /api/v1/media/objects/{id}/restore` | `media_library.media.restore` | Undo. A live object answers 404, not a silent success.              |
| `POST /api/v1/media/objects/{id}/purge`   | `media_library.media.purge`   | Hard-deletes the REGISTRY ROW only. Cannot be undone.               |

All three are high-risk actions and require `Idempotency-Key`.

**Soft delete breaks live references, deliberately.** `resolveMediaReferences`
filters `deleted_at IS NULL`, so a post whose `featured_media_id` points at a
deleted object resolves to nothing immediately. That is the intended outcome for
the case this exists to serve — a policy-violating image must stop being served
— and `restore` is why it is recoverable. None of these endpoints scans for
referencing rows first: that would make this module know its own consumers.

**`purge` clears the registry, not the bucket.** The `news-media:reconcile` job
owns R2 and has the ordering discipline for deleting from it; a second writer
here would mean two processes with different ideas of what is safe to remove.
Accepted, stated cost: a window where the R2 object outlives its registry row,
closed by the next reconciliation tick, which sees a key with no row and treats
it as an orphan-in-R2.

`awcms_news_portal_ad_placements.media_object_id` is a hard NOT NULL FK here, so
purging a still-referenced object answers `409 MEDIA_OBJECT_REFERENCED`. That
path runs inside a **savepoint**: in PostgreSQL a `23503` aborts the whole
transaction, so catching it without one turns a caller-actionable 409 into a 500
at COMMIT. The SQLSTATE is read from `error.errno` — Bun puts its own constant
on `error.code`, so comparing `code` to `"23503"` can never be true
(`tests/postgres-sqlstate-detection.test.ts` now gates this repo-wide).

## Browse listing ([ADR-0056](../../../docs/adr/0056-media-library-admin-surface.md) §C)

`GET /api/v1/media/objects/list` — gated on `media_library.media.read`, keyset
paginated (50/page), newest first. Filters: `status`, `mimeType`, `deletion`
(`live` | `deleted` | `all`, default `live`), `cursor`.

Before this, the application layer had only point lookups
(`fetchNewsMediaObjectById`, `...ByIds`, `...ByObjectKey`). There was no way to
ask "what media does this tenant have", so a browse screen could not be built on
the existing surface at all, whatever the permissions said.

**A separate path from `GET /api/v1/media/objects`, deliberately.** That
endpoint demands `?ids=` — it is a batch RESOLVER for the `awcms-astro` build.
Teaching it a no-`ids` mode would turn a request that is a **400 today** into a
dump of the whole registry: a contract change wearing the clothes of an
addition. `list` can never be read as an object id, because the `/{id}` routes
require a uuid and answer 400 otherwise — so the static/dynamic precedence rule
is not the only thing keeping the two paths apart.

**It deliberately outgrows the resolver's safety rule**, returning rows in ANY
status and, on request, soft-deleted ones. `isNewsMediaObjectSafeForPublicReference`
admits only `verified`/`attached`; an administrator opens this list precisely
because of the objects that are NOT healthy, and §B's lifecycle endpoints would
otherwise have no way to find their targets. Nothing returned here may be used
as a public reference — that is what the resolver is for.

The cursor carries full-precision `created_at` text, never a JS `Date`. A batch
upload writes many rows inside one millisecond, which is the exact shape of
Issue #158; `tests/integration/media-object-list.integration.test.ts` inserts
107 rows in ONE statement and walks every page, and reverting the cursor to a
`Date` loses 57 of them.

## `/admin/media` ([ADR-0056](../../../docs/adr/0056-media-library-admin-surface.md), ADR-0051)

The object lifecycle console: browse with the §C filters, then delete, restore,
or purge. Four permissions — `media.read`, `.delete`, `.restore`, `.purge`.
Every mutation posts to the guarded endpoint with a fresh `Idempotency-Key`
(unlike `/admin/sync`, where no endpoint wants one, all three here require it).

Three deliberate absences, each pinned by
`tests/admin-media-page-contract.test.ts` so they stay decisions rather than
becoming gaps:

- **Upload** (`media.create`/`.verify`/`.cancel`) — a three-step browser flow
  (create session → PUT to R2 → finalize) with file input, progress, and
  client-side failure modes. A button that starts a session this page cannot
  finish leaves a `pending_upload` row on every misclick, which is exactly the
  litter the reconciliation job cleans up.
- **`enforcement.*`** — a tenant-wide ONE-WAY policy switch, not an object
  action. It lives on `/admin/security` with the other policy controls.
- **No `<img>` preview.** A row can be `pending_upload` or `failed`: the bytes
  may be absent, unverified, or the very thing the operator came to remove.
  Rendering them shows a policy-violating image one more time, to the person
  removing it.

## Not ported to this base (deferred, additive)

Responsive `srcset` render (micro step 5b) and the PDF media type (step 5c).
The allowed MIME set stays the four raster types. Step 5d — the lifecycle API
and `/admin/media` — is now ported in full.

## Media reference resolution (`GET /api/v1/media/objects`)

This registry previously had **no read surface at all** — only upload sessions
and the enforcement flag. The consequence was that an out-of-process consumer
could see that a post HAS an image (`featured_media_id`, `seo_image_media_id`)
with no way whatsoever to learn its URL; `article-images.ts` in `awcms-astro`
returned `src: undefined` for exactly that reason, and every article shipped
without its image while nothing failed.

`GET /api/v1/media/objects?ids=<uuid>,<uuid>` resolves at most 100 ids in one
pass (gated on `media_library.media.read` — a permission seeded since `sql/052`
while it waited for its surface, ADR-0026 step 5d). The logic is NOT new:
`MediaLibraryPort.resolveMediaReferences` already does the same thing for
in-process consumers. This is the same call, over HTTP, with the same security
rules — only `verified`/`attached` objects, one tenant, not soft-deleted,
resolve.

Ids that do not resolve are **reported** in `unresolved`, not dropped: returning
only the successful ones makes "this resource has no image" and "its image
reference is broken" the same response — the ambiguity that let this
missing-image gap survive unnoticed. An id that is not a uuid is rejected with
400, because "you sent garbage" and "that object may not be referenced" are two
different facts.

Read-only, so machine credentials ([ADR-0049](../../../docs/adr/0049-machine-credentials-and-session-introspection.md))
may hold it.
