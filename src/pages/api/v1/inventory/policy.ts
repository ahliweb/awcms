import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  getTenantPolicy,
  setTenantPolicy
} from "../../../../modules/inventory/application/inventory-location-directory";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../modules/inventory/application/inventory-route-support";
import { INVENTORY_GUARDS } from "../../../../modules/inventory/domain/inventory-permissions";
import {
  validateTenantPolicyInput,
  type TenantPolicyInput
} from "../../../../modules/inventory/domain/inventory-validation";

const IDEMPOTENCY_SCOPE = "inventory_policy_set";

/**
 * `GET /api/v1/inventory/policy` — the tenant default negative-stock policy.
 * `isImplicitDefault` is `true` when the tenant never stored a value and the
 * safe default (`forbid`) applies. A location may override it
 * (`locations/{id}`'s `negativeStockPolicy`).
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: INVENTORY_GUARDS.policy.read,
  handler: async ({ tx, tenantId }) => ok(await getTenantPolicy(tx, tenantId))
});

type Prepared = { idempotencyKey: string; input: TenantPolicyInput };

/**
 * `PUT /api/v1/inventory/policy` — set the tenant default. Whether stock may go
 * below zero is the control that widens what every `movements.create` caller
 * can do, so it has its own permission, requires an `Idempotency-Key`, and is
 * audited with the before/after value.
 */
export const PUT = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateTenantPolicyInput);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: INVENTORY_GUARDS.policy.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      prepared.input,
      async () => {
        const { before, after } = await setTenantPolicy(
          tx,
          tenantId,
          auth.context.tenantUserId,
          prepared.input.defaultNegativeStockPolicy
        );

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "inventory",
          action: "inventory.policy.updated",
          resourceType: "inventory_settings",
          resourceId: tenantId,
          severity: "warning",
          message: "Tenant default negative-stock policy changed.",
          attributes: { before, after },
          correlationId: locals.correlationId
        });

        return {
          status: 200,
          body: { defaultNegativeStockPolicy: after, isImplicitDefault: false }
        };
      }
    )
});
