import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import { validateSetupInitializeInput } from "../../../../modules/tenant-admin/domain/setup-validation";
import type { SetupInitializeInput } from "../../../../modules/tenant-admin/domain/setup-validation";
import { provisionTenant } from "../../../../modules/tenant-admin/application/tenant-provisioning";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";

/**
 * `GET /api/v1/tenants` and `POST /api/v1/tenants` (ADR-0054) — the tenant
 * directory and tenant provisioning.
 *
 * ## Both are PLATFORM-scoped, and `read` is not an oversight
 *
 * `create` obviously is: adding a tenant adds a PARTY to the deployment, which
 * is not something a tenant does to its own data.
 *
 * `read` is platform-scoped for a reason that is easy to miss — this endpoint
 * lists EVERY tenant. A tenant-scoped read permission here would let any
 * customer's owner enumerate the platform's customer list, which is a
 * confidentiality leak that no RLS policy would catch, because `awcms_tenants`
 * is deliberately the RLS-free root table.
 *
 * The chokepoint refuses both unless the acting tenant IS the platform tenant
 * (ADR-0053), so neither is reachable from an ordinary tenant even if a grant
 * row for it somehow existed.
 *
 * ## Until this route, a second tenant was impossible
 *
 * `POST /api/v1/setup/initialize` claims the `awcms_setup_state` singleton, so
 * it succeeds exactly once. Every deployment was therefore permanently
 * single-tenant, and the `multi` branch of `resolveTenancyMode` was
 * unreachable. This is what makes tenancy an actual state rather than a
 * constant.
 */
const IDEMPOTENCY_SCOPE = "tenant_admin_tenant_provisioning";

const TENANT_ADMIN_MODULE_KEY = "tenant_admin";
const TENANT_PROVISIONING_ACTIVITY_CODE = "tenant_provisioning";

type TenantRow = {
  id: string;
  tenant_code: string;
  tenant_name: string;
  status: string;
  created_at: Date;
};

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: TENANT_ADMIN_MODULE_KEY,
    activityCode: TENANT_PROVISIONING_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx }) => {
    // `awcms_tenants` is the RLS-free root table, so this genuinely returns
    // every tenant — which is the whole point of a platform-scoped directory,
    // and exactly why the permission may not be tenant-scoped.
    //
    // Deliberately narrow: code, name, status, created_at. No owner identifier,
    // no settings, no counts. A directory answers "who is on this deployment",
    // not "what is inside their tenant" — the latter still requires acting as
    // that tenant.
    const rows = (await tx`
      SELECT id, tenant_code, tenant_name, status, created_at
      FROM awcms_tenants
      ORDER BY created_at DESC
      LIMIT 500
    `) as TenantRow[];

    return ok({
      items: rows.map((row) => ({
        id: row.id,
        tenantCode: row.tenant_code,
        tenantName: row.tenant_name,
        status: row.status,
        createdAt: row.created_at
      }))
    });
  }
});

type Prepared = { input: SetupInitializeInput; idempotencyKey: string };

export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    const body: unknown = bodyRead.value;

    // The SAME validator the setup wizard uses. Provisioning creates the same
    // shape of thing, so a second set of rules would drift — and the half that
    // matters most (a minimum-length owner password) is the half a hand-written
    // copy is most likely to soften.
    const validation = validateSetupInitializeInput(body);

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        validation.errors
          .map((error) => `${error.field}: ${error.message}`)
          .join("; ")
      );
    }

    return { input: validation.value, idempotencyKey };
  },
  authorize: {
    moduleKey: TENANT_ADMIN_MODULE_KEY,
    activityCode: TENANT_PROVISIONING_ACTIVITY_CODE,
    action: "create"
  },
  handler: async ({ tx, auth, prepared, tenantId }) => {
    // The request hash deliberately EXCLUDES the owner password: an idempotency
    // record is stored, and a stored hash of a credential is a credential at
    // rest. Everything else identifies the request uniquely enough.
    const requestHash = computeRequestHash({
      tenantCode: prepared.input.tenantCode,
      tenantName: prepared.input.tenantName,
      officeCode: prepared.input.officeCode,
      ownerLoginIdentifier: prepared.input.ownerLoginIdentifier
    });

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    // `tenantId` here is the PLATFORM tenant — the guard already established
    // that. It is passed so the new tenant's rows can be written under their
    // own RLS context and the caller's context restored afterwards, which is
    // what keeps the audit row below in the platform's log rather than in the
    // brand-new tenant's.
    const result = await provisionTenant(tx, prepared.input, tenantId);

    if (!result.ok) {
      return fail(
        409,
        "TENANT_CODE_TAKEN",
        "A tenant with that tenant_code already exists."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: TENANT_ADMIN_MODULE_KEY,
      action: "tenant_admin.tenant.provisioned",
      resourceType: "tenant",
      resourceId: result.tenant.tenantId,
      severity: "warning",
      message: "Tenant provisioned.",
      attributes: {
        tenantCode: prepared.input.tenantCode,
        // The owner's login identifier is NOT recorded here: audit attributes
        // are read by more eyes than the row itself, and `awcms-sensitive-data`
        // treats a login identifier as an identifier to mask, not to log.
        ownerTenantUserId: result.tenant.ownerTenantUserId
      }
    });

    const successResponse = ok({
      tenant: {
        id: result.tenant.tenantId,
        tenantCode: prepared.input.tenantCode,
        tenantName: prepared.input.tenantName,
        officeId: result.tenant.officeId,
        ownerTenantUserId: result.tenant.ownerTenantUserId
      }
    });
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      successBody
    );

    return successResponse;
  }
});
