import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse
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
import { captureUrlChangeRedirect } from "../../../../../modules/seo-distribution/application/url-change-capture";
import { fetchRedirectSettings } from "../../../../../modules/seo-distribution/application/redirect-settings-directory";
import { resolveTenantAllowedHosts } from "../../../../../modules/seo-distribution/application/tenant-allowed-hosts";
import { URL_CHANGE_AUTO_POLICIES } from "../../../../../modules/seo-distribution/domain/redirect-settings";
import type { UrlChangeType } from "../../../../../modules/seo-distribution/domain/url-change-plan";
import {
  SEO_MODULE_KEY,
  SEO_REDIRECT_ACTIVITY_CODE
} from "../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `POST /api/v1/seo/redirects/capture-url-change` (ADR-0039) — the controlled,
 * audited URL-change capture hook. Given an old→new public path pair and a change
 * type (slug/domain/locale change), it produces a redirect PROPOSAL (inactive) or an
 * active rule per the tenant's `url_change_auto_policy` (overridable per call), after
 * the frozen open-redirect guard + conflict/loop/chain safety gate. This is the seam
 * a content module / operator / automation drives when a URL changes. Idempotency-
 * keyed + ABAC (`redirect.create`).
 */

const CREATE_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "create" as const
};
const IDEMPOTENCY_SCOPE = "seo_distribution_redirect_capture_url_change";
const CHANGE_TYPES: readonly UrlChangeType[] = [
  "slug_change",
  "domain_change",
  "locale_change"
];

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

  const body = (bodyRead.value ?? {}) as Record<string, unknown>;
  const oldPath = typeof body.oldPath === "string" ? body.oldPath : "";
  const newPath = typeof body.newPath === "string" ? body.newPath : "";
  const changeType = body.changeType;

  if (!oldPath || !newPath) {
    return fail(400, "VALIDATION_ERROR", "oldPath and newPath are required.");
  }
  if (
    typeof changeType !== "string" ||
    !CHANGE_TYPES.includes(changeType as UrlChangeType)
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `changeType must be one of ${CHANGE_TYPES.join(", ")}.`
    );
  }

  const policyOverride =
    typeof body.policy === "string" &&
    URL_CHANGE_AUTO_POLICIES.includes(body.policy as never)
      ? (body.policy as (typeof URL_CHANGE_AUTO_POLICIES)[number])
      : null;

  const requestHash = computeRequestHash({
    oldPath,
    newPath,
    changeType,
    policy: policyOverride
  });
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
    const settings = await fetchRedirectSettings(tx, tenantId);
    const policy = policyOverride ?? settings.urlChangeAutoPolicy;

    const result = await captureUrlChangeRedirect(
      tx,
      tenantId,
      auth.context.tenantUserId,
      {
        oldPath,
        newPath,
        changeType: changeType as UrlChangeType,
        localeScope:
          typeof body.localeScope === "string" ? body.localeScope : null,
        domainScopeHost:
          typeof body.domainScopeHost === "string"
            ? body.domainScopeHost
            : null,
        reason: typeof body.reason === "string" ? body.reason : null
      },
      allowedHosts,
      policy,
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: SEO_MODULE_KEY,
          action: "seo_distribution.redirect.url_change_captured",
          resourceType: "seo_redirect",
          resourceId: detail.redirect.id,
          severity: "info",
          message: `URL change captured (${changeType}): ${detail.redirect.normalizedSourcePath} -> ${detail.redirect.target} [${detail.action}].`,
          attributes: {
            changeType,
            action: detail.action,
            state: detail.redirect.state
          },
          correlationId
        });
      },
      now
    );

    if (result.outcome === "invalid") {
      return fail(
        400,
        "VALIDATION_ERROR",
        "URL change could not be captured.",
        {},
        result.errors
      );
    }
    if (result.outcome === "rejected") {
      return fail(409, result.code, result.message);
    }

    const responseBody = { success: true, data: result, meta: {} };
    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      responseBody
    );
    return jsonResponse(responseBody, { status: 200 });
  });
};
