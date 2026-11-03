import { fail } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  approvePublication,
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
  runIdempotent
} from "../../../../../../modules/social-publishing/application/route-support";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../../../modules/social-publishing/domain/social-publishing-constants";

type Prepared = { id: string; idempotencyKey: string };

/**
 * `POST /api/v1/social-publishing/publications/{id}/approve` (Issue #1145,
 * ADR-0157 section 5) — release a publication that is waiting for approval.
 * Nothing is claimable by the dispatcher before this.
 *
 * Maker and checker: the person who created a manual publication cannot approve
 * it (`403 SELF_APPROVAL_FORBIDDEN`). The caller must also be able to use every
 * account the publication targets; otherwise it is `404`, exactly as for an
 * unknown id (no existence oracle). Idempotent: approving what is already
 * approved is a `200` that changes nothing. High-risk: `Idempotency-Key`
 * required, audited at `warning`.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request, params }) => {
    const id = asUuid(params.id);

    if (!id) return badId();

    const idempotencyKey = readIdempotencyKey(request);

    return idempotencyKey instanceof Response
      ? idempotencyKey
      : { id, idempotencyKey };
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.publicationsApprove,
  handler: async (context) => {
    const refused = mutationRefusal(context.auth);

    if (refused) return refused;

    const { tx, tenantId, auth, prepared } = context;
    const actor = auth.context.tenantUserId;

    if (
      !(await canUseAllAccounts(
        context,
        SOCIAL_PUBLISHING_GUARDS.publicationsApprove,
        await listJobAccountIds(tx, tenantId, prepared.id)
      ))
    ) {
      return notFound("Publication");
    }

    return runIdempotent(
      tx,
      tenantId,
      "social_publishing_publication_approve",
      prepared.idempotencyKey,
      actor,
      { id: prepared.id },
      async () => {
        const result = await approvePublication(
          tx,
          tenantId,
          actor,
          prepared.id
        );

        if (result.outcome === "not_found") return notFound("Publication");

        if (result.outcome === "refused") {
          return result.code === "SELF_APPROVAL_FORBIDDEN"
            ? fail(
                403,
                "SELF_APPROVAL_FORBIDDEN",
                "You cannot approve a publication you created."
              )
            : fail(
                409,
                result.code,
                "The publication is not waiting for approval."
              );
        }

        if (!result.alreadyApproved) {
          await auditPublishing(context, {
            action: "social_publishing.publication.approve",
            resourceType: "social_publication",
            resourceId: prepared.id,
            severity: "warning",
            message: "Social publication approved for dispatch."
          });
        }

        const detail = await fetchPublication(tx, tenantId, prepared.id);

        return {
          status: 200,
          body: {
            publication: detail?.publication ?? null,
            alreadyApproved: result.alreadyApproved
          }
        };
      }
    );
  }
});
