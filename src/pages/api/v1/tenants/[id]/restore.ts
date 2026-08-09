/**
 * `POST /api/v1/tenants/{id}/restore` — Issue #429, ADR-0073.
 *
 * Lifts a suspension and resumes service. Platform-scoped for the same reason
 * `suspend` is: it changes ANOTHER party's state.
 *
 * Guarded on `restore`, not on `disable`. Those are two decisions, and an
 * incident is exactly when you want someone who can bring a customer back
 * WITHOUT being able to cut one off — the same split `machine_credentials`
 * already draws between `create` and `revoke`.
 *
 * There is no `platform_blocked` branch here: restoring the platform tenant is
 * harmless and, if it somehow got suspended, is precisely the repair you want
 * to be possible.
 */
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { restoreTenant } from "../../../../../modules/tenant-admin/application/tenant-lifecycle";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TENANT_ADMIN_MODULE_KEY = "tenant_admin";
const TENANT_LIFECYCLE_ACTIVITY_CODE = "tenant_lifecycle";
const MAX_REASON_LENGTH = 500;

type Prepared = { reason: string | null };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const bodyRead = await readJsonBody<{ reason?: unknown }>(request);

    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const reason = bodyRead.value?.reason;

    if (reason !== undefined && reason !== null && typeof reason !== "string") {
      return fail(400, "VALIDATION_ERROR", "reason must be a string.");
    }

    const trimmed = typeof reason === "string" ? reason.trim() : "";

    if (trimmed.length > MAX_REASON_LENGTH) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `reason must be at most ${MAX_REASON_LENGTH} characters.`
      );
    }

    return { reason: trimmed.length > 0 ? trimmed : null };
  },
  authorize: {
    moduleKey: TENANT_ADMIN_MODULE_KEY,
    activityCode: TENANT_LIFECYCLE_ACTIVITY_CODE,
    action: "restore"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const targetTenantId = params.id;

    if (!targetTenantId || !UUID_PATTERN.test(targetTenantId)) {
      return fail(400, "VALIDATION_ERROR", "Tenant id must be a UUID.");
    }

    const result = await restoreTenant(tx, targetTenantId, prepared.reason, {
      tenantUserId: auth.context.tenantUserId,
      tenantId,
      correlationId: locals.correlationId as string | undefined
    });

    if (result.outcome === "not_found") {
      return fail(404, "NOT_FOUND", "Tenant not found.");
    }

    return ok({
      tenantId: targetTenantId,
      status: result.outcome === "changed" ? result.toStatus : result.status,
      changed: result.outcome === "changed"
    });
  }
});
