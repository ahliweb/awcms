import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getSetupDatabaseClient } from "../../../../lib/database/client";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { validateSetupInitializeInput } from "../../../../modules/tenant-admin/domain/setup-validation";
import { bootstrapPlatformTenant } from "../../../../modules/tenant-admin/application/platform-bootstrap";

/**
 * Uses `getSetupDatabaseClient()` — a dedicated setup role, not the
 * ordinary web-runtime connection every other route uses. The only route
 * that creates a tenant/office/owner from scratch.
 */
export const POST: APIRoute = async ({ request }) => {
  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateSetupInitializeInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Setup input is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
  const sql = getSetupDatabaseClient();

  return sql.begin(async (tx) => {
    const result = await bootstrapPlatformTenant(tx, input);

    if (result.outcome === "already_initialized") {
      return fail(403, "ACCESS_DENIED", "Setup has already been completed.");
    }

    return ok({
      tenantId: result.tenantId,
      officeId: result.officeId,
      ownerProfileId: result.ownerProfileId,
      ownerIdentityId: result.ownerIdentityId,
      ownerTenantUserId: result.ownerTenantUserId,
      ownerRoleId: result.ownerRoleId
    });
  });
};
