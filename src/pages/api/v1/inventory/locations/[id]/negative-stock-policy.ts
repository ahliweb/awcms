import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { setLocationPolicy } from "../../../../../../modules/inventory/application/inventory-location-directory";
import {
  asUuid,
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../../../modules/inventory/domain/inventory-permissions";
import {
  validateLocationPolicyInput,
  type LocationPolicyInput
} from "../../../../../../modules/inventory/domain/inventory-validation";

const IDEMPOTENCY_SCOPE = "inventory_location_policy_set";

type Prepared = {
  id: string;
  idempotencyKey: string;
  input: LocationPolicyInput;
};

/**
 * `PUT /api/v1/inventory/locations/{id}/negative-stock-policy` — set this
 * location's override of the tenant default, or `null` to inherit it.
 *
 * Its own endpoint and its own permission (`policy.configure`) because it is the
 * control that decides whether `movements.create` may take a balance below zero
 * — granting "rename a location" must not grant that. Requires `Idempotency-Key`
 * and is audited.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "id must be a UUID.");
    }

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateLocationPolicyInput);

    return input instanceof Response ? input : { id, idempotencyKey, input };
  },
  authorize: INVENTORY_GUARDS.policy.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      { id: prepared.id, input: prepared.input },
      async () => {
        const result = await setLocationPolicy(
          tx,
          tenantId,
          auth.context.tenantUserId,
          prepared.id,
          prepared.input.negativeStockPolicy
        );

        if (result.outcome === "not_found") {
          return fail(404, "RESOURCE_NOT_FOUND", "Stock location not found.");
        }

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "inventory",
          action: "inventory.location.negative_stock_policy.updated",
          resourceType: "inventory_location",
          resourceId: prepared.id,
          severity: "warning",
          message: `Negative-stock policy for ${result.location.code} changed.`,
          attributes: {
            before: result.before,
            after: result.location.negativeStockPolicy
          },
          correlationId: locals.correlationId
        });

        return { status: 200, body: result.location };
      }
    )
});
