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
 * `dependencies` excludes `news_portal`/`blog_content` permanently, not
 * incidentally: media must never depend on its own consumers.
 *
 * PORT NOTES vs awcms-micro: this base ports the ownership inversion + the
 * enforcement-enable switch (micro step 5a). The media lifecycle/browser surface
 * (`/api/v1/media/objects/*`, `/admin/media` — micro step 5d), the responsive
 * `srcset` render path (step 5b), and the PDF media type (step 5c) are NOT ported
 * here, so this module declares no `navigation` yet (the `/admin/media` page it
 * would point at does not exist in this base) and its allowed MIME set stays the
 * four raster types.
 */
export const mediaLibraryModule = defineModule({
  key: "media_library",
  name: "Media Library",
  version: "0.1.0",
  status: "active",
  description:
    "Tenant-scoped media object registry and upload flow, reusable by every website module (ADR-0036, System Foundation). Owns `awcms_news_media_objects` (migrations 041/042/045) — a generic registry keyed by `module_key` with `owner_resource_type`/`owner_resource_id` references, direct-to-R2 presigned upload with real magic-byte MIME sniffing and server-side SHA-256 checksum verification, orphan lifecycle, and R2 reconciliation (the `news-media:reconcile` job). The table keeps its `news_media` name deliberately (ADR-0036 §3): it is referenced by three migrations and a hard composite FK from `awcms_news_portal_ad_placements`, so renaming would trade a cosmetic annoyance for real risk. Provides the `media_library` capability (`_shared/ports/media-library-port.ts`) consumed by `blog_content` (optional — its media handling no-ops when enforcement is off) and `news_portal` (required — its ad placements hold a real FK to a media object): media reference safety, resolution, and whether managed-media enforcement is active for a tenant (this module's own readiness plus its own per-tenant flag, migration 053) — so a brochure site gets managed media without a news portal. Turning that flag ON is a dedicated, readiness-gated, one-way switch (`POST /api/v1/media/enforcement`, migration 054). `news_portal` retains only what is genuinely its own: homepage sections, ad placements, and (where ported) the R2-only editorial preset. This module never transcodes bytes inside a DB transaction (ADR-0006), and is deliberately not a CDN, image proxy, or DAM. PORT DROPS vs awcms-micro: the media lifecycle/browser surface (`/api/v1/media/objects/*`, `/admin/media`), responsive `srcset` render, and PDF media type are not ported to this base.",
  dependencies: ["tenant_admin", "identity_access"],
  type: "system",
  isCore: false,
  // ADR-0036 — sole provider of the `media_library` capability
  // (`_shared/ports/media-library-port.ts`, implemented by
  // `application/media-library-port-adapter.ts`, wired at each route's
  // composition root). Consumed by `blog_content` (optional — its media handling
  // no-ops when enforcement is off) and by `news_portal` (required — its ad
  // placements hold a real FK to a media object).
  //
  // `consumes` stays empty and must remain so: this module answers media
  // questions from its own registry, its own readiness, and its own per-tenant
  // flag. A System Foundation module consuming a domain capability would be the
  // ADR-0013 §1 inversion this extraction exists to remove.
  capabilities: {
    provides: ["media_library"]
  },
  api: {
    openApiPath: "openapi/awcms-public-api.openapi.yaml",
    basePath: "/api/v1/media/news-images"
  },
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
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "attach",
      description: "Attach a verified media object to an owning resource"
    },
    {
      activityCode: MEDIA_PERMISSION_ACTIVITY_CODE,
      action: "detach",
      description: "Detach a media object from its owning resource"
    },
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
  jobs: [
    {
      command: "bun run news-media:reconcile",
      purpose:
        "Reconcile awcms_news_media_objects metadata against the real R2 bucket contents; clean up expired pending uploads and grace-period-expired orphans in bounded, race-safe batches (dry-run supported).",
      recommendedSchedule: "Daily via cron/systemd timer.",
      environmentNotes:
        'No-op when NEWS_MEDIA_R2_ENABLED is not "true". Requires real network egress to the Cloudflare R2 API in addition to PostgreSQL — not a pure database operation.',
      safeInOfflineLan: false
    }
  ]
});
