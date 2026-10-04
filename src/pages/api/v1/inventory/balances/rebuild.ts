import { fail } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { rebuildBalances } from "../../../../../modules/inventory/application/inventory-balance-directory";
import {
  asUuid,
  readIdempotencyKey,
  runIdempotent
} from "../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../modules/inventory/domain/inventory-permissions";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";

const IDEMPOTENCY_SCOPE = "inventory_balances_rebuild";

type Prepared = { idempotencyKey: string; locationId: string | null };

/**
 * `POST /api/v1/inventory/balances/rebuild` — repairs drifted balances FROM THE
 * LEDGER. The new on-hand is always the ledger sum; the request carries no
 * quantity, so this cannot be used to assert a balance. Body is optional:
 * `{ "locationId": "<uuid>" }` narrows the scope.
 *
 * HIGH-RISK: it writes balances, requires an `Idempotency-Key`, and is audited
 * at critical severity with the before/after of every repaired key. Bounded per
 * call (`truncated: true` means run it again).
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "reporting",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    if (bodyRead.value === null) {
      return { idempotencyKey, locationId: null };
    }

    const body = bodyRead.value as Record<string, unknown>;

    if (
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "locationId")
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Body may contain only locationId. A balance is recomputed from the ledger and can never be supplied."
      );
    }

    if (body.locationId === undefined || body.locationId === null) {
      return { idempotencyKey, locationId: null };
    }

    const locationId =
      typeof body.locationId === "string" ? asUuid(body.locationId) : null;

    return locationId
      ? { idempotencyKey, locationId }
      : fail(400, "VALIDATION_ERROR", "locationId must be a UUID.");
  },
  authorize: INVENTORY_GUARDS.balances.rebuild,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      { locationId: prepared.locationId },
      async () => {
        const report = await rebuildBalances(
          tx,
          tenantId,
          prepared.locationId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          }
        );

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "inventory",
          action: "inventory.balances.rebuilt",
          resourceType: "inventory_balance",
          resourceId: prepared.locationId ?? tenantId,
          severity: "critical",
          message: `Inventory balances rebuilt from the ledger: ${report.repaired.length} repaired.`,
          attributes: {
            locationId: prepared.locationId,
            repairedCount: report.repaired.length,
            truncated: report.truncated,
            repaired: report.repaired.slice(0, 50)
          },
          correlationId: locals.correlationId
        });

        return { status: 200, body: report };
      }
    )
});
