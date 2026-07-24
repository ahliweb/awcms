import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import {
  createRedirect,
  listRedirects,
  type RedirectListFilters
} from "../../../../../modules/seo-distribution/application/redirect-directory";
import { checkRedirectSafety } from "../../../../../modules/seo-distribution/application/redirect-safety";
import { resolveTenantAllowedHosts } from "../../../../../modules/seo-distribution/application/tenant-allowed-hosts";
import { validateRedirectInput } from "../../../../../modules/seo-distribution/domain/redirect-rule";
import {
  SEO_MODULE_KEY,
  SEO_REDIRECT_ACTIVITY_CODE
} from "../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `/api/v1/seo/redirects` (ADR-0039) — list/search/filter (GET) and create (POST)
 * tenant-scoped exact-path redirect rules. Both are ABAC-gated
 * (`seo_distribution.redirect.{read,create}`) and tenant-scoped (`withTenant` + RLS
 * FORCE). Create is high-risk: it requires an `Idempotency-Key`, is audited, and
 * passes the frozen open-redirect guard + conflict/loop/chain safety gate before
 * anything is stored.
 */

const READ_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "read" as const
};

const CREATE_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "create" as const
};

const IDEMPOTENCY_SCOPE = "seo_distribution_redirect_create";

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : undefined;
  if (cursorParam && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
  }

  const filters: RedirectListFilters = {};
  const stateParam = url.searchParams.get("state");
  if (
    stateParam === "active" ||
    stateParam === "inactive" ||
    stateParam === "archived"
  ) {
    filters.state = stateParam;
  }
  const targetTypeParam = url.searchParams.get("targetType");
  if (
    targetTypeParam === "relative_same_tenant" ||
    targetTypeParam === "verified_external"
  ) {
    filters.targetType = targetTypeParam;
  }
  const q = url.searchParams.get("q");
  if (q) filters.q = q;

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
    if (!auth.allowed) return auth.denied;

    const { redirects, nextCursor } = await listRedirects(
      tx,
      tenantId,
      filters,
      cursor ?? undefined
    );

    return ok({ redirects, nextCursor });
  });
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const requestHash = computeRequestHash(bodyRead.value ?? null);
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
      CREATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const allowedHosts = await resolveTenantAllowedHosts(tx, tenantId);
    const validation = validateRedirectInput(bodyRead.value, { allowedHosts });
    if (!validation.ok) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Redirect rule is invalid.",
        {},
        validation.errors
      );
    }

    const safety = await checkRedirectSafety(
      tx,
      tenantId,
      validation.value,
      now,
      {
        allowedHosts
      }
    );
    if (!safety.ok) {
      return fail(
        409,
        safety.code,
        safety.message,
        {},
        safety.conflict ? { conflict: safety.conflict } : undefined
      );
    }

    let redirect;
    try {
      redirect = await createRedirect(
        tx,
        tenantId,
        auth.context.tenantUserId,
        validation.value
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("awcms_seo_redirects_source_scope_dedup")) {
        return fail(
          409,
          "SOURCE_CONFLICT",
          "Another live rule already governs this source path and scope."
        );
      }
      throw error;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: SEO_MODULE_KEY,
      action: "seo_distribution.redirect.created",
      resourceType: "seo_redirect",
      resourceId: redirect.id,
      severity: "info",
      message: `Redirect rule created: ${redirect.normalizedSourcePath} -> ${redirect.target} (${redirect.statusCode}).`,
      attributes: {
        targetType: redirect.targetType,
        statusCode: redirect.statusCode,
        state: redirect.state,
        origin: redirect.origin
      },
      correlationId
    });

    const successResponse = ok(redirect);
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
