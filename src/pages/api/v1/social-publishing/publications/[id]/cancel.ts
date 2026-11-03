import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { emitPublicationCancelled } from "../../../../../../modules/social-publishing/application/social-publishing-event-emit";
import {
  cancelPublication,
  fetchPublication,
  listJobAccountIds
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
import { validateCancel } from "../../../../../../modules/social-publishing/domain/social-publishing-validation";

type Prepared = { id: string; idempotencyKey: string; reason: string | null };

/**
 * `POST /api/v1/social-publishing/publications/{id}/cancel` (Issue #1145) —
 * stop a publication. The publication becomes `cancelled` and every job that has
 * NOT been sent is cancelled with it.
 *
 * It never recalls or alters what already went out: a job that was published is
 * terminal (the database refuses to change it) and is reported in
 * `jobsAlreadyPublished`, and a job being sent right now is left to finish and
 * reported in `jobsInFlight`. So cancelling after a partial failure cancels the
 * rest without replaying anything. Cancelling a waiting publication is also how
 * an approval is declined. Idempotent. High-risk: `Idempotency-Key` required,
 * audited at `warning`; the caller must be able to use every targeted account
 * (otherwise `404`, like an unknown id).
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    if (idempotencyKey instanceof Response) return idempotencyKey;

    // An empty body is `null`, which `validateCancel` accepts (no reason given).
    const body = await readJson(request);

    if (body instanceof Response) return body;

    const input = validateCancel(body);

    return input.valid
      ? { id, idempotencyKey, reason: input.value.reason }
      : validationFailure(input.errors);
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.publicationsCancel,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    if (
      !(await canUseAllAccounts(
        context,
        SOCIAL_PUBLISHING_GUARDS.publicationsCancel,
        await listJobAccountIds(tx, tenantId, prepared.id)
      ))
    ) {
      return notFound("Publication");
    }

    return runIdempotent(
      tx,
      tenantId,
      "social_publishing_publication_cancel",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id, reason: prepared.reason },
      async () => {
        const result = await cancelPublication(
          tx,
          tenantId,
          actor,
          prepared.id,
          prepared.reason
        );

        if (result.outcome === "not_found") return notFound("Publication");

        if (result.outcome === "refused") {
          return fail(
            409,
            result.code,
            "A refused publication has nothing to cancel."
          );
        }

        if (!result.alreadyCancelled) {
          await emitPublicationCancelled(tx, tenantId, {
            publicationId: prepared.id,
            jobsCancelled: result.jobsCancelled,
            jobsAlreadyPublished: result.jobsAlreadyPublished,
            correlationId: context.locals.correlationId ?? null,
            actorTenantUserId: actor
          });
          await auditPublishing(context, {
            action: "social_publishing.publication.cancel",
            resourceType: "social_publication",
            resourceId: prepared.id,
            severity: "warning",
            message: "Social publication cancelled.",
            attributes: {
              jobsCancelled: result.jobsCancelled,
              jobsAlreadyPublished: result.jobsAlreadyPublished,
              jobsInFlight: result.jobsInFlight,
              hasReason: prepared.reason !== null
            }
          });
        }

        const detail = await fetchPublication(tx, tenantId, prepared.id);

        return {
          status: 200,
          body: {
            publication: detail?.publication ?? null,
            jobs: detail?.jobs ?? [],
            alreadyCancelled: result.alreadyCancelled,
            jobsCancelled: result.jobsCancelled,
            jobsAlreadyPublished: result.jobsAlreadyPublished,
            jobsInFlight: result.jobsInFlight
          }
        };
      }
    );
  }
});
