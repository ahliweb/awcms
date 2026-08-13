import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  listPartners,
  registerPartner
} from "../../../../modules/identity-access/application/partner-registry-store";
import {
  validateRegisterPartnerInput,
  type RegisterPartnerInput
} from "../../../../modules/identity-access/domain/partner-registration";

/**
 * `GET` and `POST /api/v1/partners` (ADR-0089) — the partner REGISTRY, which
 * until now could only be written by an operator with a psql prompt.
 *
 * ## Both are PLATFORM-scoped, and `read` is not an oversight
 *
 * The same reasoning `/api/v1/tenants` records. `create` names a new party to
 * the deployment's commercial arrangements, which is not something a tenant
 * does to its own data. `read` lists EVERY partner, and ADR-0089 refused
 * exactly that list as a tenant-readable artefact: "a directory of every
 * commercial partnership on this installation, readable by every tenant".
 *
 * Two independent mechanisms keep it that way, and both are load-bearing. RLS
 * puts every row under the platform tenant, so no customer session can see one
 * even holding a grant. The chokepoint refuses a platform-scoped permission
 * unless the acting tenant IS the platform tenant, so no grant row makes it
 * reachable. `tenantId` below is therefore the platform tenant by construction.
 *
 * ## What this endpoint deliberately does NOT do
 *
 * It does not provision a tenant — a partner is an ordinary tenant, and the one
 * it names must already exist. It does not grant anything: the row is the
 * PRECONDITION a customer's engagement checks through a foreign key, never a
 * conferral, and `activeRoleGrants` must never learn to read it.
 *
 * There is no `DELETE`, and that is a decision. `awcms_partners.partner_tenant_id`
 * is the target of foreign keys from both engagements and delegated grants, and
 * ADR-0091/`sql/120` made a grant deliberately OUTLIVE its engagement. A delete
 * would fail as soon as one partnership had ever existed, and "fixing" that
 * with `ON DELETE CASCADE` would silently cut every partnership on the
 * installation. Retirement is a `status` change, and `status` is pinned by
 * `sql/116` until something reads suspension.
 *
 * ## Not idempotency-keyed
 *
 * Both natural keys carry GLOBAL unique indexes, so a duplicate submit is a 409
 * naming which key was taken rather than a second row. There is no outcome to
 * replay.
 */
const REGISTRY_GUARD = {
  moduleKey: "identity_access",
  activityCode: "partner_registry"
} as const;

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: { ...REGISTRY_GUARD, action: "read" },
  handler: async ({ tx, tenantId }) => {
    return ok({ items: await listPartners(tx, tenantId) });
  }
});

export const POST = defineTenantRoute<RegisterPartnerInput>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const body = await readJsonBody(request);

    if (body.tooLarge) return bodyTooLargeResponse(body.limitBytes);

    const validation = validateRegisterPartnerInput(body.value);

    if (!validation.valid) {
      return fail(
        422,
        "VALIDATION_FAILED",
        "Partner registration is invalid.",
        {},
        validation.errors
      );
    }

    return validation.value;
  },
  authorize: { ...REGISTRY_GUARD, action: "create" },
  handler: async ({ tx, tenantId, auth, prepared }) => {
    const result = await registerPartner(tx, tenantId, prepared);

    if (result.outcome === "tenant_not_found") {
      return fail(
        404,
        "TENANT_NOT_FOUND",
        "No such tenant on this deployment."
      );
    }

    if (result.outcome === "self") {
      return fail(
        409,
        "CONFLICT",
        "The platform tenant cannot be registered as a partner of itself."
      );
    }

    if (result.outcome === "already_registered") {
      return fail(409, "CONFLICT", "That tenant is already a partner.");
    }

    if (result.outcome === "code_taken") {
      return fail(409, "CONFLICT", "That partnerCode is already in use.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "partner.registered",
      resourceType: "partner",
      resourceId: result.partner.id,
      severity: "warning",
      message: `Tenant registered as partner "${result.partner.partnerCode}".`,
      attributes: {
        partnerTenantId: result.partner.partnerTenantId,
        partnerCode: result.partner.partnerCode
      }
    });

    return jsonResponse(
      { success: true, data: { partner: result.partner }, meta: {} },
      { status: 201 }
    );
  }
});
