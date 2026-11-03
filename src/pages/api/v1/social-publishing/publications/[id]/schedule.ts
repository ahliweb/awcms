import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  fetchPublication,
  listJobAccountIds,
  schedulePublication
} from "../../../../../../modules/social-publishing/application/publication-directory";
import {
  asUuid,
  auditPublishing,
  badId,
  canUseAllAccounts,
  mutationRefusal,
  notFound,
  readIdempotencyKey,
  readJson,
  runIdempotent,
  validationFailure
} from "../../../../../../modules/social-publishing/application/route-support";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../../../modules/social-publishing/domain/social-publishing-constants";
import { validateSchedule } from "../../../../../../modules/social-publishing/domain/social-publishing-validation";

type Prepared = {
  id: string;
  idempotencyKey: string;
  notBefore: Date | null;
};

/**
 * `POST /api/v1/social-publishing/publications/{id}/schedule` (Issue #1145) —
 * set or clear (`notBefore: null`) the instant a publication may start going
 * out. The dispatcher claims nothing of it before that instant, and nothing
 * before it is approved.
 *
 * Only while no job has left the queue: once any account has been tried the
 * publication has started and moving its schedule would misdescribe something
 * already done (`409 ALREADY_DISPATCHED`). A past instant, a malformed one and
 * one more than a year away are `400`. High-risk: `Idempotency-Key` required,
 * audited; the caller must be able to use every targeted account (otherwise
 * `404`, like an unknown id).
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params, now }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    const body = await readJson(request);

    if (body instanceof Response) return body;

    const input = validateSchedule(body, now);

    return input.valid
      ? { id, idempotencyKey, notBefore: input.value.notBefore }
      : validationFailure(input.errors);
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.publicationsSchedule,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    if (
      !(await canUseAllAccounts(
        context,
        SOCIAL_PUBLISHING_GUARDS.publicationsSchedule,
        await listJobAccountIds(tx, tenantId, prepared.id)
      ))
    ) {
      return notFound("Publication");
    }

    return runIdempotent(
      tx,
      tenantId,
      "social_publishing_publication_schedule",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, notBefore: prepared.notBefore },
      async () => {
        const result = await schedulePublication(
          tx,
          tenantId,
          prepared.id,
          prepared.notBefore
        );

        if (result.outcome === "not_found") return notFound("Publication");

        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            result.code === "ALREADY_DISPATCHED"
              ? "The publication has already started going out."
              : "The publication can no longer be rescheduled."
          );
        }

        await auditPublishing(context, {
          action: "social_publishing.publication.schedule",
          resourceType: "social_publication",
          resourceId: prepared.id,
          severity: "info",
          message: "Social publication schedule changed.",
          attributes: { scheduled: prepared.notBefore !== null }
        });

        const detail = await fetchPublication(tx, tenantId, prepared.id);

        return {
          status: 200,
          body: { publication: detail?.publication ?? null }
        };
      }
    );
  }
});
