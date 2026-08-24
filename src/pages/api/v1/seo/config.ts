import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { enqueueModuleContentPurge } from "../../../../lib/edge-cache/content-purge";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import { validateSeoTenantSettings } from "../../../../modules/seo-distribution/domain/seo-config";
import {
  fetchSeoTenantSettings,
  updateSeoTenantSettings
} from "../../../../modules/seo-distribution/application/seo-config-directory";
import {
  SEO_CONFIG_ACTIVITY_CODE,
  SEO_MODULE_KEY
} from "../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `GET`/`PUT /api/v1/seo/config` (ADR-0038 §4/§9) — this tenant's SEO
 * defaults (site identity, default social image, Twitter handle, Organization
 * identity, and the tenant-wide `noindex` switch) that the central renderer
 * applies UNDERNEATH resource-level facts.
 *
 * `PUT` is high-risk: it rewrites the public metadata/indexability surface, so it
 * requires an `Idempotency-Key` (safe double-submit) and is audited on every
 * write (`updateSeoTenantSettings`'s injected audit hook). Both verbs are
 * ABAC-gated (`seo_distribution.config.read` / `.update`) and tenant-scoped
 * (`withTenant` + RLS FORCE on `awcms_seo_tenant_settings`), so tenant A
 * can never read or change tenant B's config.
 */

const READ_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_CONFIG_ACTIVITY_CODE,
  action: "read" as const
};

const UPDATE_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_CONFIG_ACTIVITY_CODE,
  action: "update" as const
};

const IDEMPOTENCY_SCOPE = "seo_distribution_config_update";

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

    const settings = await fetchSeoTenantSettings(tx, tenantId);
    return ok(settings);
  });
};

export const PUT: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  // Order note: the work runs out here, the ANSWERS wait. The body is read and
  // validated before the transaction opens — `await request.json()` waits on
  // the CLIENT, and doing that inside `withTenant` would hold a reserved
  // connection and its work-class slot for as long as a caller chooses to take.
  // But every refusal below is HELD until `authorizeInTransaction` has answered
  // inside the transaction.
  //
  // This note used to say the opposite order was deliberate. It was wrong in a
  // way that cost nothing to a caller who is allowed and everything to the
  // audit trail: ADR-0063 made `authorizeInTransaction` the one place a
  // decision is taken AND recorded, so refusing out here refused with NO
  // `awcms_access_decision_log` row — a tenant user with no `seo.configure`
  // grant could learn this endpoint's field names and enum values, repeatedly,
  // and leave no trace. Gap C19.
  //
  // The body-size ceiling stays ahead of everything: it is a PROTOCOL limit,
  // not a product answer, and refusing it tells the caller nothing they did not
  // already send.
  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateSeoTenantSettings(bodyRead.value);
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
      UPDATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    // Allowed — so the caller is entitled to hear what is actually wrong, and
    // the decision log now carries the row saying they were here.
    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    if (!validation.ok) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "SEO settings are invalid.",
        {},
        validation.errors
      );
    }

    const next = validation.value;
    const requestHash = computeRequestHash(next);

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    const saved = await updateSeoTenantSettings(
      tx,
      tenantId,
      auth.context.tenantUserId,
      next,
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: SEO_MODULE_KEY,
          action: "seo_distribution.config.update",
          resourceType: "seo_tenant_settings",
          resourceId: tenantId,
          severity: "info",
          message: "Tenant SEO defaults updated.",
          attributes: {
            defaultRobotsNoindexChanged:
              detail.previous.defaultRobotsNoindex !==
              detail.next.defaultRobotsNoindex,
            defaultRobotsNoindex: detail.next.defaultRobotsNoindex
          },
          correlationId
        });
      }
    );

    // In the SAME transaction as the write (ADR-0042 §9): this config shapes
    // every discovery body — the tenant-wide `noindex` switch alone rewrites
    // `/robots.txt` and can withdraw the sitemap — so a committed change that
    // did not enqueue its purge would leave the old crawl policy being served
    // to crawlers until TTL, which is the one staleness here with a lasting
    // consequence.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      SEO_MODULE_KEY,
      "seo_distribution.config.update"
    );

    const successResponse = ok(saved);
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      successBody
    );

    return successResponse;
  });
};
