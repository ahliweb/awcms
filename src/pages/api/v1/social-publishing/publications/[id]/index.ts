import { ok } from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import { fetchPublication } from "../../../../../../modules/social-publishing/application/publication-directory";
import {
  asUuid,
  badId,
  disabledResponse,
  notFound
} from "../../../../../../modules/social-publishing/application/route-support";
import { SOCIAL_PUBLISHING_GUARDS } from "../../../../../../modules/social-publishing/domain/social-publishing-constants";

/**
 * `GET /api/v1/social-publishing/publications/{id}` (Issue #1145) — one
 * publication with its immutable content snapshot, its derived aggregate status
 * and ONE entry per target account: the per-account job with its own status,
 * attempts, coded failure and the provider's post id and URL once published.
 * That per-account list is how a partial failure is read: a failed account does
 * not change a published one. Never a credential, a token reference or an
 * account label.
 */
export const GET = defineTenantRoute<{ id: string }>({
  workClass: "interactive",
  prepare: ({ params }) => {
    const id = asUuid(params.id);

    return id ? { id } : badId();
  },
  authorize: SOCIAL_PUBLISHING_GUARDS.publicationsRead,
  handler: async (context) => {
    const disabled = disabledResponse();

    if (disabled) return disabled;

    const detail = await fetchPublication(
      context.tx,
      context.tenantId,
      context.prepared.id
    );

    return detail
      ? ok({ publication: detail.publication, jobs: detail.jobs })
      : notFound("Publication");
  }
});
