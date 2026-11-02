import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../../lib/database/client";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  handlePublicPreflight,
  handlePublicSubmission
} from "../../../../../modules/website-engagement/application/public-intake-handler";
import { listSubmissions } from "../../../../../modules/website-engagement/application/submission-directory";
import {
  validateListSubmissionsQuery,
  type ListSubmissionsQuery
} from "../../../../../modules/website-engagement/domain/source-validation";
import { WEBSITE_ENGAGEMENT_GUARDS } from "../../../../../modules/website-engagement/domain/website-engagement-constants";

/**
 * `GET /api/v1/website-engagement/submissions` — the tenant's submissions,
 * newest first, keyset-paginated, with MASKED contact details only. Reading the
 * decrypted details is `POST /submissions/{id}/reveal`, a separate permission.
 * Authenticated and default-deny.
 */
export const GET = defineTenantRoute<ListSubmissionsQuery>({
  workClass: "interactive",
  prepare: ({ url }) => {
    const query = validateListSubmissionsQuery(url.searchParams);

    return query.valid
      ? query.value
      : fail(400, "VALIDATION_ERROR", "Query is invalid.", {}, query.errors);
  },
  authorize: WEBSITE_ENGAGEMENT_GUARDS.readSubmissions,
  handler: async (context) => {
    const result = await listSubmissions(
      context.tx,
      context.tenantId,
      context.prepared
    );

    if (!result.ok) {
      return fail(400, "VALIDATION_ERROR", "cursor is invalid.");
    }

    return ok({ items: result.items, nextCursor: result.nextCursor });
  }
});

/**
 * `POST /api/v1/website-engagement/submissions` — the PUBLIC, unauthenticated
 * intake a tenant's website calls from a visitor's browser (ADR-0155). It is
 * the only unauthenticated handler in this module: authenticated by the source
 * token in the body plus the verified Origin host, and deliberately thin here;
 * the whole decision order is documented in `public-intake-handler.ts`.
 */
export const POST: APIRoute = (context) =>
  handlePublicSubmission(context, getDatabaseClient());

/** The preflight half of the same public surface. */
export const OPTIONS: APIRoute = (context) =>
  handlePublicPreflight(context, getDatabaseClient());
