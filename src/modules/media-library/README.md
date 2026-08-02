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

## Not ported to this base (deferred, additive)

The `/admin/media` screen (micro step 5d — the lifecycle API half above is now
ported, so this module still declares no `navigation`), responsive `srcset`
render (step 5b), and the PDF media type (step 5c). The allowed MIME set stays
the four raster types.

## Resolusi referensi media (`GET /api/v1/media/objects`)

Registry ini sebelumnya **tidak punya permukaan baca sama sekali** — hanya
upload session dan flag enforcement. Akibatnya konsumen di luar proses bisa
melihat bahwa sebuah post PUNYA gambar (`featured_media_id`,
`seo_image_media_id`) tanpa cara apa pun mengetahui URL-nya; `article-images.ts`
di `awcms-astro` mengembalikan `src: undefined` justru karena itu, dan setiap
artikel terbit tanpa gambarnya sementara tak ada yang gagal.

`GET /api/v1/media/objects?ids=<uuid>,<uuid>` me-resolve maksimal 100 id sekali
jalan (gerbang `media_library.media.read` — permission yang sudah diseed sejak
`sql/052` sambil menunggu permukaannya, ADR-0026 langkah 5d). Logikanya BUKAN
baru: `MediaLibraryPort.resolveMediaReferences` sudah melakukan hal yang sama
untuk konsumen in-process. Ini panggilan yang sama, lewat HTTP, dengan aturan
keamanan yang sama — hanya objek `verified`/`attached`, satu tenant, tidak
soft-deleted, yang resolve.

Id yang tidak resolve **dilaporkan** di `unresolved`, tidak dibuang: mengembalikan
hanya yang berhasil membuat "resource ini tidak punya gambar" dan "referensi
gambarnya rusak" jadi respons yang sama — ambiguitas yang membuat celah gambar
hilang ini bertahan tanpa disadari. Id yang bukan uuid ditolak 400, karena
"Anda mengirim sampah" dan "objek itu tak boleh dirujuk" adalah dua fakta
berbeda.

Read-only, jadi kredensial mesin ([ADR-0049](../../../docs/adr/0049-machine-credentials-and-session-introspection.md))
boleh memegangnya.
