/**
 * Concrete `NewsMediaPort` implementation (Issue #681, epic #679
 * platform-hardening) — `news_portal`'s own capability, wired into
 * `blog_content`'s write/render paths at the composition root (route
 * handlers), never imported by `blog_content`'s `application`/`domain`
 * files directly. See `_shared/ports/news-media-port.ts` for the full
 * "why a port" reasoning.
 *
 * `isFullOnlineR2ModeActiveForTenant` below is the exact function
 * previously named `isNewsPortalFullOnlineR2ModeActiveForTenant` in
 * `blog-content/application/news-portal-r2-mode-gate.ts` (Issue #636) —
 * moved here verbatim, together with its header comment, because it is
 * fundamentally `news_portal`'s OWN "is my feature active for this
 * tenant" question, not something `blog_content` should have needed to
 * import in the first place.
 *
 * ## THREE failed attempts before the working signal below — read before touching this again (PR #666, three review rounds; history preserved from the original file)
 *
 * 1. `fetchTenantModuleEntry(...).tenantEnabled` — every module in this
 *    repo is opt-out-by-default (no `awcms_tenant_modules` row means
 *    enabled), so virtually every tenant reads as `news_portal`-enabled
 *    regardless of whether they ever applied the preset. Made the entire
 *    tenant-scoping a no-op — activating the preset for one tenant
 *    silently tightened validation for every OTHER tenant on the same
 *    deployment too.
 * 2. `entry.enabledAt !== null` — reasoning was "only an explicit
 *    `enableTenantModule` call sets this column." Also broken:
 *    `enableTenantModule` validates the tenant's CURRENT state first, and
 *    since that state already reads as enabled-by-default (same fact as
 *    #1), the lifecycle validation rejects the call as
 *    `MODULE_ALREADY_ENABLED`, which `applyModulePreset` treats as
 *    `already_satisfied` and — critically — never writes a row at all. A
 *    tenant that genuinely just applied the preset had `enabledAt: null`,
 *    identical to one that never touched it. Confirmed broken by a
 *    failing integration test, not just theory.
 * 3. `awcms_module_settings` (`updateModuleSettings`/
 *    `fetchModuleSettingsView`) — this one DID correctly distinguish
 *    "applied" from "never touched." But that table is directly
 *    tenant-writable through the generic
 *    `PATCH /api/v1/tenant/modules/{moduleKey}/settings` endpoint, gated
 *    only by the generic `module_management.settings.update` permission
 *    (granted to Owner/Admin by default seed RBAC — entirely unrelated to
 *    `blog_content`/`news_portal` permissions). A tenant holding that
 *    permission could `PATCH` the marker key to `null` and silently
 *    disable ALL of Issue #636's validation for themselves — confirmed
 *    exploitable end-to-end in a security re-audit.
 *
 * The real, working signal: a brand-new, dedicated table
 * (`awcms_news_portal_tenant_state`, migration `043`) that has NO
 * generic write endpoint anywhere. The only code that ever writes to it is
 * `apply-news-portal-preset.ts` (`applyNewsPortalFullOnlineR2Preset`, the
 * sanctioned entry point for this preset).
 */
import { isFullOnlineR2ModeAppliedForTenant } from "./news-portal-tenant-state";
import { evaluateNewsPortalFullOnlineR2Readiness } from "../domain/news-portal-preset-readiness";
import { resolveNewsMediaR2Config } from "../domain/news-media-r2-config";
import {
  fetchNewsMediaObjectById,
  fetchNewsMediaObjectsByIds,
  isNewsMediaObjectSafeForPublicReference
} from "./news-media-object-directory";
import type {
  NewsMediaPort,
  ResolvedNewsMediaReferenceDTO
} from "../../_shared/ports/news-media-port";

export const newsMediaPortAdapter: NewsMediaPort = {
  async isFullOnlineR2ModeActiveForTenant(
    tx: Bun.SQL,
    tenantId: string,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<boolean> {
    if (!evaluateNewsPortalFullOnlineR2Readiness(env).ready) {
      return false;
    }

    return isFullOnlineR2ModeAppliedForTenant(tx, tenantId);
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
  ): Promise<ReadonlyMap<string, ResolvedNewsMediaReferenceDTO>> {
    const resolved = new Map<string, ResolvedNewsMediaReferenceDTO>();

    // Issue #835 §1: one `id = ANY(...)` round-trip for the whole batch,
    // instead of one `fetchNewsMediaObjectById` per id. Unsafe / nonexistent
    // / cross-tenant ids are simply absent from the result (the row is filtered
    // by status or never returned), never thrown — same contract as before.
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
  },

  resolveMediaPublicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
    // Issue #859 (epic #818): the config-resolution capability the LinkedIn
    // provider adapter (social_publishing) consumes through this port instead
    // of importing `resolveNewsMediaR2Config` statically — which had forced
    // `news_portal` to be a HARD dependency of `social_publishing`. The
    // config knowledge (the `NEWS_MEDIA_R2_*` var naming/defaults, its
    // deliberate deviations) stays here, in `news_portal`, where it belongs.
    return resolveNewsMediaR2Config(env).publicBaseUrl;
  }
};
