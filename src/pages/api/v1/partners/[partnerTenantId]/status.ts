import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { setPartnerStatus } from "../../../../../modules/identity-access/application/partner-registry-store";
import {
  isPartnerStatus,
  PARTNER_STATUSES,
  type PartnerStatus
} from "../../../../../modules/identity-access/domain/partner-suspension";

/**
 * `PATCH /api/v1/partners/{partnerTenantId}/status` (ADR-0093, Issue #543) —
 * suspend or reinstate a registered partner. PLATFORM-scoped.
 *
 * ## One endpoint, two actions, and the guard is a function of the body
 *
 * `disable` and `restore` are separate permissions because they are separate
 * authorities: an operator who may stop a partner reaching in need not also be
 * the one who lets them back. Two complete guard literals rather than one
 * literal with a computed `action` — the enforcement gate reads guards as
 * three-key literals, and a ternary inside one makes BOTH keys read as
 * "enforced by nothing" (the trap #537 hit).
 *
 * ## What suspending does, and the much longer list of what it does not
 *
 * It writes one column. No grant is revoked, no engagement is severed, nothing
 * cascades — `sql/120` made a grant outlive its engagement deliberately,
 * because "who could see our data, and until when" has to stay answerable
 * AFTER the vendor is dismissed. Effectiveness is COMPUTED per request at the
 * chokepoint, so reinstating restores every surviving grant's reach without
 * anybody rewriting a row.
 *
 * ## Not idempotency-keyed
 *
 * The write is a guarded transition to a NAMED end state, so a replayed
 * request converges rather than repeating work — and `unchanged` is reported
 * as success precisely so a retry is not an error. There is no outcome a
 * stored response would protect.
 */
type StatusBody = { status: PartnerStatus };

export const PATCH = defineTenantRoute<StatusBody>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const body = await readJsonBody(request);

    if (body.tooLarge) return bodyTooLargeResponse(body.limitBytes);

    const raw = (body.value as { status?: unknown } | null)?.status;

    // Validated against the SAME list the CHECK constraint allows, exported
    // from the domain — a screen and a writer cannot disagree with the
    // database about what a status may be.
    if (typeof raw !== "string" || !isPartnerStatus(raw)) {
      return fail(
        422,
        "VALIDATION_FAILED",
        `status must be one of ${PARTNER_STATUSES.join(", ")}.`
      );
    }

    return { status: raw };
  },
  authorize: ({ prepared }) =>
    prepared.status === "suspended"
      ? {
          moduleKey: "identity_access",
          activityCode: "partner_registry",
          action: "disable"
        }
      : {
          moduleKey: "identity_access",
          activityCode: "partner_registry",
          action: "restore"
        },
  handler: async ({ tx, tenantId, auth, prepared, params }) => {
    const partnerTenantId = params.partnerTenantId;

    if (!partnerTenantId) {
      return fail(400, "VALIDATION_FAILED", "partnerTenantId is required.");
    }

    const result = await setPartnerStatus(
      tx,
      tenantId,
      partnerTenantId,
      prepared.status
    );

    if (result.outcome === "not_found") {
      return fail(404, "NOT_FOUND", "No such partner.");
    }

    // No audit row for a no-op: an entry claiming a transition nobody made is
    // worse than a missing one, because the trail is read as a history of
    // changes.
    if (result.outcome === "changed") {
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "identity_access",
        action:
          prepared.status === "suspended"
            ? "partner.suspended"
            : "partner.reinstated",
        resourceType: "partner",
        resourceId: result.partner.id,
        // `critical`: suspending stops every delegated actor the partner
        // placed, in every customer tenant, at the next request.
        severity: prepared.status === "suspended" ? "critical" : "warning",
        message:
          prepared.status === "suspended"
            ? `Partner "${result.partner.partnerCode}" suspended — its delegated actors stop being served immediately.`
            : `Partner "${result.partner.partnerCode}" reinstated — its surviving grants apply again.`,
        attributes: {
          partnerTenantId: result.partner.partnerTenantId,
          partnerCode: result.partner.partnerCode,
          status: prepared.status
        }
      });
    }

    return ok({
      partner: result.partner,
      changed: result.outcome === "changed"
    });
  }
});
