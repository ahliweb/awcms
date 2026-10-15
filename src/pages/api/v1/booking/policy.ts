import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  actorOf,
  runAdminMutation
} from "../../../../modules/booking/application/booking-admin-routes";
import {
  configurePolicy,
  getPolicy
} from "../../../../modules/booking/application/booking-policy-admin";
import {
  readIdempotencyKey,
  readValidatedBody
} from "../../../../modules/booking/application/booking-route-support";
import {
  validatePolicy,
  type PolicyInput
} from "../../../../modules/booking/domain/booking-admin-validation";
import { BOOKING_GUARDS } from "../../../../modules/booking/domain/booking-permissions";

/**
 * `GET /api/v1/booking/policy` -- the tenant booking policy: `policy` (what the
 * tenant set, `null` where it did not) and `effective` (what is in force: the
 * tenant value, or the module default where it is `null`). A tenant that never
 * wrote a policy reads every field `null` and `updatedAt: null`. Gated by
 * `booking.policy.read`.
 */
export const GET = defineTenantRoute<Record<string, never>>({
  workClass: "interactive",
  prepare: () => ({}),
  authorize: BOOKING_GUARDS.policy.read,
  handler: async ({ tx, tenantId }) => ok(await getPolicy(tx, tenantId))
});

type PutPrepared = { idempotencyKey: string; input: PolicyInput };

/**
 * `PUT /api/v1/booking/policy` -- REPLACE the tenant policy. Every field must be
 * present; `null` selects the module default (it is NOT "unlimited": the hold
 * caps default to 5 per customer and 500 per tenant). Ranges: hold seconds 60 to
 * 86400 with the default at most the maximum, hold caps at least 1, lead time at
 * least 0, horizon 1 to 3650 days, no-show grace 0 to 30 days. Changes FUTURE
 * holds and searches only. HIGH-RISK: it bounds how much inventory one actor can
 * hold. Gated by `booking.policy.configure`; `Idempotency-Key` required (a retry
 * returns the stored response); audited `critical` with the before and after
 * values. No step-up: ADR-0141 flags payroll permissions only, and flagging a
 * routine tenant setting would be a lockout the tenant did not choose.
 */
export const PUT = defineTenantRoute<PutPrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validatePolicy);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: BOOKING_GUARDS.policy.configure,
  handler: ({ tx, tenantId, auth, prepared, locals }) =>
    runAdminMutation(
      tx,
      tenantId,
      auth,
      "booking_policy_put",
      prepared.idempotencyKey,
      prepared.input,
      200,
      () =>
        configurePolicy(tx, tenantId, actorOf(auth, locals), prepared.input),
      (result) => ({ ...result.policy, replayed: result.replayed })
    )
});
