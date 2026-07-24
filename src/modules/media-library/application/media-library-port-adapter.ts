/**
 * Concrete `MediaLibraryPort` implementation (ADR-0036 ownership inversion) —
 * wired into consumers' write/render paths at the composition root (route
 * handlers + the `blog:publish:scheduled` worker), never imported by
 * `blog_content`/`news_portal`'s `application`/`domain` files directly. See
 * `_shared/ports/media-library-port.ts` for the full "why a port" reasoning and
 * what changed from `NewsMediaPort`.
 *
 * This file imports ONLY from `media_library`. That is the whole point of the
 * extraction: its predecessor
 * (`news-portal/application/news-media-port-adapter.ts`, deleted in this change)
 * had to live in `news_portal` because it read that module's editorial R2-only
 * state, which made a System Foundation capability unavailable to any tenant not
 * running a news portal.
 *
 * ## THREE failed attempts at the per-tenant signal — read before touching this again
 *
 * History preserved from the deleted adapter. It is about how to detect "this
 * tenant genuinely opted in", which is exactly what
 * `isManagedMediaEnforcedForTenant` (`sql/053`) now answers, so it stays
 * relevant here.
 *
 * 1. `fetchTenantModuleEntry(...).tenantEnabled` — every module in this repo is
 *    opt-out-by-default (no `awcms_tenant_modules` row means enabled), so
 *    virtually every tenant reads as enabled regardless of whether they ever
 *    opted in. Made the entire tenant-scoping a no-op — activating for one tenant
 *    silently tightened validation for every OTHER tenant on the same deployment.
 * 2. `entry.enabledAt !== null` — `enableTenantModule` validates the tenant's
 *    CURRENT state first, and since that state already reads as enabled-by-default
 *    (same fact as #1), the lifecycle validation rejects the call and never
 *    writes a row. A tenant that genuinely just opted in had `enabledAt: null`,
 *    identical to one that never touched it.
 * 3. `awcms_module_settings` — this one DID correctly distinguish "applied" from
 *    "never touched." But that table is directly tenant-writable through the
 *    generic `PATCH /api/v1/tenant/modules/{moduleKey}/settings` endpoint, gated
 *    only by the generic `module_management.settings.update` permission (granted
 *    to Owner/Admin by default seed RBAC — entirely unrelated to media
 *    permissions). A tenant holding it could `PATCH` the marker to `null` and
 *    silently disable ALL media validation for themselves — confirmed
 *    exploitable end-to-end in a security re-audit.
 *
 * The real, working signal: a dedicated table with NO generic write endpoint
 * anywhere (`awcms_media_library_tenant_state`, migration `053`), written only by
 * `media-library-tenant-state.ts`'s `markManagedMediaEnforced`.
 */
import {
  fetchNewsMediaObjectById,
  fetchNewsMediaObjectsByIds,
  isNewsMediaObjectSafeForPublicReference
} from "./media-object-directory";
import { isManagedMediaEnforcedForTenant } from "./media-library-tenant-state";
import { evaluateManagedMediaReadiness } from "../domain/managed-media-readiness";
import type {
  MediaLibraryPort,
  ResolvedMediaReferenceDTO
} from "../../_shared/ports/media-library-port";

export const mediaLibraryPortAdapter: MediaLibraryPort = {
  async isManagedMediaEnforcementActiveForTenant(
    tx: Bun.SQL,
    tenantId: string,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<boolean> {
    // Both halves must hold. Deployment readiness alone would silently opt in
    // every tenant on an R2-configured deployment; the tenant flag alone would
    // enforce registry-backed references on a deployment with no working media
    // storage to back them, making content unwritable.
    if (!evaluateManagedMediaReadiness(env).ready) {
      return false;
    }

    return isManagedMediaEnforcedForTenant(tx, tenantId);
  },

  async isMediaReferenceSafe(
    tx: Bun.SQL,
    tenantId: string,
    mediaObjectId: string
  ): Promise<boolean> {
    const media = await fetchNewsMediaObjectById(tx, tenantId, mediaObjectId);
    return (
      media !== null && isNewsMediaObjectSafeForPublicReference(media.status)
    );
  },

  async resolveMediaReferences(
    tx: Bun.SQL,
    tenantId: string,
    mediaObjectIds: readonly string[]
  ): Promise<ReadonlyMap<string, ResolvedMediaReferenceDTO>> {
    const resolved = new Map<string, ResolvedMediaReferenceDTO>();

    // One `id = ANY(...)` round-trip for the whole batch, instead of one
    // `fetchNewsMediaObjectById` per id. Unsafe / nonexistent / cross-tenant ids
    // are simply absent from the result (the row is filtered by status or never
    // returned), never thrown — same contract as before.
    const mediaObjects = await fetchNewsMediaObjectsByIds(
      tx,
      tenantId,
      mediaObjectIds
    );

    for (const media of mediaObjects) {
      if (isNewsMediaObjectSafeForPublicReference(media.status)) {
        resolved.set(media.id, {
          publicUrl: media.publicUrl,
          altText: media.altText,
          mimeType: media.mimeType,
          width: media.width,
          height: media.height,
          sizeBytes: media.sizeBytes
        });
      }
    }

    return resolved;
  }
};
