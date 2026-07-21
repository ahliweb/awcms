import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  fetchDraftVersion,
  fetchThemeTenantState,
  listPublishedVersions
} from "../../../../modules/theming/application/theme-config-directory";
import { listThemeDescriptors } from "../../../../modules/theming/theme-registry";
import {
  THEMING_CONFIG_ACTIVITY_CODE,
  THEMING_MODULE_KEY
} from "../../../../modules/theming/domain/theme-permissions";

/**
 * `GET /api/v1/theming` (Issue #269, ADR-0029 §4) — everything the theming admin
 * surface needs to render the selection/editor/history view for this tenant: the
 * available (build-time, reviewed) theme descriptors, the tenant's active theme
 * pointer, its current draft config (if any), and its published version history.
 * ABAC-gated (`theming.config.read`) and tenant-scoped (`withTenant` + RLS).
 */
const READ_GUARD = {
  moduleKey: THEMING_MODULE_KEY,
  activityCode: THEMING_CONFIG_ACTIVITY_CODE,
  action: "read" as const
};

export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );
    if (!auth.allowed) {
      return auth.denied;
    }

    const [state, draft, versions] = await Promise.all([
      fetchThemeTenantState(tx, tenantId),
      fetchDraftVersion(tx, tenantId),
      listPublishedVersions(tx, tenantId, 50)
    ]);

    return ok({
      themes: listThemeDescriptors(),
      state,
      draft: draft
        ? {
            versionId: draft.id,
            themeKey: draft.themeKey,
            config: draft.config,
            configHash: draft.configHash
          }
        : null,
      // Shape MUST match the shared OpenAPI `ThemeVersion` schema
      // (openapi/modules/theming.openapi.yaml) that publish/rollback also
      // return — `versionId` (not `id`), and no `themeVersion` field. The
      // deferred rollback UI keys off `versions[].versionId`.
      versions: versions.map((v) => ({
        versionId: v.id,
        themeKey: v.themeKey,
        versionNumber: v.versionNumber,
        configHash: v.configHash,
        publishedAt: v.publishedAt
      }))
    });
  });
};
