/**
 * `POST /api/v1/tenants/{id}/suspend` — Issue #429, ADR-0073.
 *
 * Stops serving a tenant. Platform-scoped (ADR-0053, and ADR-0054 §2's
 * reasoning verbatim): it changes ANOTHER party's state, so no ordinary tenant
 * may hold it however its roles are arranged.
 *
 * No revocation sweep runs, and none is needed. The chokepoint checks the
 * TENANT, not the credential, so every live session and every machine
 * credential — which can live up to a year — is refused from its next request
 * onward. That is the half of suspension this repo was missing: before
 * ADR-0073, suspending a tenant killed its public site instantly and left its
 * admin sessions and machine credentials fully working.
 */
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { resolvePlatformTenantIdIgnoringStatus } from "../../../../../lib/tenant/platform-tenant";
import { suspendTenant } from "../../../../../modules/tenant-admin/application/tenant-lifecycle";

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
    action: "disable"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const targetTenantId = params.id;

    if (!targetTenantId || !UUID_PATTERN.test(targetTenantId)) {
      return fail(400, "VALIDATION_ERROR", "Tenant id must be a UUID.");
    }

    const result = await suspendTenant(
      tx,
      targetTenantId,
      prepared.reason,
      {
        tenantUserId: auth.context.tenantUserId,
        tenantId,
        correlationId: locals.correlationId as string | undefined
      },
      await resolvePlatformTenantIdIgnoringStatus(tx)
    );

    if (result.outcome === "not_found") {
      return fail(404, "NOT_FOUND", "Tenant not found.");
    }

    if (result.outcome === "platform_blocked") {
      // A comprehensible refusal instead of a locked control plane. The
      // chokepoint exempts the platform tenant as a second belt; this is what
      // keeps an operator from getting there by accident in the first place.
      return fail(
        409,
        "PLATFORM_TENANT_PROTECTED",
        "The platform tenant cannot be suspended: it would be refused every action, including the one that lifts the suspension."
      );
    }

    return ok({
      tenantId: targetTenantId,
      status: result.outcome === "changed" ? result.toStatus : result.status,
      changed: result.outcome === "changed"
    });
  }
});
