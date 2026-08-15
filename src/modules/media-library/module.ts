import { defineModule } from "../_shared/module-contract";
import {
  MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE,
  MEDIA_PERMISSION_ACTIVITY_CODE
} from "./domain/media-permissions";

/**
 * ADR-0036 media-library ownership inversion (adapting awcms-micro ADR-0026) —
 * this module OWNS the tenant media registry AND the capability every website
 * module consumes to use it.
 *
 * The registry moved here from `news_portal`: the presigned upload/finalize/
 * cancel flow, MIME sniffing, object-key derivation, R2 config + client,
 * verification, reconciliation, and the 9 media permissions
 * (`media_library.media.*`, migration `052`).
 *
 * `news_portal` no longer provides `news_media` — that capability is retired,
 * and `media_library` is `media-library-port.ts`'s sole provider
 * (`application/media-library-port-adapter.ts`, which imports only this module).
 * The coupling that used to keep media inside `news_portal` lived in the PORT
 * CONTRACT itself (`isFullOnlineR2ModeActiveForTenant`), so renaming the port
 * without splitting the contract would have inverted nothing.
 *
 * The split: "must this tenant's media references be registry-backed?" is a
 * MEDIA question, answered here from this module's own deployment readiness
 * (`domain/managed-media-readiness.ts`) and its own per-tenant flag
 * (`application/media-library-tenant-state.ts`, migration `053`), turned on by
 * `application/enable-managed-media-enforcement.ts` (`POST /api/v1/media/
 * enforcement`, migration `054`). That is what lets a brochure site have managed
 * media without switching on a news portal — the product gap this inversion was
 * written to close.
 *
 * `dependencies` excludes `blog_content` — today's only consumer, and since
 * ADR-0044 the owner of what `news_portal` used to hold — permanently, not
 * incidentally: media must never depend on its own consumers.
 *
 * PORT NOTES vs awcms-micro: this base ports the ownership inversion + the
 * enforcement-enable switch (micro step 5a). The media lifecycle/browser surface
 * (`/api/v1/media/objects/*`, `/admin/media`) SINCE LANDED here — ADR-0056 built
 * `/admin/media`, and `GET /api/v1/media/objects` resolves media references over
 * HTTP — so this module DOES declare `navigation` (see the entry ~40 lines
 * below, which contradicted this paragraph until 8 August 2026). Still absent:
 * the responsive `srcset` render path and the PDF media type, so the allowed
 * MIME set stays the four raster types.
 */
