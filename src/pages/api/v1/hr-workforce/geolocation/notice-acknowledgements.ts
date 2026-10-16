import { fail } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { employmentIsCallers } from "../../../../../modules/hr-workforce/application/hr-attendance-directory";
import { acknowledgeNotice } from "../../../../../modules/hr-workforce/application/hr-location-evidence";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateAcknowledgement,
  type AcknowledgeInput
} from "../../../../../modules/hr-workforce/domain/hr-geolocation-validation";

type Prepared = { idempotencyKey: string; input: AcknowledgeInput };

const SCOPE = "hr_workforce_geolocation_notice_acknowledge";

/**
 * `POST /api/v1/hr-workforce/geolocation/notice-acknowledgements` — the employee
 * records that they have seen the CURRENT notice version (ADR-0138 section 4).
 * Needs `hr_workforce.clock.create` and an employment linked to the caller's
 * login (anything else is 403). A version that is not the current one, or a
 * tenant with the feature off, is 409 `NOTICE_NOT_CURRENT`. Evidence of notice,
 * not a claim that consent is the lawful basis. Declining is simply not
 * acknowledging: the employee still clocks in, with a `not_provided` verdict.
 * A repeat is 200. Idempotent.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateAcknowledgement);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.clock.create,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const { input } = prepared;

    if (
      !(await employmentIsCallers(
        tx,
        tenantId,
        input.employmentId,
        auth.context.tenantUserId
      ))
    ) {
      return fail(
        403,
        "ACCESS_DENIED",
        "A notice can be acknowledged only for your own employment."
      );
    }

    return runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      input,
      async () => {
        const result = await acknowledgeNotice(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          input.employmentId,
          input.noticeId
        );

        if (result.outcome === "not_current") {
          return fail(
            409,
            "NOTICE_NOT_CURRENT",
            "That notice version is not the current one, or geolocation evidence is not enabled."
          );
        }

        return {
          status: result.replayed ? 200 : 201,
          body: {
            employmentId: input.employmentId,
            noticeId: input.noticeId,
            acknowledged: true
          }
        };
      }
    );
  }
});
