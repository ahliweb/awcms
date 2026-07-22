import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { log } from "../../../../../lib/logging/logger";
import {
  createAdPlacement,
  listAdPlacements
} from "../../../../../modules/news-portal/application/ad-placement-directory";
import { validateAdPlacementMediaReference } from "../../../../../modules/news-portal/application/ad-placement-reference-validation";
import { validateCreateAdPlacementInput } from "../../../../../modules/news-portal/domain/ad-placement-policy";

const READ_GUARD = {
  moduleKey: "news_portal",
  activityCode: "ad_placements",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "news_portal",
  activityCode: "ad_placements",
  action: "configure" as const
};

/** `GET /api/v1/news-portal/ad-placements` (Issue #638) — list this tenant's non-deleted ad placements (admin view: includes inactive/out-of-schedule rows). */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const placements = await listAdPlacements(tx, tenantId);

    return ok({ placements });
  });
};

/**
 * `POST /api/v1/news-portal/ad-placements` (Issue #638) — create an ad
 * placement. `mediaObjectId` is validated for shape (domain layer) then for
 * existence/tenant-ownership/verified-status/allowed-mime-type
 * (`validateAdPlacementMediaReference`) before the row is written — a
 * request that fails either never creates a partially-written row. Not
 * idempotent (same low-risk admin-config-mutation class as
 * `homepage-section-directory.ts`'s `createHomepageSection`/
 * `ads-directory.ts`'s `createAd` — neither requires an Idempotency-Key).
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<Record<string, unknown>>(
    request,
    "default"
  );

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const validation = validateCreateAdPlacementInput(body);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Ad placement is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      CONFIGURE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const referenceValidation = await validateAdPlacementMediaReference(
      tx,
      tenantId,
      input.mediaObjectId,
      input.placementKey
    );

    if (!referenceValidation.valid) {
      return fail(
        422,
        "AD_PLACEMENT_REFERENCE_INVALID",
        "Ad placement references an invalid or inaccessible media object.",
        {},
        referenceValidation.errors
      );
    }

    const placement = await createAdPlacement(
      tx,
      tenantId,
      auth.context.tenantUserId,
      input,
      correlationId
    );

    log("info", "news-portal.ad_placement.created", {
      correlationId,
      tenantId,
      moduleKey: "news_portal",
      adPlacementId: placement.id
    });

    return ok(placement);
  });
};