export const mediaLibraryModule = defineModule({
  key: "media_library",
  name: "Media Library",
  version: "0.1.0",
  status: "active",
  description:
    "Tenant-scoped media object registry and upload flow, reusable by every website module (ADR-0036, System Foundation). Owns `awcms_news_media_objects` (migrations 041/042/045) — a generic registry keyed by `module_key` with `owner_resource_type`/`owner_resource_id` references, direct-to-R2 presigned upload with real magic-byte MIME sniffing and server-side SHA-256 checksum verification, orphan lifecycle, and R2 reconciliation (the `news-media:reconcile` job). The table keeps its `news_media` name deliberately (ADR-0036 §3): it is referenced by three migrations and a hard composite FK from `awcms_news_portal_ad_placements`, so renaming would trade a cosmetic annoyance for real risk. Provides the `media_library` capability (`_shared/ports/media-library-port.ts`), whose sole consumer since ADR-0044 is `blog_content` — required, because the ad placements it absorbed from the retired `news_portal` module hold a real FK to a media object, while its post/page media handling no-ops for any tenant that has not switched enforcement on: media reference safety, resolution, and whether managed-media enforcement is active for a tenant (this module's own readiness plus its own per-tenant flag, migration 053) — so a brochure site gets managed media without a news portal. Turning that flag ON is a dedicated, readiness-gated, one-way switch (`POST /api/v1/media/enforcement`, migration 054). This module never transcodes bytes inside a DB transaction (ADR-0006), and is deliberately not a CDN, image proxy, or DAM. STILL ABSENT vs awcms-micro: responsive `srcset` render and the PDF media type. The media lifecycle/browser surface (`/api/v1/media/objects/*`, `/admin/media`) is NO LONGER absent — ADR-0056 built the admin screen and the object endpoints resolve media references over HTTP.",
  dependencies: ["tenant_admin", "identity_access"],
  type: "system",
  isCore: false,
  // ADR-0036 — sole provider of the `media_library` capability
  // (`_shared/ports/media-library-port.ts`, implemented by
  // `application/media-library-port-adapter.ts`, wired at each route's
  // composition root). Since ADR-0044 there is exactly one consumer,
  // `blog_content`, and it declares the capability REQUIRED: the ad placements
  // it absorbed from the retired `news_portal` module hold a real FK to a media
  // object. Its post/page media handling still no-ops when enforcement is off.
  //
  // `consumes` stays empty and must remain so: this module answers media
  // questions from its own registry, its own readiness, and its own per-tenant
  // flag. A System Foundation module consuming a domain capability would be the
  // ADR-0013 §1 inversion this extraction exists to remove.
  capabilities: {
    provides: ["media_library"]
  },
  api: {
    // ADR-0026: this module's own fragment, not the generated bundle (see the
    // same correction in blog-content/module.ts).
    openApiPath: "openapi/modules/media-library.openapi.yaml",
    basePath: "/api/v1/media/news-images",
    // The whole `/api/v1/media` tree, not just the news-images sub-path —
    // `/api/v1/media/enforcement` was falling to `tenant_admin`'s catch-all.
    routes: ["/api/v1/media"]
  },
  // ADR-0056 — ONE entry for eleven activity codes' worth of surface, because
  // this module's screen is the object lifecycle and nothing else. Upload lives
  // wherever a composer needs it (a three-step browser flow, not a button), and
  // the enforcement switch is a tenant-wide one-way policy that belongs on
  // `/admin/security`. A second entry appearing here without a page is what
  // `admin-navigation-registry.test.ts` catches.
  navigation: [
    {
      labelKey: "admin.layout.nav_media",
      path: "/admin/media",
      order: 34,
      requiredPermission: "media_library.media.read"
    }
  ],
  permissions: [
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "create",
      description:
        "Create a pending media object / start a presigned upload session"
    },
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "read",
      description: "Read media object metadata"
    },
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "verify",
      description: "Finalize/verify an uploaded media object"
    },
    // No `attach`/`detach` — REVOKED by ADR-0056 §A (`sql/087`). They wrote a
    // relation this module stopped owning at ADR-0036: media attachment is the
    // consumer's FK (`awcms_blog_posts.featured_media_id`), changed under the
    // consumer's permission. Both sat in the catalog, granted to every tenant
    // owner, checked by nothing.
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "delete",
      description: "Soft delete media object metadata"
    },
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "restore",
      description: "Restore a soft-deleted media object"
    },
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "purge",
      description: "Hard purge an already soft-deleted media object"
    },
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "cancel",
      description: "Cancel one's own not-yet-uploaded media upload session"
    },
    // ADR-0036 step 5a (migration `054`) — a separate activity code from `media`
    // on purpose: `media.*` governs individual objects, `enforcement.*` governs a
    // tenant-wide content policy. Folding these into `media.create` would hand
    // the policy switch to every editor who uploads images.
    //
    // There is no `disable` action here, and there must never be — see
    // `application/enable-managed-media-enforcement.ts`: a tenant able to switch
    // its own media validation off is the exploit `sql/043` documents.
    {
      activityCode: MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE,
      action: "read",
      description:
        "Read whether managed-media enforcement is active for this tenant, and why it can or cannot be enabled"
    },
    {
      activityCode: MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE,
      action: "enable",
      description:
        "Turn managed-media enforcement ON for this tenant (one-way — there is deliberately no disable)"
    }
  ],
  // ADR-0036 — the media-registry reconciliation job belongs to this module,
  // which OWNS `awcms_news_media_objects`, its orphan lifecycle, and the
  // reconciliation code (`application/media-reconciliation.ts`,
  // `infrastructure/media-r2-client.ts`, `domain/media-r2-config.ts` — the only
  // modules `scripts/news-media-r2-reconcile.ts` imports). `news_portal` first
  // declared it because that is where the registry was born; the inversion moved
  // ownership, so the job declaration follows the table.
  //
  // The `news-media:reconcile` command name is KEPT deliberately (not renamed to
  // `media:reconcile`): the script path, package.json script, and operator SOP
  // docs all reference it, and ADR-0036 §3 keeps the `news_media` naming for the
  // same reason it keeps the table name — a cosmetic rename would trade a naming
  // annoyance for real churn and risk.
  /**
   * ADR-0094 wave 2 (Issue #557) — ADR-0036 kept the `awcms_news_*` names, so
   * the table below is the media registry despite what it is called.
   */
  subjectData: [
    {
      key: "media_library.news_media_objects",
      tableName: "awcms_news_media_objects",
      ownerModuleKey: "media_library",
      subjectColumns: [
        { column: "created_by_tenant_user_id", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" }
      ],
      exportable: true,
      // The BYTES are not erased with the uploader, and the descriptor should
      // not imply they are: an image is content the tenant published, often
      // showing other people, and its lifecycle is the orphan sweep this module
      // already owns rather than a subject request.
      erasure: "severed_with_subject_row",
      rationale:
        "Files this person uploaded, with the original filename, alt text and caption they wrote. The metadata is theirs and exports; the object itself belongs to the tenant's published content and is governed by this module's orphan lifecycle, not by an erasure."
    },
    {
      key: "media_library.media_library_tenant_state",
      tableName: "awcms_media_library_tenant_state",
      ownerModuleKey: "media_library",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "A single row per tenant recording whether managed-media enforcement has been switched on. A one-way operational latch with no author column and no person in it."
    }
  ],
  jobs: [
    {
      command: "bun run news-media:reconcile",
      schedule: {
        mode: "cron",
        expression: "0 2 * * *",
        backlog: "bounded"
      },
      purpose:
        "Reconcile awcms_news_media_objects metadata against the real R2 bucket contents; clean up expired pending uploads and grace-period-expired orphans in bounded, race-safe batches (dry-run supported).",
      recommendedSchedule: "Daily via cron/systemd timer.",
      environmentNotes:
        'No-op when NEWS_MEDIA_R2_ENABLED is not "true". Requires real network egress to the Cloudflare R2 API in addition to PostgreSQL — not a pure database operation.',
      safeInOfflineLan: false
    }
  ]
});
