🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0036-media-library-module-admission-ownership-inversion.id.md)

# ADR-0036 — Admitting `media_library` through an ownership inversion (EXTRACTING the generic media registry out of `news_portal`)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Decision-maker:** @ahliweb
- **Adapts:** awcms-micro `docs/adr/0026-media-library-module-admission.md` (the media ownership inversion of ADR-0026) onto the `awcms` base, following the absorption programme of [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) and the map in [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) (media = the inversion wave, not additive Wave-0).
- **Related:** ADR-0011 (capability ports), ADR-0013 §1 (extension layers; a Core/System Foundation must not depend on the domain module that consumes it), ADR-0006 (external providers outside the transaction), ADR-0034 (templates used directly; website modules live directly in `src/modules/`), ADR-0032/`awcms-family-compatibility.yaml` (capability contracts & conformance).

## Context

`awcms` already has a media registry, but it lives **inside** `news_portal` (ported from awcms-mini, epic `news_portal` #631-#642/#649/#681/#690): the `awcms_news_media_objects` table (`sql/041`), the presigned upload flow (`/api/v1/media/news-images/upload-sessions/*`), MIME sniffing, R2 verification, orphan lifecycle, the `news-media:reconcile` job, and 9 `('news_portal','media',*)` permissions (`sql/042`). That registry is **already generic** — the `owner_resource_type`/`owner_resource_id` columns point at `blog_post`, `blog_page`, `homepage_section`, `gallery_item`, `ad`, `video_thumbnail`, `seo_image`.

The problematic product coupling: `blog_content`'s media gate (`news-media-reference-gate.ts`) only enforces managed media references **while R2-only mode is active for the tenant** — and that mode belongs to `news_portal` (`isFullOnlineR2ModeActiveForTenant`, resting on `awcms_news_portal_tenant_state`). The consequence: **a brochure-site tenant (`blog_content` + `tenant_domain`, without `news_portal`) has no media library at all** — it can only paste raw URLs. For an online-first platform, uploading and managing images must not require switching on the **news portal** module.

awcms-micro already solved this (ADR-0026) through an **ownership inversion**. This ADR adapts that decision onto `awcms`.

## Decision

### 1. Admit `media_library` as a base module, through EXTRACTION (not a parallel implementation)

- Name: **Media Library** · `key`: `media_library`
- Category: **System Foundation** — reusable platform infrastructure, in line with `sync_storage`/`domain_event_runtime`.
- `type`: `system` · `status`: `active` · `isCore`: **no**
- `dependencies`: `["tenant_admin", "identity_access"]` — it does **not** depend on `news_portal`/`blog_content` (the dependency direction is inverted instead). A System Foundation module consuming a domain module's capability is exactly the ADR-0013 §1 inversion this extraction removes.

Building a second media module alongside the existing registry would duplicate the table, the upload flow, the R2 gate, the orphan lifecycle, and the reconciliation job — two sources of truth for "media objects owned by this tenant". So ownership is **moved**, not reimplemented.

### 2. Reversing the direction of ownership

| Before                                                                                              | After                                                                                                                              |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `news_portal` **owns** the media registry; `blog_content` consumes the `news_media` port (optional) | `media_library` **owns** the media registry; `blog_content` (optional) & `news_portal` (required) consume the `media_library` port |
| Media is available only when `news_portal` is switched on                                           | Media is available to any website tenant without `news_portal`                                                                     |

`news_portal` keeps what is genuinely its own: homepage sections, ad placements, and (if ported later) the R2-only editorial policy. Only the generic media object registry and its upload flow move. `news_portal` now **CONSUMES** `media_library` (required — ad placements carry a `media_object_id` FK to a media object).

The coupling this ADR breaks lives in **the port contract itself**, not in its adapter: `NewsMediaPort.isFullOnlineR2ModeActiveForTenant` is a `news_portal` policy question, not a media question. So the port is **split**, not merely renamed:

- The question **"should this tenant's media references be registry-based?"** is a media question. It is now answered by `media_library` from its own deployment readiness (`domain/managed-media-readiness.ts`, the `NEWS_MEDIA_R2_*` portion carved out of the `news_portal` readiness preset — identical reason codes) and its own per-tenant flag (`application/media-library-tenant-state.ts`, `sql/053`).
- `MediaLibraryPort` (`_shared/ports/media-library-port.ts`) has 3 methods: `isManagedMediaEnforcementActiveForTenant` (replacing the news_portal-laden method), `isMediaReferenceSafe`, `resolveMediaReferences`. The `resolveMediaPublicBaseUrl` method (specific to `social_publishing`, not yet ported into this base) is **dropped**.

### 3. Retiring `news_media`, not a MAJOR bump

The `news_media` capability is **retired**: its provider changes **and** its contract loses a method. In `_shared/capability-contract-versions.ts` (and the `awcms-family-compatibility.yaml` manifest) the key `media_library: "1.0.0"` is added; `news_media` was never registered in this base registry (removed by Issue #183, when the content modules had not been ported yet), so at the registry level this is an honest addition of `media_library`. Any consumer pinned to `news_media` must fail loudly, not silently bind to a port that no longer asks the question it asks.

### 4. The `awcms_news_media_objects` table is NOT renamed

Even though its name now wrongly names the old owner, the table is **not** renamed: it is referenced by `sql/041`/`042`/`045`, carries a **hard composite FK** from `awcms_news_portal_ad_placements (media_object_id)`, and is referenced throughout the application layer. Renaming it trades cosmetic discomfort for real risk and an unreadable diff. The `news-media:reconcile` job command name and the `NEWS_MEDIA_R2_*` env vars are **kept** for the same reason. New migrations **add** (`sql/052`/`053`/`054`), they do not rewrite already-applied ones (an applied migration is immutable — `scripts/db-migrate.ts` checksums).

### 5. Migrations (destructive but effectively non-destructive — ordering is load-bearing)

- **`sql/052` (permission ownership).** (1) INSERT the 9 `('media_library','media',*)`; (2) repoint the old→new role grants in `awcms_role_permissions` (carrying `tenant_id`); (3) DELETE `('news_portal','media',*)`. The **repoint-before-delete** ordering is mandatory — deleting first would strip media access from every role that held it. It runs as the migration role (superuser/BYPASSRLS, `sql/019`) so the repoint crosses all tenants even though `awcms_role_permissions` is FORCE RLS.
- **`sql/053` (tenant-state schema).** `awcms_media_library_tenant_state` (PK `tenant_id`, `managed_media_enforced_at`, RLS ENABLE+FORCE + tenant_isolation) + a backfill `SELECT ... FROM awcms_news_portal_tenant_state` (in this base it reads 0 rows today because the `news_portal` preset writer has not been ported — written for forward-compat so that tenants opting in through that preset do not silently lose enforcement when that subsystem is ported later).
- **`sql/054` (enforcement permissions).** `('media_library','enforcement',{read,enable})` — a separate activity code from `media` (different blast radius: `media.*` governs OBJECTS, `enforcement.*` governs tenant-wide CONTENT POLICY).

### 5a. The enforcement activation endpoint (`GET`/`POST /api/v1/media/enforcement`)

Because this base does **not** port the `news_portal` preset-activation subsystem, the `sql/053` flag would have no writer unless this step were ported. The enforcement endpoint is the **only writer** of the flag in this base: the sanctioned entry point `application/enable-managed-media-enforcement.ts` runs the readiness gate first (at the entry point, not in one caller, so a future second caller cannot bypass it), then audits the actor.

**One-way, by construction.** There is no `disable` action, no "unmark" function, and no DELETE against `awcms_media_library_tenant_state` anywhere. This is a **security property**: the header of `sql/043` records that the old design was proven exploitable end-to-end precisely because a tenant could clear its own marker and silently switch off all of its media validation. The legitimate way back is changing the `NEWS_MEDIA_R2_*` configuration (an operator action, out of a tenant's reach), which `evaluateManagedMediaReadiness` already treats fail-closed.

### 6. Scope boundary (not ported in this wave)

From step 5 of awcms-micro, this base does **not** port: the media lifecycle/browser surface (`/api/v1/media/objects/*`, `/admin/media` — step 5d), image variants/`srcset` (step 5b), and non-image PDF media types (step 5c). The module declares these as a PORT DROP; the MIME set stays the four raster types and `navigation` is not declared yet (the `/admin/media` page does not exist yet). These are genuinely additive → deferred to a later wave.

## Consequences

**Positive.** Media becomes a platform capability rather than a hostage of the news module — brochure sites finally get managed media. A single source of truth for media objects is preserved (zero duplication). Per-tenant enforcement now has its own "switch" (5a), readiness-gated and auditable.

**Negative / acknowledged risks.** This is a non-additive cross-module refactor touching `news_portal`, `blog_content`, and the new `media_library`; it moves 12 files, retires the `news_media` capability, and runs a destructive permission migration + cross-tenant backfill under a BYPASSRLS role. That is why it was done as one reviewed change with separate RLS/backfill tests (`tests/integration/media-library-tenant-state.integration.test.ts`) proving the repoint ordering, FORCE RLS tenant isolation, `awcms_app` failing closed without a tenant context, and the cross-tenant backfill mechanism — not trusted from a comment.

## Rejected alternatives

- **Build a new `media_library` from scratch alongside the old registry.** Rejected: two sources of truth + duplicated presigned/reconciliation/orphan-lifecycle flows + guaranteed drift.
- **Leave media in `news_portal` and just add the enforcement endpoint there.** Rejected: it still locks media management behind the news portal module; brochure sites stay second-class citizens.
- **Rename `awcms_news_media_objects`.** Rejected — see §4 (hard composite FK + 3 migrations + the application layer).
- **MAJOR-bump `news_media` instead of retiring it.** Rejected — the provider changes AND the contract loses a method; retiring the key is the correct signal (§3).
