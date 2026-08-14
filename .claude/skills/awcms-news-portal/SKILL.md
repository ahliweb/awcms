---
name: awcms-news-portal
description: "READ-ONLY / HISTORICAL — the `news_portal` module NO LONGER EXISTS in this repo. [ADR-0044](../../../docs/adr/0044-merge-news-portal-into-blog-content.md) (PR #300) MERGED IT into `blog_content`: `src/modules/news-portal/` was deleted, `src/modules/index.ts` no longer loads it, and there is no `basePath` `/api/v1/news-portal`. Its features are ALIVE and owned by `blog_content`: homepage-section composer + ad placement with a verified `media_object_id`; the `awcms_news_portal_*` table names are KEPT (ADR-0036 precedent — hard composite FK). To CHANGE those features use the `awcms-blog-content` skill; for media use `awcms-media-library`. The skill body below is the PRE-MERGE SPECIFICATION (awcms-mini/news-portal numbering & paths) — kept because §640 is still the reference for the content-quality checklist rules used by real code; treat every file path inside it as history, not as where the code lives today."
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — News Portal (full-online R2-only media)

<!-- sql-refs: awcms-mini — the `sql/NNN` numbers in this skill body use awcms-mini numbering; the module HAS BEEN ported to awcms as `sql/041`–`sql/045` (see the module README + the real `sql/` for the actual numbers) -->

