import { created, fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  engagePartner,
  listPartnerEngagements
} from "../../../../../modules/identity-access/application/partner-engagement-store";

/**
 * `GET`/`POST /api/v1/access/partner-engagements` — ADR-0089, Gelombang 8 PR
 * 8.4 of #423.
 *
 * The CUSTOMER's side of a partnership, and the only side that can write one.
 * ADR-0089's rule in one endpoint: the customer initiates, always. There is no
 * partner-facing counterpart to this route and there is not meant to be — a
 * partner that could insert its own engagement would be handing itself reach.
 *
 * ## `POST` refuses identically for "not a partner" and "no such tenant"
 *
 * Both answer `404`. Distinguishing them would turn this endpoint into a
 * directory: a caller could sweep tenant ids and learn who the platform's
 * partners are, which is exactly the artefact ADR-0089 refused to build as a
 * table. The database enforces the rule (the FK into `awcms_partners`); this
 * route only translates the violation into a message.
 */
const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "partner_access",
  action: "read"
} as const;

const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "partner_access",
  action: "configure"
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EngagePrepared = { partnerTenantId: string };

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: READ_GUARD,
  handler: async ({ tx, tenantId }) =>
    ok({ engagements: await listPartnerEngagements(tx, tenantId) })
});

export const POST = defineTenantRoute<EngagePrepared>({
  workClass: "interactive",
  prepare: async ({ request }): Promise<EngagePrepared | Response> => {
    const bodyRead = await readJsonBody(request);
    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const body = bodyRead.value as { partnerTenantId?: unknown } | null;
    const partnerTenantId = body?.partnerTenantId;

    if (
      typeof partnerTenantId !== "string" ||
      !UUID_PATTERN.test(partnerTenantId)
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "partnerTenantId is required and must be a UUID."
      );
    }

    return { partnerTenantId };
  },
  authorize: CONFIGURE_GUARD,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    let result;
    try {
      result = await engagePartner(
        tx,
        tenantId,
        prepared.partnerTenantId,
        auth.context.tenantUserId
      );
    } catch {
      // The FK into `awcms_partners` is what actually enforces "registered
      // partners only", and it fires as a constraint violation. Caught HERE,
      // inside the transaction, so the 4xx below does not ride out on a
      // transaction the database has already aborted.
      return fail(404, "NOT_FOUND", "No such partner.");
    }

    if (!result.ok) {
      if (result.code === "ALREADY_ENGAGED") {
        return fail(
          409,
          "CONFLICT",
          "That partner is already engaged for this tenant."
        );
      }
      // ADR-0093. Told plainly rather than folded into the 404 above: unlike
      // `SELF`/`NOT_A_PARTNER`, this names a tenant the customer already knows
      // is a partner — they were about to engage it — so there is nothing left
      // to withhold, and "no such partner" would send them looking for a typo
      // that is not there.
      if (result.code === "PARTNER_SUSPENDED") {
        return fail(
          409,
          "PARTNER_SUSPENDED",
          "That partner is suspended on this deployment and cannot be engaged."
        );
      }
      // `SELF` deliberately answers like `NOT_A_PARTNER`: a tenant asking to
      // engage itself learns nothing it did not already know.
      return fail(404, "NOT_FOUND", "No such partner.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "create",
      resourceType: "partner_engagement",
      resourceId: result.engagement.id,
      severity: "warning",
      message: "Partner engaged for this tenant.",
      attributes: { partnerTenantId: result.engagement.partnerTenantId },
      correlationId: locals.correlationId
    });

    return created({ engagement: result.engagement });
  }
});
