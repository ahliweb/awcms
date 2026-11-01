import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  getIntakeSetting,
  setIntakeEnabled
} from "../../../../../modules/hr-commission/application/hr-commission-intake-store";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-commission/application/hr-commission-route-support";
import {
  validateIntakeSettingBody,
  type IntakeSettingInput
} from "../../../../../modules/hr-commission/domain/hr-commission-intake";
import {
  HR_COMMISSION_GUARDS,
  HR_COMMISSION_MODULE_KEY
} from "../../../../../modules/hr-commission/domain/hr-commission-permissions";

const IDEMPOTENCY_SCOPE = "hr_commission_intake_setting_put";

/**
 * `GET /api/v1/hr-commission/intake/settings` (Issue #1189, ADR-0147 section 4)
 * -- the tenant's `commissionIntakeEnabled` switch (default `false`). Gated by
 * `hr_commission.intake.read`.
 */
export const GET = defineTenantRoute<Record<string, never>>({
  workClass: "interactive",
  prepare: () => ({}),
  authorize: HR_COMMISSION_GUARDS.intake.read,
  handler: async ({ tx, tenantId }) => ok(await getIntakeSetting(tx, tenantId))
});

type PutPrepared = { idempotencyKey: string; input: IntakeSettingInput };

/**
 * `PUT /api/v1/hr-commission/intake/settings` -- switch commission intake on or
 * off for this tenant, and name the intake system actor (`intakeActorTenantUserId`,
 * an active tenant user; required to switch ON, kept when omitted). The poster
 * stamps THAT identity on every accrual and audit row it posts: the worker's own
 * claim about who acted is never trusted. With it OFF the `commission_intake` port answers
 * `disabled`, nothing is written and the poster job claims nothing (rows already
 * queued wait). Turning it ON lets a registered system consumer queue commission
 * requests that a job then posts with no signed-in person, so it is HIGH-RISK
 * and its own permission (`hr_commission.intake.configure`), never implied by
 * `accruals.accrue` or `rules.publish`. `Idempotency-Key` required (a retry
 * returns the stored response); audited at `warning` with the before and after
 * switch, never an amount. The module must be enabled for the tenant (Module
 * Management gate, applied before this handler).
 */
export const PUT = defineTenantRoute<PutPrepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateIntakeSettingBody);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_COMMISSION_GUARDS.intake.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => {
        const result = await setIntakeEnabled(
          tx,
          tenantId,
          prepared.input.commissionIntakeEnabled,
          auth.context.tenantUserId,
          prepared.input.intakeActorTenantUserId
        );

        if (result.outcome === "actor_required") {
          return fail(
            400,
            "INTAKE_ACTOR_REQUIRED",
            "Switching intake on needs intakeActorTenantUserId: the active tenant user every posted accrual and audit row will carry."
          );
        }

        if (result.outcome === "actor_invalid") {
          return fail(
            400,
            "INTAKE_ACTOR_INVALID",
            "intakeActorTenantUserId is not an active user of this tenant."
          );
        }

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: HR_COMMISSION_MODULE_KEY,
          action: "hr_commission.intake.configured",
          resourceType: "hr_commission_intake_setting",
          resourceId: tenantId,
          severity: "warning",
          message: "Commission intake was switched.",
          attributes: {
            commissionIntakeEnabled: result.setting.commissionIntakeEnabled,
            previous: result.previous.commissionIntakeEnabled,
            intakeActorTenantUserId: result.setting.intakeActorTenantUserId,
            previousIntakeActorTenantUserId:
              result.previous.intakeActorTenantUserId
          },
          correlationId: locals.correlationId
        });

        return { status: 200, body: result.setting };
      }
    )
});
