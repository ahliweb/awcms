import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import { syncModuleDescriptors } from "../../../../modules/module-management/application/descriptor-sync";
import { listModules } from "../../../../modules";
import {
  formatModuleDependencyGraphIssue,
  validateModuleDependencyGraph
} from "../../../../modules/_shared/module-dependency-graph";

const SYNC_GUARD = {
  moduleKey: "module_management",
  activityCode: "modules",
  action: "sync" as const
};

/**
 * `POST /api/v1/modules/sync` — trigger the descriptor sync service on
 * demand. No `Idempotency-Key` required: the sync itself is already naturally
 * idempotent — running it twice in a row is always safe and produces the same
 * result, not a duplicate side effect.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  // Pure pre-check (no DB) so a structurally invalid registry fails with a
  // clean, structured response here rather than an uncaught error propagating
  // out of `withTenant` (which would misrecord this as a database
  // circuit-breaker failure). `syncModuleDescriptors` itself ALSO refuses to
  // write on the same condition — deliberately redundant defense in depth.
  const graphResult = validateModuleDependencyGraph(listModules());

  if (!graphResult.valid) {
    return fail(
      500,
      "MODULE_REGISTRY_INVALID",
      "The module registry failed dependency-graph validation — refusing to sync.",
      {},
      { issues: graphResult.issues.map(formatModuleDependencyGraphIssue) }
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      SYNC_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await syncModuleDescriptors(tx);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "module_management",
      action: "modules_synced",
      resourceType: "module_registry",
      severity: "info",
      message: `Module registry synced: ${result.created.length} created, ${result.updated.length} updated, ${result.orphaned.length} orphaned.`,
      attributes: {
        created: result.created,
        updated: result.updated,
        orphaned: result.orphaned
      },
      correlationId
    });

    return ok(result);
  });
};
