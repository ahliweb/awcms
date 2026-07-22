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
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createAd,
  listAds,
  syncAdPlacements
} from "../../../../../modules/blog-content/application/ads-directory";
import {
  validateAdPlacementsInput,
  validateCreateAdInput
} from "../../../../../modules/blog-content/domain/ad-policy";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "ads",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "ads",
  action: "configure" as const
};

/** `GET /api/v1/blog/ads` (Issue #542) — list this tenant's non-deleted ads. */
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

    const ads = await listAds(tx, tenantId);

    return ok({ ads });
  });
};

/** `POST /api/v1/blog/ads` (Issue #542) — create an ad, optionally with its initial `placements`. Not idempotent. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<Record<string, unknown>>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const validation = validateCreateAdInput(body);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Ad is invalid.",
      {},
      validation.errors
    );
  }

  const placementsInput = (body ?? {}).placements ?? [];
  const placementsResult = validateAdPlacementsInput(placementsInput);

  if (!placementsResult.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Ad placements are invalid.",
      {},
      placementsResult.errors
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

    const ad = await createAd(tx, tenantId, input);
    const placements = await syncAdPlacements(
      tx,
      tenantId,
      ad.id,
      placementsResult.value
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.ad.created",
      resourceType: "blog_ad",
      resourceId: ad.id,
      severity: "info",
      message: `Blog ad created: ${ad.name}.`,
      correlationId
    });

    log("info", "blog-content.ad.created", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      adId: ad.id
    });

    return ok({ ...ad, placements });
  });
};
