---
name: awcms-media-library
description: The media_library module EXISTS in this repo (ADR-0036 INVERSION, migrations `sql/052`–`sql/054`). A System Foundation (`type: system`, `isCore: false`, deps `[tenant_admin, identity_access]`) that OWNS the per-tenant media registry `awcms_news_media_objects` (the table was NOT renamed — hard composite FK from `awcms_news_portal_ad_placements`), presigned direct-to-R2 upload/finalize/cancel (`/api/v1/media/news-images/upload-sessions/*`, magic-byte MIME sniff + SHA-256), verification, orphan lifecycle, the `news-media:reconcile` job, and enforcement activation (`GET/POST /api/v1/media/enforcement`, one-way). It provides the `media_library` capability (`_shared/ports/media-library-port.ts`) consumed by `blog_content` — the second consumer `news_portal` was MERGED into `blog_content` (ADR-0044/#300), so the `awcms_news_*` table names here are no longer a hint about any module. Use when changing/adding media upload, the registry, R2 config (`NEWS_MEDIA_R2_*`), reconcile, or enforcement. The `NEWS_MEDIA_R2_*` env vars + table names + the `news-media:reconcile` command are KEPT (ADR-0036 §3/§4). The `/admin/media` screen ALREADY EXISTS (ADR-0056, PR #345 — `src/pages/admin/media.astro`): filtered browse + delete/restore/purge, every mutation carrying an `Idempotency-Key`. ADR-0056 IS FULLY DONE — `attach`/`detach` were REVOKED (`sql/087`), `delete`/`restore`/`purge` were given a surface, and a dedicated list route `GET /api/v1/media/objects/list` (keyset, TEXT cursor with microsecond precision) was added because `?ids=` is a batch resolver, not a browse. The module now declares **9 permissions** (7 `media.*` + 2 `enforcement.*`), zero of them ungated. Deliberately NOT on the screen: upload (a three-step flow in the browser), `enforcement.*` (a tenant policy switch, which belongs in `/admin/security`), and `<img>` preview. Micro steps 5c/5d (srcset, PDF) do not exist yet.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Media Library (per-tenant media registry, ADR-0036 ownership inversion)

<!-- sql-refs: awcms — the `sql/NNN` numbers in this skill are REAL awcms numbering -->

> **STATUS — the `media_library` module EXISTS (ADR-0036 inversion).** It was born
> from moving the media registry OUT of `news_portal` (not an additive port); that
> origin module itself was later MERGED into `blog_content` (ADR-0044/#300), so the
> consumer of `media_library` for ad placement is now `blog_content`. Read
> `docs/adr/0036-media-library-module-admission-ownership-inversion.md` +
> `src/modules/media-library/README.md` + the real `sql/` before changing anything.

## What this module owns

- **Registry** `awcms_news_media_objects` (`sql/041`, FORCE RLS; the table is **not
  renamed** — referenced by `sql/041`/`042`/`045` + a hard composite FK from
  `awcms_news_portal_ad_placements`). Application: `media-object-directory.ts`
  (internal symbols KEPT: `fetchNewsMediaObjectById`,
  `fetchNewsMediaObjectsByIds`, `NewsMediaObjectView`,
  `isNewsMediaObjectSafeForPublicReference`).
- **Upload flow**, presigned direct-to-R2: `POST /api/v1/media/news-images/upload-sessions`
  (create), `.../{id}/finalize` (real R2 GET + magic-byte MIME sniff + SHA-256,
  high-risk + `Idempotency-Key`), `.../{id}/cancel`. Guard: `media_library.media.*`.
- **Domain**: `media-r2-config.ts` (`NEWS_MEDIA_R2_*` — env names KEPT, must be
  SEPARATE from sync-storage's own `R2_*`), `media-mime-sniffer.ts`,
  `media-object-key.ts` (object prefix `news-media/{tenantId}/...` KEPT),
  `media-finalize-decision.ts`, `media-upload-session-validation.ts`,
  `media-reconciliation-categorization.ts`, `managed-media-readiness.ts`.
- **Infrastructure**: `media-r2-client.ts`. **Job**: `news-media:reconcile`
  (`scripts/news-media-r2-reconcile.ts` — the command name is KEPT, it only
  imports `media_library`).
- **Port** `_shared/ports/media-library-port.ts` (`MediaLibraryPort`, 3 methods):
  `isManagedMediaEnforcementActiveForTenant`, `isMediaReferenceSafe`,
  `resolveMediaReferences`. Adapter `media-library-port-adapter.ts`
  (`mediaLibraryPortAdapter`, imports ONLY from `media_library` — never import
  `blog-content`, that is the ADR-0013 §1 inversion that was removed; the
  `news-portal/` directory itself no longer exists — ADR-0044/#300).

## Per-tenant enforcement (step 5a) — ONE-WAY, do not "complete the API"

- The flag lives in `awcms_media_library_tenant_state` (`sql/053`, PK tenant_id, RLS
  ENABLE+FORCE). The ONLY writer is `markManagedMediaEnforced`
  (`media-library-tenant-state.ts`), called ONLY from the sanctioned entry point
  `enable-managed-media-enforcement.ts` (readiness gate first + audit).
- Endpoint `GET/POST /api/v1/media/enforcement` (`sql/054`:
  `media_library.enforcement.{read,enable}` — an activity code SEPARATE from
  `media`). POST can only TURN IT ON.
- **FORBIDDEN to add**: an `enforcement.disable` action, an unmark/clear/
  disable function, or a DELETE against `awcms_media_library_tenant_state`. That
  would bring back the exploit recorded in the `sql/043` header (a tenant turning
  off its own media validation). Guarded by `tests/media-enforcement-one-way.test.ts`.
- `isManagedMediaEnforcementActiveForTenant` = deployment readiness
  (`evaluateManagedMediaReadiness`, pure) **AND** the per-tenant flag. Both halves
  are required; if readiness fails → fail-closed with no DB query.

## Rules when changing things

1. Applied migrations are immutable — correct via a new migration (skill `awcms-new-migration`).
2. Tenant-scoped table → RLS FORCE + tenant_id; test under the `awcms_app` LOGIN
   role (`tests/integration/media-library-tenant-state.integration.test.ts`).
3. Port/capability change → update `_shared/capability-contract-versions.ts`
   (`media_library`) + the `awcms-family-compatibility.yaml` manifest (must match
   key-for-key — `family:conformance:check`).
4. Endpoint change → OpenAPI fragment `openapi/modules/media-library.openapi.yaml`
   - `bun run openapi:bundle` (skill `awcms-new-endpoint`).
5. High-risk (finalize/enforcement) → audit log (moduleKey `media_library`).
6. Do not touch `blog_content` for media matters except to rewire the
   composition root (it is a consumer via the port; `news_portal` has already
   been merged into it).

## Not yet ported (additive, a later wave)

Step 5d media lifecycle/browser (`/api/v1/media/objects/*`, `/admin/media`),
step 5b `srcset` rendering, step 5c PDF type. The module declares them a PORT
DROP; MIME stays at the four raster types; `navigation` is not declared yet.
