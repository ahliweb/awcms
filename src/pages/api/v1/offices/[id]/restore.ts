import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import {
  DuplicateOfficeCodeError,
  restoreOffice
} from "../../../../../modules/tenant-admin/application/office-directory";

/**
 * Restore reuses the `office_management.update` permission rather than a
 * dedicated `restore` action: the activity has no `restore` permission to gate
 * on, and un-deleting is an edit of a record's lifecycle state — the same
 * authority that may change an office may bring one back. The endpoint guard is
 * the authority; the admin page mirrors this by gating its restore control on
 * `.update`.
 */
const RESTORE_GUARD = {
  moduleKey: "tenant_admin",
  activityCode: "office_management",
  action: "update" as const
};

/**
 * `POST /api/v1/offices/{id}/restore` — un-soft-deletes an office. 404 when the
 * id is not currently soft-deleted (idempotent-safe: a repeat restore is a 404,
 * never a duplicate). 409 when a live office has since taken the same code — the
 * partial unique index blocks the restore and the caller must resolve the clash.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const officeId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!officeId) return fail(400, "VALIDATION_ERROR", "Office id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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
      RESTORE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    try {
      const office = await restoreOffice(
        tx,
        tenantId,
        auth.context.tenantUserId,
        officeId,
        correlationId
      );

      if (!office) {
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "Office not found or not currently soft-deleted."
        );
      }

      return ok(office);
    } catch (error) {
      // A `DuplicateOfficeCodeError` follows a unique violation that already
      // aborted the transaction; returning 409 here is safe because the commit
      // degrades to a rollback and nothing further is written to `tx`. Caught
      // inside `withTenant` so the burst does not count toward the shared
      // circuit breaker (same reasoning as the create route).
      if (error instanceof DuplicateOfficeCodeError) {
        return fail(409, "OFFICE_CODE_ALREADY_EXISTS", error.message);
      }

      throw error;
    }
  });
};
