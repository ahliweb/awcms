import { ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  listNotices,
  publishNotice
} from "../../../../../modules/hr-workforce/application/hr-location-evidence";
import {
  readIdempotencyKey,
  readValidatedBody,
  runIdempotent
} from "../../../../../modules/hr-workforce/application/hr-workforce-route-support";
import { HR_WORKFORCE_GUARDS } from "../../../../../modules/hr-workforce/domain/hr-workforce-permissions";
import {
  validateNotice,
  type NoticeInput
} from "../../../../../modules/hr-workforce/domain/hr-geolocation-validation";

/**
 * `GET /api/v1/hr-workforce/geolocation/notices` — the published notice
 * versions, newest first. Needs `hr_workforce.geolocation_evidence.configure`.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: HR_WORKFORCE_GUARDS.geolocationEvidence.configure,
  handler: async ({ tx, tenantId }) =>
    ok({ notices: await listNotices(tx, tenantId) })
});

type Prepared = { idempotencyKey: string; input: NoticeInput };

const SCOPE = "hr_workforce_geolocation_notice_publish";

/**
 * `POST /api/v1/hr-workforce/geolocation/notices` — publish the next notice
 * version (append-only; locale -> text, written by the tenant). Publishing does
 * not make it current: pointing the settings at it (`PUT .../settings`
 * `noticeId`) is the audited step that re-requests every acknowledgement.
 * High-risk `configure`, idempotent.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) {
      return idempotencyKey;
    }

    const input = await readValidatedBody(request, validateNotice);

    return input instanceof Response ? input : { idempotencyKey, input };
  },
  authorize: HR_WORKFORCE_GUARDS.geolocationEvidence.configure,
  handler: async ({ tx, tenantId, auth, prepared, locals }) =>
    runIdempotent(
      tx,
      tenantId,
      SCOPE,
      prepared.idempotencyKey,
      auth.context.tenantUserId,
      prepared.input,
      async () => ({
        status: 201,
        body: await publishNotice(
          tx,
          tenantId,
          {
            actorTenantUserId: auth.context.tenantUserId,
            correlationId: locals.correlationId
          },
          prepared.input
        )
      })
    )
});
