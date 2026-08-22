import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { listModules } from "../../../../modules";
import { collectHighVolumeTableDescriptors } from "../../../../modules/data-lifecycle/domain/lifecycle-registry";
import { INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS } from "../../../../modules/data-lifecycle/domain/infrastructure-lifecycle-registry";
import { planLifecycleDryRun } from "../../../../modules/data-lifecycle/application/dry-run-planner";
import { fetchActiveLegalHoldsForPlanning } from "../../../../modules/data-lifecycle/application/legal-hold-service";

type DryRunBody = {
  descriptorKey?: unknown;
  retentionDaysOverride?: unknown;
};

/**
 * `POST /api/v1/data-lifecycle/dry-run` (ADR-0037) — on-demand, read-only
 * dry-run lifecycle plan for ONE descriptor. Deliberately POST (a request body
 * is required to name the target descriptor) but genuinely zero-mutation — no
 * `Idempotency-Key` is required ("dry-run performs no mutation") and, unlike the
 * scheduled job's own dry-run mode, this on-demand endpoint does NOT persist a
 * row to `awcms_data_lifecycle_runs` either — it is a pure computation with no
 * side effect at all, safe to call repeatedly with no idempotency concern by
 * construction.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  // The ONLY pre-auth body read in the repository, and the reason finding A4
  // put this file first. `resolveAuthInputs` checks that a tenant header and a
  // token are PRESENT — it does not resolve either — so everything above this
  // point is satisfied by two arbitrary strings. An unauthenticated caller
  // sending a chunked body with no `Content-Length` was buffered without bound,
  // and `checkContentLengthCeiling` in the middleware could not help: it returns
  // true when the header is absent, which is exactly the case that matters.
  const bodyRead = await readJsonBody<DryRunBody>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  if (bodyRead.malformed) {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const body = (bodyRead.value ?? {}) as DryRunBody;

  if (
    typeof body.descriptorKey !== "string" ||
    body.descriptorKey.length === 0
  ) {
    return fail(400, "VALIDATION_ERROR", "descriptorKey is required.");
  }

  const retentionDaysOverride =
    typeof body.retentionDaysOverride === "number"
      ? body.retentionDaysOverride
      : undefined;

  const descriptor = collectHighVolumeTableDescriptors(listModules()).find(
    (candidate) => candidate.key === body.descriptorKey
  );

  if (!descriptor) {
    // An infrastructure descriptor (ADR-0076) is a real, registered key that
    // this planner cannot serve. Answering 404 "unknown" would send the caller
    // hunting for a typo that is not there, so the two cases are told apart.
    const isInfrastructure = INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS.some(
      (candidate) => candidate.key === body.descriptorKey
    );

    if (isInfrastructure) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `Descriptor "${body.descriptorKey}" is owned by infrastructure, not by a module. On-demand dry-run is not available for it: its purge is delegated to \`bun run edge-cache:purge\`, and this planner has no status predicate, so any count it produced would include rows that purge will never touch.`
      );
    }

    return fail(
      404,
      "NOT_FOUND",
      `Unknown descriptor key: "${body.descriptorKey}".`
    );
  }
  if (descriptor.scope !== "tenant") {
    return fail(
      400,
      "VALIDATION_ERROR",
      `Descriptor "${descriptor.key}" has scope "global" — on-demand dry-run is only supported for scope: "tenant" descriptors today.`
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "data_lifecycle",
      activityCode: "plan",
      action: "analyze"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const activeHolds = await fetchActiveLegalHoldsForPlanning(tx, tenantId);
    const result = await planLifecycleDryRun(
      tx,
      descriptor,
      tenantId,
      activeHolds,
      now,
      retentionDaysOverride
    );

    return ok({ plan: result });
  });
};