> **STATUS — THIS MODULE NO LONGER EXISTS (ADR-0044, PR #300).**
> `news_portal` was MERGED into `blog_content`. What changed, and what must be read
> before a single line of code is written from this skill:
>
> - `src/modules/news-portal/` **deleted**; `src/modules/index.ts` does **not**
>   load it (registry = 21 modules). There is no `basePath /api/v1/news-portal`.
> - Its features are **not gone**: the homepage-section composer and ad placement
>   with a verified `media_object_id` are now **owned by `blog_content`**, with
>   widened targeting (#301), a legacy ad ingest job (#302), the free-URL ad write
>   path closed off (#303), and a gated content-block vocabulary (#304).
> - **The `awcms_news_portal_*` table names are KEPT** (ADR-0036 precedent: hard
>   composite FK from ad placements). A table name is therefore NOT a hint about
>   which module owns it here.
> - **Its OpenAPI contract moved too (PR #308).**
>   `openapi/modules/news-portal.openapi.yaml` was **deleted**; the four
>   `/api/v1/news-portal/*` paths and their schemas now live in
>   `openapi/modules/blog-content.openapi.yaml`. **The path names and tag names
>   (`News Portal Homepage Sections`/`News Portal Ad Placements`) were deliberately
>   NOT changed** — ADR-0044 §3/§6 moves ownership, not the public surface; the only
>   thing corrected was the module attribution in the tag descriptions. The fragment
>   ownership gate now rejects a fragment with no owning module, so this oversight
>   cannot silently recur.
> - To change those features: the **`awcms-blog-content`** skill. For media:
>   **`awcms-media-library`**. This skill no longer has any code to change.
> - The body below is **kept as the pre-merge specification** because §640 is still
>   referenced by `src/modules/blog-content/README.md` for the content-quality
>   checklist rules. Every file path inside it is **history**.
>
> <details>
> <summary>Old port status (pre-ADR-0044, kept for context)</summary>
>
> `news_portal` used to be real here: `src/modules/news-portal`, migrations
> `sql/041_awcms_news_media_object_registry_schema.sql`–`sql/045_awcms_news_portal_ad_placements_schema.sql`,
> 4 `awcms_news_*` tables (all `FORCE ROW LEVEL SECURITY`). This skill is now a
> **guide to changing/adding real code**. Read `src/modules/news-portal/README.md`
>
> - `sql/` for accurate numbers/tables.
>
> **⚠ ADR-0036 INVERSION (MUST READ — it changes media ownership): media is
> NO LONGER owned by news_portal.** Migrations `052`/`053`/`054` extract the ENTIRE
> media registry (`awcms_news_media_objects`), presigned upload/finalize/cancel,
> MIME sniffer, R2 config/client/verification, categorization, and the
> `news-media:reconcile` job OUT of `news-portal/` into the new module
> `src/modules/media-library/` (files `news-media-*` → `media-*`, internal symbols
> `fetchNewsMediaObjectById`/`NewsMediaObjectView` KEPT). The port
> `_shared/ports/news-media-port.ts` was DELETED → `media-library-port.ts`
> (`MediaLibraryPort`, `isManagedMediaEnforcementActiveForTenant`). Permission
> `news_portal.media.*` → `media_library.media.*` (destructive repoint `sql/052`).
> **For anything about media (upload, registry, reconcile, R2 config,
> enforcement) use the `awcms-media-library` skill, NOT this one.** news_portal
> here is only homepage sections + ad placements; it CONSUMES `media_library`.
> Most of the skill body below still specifies the PRE-inversion (mini) shape —
> treat its media sections as history, not as where the code lives now.
>
> **AWCMS PORT DELTA (MUST READ — most of the skill body below specifies the mini shape; this is what DIFFERS here):**
>
> - **DROPPED**: the **host-resolved `/news/**`** family of public routes (index,
>   detail, category, tag, search, feed, sitemap) along with their render helpers
>   (`homepage-section-composer`, `homepage-section-rendering`, `news-share-config`).
>   They need `lib/tenant/public-host-tenant-resolver.ts` + env `PUBLIC_TENANT_RESOLUTION_MODE`
>   from the `tenant_domain` module. **UPDATE 2026-07-25: `tenant_domain` HAS BEEN
>   ported (#219, `sql/046`–`048`)**, so the foundation blocker is gone — but the
>   `/news/**` routes themselves are **still not adopted**. Do not build/reference
>   `/news/**` as existing; adopting it now is work of its own, not an automatic
>   consequence of `tenant_domain`. (The public route that DOES exist =
>   `/blog/{tenantCode}` owned by `blog_content`, path-based ADR-0009.)
> - **DROPPED**: activation of the `news_portal_full_online_r2` preset
>   (`apply-news-portal-preset.ts`) — it needs the `module_management` preset
>   subsystem, which has not been ported. The `awcms_news_portal_tenant_state`
>   table + reader `isFullOnlineR2ModeAppliedForTenant` still exist
>   (forward-compatible) but **without a writer** (inert). Post-ADR-0036,
>   managed-media enforcement is driven by `media_library` via
>   `isManagedMediaEnforcementActiveForTenant` (readiness + per-tenant flag
>   `sql/053`), switched on via `POST /api/v1/media/
enforcement` — NO LONGER the old `isFullOnlineR2ModeActiveForTenant` port.
> - **What was ACTUALLY ported & active IN news_portal**: the homepage section
>   composer + ad placements (`sql/044`/`045`). The media registry + presigned
>   upload/finalize + MIME sniff/SHA-256 + the `news-media:reconcile` job have
>   MOVED to `media_library` (ADR-0036) — see the `awcms-media-library` skill. The
>   `news_media` capability is **retired**; news_portal now CONSUMES `media_library`.
> - `NEWS_MEDIA_R2_*` env pre-validation (validate-env + 3 security-readiness
>   checks) was **deferred** during the port — the module is fail-safe without it
>   at runtime.
> - The `sql/NNN` numbers in the skill body = awcms-mini numbering; the real ones
>   in awcms are `sql/041`–`sql/045`.

The `news_portal` epic (#631-#642, #649) adds an editorial + media layer on top
of `blog_content` (base module, already `active`) and online public routing
(`tenant_domain`, ADR-0009/ADR-0010), specifically for **full-online**
deployments that turn on **R2-only** mode for news images. The follow-on epic
`social-publishing` (#643-#647) **depends** on this epic's architectural
foundation (particularly the #633 media registry for images shared to social
platforms) but is **not** part of the status table below — see the separate
skill/documentation once that epic starts.

> </details>

## When to use this skill vs the generic skills

This skill complements (does not replace) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-integration` (outbox/circuit-breaker
patterns for R2, ADR-0006), `awcms-idempotency` (the upload `confirm`
mutation), `awcms-sensitive-data` (photos are potentially PII),
`awcms-abac-guard`, and `awcms-blog-content` (the
post/page/gallery/ads content model that consumes the media registry).
This skill provides the **epic-specific cross-cutting** context — above
all the "R2-only, bucket separate from sync-storage" decision that must
be preserved in every issue.

**Read first**: `docs/awcms/news-portal/full-online-r2-architecture.md`
before working on any issue in this epic — that document (not this
skill) is the architectural source of truth; this skill summarises
status + pointers, it does not duplicate its contents.

## Status per issue (do not rebuild what already exists)

| Issue | Scope                                                                                                                      | Status                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| #631  | Full-online R2-only architecture documentation + SOP + security + IR + backup + user guide                                 | **Done** — see §Existing documents below |
| #632  | `news_portal_full_online_r2` preset (module descriptor/config gate)                                                        | **Done** — see §632 below                |
| #633  | Tenant-scoped R2-only media object registry (schema + migration)                                                           | **Done** — see §633 below                |
| #634  | Direct-to-R2 presigned upload flow (upload/confirm endpoints)                                                              | **Done** — see §634 below                |
| #635  | Config validation + readiness checks (`config:validate`/`security:readiness`/`production:preflight`) for R2 image delivery | **Done** — see §635 below                |
| #636  | `blog_content` must reference an R2 media object for news images when the mode is active                                   | **Done** — see §636 below                |
| #637  | Editorial homepage section composer `/news` with R2-only rendering                                                         | **Done** — see §637 below                |
| #638  | News portal ad placement preset with R2-only image validation                                                              | **Done** — see §638 below                |
| #639  | `video_news` content block with a mandatory R2 thumbnail                                                                   | **Done** — see §639 below                |
| #640  | Publishing content quality checklist with an R2 image requirement                                                          | **Done** — see §640 below                |
| #641  | Automatic internal tag linking for post/news content                                                                       | **Done** — see §641 below                |
| #642  | Public social share buttons on `/news` article pages                                                                       | **Done** — see §642 below                |
| #649  | Complete SEO + social preview metadata on `/news` article pages                                                            | **Done** — see §649 below                |

Recommended dependency order (from each issue's objective):
631 → 632 → 633 → 634 → 635 (readiness needs #632-#634 to exist in order
to be validated) → 636 (needs the #633 registry) → 637/638/639/640 (need
#636, can run in parallel with each other) → 641 (independent, only
needs the `blog_content` taxonomies that already exist) → 642/649 (need
#636 for valid R2 images used in social previews, can run in parallel).

## What already exists — reuse it, do not re-derive it

### Architecture documents (Issue #631, `docs/awcms/news-portal/`)

Six documents, all docs-only (no code/migration/endpoint in this issue):

- **`full-online-r2-architecture.md`** — the main document. It contains:
  the full-online-only scope (§1), the decision to use an **R2 bucket
  separate from `sync-storage`** (§2 — see §Key decisions below), five
  non-negotiable core principles (§3), the `NEWS_MEDIA_R2_*` env var
  convention (§4 — **implemented in Issue #632**: already present in
  `.env.example`/doc 18/`scripts/validate-env.ts`), the conceptual data
  model of the media registry (§5), the object key convention (§6), two
  upload flow diagrams (§7), presigned URL lifecycle (§8), the
  MIME/extension/checksum validation order (§9), CORS (§10), custom
  domain (§11), Cache-Control (§12), credential rotation (§13), a trust
  boundary diagram (§14), and a full compliance mapping to
  ISO/IEC 27001/27002/27005/27017/27018/27701/27034, ISO 22301, OWASP
  ASVS, OWASP API Security Top 10 (§15).
- **`r2-upload-sop.md`** — operational SOP for Path A (direct-to-R2,
  recommended) and Path B (server-streaming with no local temp file),
  validation order, error handling, operator troubleshooting.
- **`r2-security-checklist.md`** — a ready-to-use checklist (validation,
  object key, presigned URL, CORS, custom domain/cache, credentials,
  readiness gates, monitoring) + an example least-privilege R2 API token
  policy. §7 of this checklist originally stated that no real check
  existed until #635 — **updated**: the shape/separation/SVG checks
  landed via Issue #632 (earlier than originally planned); what remains
  for #633/#634/#635 is only registry-schema/upload-endpoint level checks.
- **`r2-incident-response.md`** — a Detect/Contain/Eradicate/
  Recover/Post-incident runbook for three scenarios: leaked presigned
  URL, public object exposure, malicious upload.
- **`r2-backup-lifecycle.md`** — lifecycle of `pending` objects (default
  TTL 60 minutes), retention policy per data classification, detection of
  `orphaned` objects, backup strategy (replication/versioning — an
  operator choice, not a single mandate), continuity (RPO/RTO),
  privacy/minimisation.
- **`newsroom-user-guide.md`** — a guide for editors/journalists (not
  developers): how to upload, supported formats/sizes, common error
  messages, privacy/attribution best practice, where images are used.

Tests: none (docs-only, there are no code/test acceptance criteria in
issue #631). Validation: `bun run lint`, `bun run check:docs`,
`bun run build`.

### Key decision #1 — an R2 bucket separate from `sync-storage` (MUST be preserved)

`src/modules/sync-storage/` has used R2 since Issue 6.3/#436
(`R2_ENABLED`/`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/
`R2_BUCKET`) as a **private object queue** for offline/LAN
synchronisation (attachments/receipts, machine-to-machine via HMAC). News
portal media is a **fundamentally different** need — public, accessed by
browsers, custom domain, CORS for direct upload. **Never** merge the two
onto the same bucket/credentials:

- Different buckets prevent a public misconfiguration (CORS/custom
  domain) in one function from leaking the private objects of the other.
- Different credentials limit the blast radius — a compromise of the
  public media token (a bucket that is already public by design) never
  grants write access to private sync objects, and vice versa.
- The env var naming convention is **`NEWS_MEDIA_R2_*`** (not the `R2_*`
  already in use) — see `full-online-r2-architecture.md` §4 for the full
  list, which implementors must follow exactly as written.
- The Cloudflare **account** may be the same (one account, two buckets) —
  what must be separate is the bucket and the API token, not the account.

**Enforced (not merely documented) since Issue #632**:
`findNewsMediaR2SeparationViolations`
(`news-portal/domain/news-media-r2-config.ts`) compares
`NEWS_MEDIA_R2_BUCKET`/`_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY` against
`sync-storage`'s `R2_BUCKET`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`,
and is called from `config:validate`
(`checkNewsMediaR2SeparationFromSyncR2`, fails `bun run config:validate`/
the CI-deploy gate if they are identical — **not** automatic boot-time
enforcement in the server; `config:validate`/`security:readiness` are
standalone CLI scripts that are not called from `src/server.ts`, exactly
like the entire family of other checks in `validate-env.ts`) AND from
`security:readiness` (`checkNewsPortalFullOnlineR2PresetReady`, critical)
— see `r2-security-checklist.md` §7 for the full contract and what
remains for #633/#634/#635 (schema/endpoint-level checks, not this
shape/separation one).

### Key decision #2 — no local fallback, no temp files

This mode (when `NEWS_MEDIA_R2_ENABLED=true`) **never** writes image
bytes to `LOCAL_STORAGE_PATH`/the server's local disk as a substitute
for R2 — neither as a failure fallback nor as a temporary file in the
middle of the upload process (`full-online-r2-architecture.md`
§3.3/§3.4, `r2-upload-sop.md` §2/§3). This is the opposite of
`sync-storage` (which does store locally first and uploads to R2 later
via a dispatcher — the correct design for its offline-first case). The
#634 implementor **must** verify there is no intermediate
`Bun.write(tempPath, ...)`/`fs.writeFile` anywhere on the upload path
before the PR is considered done.

### Key decision #3 — the object key never contains PII/the original filename

Mandatory format: `news-media/{tenantId}/{yyyy}/{mm}/{uuid}.{ext}` — `uuid`
from `crypto.randomUUID()`, `ext` **derived from the validated MIME type**
(not the client's original extension). `original_filename` is still stored
as a separate metadata column for display, and never enters the key
(`full-online-r2-architecture.md` §6). The #633 (schema) and #634
(endpoint) implementors must follow this format exactly.

### Key decision #4 — `pending`/`confirmed` status does not control storage access

A residual risk that is already documented and **must** keep being
preserved in every follow-on issue: as soon as an object is successfully
PUT to R2, it is immediately publicly reachable via the custom domain —
the Postgres `pending` status does **not** block storage-level reads
(`full-online-r2-architecture.md` §8). Mitigations: the object key is
unguessable (Decision #3), editorial content never points at a `pending`
object (only `confirmed` ones), and a lifecycle job cleans up stale
`pending` objects (`r2-backup-lifecycle.md` §2,
`NEWS_MEDIA_R2_PENDING_TTL_MINUTES` default 60 minutes). Do not implement
controls that assume the Postgres status is enough to prevent public
access — if the #634 implementor finds a way to enforce real per-object
R2 ACLs, that is an improvement which must be documented as a replacement
for this decision, not silently assumed to already exist.

### Key decision #5 — `image/svg+xml` is forbidden by default

The default MIME allow-list (`full-online-r2-architecture.md` §4/§9):
`image/jpeg, image/png, image/webp, image/gif`. SVG is deliberately
excluded because of XSS risk (embedded scripts). Allowing it requires a
dedicated sanitisation pipeline and a separate decision — not merely
adding it to the allow-list in some issue.

## §632 — `news_portal_full_online_r2` preset (Done)

Full implementation: `src/modules/news-portal/` (new module, minimal —
see "Why a new module" below), the `news_portal_full_online_r2` preset in
`module-management/domain/module-presets.ts`, the readiness gate in
`application/apply-news-portal-preset.ts`, `.env.example`,
`18_configuration_env_reference.md` §News portal,
`scripts/validate-env.ts`, `scripts/security-readiness.ts`. The three
naming reconciliations below are **binding** on follow-on issues
#633-#649 — do not re-investigate them, do not use the other names from
the body of issue #632 that were found to be contradictory below.

### Reconciliation #1 — the R2 env vars use `NEWS_MEDIA_R2_*`, NOT the names from the body of issue #632

The body of issue #632 writes `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/
`CLOUDFLARE_ACCOUNT_ID`/`R2_NEWS_IMAGE_*` — this was DELIBERATELY not
followed. `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are the EXACT names
already used by `sync-storage` (Issue #436); following them would make two
features share the same credentials, precisely the risk that Key decision
#1 (above) was designed to prevent. Used instead: the `NEWS_MEDIA_R2_*`
convention EXACTLY as in `full-online-r2-architecture.md` §4 —
`NEWS_MEDIA_R2_ENABLED`, `_ACCOUNT_ID`, `_ACCESS_KEY_ID`,
`_SECRET_ACCESS_KEY`, `_BUCKET`, `_PUBLIC_BASE_URL`,
`_PRESIGNED_UPLOAD_TTL_SECONDS`, `_MAX_UPLOAD_BYTES`,
`_ALLOWED_MIME_TYPES`, `_PENDING_TTL_MINUTES`. **Note**: §4 of the
document does NOT have a separate `NEWS_MEDIA_R2_CUSTOM_DOMAIN` (its §11
states that `_PUBLIC_BASE_URL` ALREADY covers the custom domain) — the
#633/#634 implementors must not add a separate `_CUSTOM_DOMAIN` var
without a new explicit decision. Resolver:
`src/modules/news-portal/domain/news-media-r2-config.ts`
(`resolveNewsMediaR2Config`, `findMissingNewsMediaR2Vars`,
`findNewsMediaR2SeparationViolations`, `allowsSvgMimeType`).

### Reconciliation #2 — there is no new `DEPLOYMENT_PROFILE`/`BLOG_PUBLIC_ROUTE_MODE`/`BLOG_PUBLIC_BASE_PATH`

The body of issue #632 writes all three vars as if they were new.
Investigation proved:

- `DEPLOYMENT_PROFILE` **does not exist in the code at all** (only in the
  `deployment-profiles.md` narrative) — it was NOT added. This repo's
  convention is independent per-feature flags (`R2_ENABLED`,
  `EMAIL_ENABLED`, `VISITOR_ANALYTICS_ENABLED`, etc.), not a single
  central enum. "Full-online" for this preset is expressed through **two
  narrow new vars**: `NEWS_PORTAL_ENABLED` (the master switch for this
  preset itself) and `NEWS_PORTAL_PROFILE` (currently the only valid value
  is `full_online_r2`) — combined with the existing
  `NEWS_MEDIA_R2_ENABLED`. Three independent flags that must be
  `true`/matching ALL AT ONCE, not one master switch.
- `BLOG_PUBLIC_ROUTE_MODE=domain_default` in the issue body is **not** a
  new env var — the string `"domain_default"` is a `PUBLIC_ROUTE_MODES`
  value that ALREADY EXISTS in `blog_content`'s per-tenant module setting
  `publicRouteMode` (`blog-content/application/public-route-settings.ts`,
  Issue #564), and already defaults to it for every tenant today. NO new
  env var was added for this — preset #632 only RECOMMENDS (documentation,
  not a new mechanism) that tenants leave it at the `"domain_default"`
  default and set the `route_mode` column
  (`canonical`/`legacy_blog`) of `awcms_tenant_domains` (Issue #557,
  per-domain, NOT per-tenant global) to `"canonical"` through the existing
  tenant-domain API (#562) for the domain the news portal uses.
- `BLOG_PUBLIC_BASE_PATH` in the issue body is not a new var either — it is
  the existing `PUBLIC_CANONICAL_BASE_PATH` (Issue #556), default
  `/news`. NO new var was added.

The full details are in the header comment of
`src/modules/news-portal/domain/news-portal-preset-readiness.ts`.

### Reconciliation #3 — the preset name is NOT a reuse of the existing `news_portal` preset

`module-management/domain/module-presets.ts` ALREADY has a preset named
`"news_portal"` (Issue #565, epic #555 — "online website + editorial
approval workflow", NOT related to R2/media at all). The new preset in
this issue is named **`news_portal_full_online_r2`** — a DIFFERENT name,
NOT a rename/merge of the existing one. Both live side by side in
`MODULE_PRESETS`; see the `// NOTE:` comment directly above the
`news_portal_full_online_r2` entry in that file.

### Why the new `news_portal` module is registered now (instead of deferred)

`src/modules/news-portal/module.ts` — a new, minimal module (no
`permissions`/`navigation`/`api`/`settings`/`jobs`/`health`, the same
pattern as `visitor_analytics` before its real feature existed).
Registered now because the preset needs a real module key to
enable/disable (the same pattern as `tenant_domain`, Issue #558, register
the descriptor first, before the resolver/routes/admin UI).
**IMPORTANT**: `dependencies` is ONLY
`["tenant_admin", "identity_access"]` — it DELIBERATELY does NOT include
`blog_content`/`tenant_domain`/`visitor_analytics`, even though the
conceptual "layer on top of" relationship is real (explained in the
descriptor's `description`). The first attempt at adding them as real
`dependencies` broke 3 existing integration tests
(`blog-content-public-news.integration.test.ts` disabling blog_content
failed with 409, `module-presets.integration.test.ts`'s online_website
test) because every new tenant has ALL modules enabled by default — an
enabled-by-default `news_portal` then blocked disabling
blog_content/tenant_domain/visitor_analytics FOREVER via
`MODULE_REVERSE_DEPENDENCY_ACTIVE`. #633+ implementors **must not** add
those dependencies again without rethinking this consequence — enable
order within ONE preset application is already sufficiently guaranteed by
`enabledModuleKeys`'s ordering + `planEnableOrder`, no permanent
dependency in the graph is needed.

### Readiness gate — MUST go through `applyNewsPortalFullOnlineR2Preset`

`src/modules/news-portal/application/apply-news-portal-preset.ts` is the
ONLY legitimate path for activating this preset — it runs
`evaluateNewsPortalFullOnlineR2Readiness` (env: must have
`NEWS_PORTAL_ENABLED=true`, `NEWS_PORTAL_PROFILE=full_online_r2`,
`NEWS_MEDIA_R2_*` complete AND separate from sync-storage's `R2_*`) before
calling the generic `applyModulePreset`, and audits both the rejection
(`news_portal_preset_activation_rejected`, warning) and the success
(`news_portal_preset_activated`, info) — both via `recordAuditEvent`,
`moduleKey: "news_portal"`. module-management's generic
`applyModulePreset` **knows nothing** about R2 — it must not be imported
by any domain module (see the header comment of `module-presets.ts`
itself) — so this gate CANNOT be moved there; it lives as a separate
wrapper. There is no HTTP endpoint calling `applyModulePreset`/this
wrapper at all yet (a follow-on issue/the setup wizard).

**IMPORTANT for the follow-on issue that adds the first
endpoint/setup-wizard calling this preset (findings from the
reviewer+security-auditor on PR #651, both PASS but with binding notes)**:

1. `applyModulePreset(tx, tenantId, actor, "news_portal_full_online_r2")`
   called directly (bypassing the wrapper) today **will** activate the
   preset WITHOUT the readiness gate and WITHOUT an audit event — the
   generic engine does not know this preset needs a gate. Inert today (no
   caller at all), but as soon as a follow-on issue adds any caller of
   `applyModulePreset`, it MUST ensure the string literal
   `"news_portal_full_online_r2"` only ever goes through
   `applyNewsPortalFullOnlineR2Preset` and is never passed to the generic
   function directly — add a structural test (same pattern as
   `news-portal-no-local-fallback.test.ts`) that greps to guarantee this,
   do not rely on code-review discipline alone.
2. `applyModulePreset`/this wrapper **does not do an ABAC/permission check
   itself** (by design, the same pattern as `enableTenantModule`/
   `disableTenantModule` — that is the caller's responsibility). The first
   issue that adds an HTTP endpoint/admin page for activating this preset
   MUST add `authorizeInTransaction` (skill `awcms-abac-guard`) and
   register that endpoint in OpenAPI — do not assume this wrapper is
   "already safe" because it has readiness+audit; that is no substitute
   for the authorization layer.
3. This readiness/audit gate is **global per-deployment** (it reads env
   vars, not per-tenant module state) — it does not verify that
   `blog_content`/`tenant_domain`/`visitor_analytics` are still actually
   `tenantEnabled=true` for the tenant whose preset is active (see §"Why
   the new module... dependencies is ONLY..." above — this is deliberate,
   so that `news_portal` can be a leaf that can be disabled). The
   consequence: a tenant admin can activate this preset and later disable
   `blog_content` for that tenant without being blocked by anything, and
   the readiness check will still report "ready" even though that tenant
   functionally can no longer serve news. As soon as #633/#634 add real
   API/health surfaces consumed by operators/end-users, add a separate
   tenant-scoped check (not just an env-level one) before claiming that
   tenant is "ready".

### There is no real "local fallback" flag

The issue's acceptance criteria asked for "readiness fails when local
upload is enabled" — this was NOT implemented as a runtime flag
(`NEWS_MEDIA_LOCAL_FALLBACK_ENABLED` and friends) because this mode
structurally has no local-upload path to disable. Instead:
`tests/unit/news-portal-no-local-fallback.test.ts` — a structural test
that greps all of `src/modules/news-portal/**` for
`Bun.write`/`fs.writeFile`/`LOCAL_STORAGE_PATH`/etc., failing loudly as
soon as any PR (#634 in particular) adds such a path.

### Files created/changed (quick reference)

- `src/modules/news-portal/module.ts`, `domain/news-media-r2-config.ts`,
  `domain/news-portal-preset-readiness.ts`,
  `application/apply-news-portal-preset.ts`.
- `src/modules/index.ts`,
  `src/modules/module-management/domain/module-presets.ts` (preset entry
  - `ModulePresetName` union).
- `scripts/validate-env.ts`
  (`checkNewsPortalProfileConfig`/`checkNewsMediaR2Config`/
  `checkNewsMediaR2SeparationFromSyncR2`/`isHttpsAbsoluteUrl`),
  `scripts/security-readiness.ts`
  (`checkNewsPortalFullOnlineR2PresetReady`/`checkNewsMediaR2SvgNotAllowed`).
- `.env.example`, `18_configuration_env_reference.md` §News portal,
  `full-online-r2-architecture.md` §4 (status updated),
  `r2-security-checklist.md` §7 (status updated — most of the contract
  originally scheduled for #635 is already met by #632; what remains for
  #633/#634/#635 is only checks that need the real registry table/upload
  endpoint).
- Tests: `tests/unit/news-media-r2-config.test.ts`,
  `tests/unit/news-portal-preset-readiness.test.ts`,
  `tests/unit/news-portal-no-local-fallback.test.ts`,
  `tests/modules/news-portal-module.test.ts`,
  `tests/integration/news-portal-preset.integration.test.ts`; updated:
  `tests/unit/module-presets.test.ts`,
  `tests/integration/module-presets.integration.test.ts`,
  `tests/foundation.test.ts` (module count 13→14).

## §633 — Media object registry (Done)

Full implementation: migration
`sql/041_awcms_news_media_object_registry_schema.sql`, domain
`src/modules/news-portal/domain/news-media-object-key.ts` (object key
build/validate, trusted public URL) + `domain/news-media-permissions.ts`
(permission constants for #634, not wired yet), application
`application/news-media-object-directory.ts` (full CRUD + lifecycle).
The two reconciliations below are **binding** on follow-on issues #634+ —
do not re-investigate them.

### Reconciliation #1 — the table is named `awcms_news_media_objects`, NOT `awcms_media_objects` as in the body of issue #633

The body of issue #633 writes `awcms_media_objects`. NOT followed — the
name had already been chosen earlier by
`full-online-r2-architecture.md` §5 ("the plan for Issue #633", written
during Issue #631, before #633 started), which is this epic's source of
truth per this skill's own header. Besides, the generic name
`awcms_media_objects` reads as "the application's general media library"
when this table is deliberately NARROW — hard-`CHECK`-constrained to
`storage_driver = 'cloudflare_r2'` and only relevant while the
full-online-R2-only preset (#632) is active. A generic name risks a
meaning collision with a genuinely general media system in the future
(avatars, product images, etc.) that may want the unprefixed name for
itself. The full details are in migration 041's header comment.

### Reconciliation #2 — a 7-state status enum, an elaboration of the original 4-state §5 sketch

`full-online-r2-architecture.md` §5 (written before #633) sketched
`pending|confirmed|orphaned|deleted`. Migration 041 uses the 7 states from
the body of issue #633 itself:
`pending_upload|uploaded|verified|attached|orphaned|deleted|failed` —
this is an ELABORATION, not a contradiction: `pending_upload` = `pending`;
`uploaded`+`verified` split the single `confirmed` into "R2 PUT succeeded"
vs "MIME/checksum/dimensions verified by the server" (matching the
two-step Path A flow in §7 — #634 will need both states to represent the
gap between a successful HEAD and full content verification); `attached`
is new (the media is genuinely referenced by an owning resource, not
merely verified-but-idle); `orphaned`/`deleted` are unchanged; `failed` is
new. **Soft delete (`deleted_at`) is orthogonal to `status`** (the same
pattern as `awcms_blog_posts`) — delete/restore never rewrites `status`.

### `owner_resource_type`/`owner_resource_id` — a generic polymorphic reference, with NO FK to `blog_content`

Deliberately a loose `(text, uuid)` pair with no foreign key, following
the same PATTERN (NOT identical column types — post-review correction on
PR #652) as the idiom that ALREADY EXISTS in
`awcms_audit_events.resource_type`/`resource_id` (migration 011,
`resource_id text`) and `awcms_workflow_instances.resource_type`/
`resource_id` (migration 012, `resource_id text` as well) — NOT an FK to
`awcms_blog_posts` or any other specific table. This table uses
`owner_resource_id uuid` (not `text`) plus a `CHECK` enum for
`owner_resource_type` — a stricter variant of the same idiom, not an exact
replica. This lets one registry serve every consumer in the objective
(blog post/page, homepage section, gallery item, ad, video thumbnail, SEO
image) without a per-consumer FK, and without this migration depending at
all on the `blog_content` schema — matching `news_portal`'s `module.ts`,
which deliberately has NO hard dependency on `blog_content` (see §"Why the
new module... dependencies is ONLY..." above). Both columns are `NULL`
until the row reaches `status='attached'` (enforced by a `CHECK` in the DB
AND by `attachNewsMediaObject`, which only accepts a transition from
`status='verified'`).

**MANDATORY for #634 (security-auditor finding on PR #652, Medium,
latent — there is no exploitable endpoint today, but it is binding
before #634 ships real attach/purge endpoints):**

1. `attachNewsMediaObject` **never** verifies that `owner_resource_id`
   actually exists AND belongs to the same tenant — because there is no FK,
   this function will always succeed at attaching to whatever UUID the
   caller supplies, including a UUID of a resource owned by another tenant
   or one that never existed at all. Before the #634 attach endpoint ships,
   a verification query (`SELECT 1 FROM <owning table> WHERE id = $1
AND tenant_id = $2`) MUST be added inside the same tenant-scoped
   transaction BEFORE calling `attachNewsMediaObject`, plus a cross-tenant
   attach integration test that explicitly asserts the rejection.
2. There is no retention/legal-hold mechanism at all on
   `purgeNewsMediaObject`/`restoreNewsMediaObject` (a systemic gap, the
   same as `blog-content`'s `purgeBlogPost` — not a new regression from
   this PR). Because R2 media has its own IR runbook
   (`r2-incident-response.md`) that relies on retention/forensic audit,
   #634 (or a separate retention issue) MUST define a mechanism that blocks
   purging objects still inside a mandatory retention period before a real
   purge endpoint ships.

### Object key & public URL — server-generated, validated in 3 layers

`buildNewsMediaObjectKey`/`isValidNewsMediaObjectKey`
(`domain/news-media-object-key.ts`) implement §6 exactly:
`news-media/{tenantId}/{yyyy}/{mm}/{uuid}.{ext}`, with `{ext}` derived
from the validated `mime_type` (an explicit map of the 4 default types,
NOT a generic `mime.split("/")[1]` — a mime type outside the map throws a
loud error instead of guessing an extension). Validated in 3 layers: (1)
the application layer at generation time, (2) a `CHECK` constraint in
Postgres itself (`awcms_news_media_objects_object_key_format_check`,
referencing the same row's `tenant_id` column — a defence against a direct
INSERT that bypasses the helper), (3) a structural unit test.
`buildNewsMediaPublicUrl` builds the public URL ONLY from the trusted
`NEWS_MEDIA_R2_PUBLIC_BASE_URL` (#632 config) + the server-generated
object key — it rejects a non-https/malformed base URL
(`UntrustedNewsMediaPublicBaseUrlError`) and never accepts client input.

### Permission keys for #634 — prepared as constants, NOT YET declared in `module.ts`

`domain/news-media-permissions.ts` exports
`NEWS_MEDIA_PERMISSIONS.{create,read,verify,attach,detach,delete,restore,purge}`
(values `news_portal.media.<action>`) — PURE documentation/constants, not
yet synced to `awcms_permissions` (no DB rows, no change to `module.ts`'s
`permissions` array). Reason: `news_portal` deliberately leaves
`permissions` undeclared until real endpoints exist (the same pattern as
`visitor_analytics`, see §"Why the new module..." above) — #633 only adds
domain/application helpers, there is no HTTP endpoint enforcing them yet.
**Mandatory for #634**: use exactly these constants (do not invent new
names) when declaring `module.ts`'s `permissions` array and calling
`authorizeInTransaction` (skill `awcms-abac-guard`).

### Files created/changed (quick reference)

- `sql/041_awcms_news_media_object_registry_schema.sql`.
- `src/modules/news-portal/domain/news-media-object-key.ts`,
  `domain/news-media-permissions.ts`,
  `application/news-media-object-directory.ts`.
- Tests: `tests/unit/news-media-object-key.test.ts`,
  `tests/unit/news-media-permissions.test.ts`,
  `tests/integration/news-media-object-registry.integration.test.ts`;
  updated: `tests/foundation.test.ts` (migration list).
- Docs: `full-online-r2-architecture.md` §5/§6/§16 (status updated),
  `04_erd_data_dictionary.md` (new §News Portal added).

## §634 — Direct-to-R2 presigned upload flow (Done)

Full implementation of Path A (`r2-upload-sop.md` §2) — three endpoints:
`POST /api/v1/media/news-images/upload-sessions` (create),
`POST .../{id}/finalize`, `POST .../{id}/cancel`. Path B (server-
streaming, §3) was **not** implemented — out of scope for this issue,
Path A already satisfies the acceptance criteria.

### CRUCIAL CONFIRMATION — finalize does a full GET + magic-byte sniffing + server-side checksum, NOT HEAD-only

The body of issue #634 on GitHub writes "Server verifies object existence
and metadata via R2 HEAD/metadata" — that sentence was DELIBERATELY NOT
followed because it is stale relative to the post-review architectural
decision (Critical security-auditor finding on #631) in
`full-online-r2-architecture.md` §9 and `r2-upload-sop.md` §2 step 5. The
real implementation:
`src/modules/news-portal/application/news-media-r2-verification.ts`'s
`verifyNewsMediaR2Object` — the EXACT order: (1) `client.headObject()`
(a quick existence check + real `Content-Length`, short-circuiting before
the `GET` if the object does not exist or is oversized — saving bandwidth
per §9 point 1), (2) `client.getObject()` = `S3File.arrayBuffer()`
(a FULL GET, not ranged/partial), (3) `sniffNewsMediaMimeType(bytes)`
(`domain/news-media-mime-sniffer.ts`, a magic-byte allow-list of JPEG/PNG/
WebP/GIF — any payload that does not match, including HTML/JS disguised as
`.jpg`, sniffs to `undefined`), (4) `Bun.CryptoHasher("sha256")` computed
from the SAME BYTES read in step 2 (not a re-hash of the first few
bytes), (5) `decideNewsMediaFinalizeOutcome`
(`domain/news-media-finalize-decision.ts`) — the MIME/content decision
ALWAYS comes from the sniffing result; the client's claimed checksum
(optional, in the finalize request body, NOT in create — see the checksum
reconciliation below) is ONLY compared as transport-corruption detection,
it never replaces sniffing. `HEAD` (step 1) NEVER promotes the status on
its own — if the object does not exist or is oversized, the request is
rejected BEFORE `GET` is called at all (defence-in-depth, but still via
the HEAD-then-GET order, not HEAD-only).

The route (`pages/api/v1/media/news-images/upload-sessions/[id]/finalize.ts`)
only does thin HTTP parsing/validation — the real logic lives in
`application/news-media-finalize-upload-session.ts`'s
`finalizeNewsMediaUploadSession` (two separate `withTenant` transactions
bracketing the R2 call in the middle, ADR-0006 — row/TTL/idempotency
precheck in the first tx, commit, call R2 outside the transaction, then a
second tx writes the `verified`/`failed` result). The test proving that
HTML/JS disguised as an image is rejected:
`tests/integration/news-media-upload-session-api.integration.test.ts`'s
"HTML/JS payload disguised as a .jpg (Issue #631 exploit scenario) is
REJECTED" — it uploads real HTML/`<script>` bytes to a fake R2 object
(a fake in-memory S3 server, `Bun.serve`, path-style `/{bucket}/{key}`,
empirically confirmed to match real `Bun.S3Client` requests) whose
key/claimed-mime-type says `image/jpeg`, then asserts that `finalize`
returns `422 UPLOAD_VERIFICATION_FAILED` with
`reason: "mime_not_recognized"`, that the row stays `failed` (not
`verified`), and that the audit event `news_media.object.finalize_rejected`
is recorded. Equivalent tests at unit level (no DB):
`tests/unit/news-media-mime-sniffer.test.ts`,
`tests/unit/news-media-finalize-decision.test.ts`,
`tests/unit/news-media-r2-verification.test.ts`.

### Why the R2-dependent tests do not go through the HTTP route directly

Astro routes have a fixed `(context) => Response` signature; there is no
seam for injecting a fake R2 client into a test.
`finalizeNewsMediaUploadSession` was extracted into
`application/news-media-finalize-upload-session.ts` precisely so it has a
`deps.createR2Client` that tests can override (the same pattern as
`dispatchObjectSyncQueue`'s `resolveUploader` option in `sync-storage`,
applied one layer deeper because that is where the seam actually is).
Scenarios that do NOT need real R2 (auth/tenant/ABAC, shape validation,
idempotency-required, not-found, wrong-status, expired-session — all
decided from DB state alone before R2 is called at all) are still tested
through the real route (`invoke()`). Scenarios that do need R2 (accept,
object-not-found, mime-mismatch/exploit, checksum-mismatch) call
`finalizeNewsMediaUploadSession` directly with a real `Bun.S3Client`
pointed at the local fake server.

### Permission reconciliation — use `news_portal.media.*` from #633, NOT `media_objects.news_images.*` from the body of issue #634

The body of issue #634 suggests
`media_objects.news_images.{upload,read,attach,delete}`. NOT followed —
`news-media-permissions.ts` (#633) had already frozen
`news_portal.media.{create,read,verify,attach,detach,delete,restore,purge}`
earlier, and that file itself already writes explicitly that "#634 MUST
use exactly these constants". Verification was done: there is no other
module in this repo named `media_objects` nor any similar generic
permission pattern (`grep` found nothing) — so there is no real conflict
to reconcile beyond the naming itself. Endpoint → permission mapping:
create session → `news_portal.media.create` (action `"create"`, already in
the `AccessAction` union); finalize → `news_portal.media.verify`
(action `"verify"`, already exists); cancel → the NEW permission
`news_portal.media.cancel` (action `"cancel"`, which already existed in
the `AccessAction` union for sync/POS purposes — reused, not added).
`cancel` was added to `NEWS_MEDIA_PERMISSIONS` because #633
never budgeted for the concept of an "upload session" at all (at the time
the registry only thought in terms of object lifecycle status, not
presigned sessions) — this is an additive extension, not a contradiction
of the #633 set. Migration `042_awcms_news_media_permissions.sql` seeds
nine rows (the eight from #633 + the new `cancel`) into
`awcms_permissions`, and `module.ts`'s `permissions` array (NEWLY declared
in this issue, previously deliberately `undefined`) copies EXACTLY the
same nine actions — verified by a test
(`tests/modules/news-portal-module.test.ts`'s "every declared
permission's activityCode/action reproduces exactly one
NEWS_MEDIA_PERMISSIONS constant").

### Client-claimed checksum reconciliation — in the FINALIZE body, not in the CREATE body as the SOP implies

`r2-upload-sop.md` §2 step 5 writes that "the checksum claimed in step 1"
(create) is compared at the finalize step — but migration 041 (#633,
FROZEN schema, untouched by this issue) has only ONE `checksum_sha256`
column, filled from the SERVER-COMPUTED value at
`markNewsMediaObjectVerified` (not `markNewsMediaObjectUploaded` — since
the PR #653 re-review, the atomic `pending_upload->uploaded` claim happens
BEFORE the real GET, see the subsection below), not from the client's
claim. There is no column to store the client's claim separately from that
final value. The solution: an optional `checksumSha256` is accepted in the
FINALIZE BODY (not create) — functionally equivalent (a Path A client
holds exactly the same bytes for both requests, there is no downside to
including it again in the second request) with no new migration needed.
`CreateNewsMediaUploadSessionRequest` in OpenAPI has NO checksum field at
all; `FinalizeNewsMediaUploadSessionRequest` has an optional
`checksumSha256`.

### PR #653 re-review — two security-auditor findings closed, do not reintroduce them

PR #653 (this issue) went through ONE round of review after the initial commit — the reviewer

- security-auditor found two real bugs in the finalize implementation:

1. **Critical (TOCTOU size-cap)**: `getObject` originally called
   `file.arrayBuffer()` — buffering the ENTIRE object into memory BEFORE
   its size was checked. A presigned PUT URL can be reused, so an attacker
   could overwrite the object with a giant file BETWEEN `headObject` (which
   reported a small size) and `getObject` (which reads the actual bytes) —
   the process could OOM. **Fix**: `getObject(objectKey,
maxBytes)` now reads via `readCappedStream` (a helper exported from
   `news-media-r2-client.ts`, directly testable against a synthetic
   `ReadableStream`) which cancels (`reader.cancel()`) the read EXACTLY
   when the running total exceeds `maxBytes`, NEVER accumulating more than
   `maxBytes`. `verifyNewsMediaR2Object` treats `get.sizeExceeded` as
   AUTHORITATIVE, overriding a possibly stale `head.sizeBytes`.
2. **High (concurrent-finalize cost amplification)**: N concurrent
   `finalize` calls with DIFFERENT `Idempotency-Key`s against the SAME
   `objectId` used to each reach `verifyNewsMediaR2Object` individually
   (each paying its own `HEAD`+`GET`). **Fix**:
   `markNewsMediaObjectUploaded(tx,
tenantId, objectId)` (now with optional `input`, `COALESCE` in SQL) is
   used as an ATOMIC CLAIM (`pending_upload -> uploaded`) INSIDE the
   precheck transaction, BEFORE any R2 call — its `WHERE status =
'pending_upload'` is the mutual-exclusion primitive (Postgres serialises
   concurrent `UPDATE`s on the same row). The winner proceeds to R2; the
   losers get a cheap `409`, WITHOUT ever calling R2.

**A design consequence that follow-on issues MUST preserve**: the
`uploaded` claim is now held across a SEPARATE DB transaction (no longer
the same transaction as the `verified`/`failed` resolution) while the real
R2 call runs. This requires an explicit revert path
(`revertNewsMediaObjectUploadClaim`, `uploaded -> pending_upload`) —
called for (a) the handled `provider_error` outcome, AND (b) ANY
UNEXPECTED EXCEPTION from `verifyNewsMediaR2Object` or the resolution
transaction (bug, OOM, etc.) — see the `try/catch` in
`finalizeNewsMediaUploadSession`. Without (b), a crash between the claim
commit and the resolution leaves the row stuck PERMANENTLY at `uploaded`
(both `finalize` and `cancel` require `pending_upload`) — there is NO
reaper/cleanup job for stale `uploaded` rows at present (unlike
`pending_upload`, which has a TTL check). Do not remove this `try/catch`
in the name of "simplification" without first adding an equivalent
reconciliation job.

A related idempotency fix: the `rejected` outcome (422) now ALSO stores
its own idempotency record (`saveIdempotencyRecord` with status 422) —
previously only the success path (200) was stored, so a retry with the
same `Idempotency-Key` after a rejection would fall into the status guard
(`row.status !== "pending_upload"`) and get a DIFFERENT response ("Cannot
finalize... status failed"), violating the "same key + same request ->
identical replay" contract.

The tests proving both fixes + regressions: `tests/unit/news-media-r2-client.test.ts`
(`readCappedStream` directly + the swapped-object scenario via a loopback
server with a large-but-finite body — DO NOT use a `pull()` that
`enqueue()`s endlessly without `close()`, that is a test design bug which
hangs the Bun runtime even without `Bun.S3Client` at all, not a property
of the code under test), `tests/unit/news-media-r2-verification.test.ts`
(`sizeExceeded: true` is authoritative even when `HEAD` claims the size is
within the limit),
`tests/integration/news-media-object-registry.integration.test.ts`
(`markNewsMediaObjectUploaded` with no argument as a claim + the
second-claim-loses guard, `revertNewsMediaObjectUploadClaim` transitioning
back + being a no-op in other statuses),
`tests/integration/news-media-upload-session-api.integration.test.ts`
(provider_error → 502 → claim reverted → retry with a new key succeeds; a
422 replays identically with the same key instead of falling into the
status guard).

Residual (noted by the security-auditor, NOT a go-live blocker, for a
follow-on issue): `withTimeout` (`src/lib/integration/timeout.ts`) does not
cancel a stream that is being read when the timeout fires — the
`readCappedStream` read keeps running in the background until it
finishes/is GC'd (bounded to `maxBytes`, so no longer unbounded, but not
genuinely "stopped"); and there is no REAL concurrency race test yet (two
genuinely parallel `finalize`s) — the correctness argument currently rests
on inspecting Postgres `READ COMMITTED` semantics inside `withTenant`, not
on a red/green test.

### Files created/changed (quick reference)

- `sql/042_awcms_news_media_permissions.sql`.
- `src/modules/news-portal/domain/news-media-mime-sniffer.ts`,
  `domain/news-media-finalize-decision.ts`,
  `domain/news-media-upload-session-validation.ts`; updated:
  `domain/news-media-permissions.ts` (added `cancel`).
- `src/modules/news-portal/infrastructure/news-media-r2-client.ts`
  (a `Bun.S3Client` wrapper: presign/HEAD/GET, circuit breaker
  `"news-media-r2"`, timeout — the same pattern as
  `object-storage-uploader.ts`).
- `src/modules/news-portal/application/news-media-r2-verification.ts`
  (orchestrates HEAD→GET→sniff→checksum→decision, no `tx`, pure R2 +
  domain), `application/news-media-finalize-upload-session.ts`
  (orchestrates the full finalize: precheck tx → R2 verify → outcome tx,
  with `deps.createR2Client` injectable for tests).
- `src/pages/api/v1/media/news-images/upload-sessions/index.ts` (create),
  `.../[id]/finalize.ts`, `.../[id]/cancel.ts` — thin routes.
- Updated: `src/modules/news-portal/module.ts` (`permissions`, `api`
  newly declared, version 0.1.0→0.2.0).
- `openapi/awcms-public-api.openapi.yaml` (the "News Media" tag, three
  paths, five new schemas).
- Tests: `tests/unit/news-media-mime-sniffer.test.ts`,
  `tests/unit/news-media-finalize-decision.test.ts`,
  `tests/unit/news-media-upload-session-validation.test.ts`,
  `tests/unit/news-media-r2-client.test.ts`,
  `tests/unit/news-media-r2-verification.test.ts`,
  `tests/integration/news-media-upload-session-api.integration.test.ts`;
  updated: `tests/unit/news-media-permissions.test.ts` (9 keys,
  module.ts now declares permissions),
  `tests/modules/news-portal-module.test.ts`,
  `tests/unit/news-portal-no-local-fallback.test.ts` (scan extended to
  `src/pages/api/v1/media/news-images`), `tests/foundation.test.ts`
  (migration list 042).
- Changeset: `.changeset/news-media-presigned-upload-issue-634.md`.

### Not done / out of scope for this issue (for follow-on issues)

- Path B (server-streaming) — not implemented.
- A cleanup job for expired `failed`/`orphaned`/`pending` R2 objects —
  finalize only MARKS the row `failed` and audits it, it does NOT delete
  the actual R2 object (`r2-backup-lifecycle.md`'s lifecycle job).
  **Update #635**: it turns out this is not #635's scope either (that
  issue's title is "readiness checks", not "cleanup job") — #635 only adds
  `checkNewsMediaR2NoStalePendingObjects`, which REPORTS the backlog as a
  warning, it does not delete. No issue has claimed the real deletion job
  yet — see §635 below.
- A real `attach` endpoint (the `news_portal.media.attach` permission is
  already declared, but no route calls it) — verifying that
  `owner_resource_id` exists + matches the tenant (the Medium
  security-auditor finding on PR #652, recorded in §633 above) MUST still
  be enforced by the issue that adds the real attach endpoint, NOT this
  one.
- Retention/legal-hold on purge — still the same systemic gap (recorded in
  §633), untouched by this issue (no real purge endpoint ships here).

## §635 — R2 image delivery readiness checks (Done)

### Reconciliation — the body of issue #635 uses placeholder var names, NOT the real `NEWS_MEDIA_R2_*`

The body of issue #635 writes `R2_NEWS_IMAGE_*`, `NEWS_IMAGE_STORAGE_POLICY`,
`FILE_STORAGE_DRIVER`, `LOCAL_FILE_UPLOADS_ENABLED`,
`LOCAL_MEDIA_STORAGE_ENABLED` — NOT ONE of these vars exists in the code
(the same pattern as the #632/#633/#634 reconciliations above). The real
vars remain `NEWS_MEDIA_R2_*` (§4 of the architecture doc, enforced since
#632). There is no `LOCAL_FILE_UPLOADS_ENABLED`/`LOCAL_MEDIA_STORAGE_ENABLED`/
`FILE_STORAGE_DRIVER` because this mode structurally has no local upload
path to disable (Key decision #2, `There is no real "local fallback" flag`
in §632 above — it applies exactly the same here, and was NOT
re-implemented as a new flag).

### The real scope of the work — most of the issue's acceptance criteria were ALREADY met by #632, the rest is here

`r2-security-checklist.md` §7 (written during #631/#632) already marked
most of issue #635's acceptance criteria as completed early via #632
(`checkNewsPortalProfileConfig`, `checkNewsMediaR2Config`,
`checkNewsMediaR2SeparationFromSyncR2`,
`checkNewsPortalFullOnlineR2PresetReady`,
`checkNewsMediaR2SvgNotAllowed`) AND explicitly marked what was "still
open for #635". This issue adds FOUR new checks that close the rest:

- **`checkNewsMediaR2AllowedMimeTypesKnown`** (`config:validate`,
  **fail**) — `NEWS_MEDIA_R2_ALLOWED_MIME_TYPES` must lie entirely within
  `NEWS_MEDIA_R2_KNOWN_MIME_TYPES` (domain
  `news-media-r2-config.ts`: the four raster types that
  `news-media-mime-sniffer.ts` can sniff PLUS `image/svg+xml` — svg stays
  "known" because it has a legitimate override path via
  `checkNewsMediaR2SvgNotAllowed`, it is not "unknown/unsafe"). Any other
  entry (`text/html`, `application/octet-stream`, a typo) could never pass
  sniffing at `finalize` — that is pure misconfiguration, so this is a hard
  **fail**, not a warning.
- **`checkNewsMediaR2PresignedTtlUpperBound`** (`config:validate`,
  **fail**) — `NEWS_MEDIA_R2_PRESIGNED_UPLOAD_TTL_SECONDS` must not exceed
  `NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS` (a new constant, 3600
  seconds/1 hour) — a presigned PUT URL can be reused for as long as the
  TTL is valid (architecture doc §8), so an excessive TTL weakens that
  mitigation. The 3600 figure was chosen as a generous but still meaningful
  upper bound — it does not come from the issue's acceptance criteria
  (which give no number), and is documented as an implementor's decision.
- **`checkNewsMediaR2PublicBaseUrlProductionSafe`** (`security:readiness`,
  **critical**) — the FIRST time this family of checks (config:validate/
  security:readiness for news-media R2) branches on `APP_ENV`. When
  `APP_ENV=production` AND `NEWS_MEDIA_R2_ENABLED=true`: it rejects
  Cloudflare's default `*.r2.dev` host (regex `\.r2\.dev$` against the
  hostname, not a substring match — avoiding a false positive against a
  custom domain that happens to contain that string in its path) and
  loopback hosts (`localhost`/`127.0.0.1`). Non-production ALWAYS
  **passes** — the issue explicitly asks that "non-production/dev mode may
  be documented separately without weakening the production default", so
  non-production never fails here even when its URL is `r2.dev`. This is
  the FIRST **critical** check that reads `APP_ENV` in the
  `security-readiness.ts` family — a precedent for follow-on implementors
  who need different production vs non-production behaviour.
- **`checkNewsMediaR2NoStalePendingObjects`** (`security:readiness`,
  **warning**, ASYNC + requires `DATABASE_URL`) — this is exactly what the
  old version of `r2-security-checklist.md` §7 explicitly marked as "still
  open for #635": a check that touches the REGISTRY TABLE itself, not just
  the shape of env vars. It scans across ALL active tenants for
  `pending_upload` rows that are past `NEWS_MEDIA_R2_PENDING_TTL_MINUTES`
  — the IDENTICAL pattern to `checkSsoBreakGlassReady` (Issue #593): query
  `awcms_tenants` first, then one `sql.begin` per tenant with
  `SET LOCAL app.current_tenant_id`, so that this check stays correct under
  RLS regardless of which privilege the `DATABASE_URL` used by
  `security:readiness` has. **Severity `warning`, not `critical`** — a
  backlog of stale `pending_upload` objects is a housekeeping gap (the §2
  cleanup job genuinely does not exist at all in this codebase yet — see
  the paragraph below), not evidence of active exploitation.

**IMPORTANT — what this issue did NOT do (deliberately, per
`r2-backup-lifecycle.md`)**:

1. **The REAL cleanup job for stale `pending_upload` objects** (§2 —
   deleting the R2 object + the metadata row).
   `checkNewsMediaR2NoStalePendingObjects` above only REPORTS the backlog,
   it deletes NOTHING. The real job is still purely operational/lifecycle
   scope that nobody has implemented to date (§2 itself writes "probably
   part of #633/#634" — it turned out not to be, and #635 is not the place
   either because this issue's title is "readiness checks", not "cleanup
   job").
2. **Detecting `confirmed` `orphaned` objects** (§4) — DELIBERATELY not
   implemented in this issue because it depends on the COMPLETE list of
   reference points (`blog_content` featured image, the
   `gallery`/`video_news` blocks, `ad.imageUrl`, the SEO share image),
   which only exists once #636-#640/#642/#649 are done (§4 is explicit:
   "this list of reference points must be updated every time a follow-on
   issue adds a new surface"). Implementing orphan detection NOW — before
   `blog_content` even requires an R2 reference (#636) — would wrongly flag
   EVERY `confirmed`/`verified` object as an orphan (no surface actually
   references them yet), exactly the "do not build ahead before the
   dependency is ready" mistake this epic has repeatedly been warned to
   avoid.

The implementor of the issue that eventually adds either of the two above
**must** update `r2-security-checklist.md` §7 and this section again.

### PR #665 re-review — hostname bypass in the `checkNewsMediaR2PublicBaseUrlProductionSafe` check

The reviewer AND the security-auditor independently both found that
`findNewsMediaR2PublicBaseUrlProductionUnsafeReason` (and the helpers
`isLoopbackHost`/`isR2DevHost`) could be bypassed:

1. **Trailing-dot FQDN** — `https://pub-abc123.r2.dev./x` has the literal
   `hostname` `"pub-abc123.r2.dev."` (the DNS root dot is preserved by
   `new URL(...).hostname`), which does not match the regex
   `/\.r2\.dev$/i` because that regex does not normalise the trailing dot
   — even though DNS treats `abc.r2.dev.` EXACTLY the same as
   `abc.r2.dev`. Same for `http://localhost.`.
2. **IPv6/`0.0.0.0` loopback not covered** (reviewer) —
   `new URL("http://[::1]/").hostname` returns `"[::1]"`, and
   `new URL("http://0.0.0.0/").hostname` returns `"0.0.0.0"` — neither
   matched the exact-string check, which used to be only
   `"localhost"`/`"127.0.0.1"`.

**Fix**: `stripTrailingDot` (a new helper) normalises the trailing dot
BEFORE either check runs; `isLoopbackHost` was widened to cover
`0.0.0.0`, `::1`, `[::1]` (case-insensitive). Encouragingly, other IP
obfuscations (octal/decimal/hex — `0177.0.0.1`/`2130706433`/`0x7f000001`)
AND Unicode homographs of the dot (`．`/`。`) are already neutralised
automatically by Bun's built-in `URL`/IDNA normalisation BEFORE the
regex/exact-match runs (verified independently by both agents) — not
something that needs handling by hand here. Regression tests for both
bypasses above were added to `tests/unit/news-media-r2-config.test.ts`.
Follow-on implementors who touch this function again **must** keep
`stripTrailingDot` and all four loopback variants — do not simplify back
to a plain exact-string match.

### Files created/changed (quick reference)

- `src/modules/news-portal/domain/news-media-r2-config.ts`: added
  `NEWS_MEDIA_R2_KNOWN_MIME_TYPES`,
  `NEWS_MEDIA_R2_MAX_PRESIGNED_UPLOAD_TTL_SECONDS`,
  `findUnknownNewsMediaR2MimeTypes`, `isPresignedUploadTtlTooLong`,
  `findNewsMediaR2PublicBaseUrlProductionUnsafeReason`.
- `scripts/validate-env.ts`: `checkNewsMediaR2AllowedMimeTypesKnown`,
  `checkNewsMediaR2PresignedTtlUpperBound`, wired into
  `runEnvValidation`.
- `scripts/security-readiness.ts`:
  `checkNewsMediaR2PublicBaseUrlProductionSafe`,
  `checkNewsMediaR2NoStalePendingObjects`, wired into
  `runSecurityReadinessChecks`.
- `.env.example`, `18_configuration_env_reference.md` §News portal,
  `full-online-r2-architecture.md` §4, `r2-security-checklist.md` §7 —
  all updated for the four new checks.
- Tests: `tests/unit/news-media-r2-config.test.ts` (added a describe
  block for the three new helpers), `tests/validate-env.test.ts` (added a
  describe block for the two new config:validate checks),
  `tests/security-readiness.test.ts` (added a describe block for
  `checkNewsMediaR2PublicBaseUrlProductionSafe`; `checkNewsMediaR2NoStalePendingObjects`
  is DELIBERATELY not unit-tested here — the same pattern as
  `checkSsoBreakGlassReady`, see that test file's header comment),
  `tests/integration/security-readiness-news-media-r2.integration.test.ts`
  (new — a real DB for `checkNewsMediaR2NoStalePendingObjects`, the same
  pattern as `security-readiness-break-glass.integration.test.ts`).
- Changeset: `.changeset/news-media-r2-readiness-checks-issue-635.md`.

## §636 — `blog_content` must reference R2 media (Done)

### Reconciliation — the body of issue #636 implies a new `{mediaObjectId, alt, caption}` shape; NOT followed for `featuredMediaId`

The body of issue #636 implies the reference shape `{mediaObjectId, alt,
caption}` as a new field replacing `featuredMediaId`. **Not followed** —
`featuredMediaId` (the `awcms_blog_posts`/
`awcms_blog_pages`.`featured_media_id` column, migration 026, with NO FK,
see §633 above) REMAINS a loose UUID exactly as before; `alt`/`caption`
ALREADY EXIST as the `alt_text`/`caption` columns on
`awcms_news_media_objects` itself (#633) — duplicating them into separate
columns in `blog_content` would create two sources of truth for the same
data (exactly the "derive, don't duplicate" pattern the architecture doc
§11 set out for `public_url`). The ONLY thing that changed is validation:
`featuredMediaId`, when present, must now point at an
existing/`verified`/`attached`/same-tenant registry row — enforced in the
APPLICATION layer (it needs a DB round-trip), not in the pure validator
(`blog-post-validation.ts`'s `validateFeaturedMediaId` REMAINS shape-only,
the same pattern as `termIds`/`countExistingTerms`, Issue #539).

For the gallery block in `content_json` (the `GalleryItem` type,
`content-block-rendering.ts`, Issue #542): items of `mediaType:
"image"` now support a new `mediaObjectId` field (alongside the `url` that
remains for non-R2-only mode) — exactly the `{mediaObjectId, caption}`
shape the issue asked for, WITHOUT a separate `alt` (alt text still comes
from the registry's `alt_text`, for the same reason as above).
`mediaType: "video"` items are **untouched** — a mandatory R2 thumbnail
for video is #639's scope (not yet done), and forcing it now would be
"building ahead" before its dependency is ready.

### The tenant+env gate — a new infrastructure component that did not exist before

`evaluateNewsPortalFullOnlineR2Readiness` (§632) is purely env-based/global
— it does NOT know whether the CALLING TENANT actually activated the
`news_portal_full_online_r2` preset. This issue adds
`src/modules/blog-content/application/news-portal-r2-mode-gate.ts`'s
`isNewsPortalFullOnlineR2ModeActiveForTenant(tx, tenantId, env)` — which
composes THAT global env check with a real per-tenant signal that the
tenant HAS applied the preset. **Deliberately a runtime check, NOT a
`module.ts` `dependencies` entry** — neither `blog_content` nor
`news_portal` declares a dependency on the other, DELIBERATELY (see
§632's "Why the new module... dependencies is ONLY..."), to avoid
`MODULE_REVERSE_DEPENDENCY_ACTIVE` locking one of the modules against
being disabled forever — adding a dependency here would resurrect exactly
that problem.

**IMPORTANT — THREE failed attempts before the right signal was found
(three review rounds with the reviewer+security-auditor, PR #666; do not
re-derive this from scratch, ALL THREE were confirmed to fail in reality —
two by red integration tests, one by a live exploit reproduced by the
security-auditor):**

1. **`fetchTenantModuleEntry(...).tenantEnabled` — a total FAILURE.**
   This function is opt-out-by-default (no `awcms_tenant_modules` row
   means `tenantEnabled: true` — its own documentation says so): ALMOST
   EVERY tenant reads `news_portal` as "enabled" whether or not it ever
   applied the preset (that is the default for every module for every
   tenant). Using this as the opt-in signal makes this issue's entire
   tenant-scoping COMPLETELY INOPERATIVE — as soon as ANY ONE tenant makes
   the deployment-wide env vars correct, THIS VALIDATION BECOMES ACTIVE
   FOR ALL OTHER TENANTS TOO, exactly the scenario this very file was
   written to prevent.
2. **`entry.enabledAt !== null` — also a FAILURE, more subtly.**
   The second attempt: only `enableTenantModule` ever writes an
   `awcms_tenant_modules` row, so `enabledAt: null` should mean "never
   touched". BUT `enableTenantModule` (called by
   `applyModulePreset`/`applyNewsPortalFullOnlineR2Preset`) validates the
   CURRENT state first — a new tenant ALREADY reads as "enabled" (the
   default above), so validation rejects with `MODULE_ALREADY_ENABLED`,
   which `applyModulePreset` treats as `already_satisfied` (idempotency) —
   **it NEVER writes a row at all**. A tenant that JUST applied the preset
   has `enabledAt: null` EXACTLY like a tenant that never touched it —
   confirmed to fail when 8 previously passing integration tests suddenly
   all went red as soon as this fix was tried.
3. **`awcms_module_settings` (`updateModuleSettings`/
   `fetchModuleSettingsView`) — a FAILURE, and the MOST DANGEROUS one.**
   The third attempt was logically CORRECT (it did distinguish "applied"
   from "never touched"), BUT this table can be written directly by the
   tenant through the generic endpoint
   `PATCH /api/v1/tenant/modules/{moduleKey}/settings`, gated by the
   generic permission `module_management.settings.update` (granted by
   default to Owner/Admin — COMPLETELY unrelated to
   `blog_content`/`news_portal` permissions). A tenant holding that
   generic permission could `PATCH` its marker key to `null` and TURN OFF
   this issue's ENTIRE R2-only validation for itself — the
   security-auditor reproduced this exploit live end-to-end (PATCH 200,
   then POST a post with a raw `featuredMediaId` passing with 200 when it
   should have been 422). **Verdict BLOCKED** on the second re-audit
   because of this finding.

**The signal that ACTUALLY works (the fourth, final attempt)**: a
dedicated NEW table, `awcms_news_portal_tenant_state` (migration `043`,
`tenant_id` PK, column `full_online_r2_mode_applied_at`), which has NO
generic write endpoint ANYWHERE AT ALL. The only code that ever writes to
this table is `applyNewsPortalFullOnlineR2Preset`
(`news-portal/application/apply-news-portal-preset.ts`, via
`news-portal-tenant-state.ts`'s `markFullOnlineR2ModeApplied`) — the one
official path for activating this preset (see that file's own header).
`isNewsPortalFullOnlineR2ModeActiveForTenant` reads it via
`isFullOnlineR2ModeAppliedForTenant` — a tenant with no row in this table
(the majority of tenants today) is always `false`, fail-closed by
construction, and there is NO API path whatsoever (neither
`module_management.settings.update` nor any other generic permission) that
can touch it.

**The lesson for follow-on implementors who need a similar per-tenant
signal**: NEVER put a security/enforcement signal in a mechanism that
ALREADY has a generic tenant-writable endpoint (`awcms_tenant_modules`,
`awcms_module_settings`) — both are designed for operator self-service,
not for storing state the tenant itself must not be able to change. If you
need a genuinely tamper-proof signal, create a narrow new table that is
touched by ONLY one already-trusted application function, and do NOT
expose any write path to it.

When the mode is NOT active for a tenant (the majority of
deployments/tenants today): all of this new validation is a no-op — the
old `featuredMediaId`/gallery URLs behave identically to before this issue
(backward compatible, not a blanket tightening). The regression tests
`"R2-only mode active for tenant A does NOT leak into tenant B"` AND
`"the generic PATCH .../settings endpoint CANNOT disable R2-only
validation"` in `blog-content-news-media-r2-references.integration.test.ts`
prove this explicitly — follow-on implementors who change this gate
**must** keep both tests passing.

### The revision-restore path bypass — found & closed before merge (security-auditor, PR #666 review)

`POST /api/v1/blog/posts/{id}/revisions/{revisionId}/restore` (Issue
#541) writes `revision.contentJson` back into the live post via
`updateBlogPost` — a FIFTH write path to `content_json`/`featuredMediaId`
that was NOT patched alongside the four create/update posts/pages route
handlers when this validation was first written. The real scenario: an old
revision (created BEFORE R2-only mode was active, containing a raw gallery
`url` that was legal at the time) is restored AFTER the tenant activates
R2-only mode — the restore simply passed, putting the raw `url` back into
the live post WITHOUT any validation, immediately visible publicly on
`/news`. **Fix**: `restore.ts` now also calls
`validateNewsMediaReferencesForFullOnlineR2Mode` (only the revision's
`contentJson` — `featuredMediaId` is indeed never part of a revision
snapshot, see §Rule #13 of the blog-content skill) right before
`updateBlogPost`, failing with `422 NEWS_MEDIA_REFERENCE_INVALID` exactly
like an ordinary PATCH. Regression test:
`"POST .../revisions/{id}/restore also enforces the same validation"` in
the same integration test file. **Every future new write path to
`content_json`/`featuredMediaId` (e.g. bulk-import, duplicate-post) MUST
go through the same gate** — do not assume the four original route
handlers already cover every write path that exists.

### Files created/changed (quick reference)

- `src/modules/news-portal/application/news-media-object-directory.ts`:
  added `isNewsMediaObjectSafeForPublicReference(status)` — a shared
  predicate (`verified`/`attached` only) used by `blog_content` so that
  the list of "statuses safe to reference publicly" is defined in exactly
  ONE place.
- `src/modules/blog-content/application/news-portal-r2-mode-gate.ts`
  (new) — see above.
- `src/modules/blog-content/domain/content-block-media-references.ts`
  (new) — `collectGalleryImageReferences(contentJson)`, pure: extracts the
  `mediaObjectId` of image-type gallery items + reports violations
  (`raw_url_not_allowed`/`media_object_id_missing_or_malformed`) with no
  DB access.
- `src/modules/blog-content/application/news-media-reference-gate.ts`
  (new) — `validateNewsMediaReferencesForFullOnlineR2Mode` (called by the
  route handler AFTER the pure validator, BEFORE the write — the
  `countExistingTerms` pattern) and `resolveVerifiedNewsMediaReferences`
  (used at render time, see below).
- `src/modules/blog-content/domain/content-block-rendering.ts`: `GalleryItem`
  gains an optional `mediaObjectId`; `renderGalleryItem`/`renderGallery`/
  `renderBlock`/`renderContentJsonToHtml` accept `resolvedMediaUrls`
  (empty by default — backward compatible for old callers). Added
  `collectRenderableGalleryMediaObjectIds` (a thin re-export of
  `collectGalleryImageReferences`, one traversal used at both write time
  and render time so they can never drift).
- `src/modules/blog-content/domain/seo-rendering.ts`: added
  `resolveOgImageUrl` — pure, accepting an ALREADY-resolved URL (it does
  not do a lookup itself).
- `src/modules/blog-content/domain/public-page-rendering.ts`:
  `PublicPageShellOptions` gains optional `ogImageUrl`/`ogImageAlt`;
  `renderPublicPageShell` emits `og:image`/`twitter:card`/
  `twitter:image`/`og:image:alt` only when `ogImageUrl` is present.
- `src/modules/blog-content/application/public-blog-directory.ts`: the
  `PublicBlogPostDetail`/`fetchPublicBlogPostBySlug` SELECT now also
  includes `featured_media_id` (it was never SELECTed at all before —
  nothing rendered it prior to this issue).
- `src/pages/news/[slug].ts`, `src/pages/blog/[tenantCode]/[slug].ts`:
  resolve ALL mediaObjectIds (featured + gallery) in ONE bulk lookup
  (`resolveVerifiedNewsMediaReferences`) before rendering — ids that do
  not resolve (wrong tenant/unsafe status/nonexistent) are silently not
  rendered (degrade, don't 500).
- `src/pages/api/v1/blog/posts/index.ts`, `[id].ts`,
  `src/pages/api/v1/blog/pages/index.ts`, `[id].ts`,
  `src/pages/api/v1/blog/posts/[id]/revisions/[revisionId]/restore.ts`
  (all five routes — the last one added after the re-review, see
  §"The revision-restore path bypass" above): call
  `validateNewsMediaReferencesForFullOnlineR2Mode` after the pure
  validator + (for posts) `countExistingTerms`, before
  create/updateBlogPost/Page — failing with
  `422 NEWS_MEDIA_REFERENCE_INVALID`.
- `sql/043_awcms_news_portal_tenant_state_schema.sql` (new) — the narrow
  table `awcms_news_portal_tenant_state` (`tenant_id` PK,
  `full_online_r2_mode_applied_at`), RLS FORCE, with NO generic write
  endpoint whatsoever — see §"The tenant+env gate" above for why this
  needed a new migration (two attempts without a new migration failed, one
  of them genuinely exploitable).
- `src/modules/news-portal/application/news-portal-tenant-state.ts`
  (new) — `markFullOnlineR2ModeApplied`/`isFullOnlineR2ModeAppliedForTenant`,
  the only code allowed to write the table above.
- `src/modules/news-portal/application/apply-news-portal-preset.ts`:
  after `applyModulePreset` succeeds AND the `news_portal` entry itself in
  `result.changes` is not `rejected` (the rejection of ANOTHER module
  bundled in the preset, e.g. `visitor_analytics` because its own
  `logging` is disabled, does NOT block — only a rejection of
  `news_portal` itself means this tenant is genuinely not ready), it calls
  `markFullOnlineR2ModeApplied`.
- `src/lib/i18n/error-messages.ts`, `i18n/en.po`, `i18n/id.po`: a new
  `error.news_media_reference_invalid` entry for the error code above (the
  admin UI already generic-falls back to the server's `error.message`
  without it, but an explicit i18n entry is consistent with EVERY other
  error code in the catalogue).
- `openapi/awcms-public-api.openapi.yaml`: the `featuredMediaId`/
  `contentJson` schema descriptions were updated (the shape did NOT
  change); a new `422` response on all five create/update posts/pages +
  revision restore endpoints.
- `tests/foundation.test.ts`: added the migration `043` filename to the
  list of expected migrations.
- Tests: `tests/unit/content-block-media-references.test.ts` (new),
  `tests/blog-content-public-rendering.test.ts` (added describe blocks for
  gallery mediaObjectId + og:image + `resolveOgImageUrl`),
  `tests/integration/blog-content-news-media-r2-references.integration.test.ts`
  (new — end-to-end: create/update reject, cross-tenant, unsafe status,
  soft-deleted, gallery raw-url reject, gallery mediaObjectId accept,
  video items unaffected, public rendering of og:image+gallery
  `<img>`, revision-restore reject, "tenant B unaffected by tenant A's
  activation", AND "the generic settings endpoint cannot disable the
  validation" — the last three added after three review rounds).
- Changeset: `.changeset/blog-content-news-media-r2-references-issue-636.md`.

### Not done / out of scope for this issue (for follow-on issues)

- **`orphaned` object detection** (§4 of `r2-backup-lifecycle.md`) — this
  issue ADDS new reference points (`featuredMediaId`, gallery
  `mediaObjectId`) that MUST be included in the orphan-detection reference
  point list once that job is finally built (still no issue has claimed
  it, see §635's note).
- **R2-only video gallery items** — deliberately untouched, #639's scope.
- **Complete SEO metadata** (structured data, Twitter cards other than
  `summary_large_image`, etc.) — the `resolveOgImageUrl`/`og:image` here
  is the MINIMAL slice that satisfies #636's acceptance criteria ("SEO
  image rendering uses verified R2 media metadata only"); full SEO polish
  remains #649's scope.
- **A visual admin UI picker** for choosing a media object (today the
  admin still types the `featuredMediaId`/`mediaObjectId` UUID by hand in
  the form — the same as before this issue, see the `awcms-blog-content`
  SKILL.md). The server returns a clear error
  (`NEWS_MEDIA_REFERENCE_INVALID`) which already shows up as an admin UI
  banner (the generic `strings.errorMessages`/`error.message` fallback,
  `AdminLayout.astro`'s pattern) — but no new picker UI was built by this
  issue.

## §637 — Editorial homepage section composer (Done)

Full implementation: migration `044_awcms_news_portal_homepage_sections_schema.sql`
(the `awcms_news_portal_homepage_sections` table, RLS ENABLE+FORCE, the
same idiom as `awcms_blog_ads`), domain `news-portal/domain/homepage-section-policy.ts`
(a whitelist of six `sectionType`s + a per-type `config_json` validator,
strictly discriminated), application `news-portal/application/homepage-section-directory.ts`
(tenant-scoped CRUD), `homepage-section-reference-validation.ts`
(existence/ownership checks for every id/slug in `config`),
`homepage-section-composer.ts` (render-time orchestration: resolve live
references then call the renderer), domain `homepage-section-rendering.ts`
(a pure whitelist renderer), the admin endpoints
`POST/GET /api/v1/news-portal/homepage-sections`,
`PATCH/DELETE .../{id}`, the admin UI `admin/news-portal/homepage-sections.astro`,
and the public wiring in `src/pages/news/index.ts` (page 1 only).

### Reconciliation — six `sectionType`s implemented, FOUR from the issue's "such as" list NOT

The body of issue #637 suggests ten section types
(`headline, latest_posts, featured_posts, editor_picks, category_grid,
video_block, gallery_block, ad_slot, static_page_block, custom_widget_block`)
as examples ("such as"), NOT as mandatory acceptance criteria in the form of
a closed list. Implemented: `headline`, `latest_posts`, `featured_posts`,
`editor_picks`, `category_grid`, `gallery_block` — six types that can ALL
satisfy the acceptance criterion "every image a section renders must come
from a verified R2 media object" using infrastructure that ALREADY EXISTS
(a post's `featured_media_id`, R2-gated since #636; the #633 media
registry). The following four types are **deliberately not implemented in
this issue**, as documented in migration 044's header comment:

- **`video_block`** — needs Issue #639 (the `video_news` content block with
  a mandatory R2 thumbnail), which does NOT exist yet. Building it now
  means "building ahead before the dependency is ready" — the mistake
  pattern this epic has repeatedly been warned to avoid (see §635's note
  about orphan detection).
- **`ad_slot`** — needs Issue #638 (the R2-only ad placement preset), which
  does NOT exist yet. `awcms_blog_ads`'s `image_url` is TODAY still a free
  URL (see the `blog-content` README §Ads) — rendering ads through the
  homepage composer now would VIOLATE this issue's own acceptance criteria
  ("all section images must be verified R2").
- **`custom_widget_block`** — **explicitly out of scope** per the issue's
  own body ("Arbitrary HTML widgets" is in §Out of scope).
- **`static_page_block`** — considered and then dropped: there is NO public
  route rendering `awcms_blog_pages` at all in this repo today (only the
  admin-side `blog-page-directory.ts`) — building a new public page-detail
  route is not a side effect of the homepage composer issue, it is a
  separate decision.

The #638/#639 implementors who eventually build the dependencies above
**must** add the new `sectionType` to the whitelist
(`homepage-section-policy.ts`, its migration `CHECK` constraint, the
OpenAPI enum) — not change the existing types.

### Reference validation — NOT GATED on R2-only mode, unlike #636

`homepage-section-reference-validation.ts` validates EVERY reference
(`postId`/`postIds`/`categorySlugs`/`mediaObjectIds`) EVERY TIME, WITHOUT
the `isNewsPortalFullOnlineR2ModeActiveForTenant` gate that #636 uses.
This is NOT an oversight — the `awcms_news_portal_homepage_sections` table
is a NEW table with ZERO pre-existing rows; there is no "old shape" to keep
compatible (unlike #636's `featuredMediaId`/gallery `content_json`, which
had already been used by millions of posts before R2-only mode existed).
Follow-on implementors MUST NOT add a mode gate here without a new reason —
it is deliberately unconditional by design.

### `sectionType` is immutable after creation

`validateUpdateHomepageSectionInput(body, currentSectionType)` takes
`currentSectionType` from the EXISTING row (fetched by the caller first) —
`config` on an update request is ALWAYS validated against the CURRENT type,
NOT against a new type the client might request. A request that tries to
change `sectionType` is rejected with `400`. The reason: allowing a type
change means the old `config_json` shape (say `headline`'s `postId`)
becomes unvalidated garbage for the new type (say `gallery_block`, which
needs `mediaObjectIds`) — it is simpler and safer to require
delete+recreate than to build an in-place config shape migration.

### Reorder — there is NO separate bulk-reorder endpoint

This repo has NO precedent for a "PATCH array of ids in order" or dedicated
"reorder" endpoint anywhere (`grep -rn "reorder"` returned no relevant
results before this issue) — the existing convention
(`widget-directory.ts`'s `updateWidget`) treats `sort_order` as a field
PATCHed one row at a time like any other field. This issue follows that
pattern EXACTLY: an admin "reorders" by PATCHing each section's `sortOrder`
one by one through the existing edit form — NO new endpoint was added for
it.

### Files created/changed (quick reference)

- `sql/044_awcms_news_portal_homepage_sections_schema.sql` (new).
- `src/modules/news-portal/domain/homepage-section-policy.ts`,
  `domain/homepage-section-rendering.ts`,
  `application/homepage-section-directory.ts`,
  `application/homepage-section-reference-validation.ts`,
  `application/homepage-section-composer.ts` (all new).
- `src/modules/blog-content/application/public-blog-directory.ts`: added
  `featuredMediaId` to `PublicBlogPostSummary`/`toSummary` (previously
  only on `PublicBlogPostDetail`, #636) + a new
  `fetchPublicBlogPostSummariesByIds` (which preserves the caller's
  requested order for curated content, NOT `published_at DESC`).
- `src/pages/api/v1/news-portal/homepage-sections/index.ts` (create/list),
  `.../[id].ts` (update/delete) — new.
- `src/pages/admin/news-portal/homepage-sections.astro` — new, the same
  pattern as `admin/blog/ads.astro` (a JSON textarea for `config`,
  loading/empty/error/ready states via `StateNotice`).
- `src/pages/news/index.ts`: calls `composeHomepageSectionsHtml` above the
  plain post list, ONLY when `page === 1` — a tenant with no sections (the
  majority today) sees a page byte-identical to before this issue.
- Updated: `src/modules/news-portal/module.ts` (the permissions
  `homepage_sections.{read,configure}`, `navigation` newly declared —
  this module's first admin screen, version 0.2.0→0.3.0),
  `src/lib/i18n/error-messages.ts` (`HOMEPAGE_SECTION_REFERENCE_INVALID`/
  `HOMEPAGE_SECTION_KEY_CONFLICT`), `i18n/en.po`/`i18n/id.po`.
- `openapi/awcms-public-api.openapi.yaml`: a new "News Portal Homepage
  Sections" tag, three paths, four new schemas.
- Tests: `tests/unit/homepage-section-policy.test.ts`,
  `tests/unit/homepage-section-rendering.test.ts`,
  `tests/integration/news-portal-homepage-sections.integration.test.ts`
  (new — CRUD, per-type reference validation, cross-tenant 404 (RLS, not
  403), ABAC 403 without the permission, public rendering
  enabled/disabled/degrade-on-unpublish/gallery); updated:
  `tests/unit/news-media-permissions.test.ts`,
  `tests/modules/news-portal-module.test.ts` (both filtered by
  `activityCode` so that the old `media` permission count is not mixed up
  with the new `homepage_sections` ones),
  `tests/foundation.test.ts` (migration list 044).
- Changeset: `.changeset/news-portal-homepage-sections-issue-637.md`.

## §639 — The `video_news` content block with a mandatory R2 thumbnail (Done)

Full implementation: the new domain file
`blog-content/domain/video-news-block-validation.ts` (a provider allowlist +
videoId normalisation, UNCONDITIONAL — not gated on R2-only mode), the new
application file
`blog-content/application/video-news-thumbnail-reference-gate.ts` (verifies
`thumbnailMediaObjectId`, mode-gated — EXACTLY the same pattern as
`news-media-reference-gate.ts` #636), the new renderer
`_shared/rendering/video-news-block-renderer.ts` (a safe
`youtube-nocookie.com` iframe). **No new migration** — the
`owner_resource_type` enum (migration 041, #633) has contained
`'video_thumbnail'` from the start, and a video thumbnail is never
`attach`ed (exactly the #636 gallery image pattern — only verified as
`verified`/`attached`, never writing `owner_resource_type`/
`owner_resource_id`).

### Key design decision — TWO validation layers, only ONE of them mode-gated

Unlike #636 (where everything is mode-gated), this issue separates two
classes of control:

1. **UNCONDITIONAL (always applies, regardless of whether R2-only mode is
   active)** — the `provider` allowlist (only `"youtube"` today) and
   `videoId` validation/normalisation (from a raw 11-character id OR a
   common YouTube URL: `watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`, all
   normalised to the canonical id before storage). Reason: the issue body
   itself frames this as an embed security control ("treat video embeds as
   high-risk content"), not as an R2 storage policy — so it applies to ALL
   tenants, not only those that activated the `news_portal_full_online_r2`
   preset. Run inside `validateAndNormalizeContentJsonVideoBlocks` (pure, no
   DB access), called by the route handler BEFORE `withTenant` (it needs no
   transaction).
2. **MODE-GATED (only when `isFullOnlineR2ModeActiveForTenant` is true)** —
   `thumbnailMediaObjectId` (optional — the issue body explicitly says
   "tenant policy may optionally allow provider default thumbnail") must
   point at an existing/verified-or-attached/same-tenant R2 registry
   object, EXACTLY the `featuredMediaId`/gallery `mediaObjectId` pattern
   (#636). Outside that mode, this field's format is NOT even validated at
   all (deliberately mirroring the treatment of gallery `mediaObjectId`,
   whose shape is likewise never checked outside the active mode) — any
   value that does not resolve simply never gets rendered, and is never
   treated as an error.

"Raw iframe HTML/script must be rejected" (this issue's Rules) was
DELIBERATELY NOT implemented as a new regex specific to this block — the
existing protection (`content-validation.ts`'s `containsUnsafeHtml`, Issue
#538, unconditional, scanning the ENTIRE `JSON.stringify`d `contentJson`)
ALREADY covers this for any block type including `video_news`. The
genuinely new second layer:
`validateAndNormalizeContentJsonVideoBlocks` REBUILDS every `video_news`
block ONLY from known fields (`provider`/normalised `videoId`/`title`/
`caption`/`thumbnailMediaObjectId`/`durationSeconds`/`sourceLabel`) — any
foreign field (e.g. `rawEmbedHtml`) is automatically dropped on save,
not merely blocked by a regex.

### Why TWO separate files for the thumbnail reference, instead of extending `news-media-reference-gate.ts` (#636) directly

The parallel issue #640 (content quality checklist) was running at the same
time and touches the same content-block validation/rendering surface. To
minimise merge conflict risk, this issue's extensions were made AS ADDITIVE
as possible:

- `content-block-media-references.ts` (#636): ONLY adds the new function
  `collectVideoNewsThumbnailReferences` + its new types — the existing
  `collectGalleryImageReferences` function is NOT touched at all.
- `content-block-rendering.ts` (#636): ONLY adds a new import, one new
  union member (`video_news`), one new `case` in `renderBlock`'s `switch`,
  and one new re-export function
  (`collectRenderableVideoNewsThumbnailMediaObjectIds`) — the
  `renderContentJsonToHtml`/`renderBlock` signatures did NOT change at all
  (a video thumbnail uses the SAME `resolvedMediaUrls` map as the gallery,
  because both share the same media registry id space — no second parameter
  is needed).
- `news-media-reference-gate.ts` (#636) was DELIBERATELY NOT TOUCHED AT ALL
  — a new sibling file `video-news-thumbnail-reference-gate.ts` was created
  with the function
  `validateVideoNewsThumbnailReferencesForFullOnlineR2Mode`, whose pattern
  is identical but which lives independently. The route handler calls BOTH
  gates in sequence (gallery/featured first, then video thumbnail) — a
  little extra boilerplate in the route handler, but zero conflict risk on
  the #636 function that already survived three review rounds.

### Renderer — a `youtube-nocookie.com` iframe, CSP `frame-src` widened

`_shared/rendering/video-news-block-renderer.ts` (the same pattern as
`gallery-block-renderer.ts`, Issue #681 — neutral ground, importing from
neither `blog_content` nor `news_portal`) builds `<iframe src="https://
www.youtube-nocookie.com/embed/{videoId}">` ONLY from the validated
`provider`+`videoId` — NEVER from any raw HTML field (no such field exists
in this block's schema at all). `astro.config.mjs`'s CSP `frame-src` was
widened to add this origin (the same pattern as the Cloudflare Turnstile
addition, Issue #588) — without it the browser would BLOCK that iframe even
though the markup is already safe. A custom thumbnail (when it resolves) is
rendered as a separate `<img class="video-news-thumbnail">` BEFORE the
iframe; `sourceLabel`/`caption` are rendered as escaped text afterwards.

### Files created/changed (quick reference)

- `src/modules/blog-content/domain/video-news-block-validation.ts` (new).
- `src/modules/blog-content/application/video-news-thumbnail-reference-gate.ts`
  (new).
- `src/modules/_shared/rendering/video-news-block-renderer.ts` (new).
- `src/modules/blog-content/domain/content-block-media-references.ts`:
  added `collectVideoNewsThumbnailReferences` (additive).
- `src/modules/blog-content/domain/content-block-rendering.ts`: added the
  `video_news` union member, a new `case` in `renderBlock`, and the
  function `collectRenderableVideoNewsThumbnailMediaObjectIds` (additive).
- `astro.config.mjs`: `frame-src` gains `https://www.youtube-nocookie.com`.
- `src/pages/api/v1/blog/posts/index.ts`, `[id].ts`,
  `src/pages/api/v1/blog/pages/index.ts`, `[id].ts`,
  `src/pages/api/v1/blog/posts/[id]/revisions/[revisionId]/restore.ts`:
  call `validateAndNormalizeContentJsonVideoBlocks` (unconditional,
  400 VALIDATION_ERROR) AND
  `validateVideoNewsThumbnailReferencesForFullOnlineR2Mode` (mode-gated,
  422 NEWS_MEDIA_REFERENCE_INVALID, reusing the same error code as #636).
- `src/pages/news/[slug].ts`, `src/pages/blog/[tenantCode]/[slug].ts`:
  merge the video thumbnail ids into the same bulk `resolveMediaReferences`
  as featured+gallery.
- `i18n/en.po`/`i18n/id.po`:
  `admin.blog.posts.content_json_hint` updated to mention `video_news`.
- `openapi/awcms-public-api.openapi.yaml`: the `contentJson` descriptions
  (six locations) and the 422 responses (five locations) were updated to
  mention `video_news`/thumbnail — the schema shape did NOT change
  (`contentJson` remains a generic `type: object`).
- Tests: `tests/unit/video-news-block-validation.test.ts`,
  `tests/unit/video-news-thumbnail-reference-gate.test.ts` (new); updated:
  `tests/unit/content-block-media-references.test.ts` (a new describe
  block for `collectVideoNewsThumbnailReferences`),
  `tests/blog-content-public-rendering.test.ts` (a new describe block for
  `video_news` rendering +
  `collectRenderableVideoNewsThumbnailMediaObjectIds`); new:
  `tests/integration/blog-content-video-news-block.integration.test.ts`
  (a SEPARATE file from #636's
  `blog-content-news-media-r2-references.integration.test.ts` —
  end-to-end: videoId normalisation from a URL, provider rejected, invalid
  videoId rejected, raw iframe/script rejected, foreign fields stripped,
  cross-tenant/unsafe-status thumbnail rejected, public rendering of
  iframe+thumbnail).
- Changeset: `.changeset/news-portal-video-news-block-issue-639.md`.

### Not done / out of scope for this issue (for follow-on issues)

- **Providers other than YouTube** (Vimeo, etc.) — `VIDEO_NEWS_PROVIDERS`
  is deliberately only `["youtube"]` (issue body: "Initial provider
  allowlist: youtube"). Adding another provider needs a new per-provider id
  normalisation function in `video-news-block-validation.ts` AND a new CSP
  `frame-src` entry in `astro.config.mjs`.
- **An explicit tenant policy toggle** for "allow the provider's default
  thumbnail vs require a custom R2 one" — the issue body mentions this as
  an option ("Tenant policy may optionally allow provider default
  thumbnail"), and it was NOT implemented as a real setting (the thumbnail
  is already structurally optional — there is no separate "require a custom
  thumbnail" mechanism). A follow-on issue that needs that mode may add a
  new `module_settings` field, following the existing pattern.
- **The `video_block` homepage section** (`homepage-section-policy.ts`'s
  whitelist, #637's note) — the dependency (this `video_news` block) NOW
  exists, but wiring up that new `sectionType` is still a separate issue's
  scope, not claimed here.
- **A visual admin UI picker** for choosing the video/thumbnail — as with
  #636/#637, the admin still types the `contentJson` JSON by hand (in the
  existing textarea); only its hint text was updated.

## §681 — Capability ports replace direct imports into `blog_content` (epic #679, NOT this epic — Done)

**This issue is not part of the `news_portal` epic (#631-#642/#649)** — it
comes from the separate epic `#679` (platform-hardening, static repo
audit), but it changes enough of this module's core files that it is
documented here too (see `[[platform-hardening-epic-progress]]` in memory
if you need the full #679 epic context).

### The problem — a real source-level cycle, not just in `dependencies`

§636 and §637 above each explicitly write that "a cross-module TypeScript
import is NOT the `dependencies` array, which only governs enable/disable
ordering" — true for the lifecycle CONSEQUENCE, but the end result was
still a real cycle at the SOURCE CODE import level:
`blog-content/application/news-media-reference-gate.ts` imports
`news-portal/application/news-media-object-directory.ts` (§636), while
`news-portal/application/homepage-section-composer.ts` imports
`blog-content/application/public-blog-directory.ts` AND
`blog-content/application/news-media-reference-gate.ts` (§637) — which, as
just said, imports `news-portal` BACK. A three-hop chain entirely invisible
from any `module.ts`'s `dependencies`.
`news-portal/domain/homepage-section-rendering.ts` also imports
`blog-content/domain/content-block-rendering.ts` directly (reusing the
gallery renderer).

### The solution — minimal ports-and-adapters, composition root = the route handler

The full reasoning/alternatives are in **ADR-0011**
(`docs/adr/0011-capability-ports-for-cross-module-collaboration.md`) —
summary:

- **Port** (a pure interface, importing NO module):
  `src/modules/_shared/ports/news-media-port.ts` (`NewsMediaPort` — a
  `news_portal` capability, used by `blog_content`) and `.../public-
content-port.ts` (`PublicContentPort` — a `blog_content` capability, used
  by `news_portal`). The port DTOs are DELIBERATELY their own shape, not a
  re-export of the owning module's types.
- **Adapter** (the concrete implementation, living in the module that OWNS
  the capability): `news-portal/application/news-media-port-adapter.ts`
  (which folds in the `isNewsPortalFullOnlineR2ModeActiveForTenant`
  function that used to live in
  `blog-content/application/news-portal-r2-mode-gate.ts` — **that file was
  DELETED**, and the whole "THREE failed attempts" history from §636 above
  was moved verbatim into this adapter's header comment; DO NOT lose it by
  re-reading §636 without also checking this adapter) and
  `blog-content/application/public-content-port-adapter.ts`.
- **Composition root** = the route handler (`src/pages/api/v1/**`,
  `src/pages/news/**`, `src/pages/blog/**`) — ALREADY the layer that is
  allowed to import across modules (an old convention, not a new one), so
  no new DI infrastructure is needed. Every route handler that needs a
  cross-module capability imports the concrete adapter and injects it as an
  ordinary function parameter (NOT a default parameter — every caller MUST
  inject explicitly, so there is no "forgot to inject, so it silently went
  back to a direct import" path).
- `renderContentJsonToHtml`'s gallery rendering (used by BOTH modules)
  moved to `src/modules/_shared/rendering/gallery-block-renderer.ts` —
  neutral ground, rather than one module "borrowing" from the other.
  `content-block-rendering.ts` (blog-content) and
  `homepage-section-rendering.ts` (news-portal) BOTH call this shared
  function now.
- `_shared/module-contract.ts`'s `ModuleDescriptor` gains a new optional
  field, `capabilities?: {provides, consumes}` — structured documentation
  of these port relationships, SEPARATE from `dependencies` (which stays
  purely about enable/disable ordering; the #632 decision still holds and
  was NOT changed by this issue).
- A new structural test, `tests/unit/module-boundary.test.ts` — scans
  `blog-content`/`news-portal`'s `application`/`domain` trees for direct
  imports into another module's tree (regex `from ["'].../(?:application|domain)/...["']`,
  which does not false-positive on comment prose that backtick-quotes a
  path rather than using `from "..."` syntax). It fails loudly if any PR
  brings the old pattern back.

### Functions whose signature changed — MUST read before touching them again

Each of the following functions now takes a port as an extra parameter (it
no longer imports the other module itself):

- `blog-content/application/news-media-reference-gate.ts`'s
  `validateNewsMediaReferencesForFullOnlineR2Mode(tx, tenantId, input,
mediaPort: NewsMediaPort, env?)` — the new `mediaPort` parameter comes
  before `env`. `resolveVerifiedNewsMediaReferences` (the render-time
  function that used to live in this file) was **DELETED ENTIRELY** —
  every caller (`blog_content`'s own public routes, `news_portal`'s
  homepage composer) now calls `NewsMediaPort.resolveMediaReferences`
  DIRECTLY (the `newsMediaPortAdapter` from `news-portal`), because that is
  purely the port's own capability and there is nothing left for this file
  to add on top of it.
- `news-portal/application/homepage-section-reference-validation.ts`'s
  `validateHomepageSectionReferences(tx, tenantId, sectionType, config,
contentPort: PublicContentPort)` — the new `contentPort` parameter comes
  last. `mediaObjectIds` (`gallery_block`) did NOT change — that is this
  module's OWN `news-media-object-directory.ts`, not cross-module.
- `news-portal/application/homepage-section-composer.ts`'s
  `composeHomepageSectionsHtml(tx, tenantId, basePath, contentPort:
PublicContentPort, mediaPort: NewsMediaPort, now?)` — TWO new port
  parameters before `now`.

Every calling route handler (5 in `blog_content` for the #636 gate, 3 in
`news_portal` for the #637 composer/reference-validation, plus the two
public post-detail routes) was updated to import the relevant concrete
adapter and inject it — see the Issue #681 diff/related PR for the full
file list if you need the exact call sites.

### Files created/changed/deleted (quick reference)

- **New**: `src/modules/_shared/ports/news-media-port.ts`,
  `_shared/ports/public-content-port.ts`,
  `_shared/rendering/gallery-block-renderer.ts`,
  `news-portal/application/news-media-port-adapter.ts`,
  `blog-content/application/public-content-port-adapter.ts`,
  `tests/unit/module-boundary.test.ts`,
  `docs/adr/0011-capability-ports-for-cross-module-collaboration.md`.
- **Deleted**: `blog-content/application/news-portal-r2-mode-gate.ts`
  (the logic moved to `news-media-port-adapter.ts`, and §636's "three
  failed attempts" history moved verbatim).
- **Changed**: `blog-content/application/news-media-reference-gate.ts`
  (takes `mediaPort`, `resolveVerifiedNewsMediaReferences` removed),
  `blog-content/domain/content-block-rendering.ts` (delegates gallery to
  the shared renderer), `news-portal/application/homepage-section-composer.ts`,
  `news-portal/application/homepage-section-reference-validation.ts`,
  `news-portal/domain/homepage-section-rendering.ts` (all take a
  port/use the shared renderer), `_shared/module-contract.ts`
  (the new `capabilities` field), `blog-content/module.ts`,
  `news-portal/module.ts` (declaring `capabilities.provides/consumes`),
  10 route handlers (5 blog_content create/update/restore, 2 public
  detail routes, 3 news_portal homepage-sections//`/news` index) — adapter
  wiring at the composition root.

## §638 — R2-only advertisement placement presets (Done)

Full implementation: migration
`sql/049_awcms_news_portal_ad_placements_schema.sql` (the NEW table
`awcms_news_portal_ad_placements`, RLS ENABLE+FORCE), domain
`news-portal/domain/ad-placement-policy.ts` (a whitelist of the twelve
`placementKey`s exactly as in the issue body + the static preset metadata
`AD_PLACEMENT_PRESETS` + create/update validators) and
`domain/ad-placement-rotation.ts` (`selectAdsForRotation`, pure, four
rotation modes), application `application/ad-placement-directory.ts`
(tenant-scoped CRUD + the public render query + a whitelist renderer) and
`application/ad-placement-reference-validation.ts` (verifying
`mediaObjectId`), the admin endpoints
`POST/GET /api/v1/news-portal/ad-placements`, `PATCH/DELETE .../{id}`, and
the admin UI `admin/news-portal/ad-placements.astro`.

### Reconciliation — a NEW table in `news_portal`, NOT an extension of `awcms_blog_ads`

The body of issue #638 writes "blog_content already includes advertisement
capabilities" as if this issue extended `awcms_blog_ads`/
`awcms_blog_ad_placements` (`blog_content`, migration 029, Issue #542),
whose `image_url` is TODAY still a free http(s) URL. NOT followed — for
exactly the reason migration 044 (#637) already documented for the same
dilemma: adding R2-only validation to that generic table would break
non-full-online-R2 tenants that legitimately use `awcms_blog_ads` with
ordinary external image URLs. Instead: a NEW and NARROW table,
`awcms_news_portal_ad_placements`, owned by the `news_portal` module (not
`blog_content`) — the identical pattern to
`awcms_news_portal_homepage_sections` (#637): "a new table, zero
pre-existing rows, no runtime R2-only mode gate needed" (see §637's
"Reference validation — NOT GATED..." above; the SAME reasoning applies
here). R2-only-ness holds BY CONSTRUCTION: the `media_object_id` column is
a real FK to `awcms_news_media_objects`, and there is NO free-text
`image_url` column on this table at all — unlike `awcms_blog_ads`, which is
kept EXACTLY as before (untouched by this issue) for tenants that do not
use the full-online-R2 preset.

Because this table lives INSIDE the `news_portal` module itself (not across
modules like #636's `blog_content`↔`news_portal` gate), the `mediaObjectId`
validation (`ad-placement-reference-validation.ts`) calls
`fetchNewsMediaObjectById`/`isNewsMediaObjectSafeForPublicReference`
(`news-media-object-directory.ts`, #633) DIRECTLY — it does NOT need
`_shared/ports/news-media-port.ts` (the #681 port) at all, just like
`homepage-section-reference-validation.ts`'s `mediaObjectIds`
(`gallery_block`) check. This is EXACTLY the "verified-media-reference
validation" pattern the orchestrator prompt asked to be reused from
`content-block-media-references.ts`/`news-media-reference-gate.ts` (#636)
— the only difference is which layer performs the existence+status check
(here: `news_portal`'s own application layer, not `blog_content`'s
cross-module gate), not the validation pattern itself (the same
`isNewsMediaObjectSafeForPublicReference` predicate, called with the same
arguments).

### `placementKey` is NOT immutable — an explicit contrast with #637's `sectionType`

`homepage-section-policy.ts`'s `sectionType` is immutable after creation
because `config_json` has a DIFFERENT SHAPE per type (changing the type
makes the old config unvalidated garbage for the new type). This ad
placement table does NOT have that problem — EVERY `placementKey` shares
EXACTLY THE SAME ROW SHAPE (`mediaObjectId` + `linkUrl` + schedule +
rotation knobs), so letting an admin move an existing ad to a different
`placementKey` via PATCH creates no data-shape hazard at all —
`validateUpdateAdPlacementInput` accepts `placementKey` as an ordinary
changeable field, and the PATCH endpoint re-validates `mediaObjectId`
(existing or new) against the TARGET placement's `allowedMediaTypes` (new
or old) whenever either of the two changes.

### `recommended_size`/`allowed_media_types`/`max_items` — static preset metadata in code, NOT table columns

Following the `homepage-section-policy.ts` `HomepageSectionType` whitelist
pattern (the per-type config shape lives in code, the DB only
`CHECK`-constrains its key): `AD_PLACEMENT_PRESETS`
(`ad-placement-policy.ts`) is a static `Record` mapping each
`placementKey` to `{recommendedSize, allowedMediaTypes, maxItems}` — not
columns in `awcms_news_portal_ad_placements`. The per-field design
decisions (binding on follow-on implementors who touch this whitelist):

- **`recommendedSize`** — ADVISORY UI only (displayed to the admin, not
  enforced against the actually-verified media's `width`/`height`).
  Enforcing an exact/near pixel match risks rejecting a legitimate image
  that has simply been cropped differently, and the issue's acceptance
  criteria did not ask for it.
- **`allowedMediaTypes`** — ALL twelve presets today share the SAME default
  set (the four raster types already validated by the R2 upload pipeline —
  SVG remains forbidden, Key decision #5), so
  `validateAdPlacementMediaReference`'s per-placement mime check is
  CURRENTLY redundant with the upload pipeline's guarantee — it is still
  implemented as real, tested defence-in-depth so that a FUTURE placement
  can narrow its allow-list (e.g. forbidding animated GIFs in a narrow
  banner slot) without a new migration or a new validation mechanism.
- **`maxItems`** — enforced ONLY as a RENDER-TIME selection limit
  (`selectAdsForRotation` truncates the result to `maxItems`), NOT as a
  write-time limit on how many rows an admin may configure for one
  `placementKey`. An admin may configure more ad candidates than
  `maxItems` (e.g. ten `header_banner` ads scheduled over different date
  ranges); rotation picks the subset shown at read time.

### The four rotation modes — a pure function with an injectable `randomFn` for tests

`ad-placement-rotation.ts`'s `selectAdsForRotation(candidates, rotationMode,
maxItems, randomFn = Math.random)` — NO I/O or `Bun.SQL`, the same
"pure selection, existence/safety decided by the application" separation
that `homepage-section-rendering.ts` uses. `latest` (ordered by
`createdAt DESC`), `priority` (ordered by `priority DESC`, tie-broken by
`createdAt DESC`, deterministic — unlike `weighted`), `random_safe` (a
Fisher-Yates shuffle, every permutation equally likely), `weighted`
(sampling without replacement, weight = `priority + 1` — DELIBERATELY `+1`,
not bare `priority`, so that a `priority: 0` row still has a chance of
being picked and is never permanently locked out when a higher-priority row
exists). The injectable `randomFn` is NOT a security measure (this purely
decides display order/subset among ads that are ALREADY authorised to be
shown, it is not access control) — the `Math.random` default is
appropriate, `crypto.getRandomValues` is not needed.

### Safe link URL — the predicate is duplicated, NOT imported from `blog_content`

`isSafeAdLinkUrl` (`ad-placement-policy.ts`) applies the EXACT same
absolute http(s) rule as `blog-content/domain/seo-validation.ts`'s
`isAbsoluteHttpUrl`/`ad-policy.ts` — DELIBERATELY duplicated as a two-line
literal rather than imported: `tests/unit/module-boundary.test.ts` (#681)
forbids `news_portal`'s `domain`/`application` files from importing any of
`blog_content`'s `domain`/`application` tree. A pure predicate this small
is cheaper to keep in sync by eye than to pass through a new cross-module
port.

### No R2-only mode gate needed — R2-only holds by construction

Unlike `blog_content`'s Issue #636 gate
(`isNewsPortalFullOnlineR2ModeActiveForTenant`, via `NewsMediaPort`), the
validation here is entirely UNCONDITIONAL — there is no "is the
full-online-R2 preset active for this tenant" check. The reason is the SAME
as §637's homepage sections: a new table, zero legacy rows, so there is no
backward-compatibility concern forcing old behaviour to keep working for
tenants that have not activated the R2-only preset.

### `ad_slot` homepage-section integration — STILL out of scope for this issue

§637's note writes "once #638 is done, `homepage-section-policy.ts`'s
whitelist MUST be widened with `ad_slot`" — but the body of GitHub issue
#638 itself does NOT mention the homepage composer/`ad_slot` at all (its
scope is purely ad placement presets + R2-only image validation). Adding
`ad_slot` to `homepage-section-policy.ts`/migration 044's `CHECK`
constraint now would widen this issue's scope into another system (the #637
composer) with no acceptance criteria asking for it — DEFERRED as separate
follow-on work (no issue has claimed it yet). The implementor who
eventually does that integration has everything they need ready:
`ad-placement-directory.ts`'s
`selectAndRenderActiveAdsForPlacement(tx, tenantId, placementKey, now?)`
returns an array of render-ready HTML strings per placement, which only
needs to be called from `homepage-section-composer.ts` for a `sectionType:
"ad_slot"` whose config carries a `placementKey`.

### Residual risk — a real `media_object_id` FK vs. a future `purgeNewsMediaObject`

Unlike the polymorphic `owner_resource_id` (§633, deliberately without an
FK), `media_object_id` on this table is a real FK to
`awcms_news_media_objects` — a legitimate choice because this table lives
INSIDE the same module as the registry. The consequence is documented in
migration 049's header: `purgeNewsMediaObject` (a hard DELETE, present
since #633, BUT with no route calling it to this day — verified,
`src/pages/api/v1/media/news-images/` only contains upload session
create/finalize/cancel) will fail with a raw Postgres FK violation, not a
tidy application 409/422, if called against a media object still
referenced by a row in this table. Latent, not an active bug (no API path
can trigger it today) — the implementor of the issue that eventually adds a
real purge endpoint MUST handle this constraint (catch the error or
pre-check references) before shipping that endpoint.

### Public rendering — the query + renderer are tested, but not wired to any route

`listActiveAdPlacementsForRendering`/`renderAdPlacementHtml`/
`selectAndRenderActiveAdsForPlacement` (`ad-placement-directory.ts`) are
complete and tested end-to-end (see §Tests below) — they are NOT wired to
`/news` or any public route in this issue, exactly the "tested public-safe
helper, wiring is a later issue's job" precedent that
`ads-directory.ts`'s `listActiveAdsForPlacement`/`renderAdHtml` (#542) set
earlier, and that §637 explicitly deferred for `ad_slot`. The render
whitelist is `<img>`/`<a rel="sponsored noopener noreferrer">` — there is no
embed/iframe/raw-HTML field anywhere in this table's schema, so the
rendering CANNOT become an XSS channel no matter what the request contains
(the same argument `ads-directory.ts`'s `renderAdHtml` §542 uses).

### Files created/changed (quick reference)

- `sql/049_awcms_news_portal_ad_placements_schema.sql` (new).
- `src/modules/news-portal/domain/ad-placement-policy.ts`,
  `domain/ad-placement-rotation.ts` (both new).
- `src/modules/news-portal/application/ad-placement-directory.ts`,
  `application/ad-placement-reference-validation.ts` (both new).
- `src/pages/api/v1/news-portal/ad-placements/index.ts` (create/list),
  `.../[id].ts` (update/delete) — new.
- `src/pages/admin/news-portal/ad-placements.astro` — new, the same pattern
  as `admin/news-portal/homepage-sections.astro` (flat form fields, no JSON
  textarea — every field here is a scalar, not a variably-shaped
  `config_json`).
- Updated: `src/modules/news-portal/module.ts` (the permissions
  `ad_placements.{read,configure}`, a second navigation entry, version
  0.3.0→0.4.0), `src/lib/i18n/error-messages.ts`
  (`AD_PLACEMENT_REFERENCE_INVALID`), `i18n/en.po`/`i18n/id.po`.
- `openapi/modules/news-portal-ad-placements.openapi.yaml` (a new fragment
  — see `openapi/README.md` for the split-source flow; DO NOT edit
  `openapi/awcms-public-api.openapi.yaml` directly, that file is
  GENERATED by `bun run openapi:bundle`), a new tag in
  `awcms-public-api.src.yaml`.
- Tests: `tests/unit/ad-placement-policy.test.ts`,
  `tests/unit/ad-placement-rotation.test.ts`,
  `tests/integration/news-portal-ad-placements.integration.test.ts`
  (CRUD, validation of a missing/unverified/cross-tenant mediaObjectId,
  an unsafe linkUrl, cross-tenant RLS 404, ABAC 403 without the
  permission, public rendering emitting only registry public URLs, ads
  that are inactive/future/expired/on another placement excluded, media
  soft-deleted after the placement was created excluded, rotation
  truncating to `maxItems`); updated: `tests/foundation.test.ts`
  (migration list 049), `tests/modules/news-portal-module.test.ts` (two
  navigation entries, the new `ad_placements` permission pair).
- Changeset: `.changeset/news-portal-ad-placements-issue-638.md`.

### Not done / out of scope for this issue (for follow-on issues)

- **`ad_slot` integration into the homepage composer** (#637) — see the
  subsection above. It requires adding `ad_slot` to
  `HOMEPAGE_SECTION_TYPES`/migration 044's `CHECK` constraint AND calling
  `selectAndRenderActiveAdsForPlacement` from
  `homepage-section-composer.ts`.
- **Wiring public rendering into `/news`/article pages** — the
  query+renderer exist and are tested, but are not wired to any public
  route (the same `awcms_blog_ads` §542 precedent).
- **A visual media picker UI** — the admin still types the `mediaObjectId`
  UUID by hand, the same gap noted in `awcms-blog-content`/§636/§637.
- **Click fraud detection** — explicitly out of scope per the issue body.

## §649 — Complete SEO + social preview metadata for `/news/{slug}` (Done)

Full implementation: one new `seo_image_media_id` column on
`awcms_blog_posts` (migration 050), a new pure image priority resolution
function (`blog-content/domain/social-preview-image-resolution.ts`),
`NewsArticle` JSON-LD (`blog-content/domain/structured-data-rendering.ts`),
an extension of `public-page-rendering.ts` (og:type/og:image:type/width/height/
secure_url/twitter:image:alt/article:*/robots/the JSON-LD script), a new
application orchestration shared by BOTH detail routes
(`blog-content/application/news-article-seo-metadata.ts`), two new checklist
rules (`social_preview_image_ready`/`social_preview_image_alt_text`), and
two new tenant-level fields in `awcms_blog_settings.settings`
(`socialPreviewFallbackImageMediaId`/`socialPreviewContentImageFallbackEnabled`).

### Image source priority — reuse #636's bulk resolution pattern, do NOT re-derive

The order (issue body "Image source order"): (1) `seoImageMediaId` (the
post's explicit override) → (2) `featuredMediaId` → (3) the first VERIFIED
image in `contentJson` gallery blocks, in document order, ONLY if the tenant
allows it (`socialPreviewContentImageFallbackEnabled`, default `true`)
→ (4) the tenant-level `socialPreviewFallbackImageMediaId`. The pure function
`resolveSocialPreviewImageSourceId` (domain, no I/O) takes ONE set of
already-"resolved" ids (the result of ONE bulk `NewsMediaPort.resolveMediaReferences`
call that merges featured + SEO image + gallery + video thumbnail +
tenant fallback ids — the same #636 primitive, never querying the registry
a second time) and returns the first winning id that IS in that set —
a higher-priority candidate that is NOT safe (not yet verified/cross-tenant/
non-existent) is skipped, it does not halt the whole chain. `news-article-seo-
metadata.ts`'s `buildNewsArticleSeoMetadata` is the ONLY place this bulk
resolution happens for the render routes (called from BOTH
`/news/[slug].ts` and `/blog/[tenantCode]/[slug].ts`, byte-for-byte
consistent by construction) — `resolveNewsArticlePreviewImage` is the
lighter sibling for RSS/sitemap (no taxonomy fetch/JSON-LD build, because
feed/sitemap do not need it), called once per item
(bounded by `FEED_ITEM_LIMIT` 50).

### Why a new column, NOT a reuse of the `owner_resource_type = 'seo_image'` already in the schema

Migration 041 (`awcms_news_media_objects`) has had the value
`'seo_image'` in the `owner_resource_type` CHECK constraint since Issue #633 —
it looks like an "intended" extension point. NOT used:
`attachNewsMediaObject`/`detachNewsMediaObject` (migration 041's own
application layer) turned out to have ZERO real callers anywhere in the codebase
before this issue (grepped before writing migration 050) — every other consumer
(`featuredMediaId`, gallery `mediaObjectId`) has only ever checked
`isNewsMediaObjectSafeForPublicReference` (`verified` OR `attached`);
nothing transitions a row to `attached`. Making this SEO issue the
FIRST caller of that attach/detach lifecycle (attach/detach ordering on
post update, replace-on-change semantics, concurrent-edit races) is a
far bigger and far less reviewed design decision than
this issue's scope. A plain `seo_image_media_id uuid` column, no FK (exactly
the `featured_media_id` pattern — this module must not depend on the
`news_portal` schema, `tests/unit/module-boundary.test.ts`), verified through
the IDENTICAL existing `featuredMediaId` mechanism
(`news-media-reference-gate.ts`'s `validateNewsMediaReferencesForFullOnlineR2Mode`,
additively widened) — a proven pattern, not a new one.

### robots meta — deterministic from `visibility`, not a new status signal

`resolveRobotsMetaContent(visibility)`: `public` → `index,follow,
max-image-preview:large`; `unlisted`/`private` → `noindex,nofollow`. There is
no tenant override for this directive (the issue body's "unless tenant policy
overrides safely" is a hedge, not a hard requirement) — every public
post gets the same default directive, safe/conservative. Draft/
private/review/archived/soft-deleted/scheduled-future NEVER reach
this function at all — `fetchPublicBlogPostBySlug`'s own predicate
(`status='published' AND visibility IN ('public','unlisted') AND
deleted_at IS NULL AND published_at <= now()`) already 404s them BEFORE
any render happens, so "no metadata is ever rendered" for those states
is a structural property, not an if-branch someone can forget to check.

### JSON-LD `NewsArticle` — author/publisher is ALWAYS an Organization, it never exposes an individual editor's identity

A deliberate design decision: `author`/`publisher` are both
`{"@type": "Organization", "name": tenant.tenantName}` — NEVER an
individual editor's display name (`author_tenant_user_id`). The reason: this repo has
no concept of a "publicly safe author display name" at all
(nothing exposes user identity publicly today on any
route — not even the RSS feed carries an author name), and
adding one as a side effect of this SEO issue would be a
new PII surface unrelated to the scope (see the `awcms-sensitive-data` skill).
`publisher.logo` is best-effort: the tenant's `socialPreviewFallbackImageMediaId`
is used IF it resolves safely, otherwise it is OMITTED entirely (not
fabricated from an unverified source) — this repo has no dedicated
"tenant logo" concept.

### JSON-LD escaping — escape EVERY `<`, not just the literal `</script>` string

`renderJsonLdScriptTag` (`structured-data-rendering.ts`): `JSON.stringify(data)
.replace(/</g, "\\u003c")`. The one risk of putting JSON inside an
HTML `<script>` is NOT a JSON-escaping hole (`JSON.stringify` is correct per
spec) — it is the browser's HTML tokenizer looking for a literal `</script` BEFORE
JS/JSON parsing even starts. Escaping EVERY `<` (not just the exact
`</script>` substring) closes this structurally, the same principle of
"escape a whole character class, not a deny-list of particular strings" that
`escapeHtml` already uses. Note: only `<` is escaped, `>` is left
literal (`</script>`, not `</script>`) — enough to
break the tokenizer's lookup.

### The #640 checklist widened additively — 2 new rules, NOT restructured

`social_preview_image_ready`/`social_preview_image_alt_text` were added to
`ChecklistRuleId`/`OVERRIDABLE_RULE_IDS` (NOT `SECURITY_RULE_IDS` — purely
advisory, never blocking by default, because "no preview image" is
already a valid degradation — `og:image`/`twitter:image` are
simply omitted). The gate (`content-quality-checklist-gate.ts`) computes
`socialPreviewImage` through EXACTLY the same priority chain
(`resolveSocialPreviewImageSourceId`) from the SAME bulk resolve
already used for featured/gallery — the new parameter
`EvaluateContentQualityChecklistOptions.socialPreviewFallback` (optional,
defaulting to no tenant fallback/content-image) is threaded through ALL 5
composition roots (`publish.ts`, `schedule.ts`, the two preview endpoints
`quality-checklist.ts`, `blog-scheduled-publish.ts`'s per-post loop).

### New fields in `awcms_blog_settings.settings` — the #640 pattern, NOT the §636 anti-pattern

`socialPreviewFallbackImageMediaId`/`socialPreviewContentImageFallbackEnabled`
live in the catch-all `settings jsonb` column (just like
`contentQualityChecklistPolicy`) — this is SAFE because both are tenant
BUSINESS preferences, not security signals: the actual R2-only enforcement
still happens 100% in the RENDER-TIME resolution step
(`NewsMediaPort.resolveMediaReferences`, fail-closed for any id that is
not verified/same-tenant), never trusted from these stored
values themselves. `blog-settings-directory.ts`'s `sanitizeSocialPreviewFallbackImageMediaId`
re-enforces the UUID shape on the read side (the same defence-in-depth
as `sanitizeChecklistPolicyOverrides`).

### RSS/sitemap — enclosure/image:image from a verified image, sequential per-item resolution

`feed.xml.ts` (both variants) adds `<enclosure url=... length=... type=...>`
per item; `sitemap-news.xml.ts` (both variants) adds the
`xmlns:image` namespace + `<image:image><image:loc>...` per URL — both from
`resolveNewsArticlePreviewImage` (see above), called in a sequential
LOOP (not `Promise.all`) because every query shares the SAME single
transaction (`tx`) — running concurrent queries on one postgres.js
connection/transaction risks protocol interleaving; that is not a safe pattern
in this repo. `listPublicBlogPostsForFeed` (public-blog-directory.ts)
had its SELECT widened to also fetch `visibility`/`updated_at`/
`featured_media_id`/`seo_image_media_id` — simultaneously fixing a
pre-existing bug found while working this issue: `featured_media_id`
was previously NEVER SELECTed by this function at all, so
`toDetail()`'s `featuredMediaId` for feed results was always `undefined` at
runtime even though the type claimed `string | null` — a silent bug with no
test before this issue (now covered).

### Files created/changed (quick reference)

- **New migration**: `sql/050_awcms_blog_posts_seo_image.sql`
  (`awcms_blog_posts.seo_image_media_id uuid`, no FK/index).
- **New**: `src/modules/blog-content/domain/social-preview-image-resolution.ts`,
  `src/modules/blog-content/domain/structured-data-rendering.ts`,
  `src/modules/blog-content/application/news-article-seo-metadata.ts`.
- **Changed (additively)**: `src/modules/blog-content/domain/seo-rendering.ts`
  (`resolveRobotsMetaContent`, `deriveArticleSectionAndTags`),
  `src/modules/blog-content/domain/public-page-rendering.ts`
  (`PublicPageShellOptions` ogType/ogImage width-height-mime-secure_url/
  article:*/robotsContent/structuredDataJsonLd, all optional),
  `src/modules/blog-content/domain/content-quality-checklist.ts`
  (`social_preview_image_ready`/`social_preview_image_alt_text`),
  `src/modules/blog-content/application/content-quality-checklist-gate.ts`
  (`seoImageMediaId`/`socialPreviewFallback`),
  `src/modules/blog-content/domain/blog-post-validation.ts`,
  `src/modules/blog-content/application/blog-post-directory.ts`,
  `src/modules/blog-content/application/news-media-reference-gate.ts`,
  `src/modules/blog-content/application/public-blog-directory.ts`
  (`visibility`/`updatedAt`/`seoImageMediaId` + a new
  `fetchPublicPostTaxonomyTerms`), `src/modules/blog-content/domain/blog-settings-policy.ts` +
  `application/blog-settings-directory.ts` (the two new fields).
- Routes: `src/pages/news/[slug].ts`, `src/pages/blog/[tenantCode]/[slug].ts`
  (trimmed down to delegate to `buildNewsArticleSeoMetadata`),
  `src/pages/news/feed.xml.ts`/`sitemap-news.xml.ts` +
  `src/pages/blog/[tenantCode]/feed.xml.ts`/`sitemap-blog.xml.ts`
  (enclosure/image:image), the five checklist call sites (publish/schedule/the two
  quality-checklist previews/blog-scheduled-publish).
- Admin UI: `src/pages/admin/blog/posts/[id].astro` (the
  `seoImageMediaId` field), `src/pages/admin/blog/settings.astro` (the fallback
  image field + toggle).
- OpenAPI: `openapi/awcms-public-api.src.yaml` (`BlogPostItem.
seoImageMediaId`, `ContentQualityChecklistRuleOutcome.ruleId` enum +2),
  `openapi/modules/blog-posts.openapi.yaml` (create/update request),
  `openapi/modules/blog-settings.openapi.yaml` (the two new fields + an updated
  checklist policy description) — `bun run openapi:bundle` was run.
- i18n: `i18n/en.po`/`i18n/id.po` (the new post editor + settings fields),
  `i18n/messages.pot` regenerated via `bun run i18n:extract`.
- Tests: `tests/unit/social-preview-image-resolution.test.ts`,
  `tests/unit/structured-data-rendering.test.ts` (new);
  `tests/blog-content-public-rendering.test.ts`,
  `tests/unit/content-quality-checklist.test.ts`,
  `tests/unit/content-quality-checklist-gate.test.ts` (widened additively);
  `tests/integration/news-portal-seo-social-preview-metadata.integration.test.ts`
  (new — OG image dims/mime/secure_url, twitter:image:alt, article:*,
  JSON-LD, end-to-end image priority, robots per visibility, RSS/sitemap
  image, escaping, no local/external leak); `tests/foundation.test.ts`
  (migration list +1).
- Changeset: `.changeset/news-portal-seo-social-preview-metadata-issue-649.md`.

## §642 — Public social share buttons (Done)

Full implementation: a new domain
`src/modules/news-portal/domain/news-share-config.ts` (the `NEWS_SHARE_*`
env resolver, pure),
`src/modules/blog-content/domain/social-share-links.ts` (an allowlisted
per-platform link builder + an HTML widget renderer), the static client script
`public/js/news-share.js` (native share + copy-link, progressive
enhancement), and a widening of
`src/modules/blog-content/domain/public-page-rendering.ts` (og:title/
og:description/og:url/og:site_name + twitter:title/twitter:description/
twitter:card always present). **No new migration** — purely
UI/rendering/config, no new persisted data (the highest migration was
still `047` when this issue was worked; watch for the genuinely
latest number in `sql/` before a follow-on issue adds a migration, because other
issues in the same epic can run in parallel).

### Why the config resolver lives in `news-portal` but the link-builder+renderer in `blog-content`

The `NEWS_SHARE_*` env vars are **owned** by the `news-portal` module (the
CONFIG_REGISTRY convention: prefix `NEWS_` = `ownerModule: "news-portal"`, just
like `NEWS_PORTAL_ENABLED`/`NEWS_MEDIA_R2_*`) — so the env resolver
(`resolveNewsShareConfig`) lives there. But the pure functions that build the
per-platform share URLs + render the HTML widget
(`buildSocialShareLinks`/`renderSocialShareButtonsHtml`) live in
`blog-content` because they operate on purely `blog_content` concepts
(the post's title/excerpt/canonical URL) and are called from the same routes
(`/news/[slug].ts`, `/blog/[tenantCode]/[slug].ts`) that already render
`seo-rendering.ts`/`public-page-rendering.ts` — there is NO functional
dependency on the R2 media registry at all for this feature (unlike
#636). `SocialShareRenderConfig` (in `blog-content`) deliberately has exactly
the same fields as `NewsShareConfig` (in `news-portal`) WITHOUT a
cross-module import — TypeScript structural typing is enough, and the route (the composition
root) calls both directly, the same pre-existing "a route imports from
two modules at once" pattern (`[slug].ts` already imported
`newsMediaPortAdapter` from `news-portal/application/` directly before
this issue).

### Instagram — NO button/URL, only a text note

There is no supported Instagram web-share URL for sharing an arbitrary
external URL (unlike WhatsApp/Telegram/Facebook/LinkedIn/X, which
all have an official share-intent endpoint) — so `STATIC_SHARE_LINK_BUILDERS`
in `social-share-links.ts` NEVER has an Instagram entry.
`NEWS_SHARE_INSTAGRAM_NATIVE_ONLY` (default `true`) only gates
a static text note next to the native-share button, explaining that
Instagram is shared through native share (`navigator.share`, when the OS
offers it as a target) or copy-link — it never builds a new
button/URL for it. The `social-share-links.test.ts` test "never
emits a fake Instagram share link/button" enforces this explicitly
(grepping `instagram.com`/`news-share__link--instagram` never appears in
any output).

### Canonical URL, not the querystring — guaranteed structurally, not by a filter

Every link/`data-share-url` attribute is built ONLY from the `canonicalUrl`
already resolved by `resolveCanonicalUrl` (server-side, from
`url.origin` + the post slug) — never from a raw `request.url`/`Astro.url`.
Because a server-generated `canonicalUrl` never carries a
querystring/tracking parameter/session id at all, the issue's requirement "do
not leak admin preview URLs, draft URLs, session IDs, or private query
parameters" is met structurally (those values are simply never
there), not by a filter that can forget to filter something.
The integration test proves this by calling the route with
`?utm_source=newsletter&session_id=abc123` in the request URL and asserting
that not one of those strings appears in the response.

### Client script — a same-origin static file, NOT inline (CSP)

`native_web_share`/`copy_link` need JS (Web Share API, Clipboard API) —
every other platform is a static `<a href>` with no JS at all.
`public/js/news-share.js` is loaded via `<script src="/js/news-share.js"
defer>` (same-origin, Astro's `public/` default) — **not** an inline
`<script>`. This deliberately avoids the whole CSP hash/nonce complication that
`astro.config.mjs`/`theme-init-script.ts` have already documented
(Astro's `security.csp` only hashes the scripts **it processes**
itself — a script rendered through a `.ts` API route like
`/news/[slug].ts` is not an `.astro` component, so it NEVER goes through
Astro's hashing pipeline at all; an inline `<script>` here
risks being blocked by a real browser's CSP with no headless-Chrome test able
to detect it through `curl`). `script-src 'self'` (Astro's default) is
enough for a same-origin static file — zero new hash entries needed.
The native-share button is rendered `hidden` on the server and is only unhidden by
this script after a real feature detection (`window.isSecureContext &&
navigator.share`) — the issue: "native share uses `navigator.share` only
after user activation and only in secure context." There is no external
dependency and no `fetch`/`import` to any origin other than the page
itself — `tests/unit/news-share-client-script.test.ts` asserts that no
external `http(s)://` string exists in this file.

### Configuration — every flag defaults to `true`, a deliberate deviation from the repo's habit

Every `NEWS_SHARE_*` flag defaults to `true` (see the
`news-share-config.ts` header comment for the full reasoning) — different from the
"opt-in, default off" habit of the other vars in this repo (`NEWS_PORTAL_ENABLED`,
`VISITOR_ANALYTICS_ENABLED`, etc.) because this feature does not collect
data/load an external script/need any credential to be enabled.
There is no separate flag for copy-link (always present once
`NEWS_SHARE_BUTTONS_ENABLED=true`) — the body of issue #642 did not
suggest one, and copy-link is the universal fallback that should
always be available.

### OG/Twitter meta tags — a widening of `renderPublicPageShell`, not a new function

`og:title`/`og:description`/`og:url` + `twitter:title`/
`twitter:description` are derived from the `title`/`description`/
`canonicalUrl` fields ALREADY on `PublicPageShellOptions` (one source of
truth per field — no second column that can drift).
`twitter:card` is now ALWAYS rendered (`summary` without an image,
`summary_large_image` with an `og:image` — unlike before this issue,
which omitted `twitter:card` entirely when there was no image). `og:image`/
`twitter:image`/`og:image:alt` did NOT change — they remain Issue #636's
R2-only gate (`resolveOgImageUrl`, only `verified`/`attached` media).
`og:site_name` is new, optional, from `PublicTenantResolution.tenantName` —
passed through by both routes (`/news/[slug].ts`, `/blog/[tenantCode]/[slug].ts`)
with no extra lookup (the tenant is already resolved for the existing
tenant/module gate).

### Files created/changed (quick reference)

- `src/modules/news-portal/domain/news-share-config.ts` (new).
- `src/modules/blog-content/domain/social-share-links.ts` (new).
- `public/js/news-share.js` (new).
- `src/modules/blog-content/domain/public-page-rendering.ts`: `PublicPageShellOptions`
  gains `siteName`; a new `renderOpenGraphMetaTags` (og:title/description/
  url/site_name + twitter:title/description/card always present).
- `src/pages/news/[slug].ts`, `src/pages/blog/[tenantCode]/[slug].ts`:
  call `resolveNewsShareConfig()` + `renderSocialShareButtonsHtml`,
  pass `siteName: tenant.tenantName` through to the shell.
- `src/lib/config/registry.ts`: nine new `NEWS_SHARE_*` entries
  (`ownerModule: "news-portal"`, `profiles: ALL_PROFILES`, all
  defaulting to `"true"`).
- `.env.example`, `18_configuration_env_reference.md` §News portal —
  public social share buttons (a table + a compact fenced block).
- Tests: `tests/unit/news-share-config.test.ts`,
  `tests/unit/social-share-links.test.ts`,
  `tests/unit/news-share-client-script.test.ts`,
  `tests/integration/news-portal-share-buttons.integration.test.ts`;
  updated: `tests/blog-content-public-rendering.test.ts` (og:title/
  description/url/site_name/twitter:card always present).
- Changeset: `.changeset/news-portal-social-share-buttons-issue-642.md`.

## §640 — Content quality checklist publishing with an R2 image requirement (Done)

Full implementation: domain `blog-content/domain/content-quality-checklist.ts`
(17 pure rules, three severities `blocking`/`warning`/`info`, five
non-overridable security rules), application
`blog-content/application/content-quality-checklist-gate.ts` (DB/port
orchestration), wired into `POST /api/v1/blog/posts/{id}/publish`,
`POST /api/v1/blog/posts/{id}/schedule`, `blog-scheduled-publish.ts`'s
`publishDueScheduledPosts` (Issue #541), and two new preview endpoints
`GET /api/v1/blog/posts/{id}/quality-checklist` /
`GET /api/v1/blog/pages/{id}/quality-checklist`. **No new
migration** — the tenant override policy is stored in the existing catch-all
`awcms_blog_settings.settings` column (Issue #543), not in a
new table.

### A single gate — following #636's mode-gate pattern exactly, NOT a blanket tightening across all of `blog_content`

The whole checklist (not just the R2 rules) is ONE no-op when full-online
R2-only mode is not active for the calling tenant
(`mediaPort.isFullOnlineR2ModeActiveForTenant`) — publish/schedule for a
`blog_content`-only tenant (the majority of tenants today) behaves identically to before
this issue, byte-for-byte. This is a deliberate decision, not an oversight: forcing
new editorial rules (missing meta description, empty taxonomy, etc.) to be
warnings/blocking for ALL `blog_content` tenants — including those that have never
enabled `news_portal` — would be a "blanket tightening", exactly the
mistake pattern this epic has repeatedly documented as one to
avoid (see §636's identical principle). `applicable: false` on the
`ContentQualityChecklistResult` is that signal.

### Reuse — ONE mediaPort.resolveMediaReferences call, not a re-derivation of R2 verification

`content-quality-checklist-gate.ts` calls
`collectGalleryImageReferences` (#636's domain, its traversal NOT changed)
and `NewsMediaPort.resolveMediaReferences` (#681's adapter,
`news-portal/application/news-media-port-adapter.ts`) — ONE bulk lookup
for the featured image + every gallery mediaObjectId, EXACTLY the primitive
#636 already built. The checklist does NOT call the `news_portal`
registry/DB directly itself and does NOT re-implement the "is this media
verified/attached" query — that is already the responsibility of
`isNewsMediaObjectSafeForPublicReference` behind the port, called in one
place (`news-media-port-adapter.ts`).

### Additive changes to files flagged as shared with Issue #639 (video block, worked in parallel)

The two files explicitly named as conflict risks with #639 were touched
MINIMALLY and purely additively:

- `blog-content/domain/content-block-media-references.ts` —
  `GalleryImageReferenceViolation` gains a new optional field `rawUrl?:
string` (populated only for `reason: "raw_url_not_allowed"`), so that the
  checklist can classify local-path vs external-url WITHOUT a
  second traversal of `contentJson` (see that file itself for the
  "one traversal, do not drift" reasoning). NO change to
  `mediaType: "video"` (still out of scope, #639's scope), NO
  change to the order/contents of the `violations` array for old consumers
  (`news-media-reference-gate.ts`'s `violationMessage` only reads
  `itemIndex`/`reason`, unaffected by the new field).
- `content-block-rendering.ts` — **not touched at all** by
  this issue (rendering is not a checklist concern — the checklist only
  reads `contentJson`/the registry, it never renders HTML).

`_shared/ports/news-media-port.ts` was also widened additively:
`ResolvedNewsMediaReferenceDTO` gains four new metadata fields
(`mimeType`, `width`, `height`, `sizeBytes`) alongside the existing
`publicUrl`/`altText` — every old consumer (the homepage composer,
render-time gallery/og:image resolution) still reads only the two old
fields, unaffected.

### The "featured image MIME/size" classification — no re-derivation of the policy config, purely a report of verified metadata

`featured_image_mime_allowed`/`featured_image_size_within_policy` do NOT
read `NEWS_MEDIA_R2_ALLOWED_MIME_TYPES`/`NEWS_MEDIA_R2_MAX_UPLOAD_BYTES`
(that would be new cross-module coupling to the `news_portal` domain's config,
forbidden by `module-boundary.test.ts`). Instead: EVERY object that
reaches `verified`/`attached` status has CERTAINLY already passed raster MIME
sniffing (the four types) and the byte cap at upload time (Issue #634) — so these two
rules report ALREADY-verified metadata (the real `mimeType`/
`sizeBytes` values from the registry), they do not repeat the
allow/deny decision. Severity `info`, not overridable (there is nothing that needs
overriding — these rules structurally cannot fail for a verified
object).

### The five security rules — CANNOT be downgraded by tenant policy, in ANY environment (stricter than the issue's literal request)

`SECURITY_RULE_IDS` (`unsafe_html_rejected`, `no_local_image_path`,
`no_external_image_url`, `featured_image_verified_r2`,
`gallery_images_verified`) reject ANY override, with no
`APP_ENV` branch. Issue #640's security notes only asked for "must not be
downgraded IN PRODUCTION" — this implementation is DELIBERATELY stricter
(rejecting universally) because that trivially satisfies the literal requirement
without adding a new env branch that risks becoming a footgun for a
staging environment that mirrors production data. `resolveSeverity` (domain) rejects an
override for any id outside `OVERRIDABLE_RULE_IDS` at runtime —
independent of `blog-settings-policy.ts`'s write-time validation (two
layers, not a single point of failure, the same lesson as §636's restore-revision
bypass).

### Tenant policy — stored in `awcms_blog_settings.settings`, NOT a new mechanism

`contentQualityChecklistPolicy` (a map of overridable rule id -> severity)
lives in `awcms_blog_settings`' catch-all `settings jsonb` column
(Issue #543, already tenant-writable via `PATCH /api/v1/blog/settings`,
permission `blog_content.settings.configure`). This is NOT the §636
anti-pattern ("do not put a security signal in a generic-writable mechanism") —
the five security rules above are NEVER read from this blob at all
(they are hard-coded in `content-quality-checklist.ts`), so no bypass
is possible through here even though the column is generic-writable. `validateUpdateBlogSettingsInput`
rejects (400) any key that is not in `OVERRIDABLE_RULE_IDS` or any invalid
severity — including an attempt to put a security rule in there.

### The scheduled-publish worker — restructured from a bulk UPDATE to a per-post loop

`publishDueScheduledPosts` (Issue #541) was previously one set-based `UPDATE ...
RETURNING`. This issue restructures it into a `SELECT ... FOR
UPDATE` followed by a per-post loop: every due post gets its own checklist
evaluation; failures are LEFT `scheduled` (not silently published, not
unscheduled) + an audit event `blog.post.scheduled_publish_blocked`; only those that
pass are then `UPDATE`d one by one to `published`. The reason: without this, a
tenant could bypass the checklist entirely by scheduling a post BEFORE
enabling R2-only mode (or before the media is re-verified), then
waiting for it to fall due — the same class of hole as §636's restore-revision
bypass. `mediaPort` is now a MANDATORY parameter of this function (injected by
`scripts/blog-scheduled-publish.ts` as the composition root) — the old
signature `(sql, tenantId, options?)` becomes `(sql, tenantId, mediaPort,
options?)`, a breaking change for any caller.

### The response envelope — an additive `qualityChecklist` field, `error.details` stays `ErrorDetail[]`

The successful `publish`/`schedule` response (200) uses EXACTLY the pattern
`termIds` already uses in `BlogPostItem` (Issue #539: "only optional
fields that some endpoints populate") — `ok({ ...updated, qualityChecklist
})`, NOT wrapping `data` in a new wrapper. The blocked response (422,
code `CONTENT_QUALITY_CHECKLIST_BLOCKED`) maps every blocker to
`{ field: ruleId, message }` — the EXISTING `ErrorDetail` shape
(used by `VALIDATION_ERROR`/`NEWS_MEDIA_REFERENCE_INVALID`), NOT a full
checklist object in `error.details` (which would require a change to the shared
`ApiError` schema) — the full checklist (including warnings/info) is still obtained through
the preview endpoint `GET .../quality-checklist`.

### Pages (`blog_content` pages) — preview-only, there is NO publish/schedule endpoint for pages at all

`GET /api/v1/blog/pages/{id}/quality-checklist` exists (satisfying "the checklist is
available in the admin post/page editor"), but there is NO `POST
/api/v1/blog/pages/{id}/publish`/`.../schedule` in this codebase — pages
are created directly as `status='draft'` with no lifecycle transition route at all
(a pre-existing gap, not something this issue fixes, outside this issue's atomic
scope). `taxonomy_exists` is always `applicable: false` for pages
(there is no `_terms` table for pages, unlike posts'
`awcms_blog_post_terms`).

### Files created/changed (quick reference)

- **New**: `src/modules/blog-content/domain/content-quality-checklist.ts`,
  `src/modules/blog-content/application/content-quality-checklist-gate.ts`,
  `src/pages/api/v1/blog/posts/[id]/quality-checklist.ts`,
  `src/pages/api/v1/blog/pages/[id]/quality-checklist.ts`.
- **Changed (additively)**: `src/modules/_shared/ports/news-media-port.ts`
  (new `ResolvedNewsMediaReferenceDTO` metadata),
  `src/modules/news-portal/application/news-media-port-adapter.ts`
  (populating the new metadata), `src/modules/blog-content/domain/content-block-media-references.ts`
  (optional `rawUrl` on the violation), `src/modules/blog-content/domain/blog-settings-policy.ts`
  - `application/blog-settings-directory.ts` (`contentQualityChecklistPolicy`),
    `src/pages/api/v1/blog/posts/[id]/publish.ts`, `.../schedule.ts` (gate +
    audit + `qualityChecklist` in the response), `src/modules/blog-content/application/blog-scheduled-publish.ts`
  - `scripts/blog-scheduled-publish.ts` (per-post restructuring + injecting
    `mediaPort`).
- `openapi/awcms-public-api.src.yaml` (new `ContentQualityChecklistResult`/
  `ContentQualityChecklistRuleOutcome` schemas, `BlogPostItem.qualityChecklist`),
  `openapi/modules/blog-posts.openapi.yaml` (a new 422 on publish/schedule,
  a new `quality-checklist` path), `openapi/modules/blog-pages.openapi.yaml`
  (a new `quality-checklist` path), `openapi/modules/blog-settings.openapi.yaml`
  (a new `ContentQualityChecklistPolicy` schema).
- `src/lib/i18n/error-messages.ts` (`CONTENT_QUALITY_CHECKLIST_BLOCKED`),
  `i18n/en.po`/`i18n/id.po` (error string + admin UI checklist panel +
  settings policy field strings).
- Admin UI: `src/pages/admin/blog/posts/[id].astro` (a new checklist panel),
  `src/pages/admin/blog/pages/[id].astro` (a new checklist panel, read-only),
  `src/pages/admin/blog/settings.astro` (a JSON textarea for the checklist
  policy).
- Tests: `tests/unit/content-quality-checklist.test.ts`,
  `tests/unit/content-quality-checklist-gate.test.ts`,
  `tests/unit/blog-settings-policy.test.ts` (new — scoped to the new fields
  only), `tests/integration/blog-content-quality-checklist.integration.test.ts`
  (new); updated: `tests/unit/content-block-media-references.test.ts`
  (asserting the new `rawUrl`), `tests/integration/blog-content-scheduled-publish.integration.test.ts`
  (the new `publishDueScheduledPosts` signature needs `mediaPort`).
- Changeset: `.changeset/blog-content-quality-checklist-issue-640.md`.
- **No new migration** — see "A single gate"/"Tenant policy" above
  for the reasoning.

## §641 — Automatic internal tag linking (Done)

Full implementation: domain `blog-content/domain/internal-tag-linking.ts`
(a pure matching engine + an HTML transform built on Bun's built-in
`HTMLRewriter`), `domain/internal-tag-linking-config.ts` (a resolver for
the six `BLOG_AUTO_INTERNAL_TAG_LINKS_*` env vars),
`domain/internal-tag-linking-policy.ts` (a tenant policy validator),
application `application/internal-tag-link-settings-directory.ts` (the
dedicated tenant policy table) + `application/internal-tag-link-rendering.ts`
(the orchestration used by BOTH public rendering AND the preview
endpoint). Migrations
`sql/051_awcms_blog_content_internal_tag_links_schema.sql` (the
`auto_internal_tag_links_disabled` column on `awcms_blog_posts` + the new
table `awcms_blog_internal_tag_link_settings`) and
`sql/052_awcms_blog_content_internal_tag_links_permissions.sql`
(the `blog_content.internal_links.{read,configure,preview}` permissions).
**Not directly related to R2/media** — this item is in the same epic
because it is equally part of the `news_portal` editorial experience; it
does not depend on Key decisions #1-#5 above. The feature lives in the
`blog_content` module (not `news_portal`) because it has to be generic for
ALL `blog_content` consumers, not only full-online-R2 tenants — proven by
wiring it into BOTH public routes (`/news/{slug}` AND
`/blog/{tenantCode}/{slug}`), not just one of them.

### Key decision — HTML tree parsing via Bun's `HTMLRewriter`, not a regex over a raw string

Issue #641's security notes explicitly forbid "naive string replacement
on raw HTML without parsing/sanitization." The implementation uses Bun's
built-in `HTMLRewriter` (a built-in global, the same API as Cloudflare
Workers, requiring NO new dependency — consistent with the Bun-only rule)
to genuinely walk the element tree: a `skipDepth` counter is incremented
on entering an element in the exclusion list (`a`, `script`, `style`,
`code`, `pre`, `kbd`, `samp`, `textarea`, `noscript`, `figcaption`,
`iframe`, `object`, `embed`, `video`, `audio`, `template`, `math`, `svg`,
plus `h1`-`h6` when `excludeHeadings=true`) and decremented exactly at
the SAME element's `el.onEndTag()` — text encountered while
`skipDepth > 0` is never examined at all, no matter how deeply nested.
The regex is ONLY applied to text the parser has ALREADY isolated as a
safe text node (not to a raw HTML string), the same principle as the
`content-block-rendering.ts` whitelist renderer. Proven empirically (a
manual prototype script) BEFORE the final code was written — see the unit
test `tests/unit/internal-tag-linking.test.ts` for 25 validated scenarios
including existing-anchor/code/script/figcaption/embed/heading exclusion
and two XSS cases (a tag name containing HTML-special characters, and
content already containing escaped `&lt;script&gt;` text never being
reinterpreted as markup).

### Matching — text is matched in the escaped domain, never decoded

`HTMLRewriter`'s `text()` callback returns SOURCE-level text (already
HTML-entity-encoded, `&` stays `&amp;`), not the decoded version. Rather
than decoding the text (prone to double-escape bugs), every candidate tag
name is run through `escapeHtml()` with EXACTLY the same function the
renderer uses, so that matching happens entirely in the already-escaped
domain — a tag named `Q&A` matches the source text `Q&amp;A` (verified by
a test). The matched substring is used as-is for the anchor text, so the
resulting markup is always well-formed.

### Word boundary — Unicode-aware, not a plain `\b`

The regex pattern uses the lookaround
`(?<![\p{L}\p{N}_])...(?![\p{L}\p{N}_])` with the `u` flag — preventing
the tag "makan" from matching as a substring inside a larger Indonesian
word sharing the same root ("memakan", "makanan"), while still matching
standalone occurrences. Candidates are sorted longest-first (by the length
of the escaped form) before being combined into one regex alternation — JS
regex alternation picks the FIRST alternative that matches at a given
position, not the longest, so it is this ordering that makes "longest
match wins" correct (the tag "Jakarta Selatan" is chosen over "Jakarta" at
the same position).

### Two levels of cap — `maxPerTag`/`linkFirstOccurrenceOnly` and `maxPerPost`

`linkFirstOccurrenceOnly=true` (the default) effectively pins `maxPerTag`
to 1 (`effectiveMaxPerTag = linkFirstOccurrenceOnly ? 1 :
max(1, maxPerTag)`), satisfying "Avoid duplicate links to the same tag in
one post unless configured" — raising `maxPerTag` AND turning off
`linkFirstOccurrenceOnly` allows more than one link to the same tag.
`maxPerPost` is a GLOBAL ceiling across all tags within one document,
enforced through a stateful counter that persists across the whole
document (not per text node) — guaranteed by
`createInternalTagLinkEngine`'s closure, which `HTMLRewriter` calls
repeatedly per text node, in document order.

### Tenant policy — a DEDICATED table, NOT `awcms_blog_settings.settings` like Issue #640

Unlike `contentQualityChecklistPolicy` (#640), which was safe to put in
the catch-all `awcms_blog_settings.settings` column because
`upsertBlogSettings` was updated to round-trip that new key too — this
issue's policy (`enabled`/`caseInsensitive`/`disabledTagIds`)
DELIBERATELY uses a new table `awcms_blog_internal_tag_link_settings`
(migration 050), one row per tenant, the same pattern as
`awcms_blog_theme_settings` (migration 029). The reason: `settings` is a
catch-all column that is **overwritten wholesale** by `upsertBlogSettings`
from an explicit key list (the `extras` object) — a NEW key not added to
that list would SILENTLY DISAPPEAR every time an admin updates any other
blog setting via `PATCH /api/v1/blog/settings`, unless that file were
touched as well. A dedicated table avoids that coupling entirely, and
matches the issue's explicit request for separate permissions
(`blog_content.internal_links.*`, NOT `blog_content.settings.*`) — the
endpoints (`GET`/`PATCH /api/v1/blog/internal-tag-links/settings`) and the
directory (`internal-tag-link-settings-directory.ts`) are likewise
completely separate from `blog-settings-directory.ts`, with no double
write path.

### Bun.SQL does not auto-deserialize Postgres array columns — a real trap found during integration testing

A `disabled_tag_ids uuid[]` read through `Bun.SQL` comes back as the
literal wire-format STRING `"{uuid1,uuid2}"` (`typeof === "string"`), NOT
a parsed JS array — verified empirically with a manual test script before
blaming the integration test. Without explicit parsing, the old code's
`[...rawString]` would silently spread that STRING into an array of
individual characters (a real bug that briefly made it into the
integration test the first time it ran). `parsePostgresUuidArray` in
`internal-tag-link-settings-directory.ts` handles this — safe specifically
for UUIDs (there is no comma/brace/quote inside a single element that
would need escaping). **A note for follow-on implementors**: when adding a
new `xxx[]` column to any table in this repo, DO NOT assume Bun.SQL parses
it automatically — verify empirically first (see the related `awcms-coder`
prompt/skill if this note needs to be added to a general,
non-epic-specific reference).

### `POST /setup/initialize` is a once-per-database singleton — not per tenant

Rediscovered while writing the cross-tenant test: `POST
/api/v1/setup/initialize` rejects (403 "Setup has already been
completed") a SECOND call within ONE database, even for a different
`tenantCode` — so it cannot be called twice inside ONE test case to
bootstrap two tenants. The correct pattern (already used earlier by
`blog-content-admin-ui.integration.test.ts`/
`blog-content-public-news.integration.test.ts`, replicated here as
`provisionSecondTenant`): insert the SECOND tenant directly via the raw
SQL admin client (`awcms_tenants`/`awcms_profiles`/
`awcms_identities`/`awcms_tenant_users`/`awcms_roles`/
`awcms_role_permissions`/`awcms_access_assignments`), then log in
normally. For a scenario that needs the second tenant to be genuinely
RESOLVABLE through `/news` (not just an ordinary tenant-scoped API), add
`PUBLIC_TENANT_RESOLUTION_MODE=env_default` +
`PUBLIC_DEFAULT_TENANT_ID=<tenantB>` temporarily (the same pattern as
`blog-content-public-news.integration.test.ts`'s cross-tenant test).

### A new permission — `preview` added to the `AccessAction` union

`identity-access/domain/access-control.ts`'s `AccessAction` union gains a
new member `"preview"` (used ONLY by
`blog_content.internal_links.preview`) — following exactly the
`verify`/`set_primary` precedent (Issue #562): seed the permission first,
add the action to the union when a real endpoint needs it. Not added to
`HIGH_RISK_ACTIONS` (read-only, non-destructive).

### Rendering wiring — both public post-detail routes, not only `/news`

`renderContentHtmlWithInternalTagLinks` is called in BOTH
`src/pages/news/[slug].ts` AND `src/pages/blog/[tenantCode]/[slug].ts`,
right after `renderContentJsonToHtml` has produced safe HTML and before it
is wrapped into `bodyHtml` — the tag archive basePath differs per route
(`routeSettings.publicBasePath` vs `/blog/${tenantCode}`), but the
policy/candidate resolution orchestration is the SAME (one application
function, not duplicated). The preview endpoint
(`GET /api/v1/blog/posts/{id}/internal-links/preview`) uses the SAME
orchestration function (`previewInternalTagLinksForContent`) so that
"which tag candidates qualify, and what the effective policy is" can never
drift between render time and preview time.

### Files created/changed (quick reference)

- `sql/051_awcms_blog_content_internal_tag_links_schema.sql`,
  `sql/052_awcms_blog_content_internal_tag_links_permissions.sql`.
- `src/modules/blog-content/domain/internal-tag-linking.ts`,
  `domain/internal-tag-linking-config.ts`,
  `domain/internal-tag-linking-policy.ts`;
  `application/internal-tag-link-settings-directory.ts`,
  `application/internal-tag-link-rendering.ts`.
- Updated (additively): `src/modules/identity-access/domain/access-control.ts`
  (the `"preview"` action), `src/modules/blog-content/module.ts` (the
  `internal_links.*` permissions, a new event, version 0.8.0→0.9.0),
  `src/modules/blog-content/application/blog-post-directory.ts`/
  `domain/blog-post-validation.ts`/`application/public-blog-directory.ts`
  (`autoInternalTagLinksDisabled`), `src/pages/news/[slug].ts`,
  `src/pages/blog/[tenantCode]/[slug].ts` (render wiring).
- `src/pages/api/v1/blog/internal-tag-links/settings.ts` (GET/PATCH),
  `src/pages/api/v1/blog/posts/[id]/internal-links/preview.ts` (GET).
- Admin UI: `src/pages/admin/blog/internal-tag-links.astro` (new),
  `src/pages/admin/blog/posts/[id].astro` (a per-post checkbox + a preview
  panel), `src/pages/admin/blog/index.astro` (a new quick link).
- `openapi/modules/blog-internal-tag-links.openapi.yaml` (new),
  `openapi/awcms-public-api.src.yaml` (`BlogPostItem.
autoInternalTagLinksDisabled`, a new tag), `openapi/modules/blog-posts.openapi.yaml`
  (a new request field), `asyncapi/awcms-domain-events.asyncapi.yaml`
  (a new channel + operation).
- `src/lib/config/registry.ts`, `scripts/validate-env.ts`
  (`checkBlogAutoInternalTagLinksConfig`), `.env.example`,
  `18_configuration_env_reference.md` §Blog content — automatic internal
  tag linking.
- `i18n/en.po`/`i18n/id.po` (25 new keys: the dashboard link, the post
  editor panel, the new settings screen).
- Tests: `tests/unit/internal-tag-linking.test.ts` (25 scenarios),
  `tests/unit/internal-tag-linking-config.test.ts`,
  `tests/unit/internal-tag-linking-policy.test.ts`,
  `tests/integration/blog-internal-tag-linking.integration.test.ts` (16
  scenarios: render wiring, tenant isolation, the three disable levels,
  per-tag disable, settings API CRUD + validation + audit, the preview
  API);
  updated: `tests/foundation.test.ts` (module version, migration list).
- Changeset: `.changeset/blog-content-internal-tag-linking-issue-641.md`.

## §690 — R2 media lifecycle cleanup & reconciliation job (epic #679 platform-hardening, NOT this epic — Done)

Not part of the `news_portal` epic (#631-#642/#649) — it comes from the
separate epic `#679` (platform-hardening, the "runtime/worker hardening"
wave, after #691/#689/#694/#695/#687/#697), but it touches this module
directly (recorded here to keep the context centralised, just like §681).

### What was implemented

`bun run news-media:reconcile` (`scripts/news-media-r2-reconcile.ts`, with
the logic in `news-media-reconciliation.ts` + `news-media-reconciliation-
categorization.ts`) — this module's first job on top of the shared worker
runner (#697). It fills THREE gaps that `r2-backup-lifecycle.md` §2/§4 had
described since Issue #631/#633 but which had no implementation:

1. **Pending TTL cleanup** — `pending_upload`/`uploaded` rows (and
   `failed` ones, for retry-on-rerun) that are past
   `NEWS_MEDIA_R2_PENDING_TTL_MINUTES` (atomically claimed to `failed`
   first — the SAME `WHERE status IN (...) AND created_at < cutoff` guard
   as the atomic-claim pattern `finalizeNewsMediaUploadSession` #634 uses
   — then delete the R2 object, then hard-delete the row).
2. **Stale-orphaned physical cleanup** — a NEW `orphaned_at` column
   (migration 046) on `status='orphaned'` rows, used to measure
   `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` (default+minimum 30 days). This job
   does NOT itself decide when a row becomes `orphaned` (cross-
   referencing against every `blog_content` reference point — §4's
   "concrete implementation" — is still out of scope and unchanged).
3. **DB-vs-R2 drift reconciliation** — two NEW categories, distinct from
   the existing `orphaned` status enum: **orphan-in-DB** (an
   `uploaded`/`verified`/`attached` row whose R2 object is missing —
   report-only, NEVER mutated automatically) and **orphan-in-R2** (an R2
   object with no DB row at all — a real gap, because
   `purgeNewsMediaObject` does not delete its R2 object; physically
   deleted after the same grace period, WITH a re-check immediately
   before deletion — `objectKeyExistsForTenant` — so that a row created
   just before the delete never loses its object).

### Why the order is "claim in the DB first, then R2" — NOT "R2 first" as originally written in `r2-backup-lifecycle.md` §2

The lifecycle doc (written before any implementation existed) asks to
"delete the R2 object first, then the metadata row" purely for
crash-safety. This job inverts that order because there is ANOTHER, more
critical concern: the DB claim must happen FIRST so that its atomic guard
can serialise against a `finalize()` that is genuinely running
concurrently for the same row (if R2 were deleted first, an in-flight
`finalize()` could lose its object mid-way). The partial failure the
original doc worried about (an orphaned R2 object with no row) is still
handled — it is not a dead end — because that is exactly the orphan-in-R2
category this job itself detects/cleans on the next run (self-healing
across runs, not merely across passes within one run).

### The most critical race-condition test

Issue #690's acceptance criteria explicitly ask for a test of the
scenario: a DB row created JUST BEFORE the reconciliation run deletes an
object that (at the initial snapshot point) looked like an orphan-in-R2.
`tests/integration/news-media-r2-reconciliation-job.integration.test.ts`
proves it by wrapping the real R2 client so that the FIRST `listObjects`
call (which happens right after the DB snapshot is taken) ALSO inserts a
new row for the same key — simulating a genuine race — and then asserts
that `objectKeyExistsForTenant`'s re-check (run immediately before the
delete) finds that new row and cancels the deletion (`raceAverted`),
NEVER deleting the object.

### Files created/changed (quick reference)

- `sql/046_awcms_news_media_orphan_lifecycle.sql` — the `orphaned_at`
  column + a CHECK constraint + a GRANT to `awcms_worker`.
- `src/modules/news-portal/domain/news-media-reconciliation-
categorization.ts` — pure categorisation logic (no I/O).
- `src/modules/news-portal/application/news-media-reconciliation.ts` —
  per-tenant/all-tenant orchestration (DB + the real R2 client).
- `src/modules/news-portal/application/news-media-object-directory.ts`
  — new atomic functions: `purgeExpiredPendingNewsMediaObject`,
  `markStaleOrphanedNewsMediaObjectDeleted`, `objectKeyExistsForTenant`,
  `fetchNewsMediaObjectsForReconciliation`;
  `markNewsMediaObjectFailed` gains an optional `olderThan` parameter;
  `markNewsMediaObjectOrphaned` now fills `orphaned_at`.
- `src/modules/news-portal/infrastructure/news-media-r2-client.ts` —
  new `listObjects`/`deleteObject` (the same circuit breaker + timeout as
  the other methods in this file).
- `src/modules/news-portal/domain/news-media-r2-config.ts` —
  `orphanGraceDays`/`NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS`/
  `isOrphanGraceTooShort`.
- `scripts/news-media-r2-reconcile.ts` — the CLI, `bun run
news-media:reconcile`, built on `runJob` from the start.
- `docs/awcms/news-portal/r2-backup-lifecycle.md` — §2/§4 updated
  - a new §Operator SOP.

## Principles that must be preserved in every follow-on issue

1. **Full-online-only, explicitly opt-in** — none of this epic's behaviour
   is active by default for a deployment that has not explicitly activated
   the preset (#632). Offline/LAN must not be affected at all.
2. **R2-only for binaries, Postgres for metadata** — no new binary column
   in any table this epic touches.
3. **No local filesystem fallback, no local temp file** — see Key
   decision #2.
4. **The media R2 bucket + credentials are separate from `sync-storage`** —
   see Key decision #1. This is not advice, it is mandatory enforcement in
   `config:validate`/`security:readiness` (#635).
5. **Object key: UUID + date + tenant, never a filename/PII** — see Key
   decision #3.
6. **Postgres status is not a storage access control** — see Key
   decision #4; do not assume otherwise in new code/documentation.
7. **SVG forbidden by default** — see Key decision #5.
8. **Editorial content may only point at `confirmed` media** — from #636
   onwards; do not re-derive the old free-URL rules.

## References

- `docs/awcms/news-portal/full-online-r2-architecture.md` — the full architecture + compliance mapping.
- `docs/awcms/news-portal/r2-upload-sop.md` — the upload SOP.
- `docs/awcms/news-portal/r2-security-checklist.md` — the security checklist.
- `docs/awcms/news-portal/r2-incident-response.md` — the incident runbook.
- `docs/awcms/news-portal/r2-backup-lifecycle.md` — backup/lifecycle/retention + §Operator SOP `news-media:reconcile` (Issue #690).
- `docs/awcms/deployment-profiles.md` §Shared worker runner / §Other job registry — `news-media:reconcile` (Issue #690).
- `docs/awcms/news-portal/newsroom-user-guide.md` — the editor guide.
- `src/modules/sync-storage/README.md` — the existing R2 usage (a separate bucket, Key decision #1).
- `src/modules/blog-content/README.md` §Media/Gallery, §Ads — the behaviour before #636 changed it.
- `docs/adr/0006-offline-first-sync-outbox.md` — external providers are optional/outside the transaction.
- `docs/awcms/deployment-profiles.md` §News portal — a summary per deployment profile.
- `AGENTS.md` skill table.
