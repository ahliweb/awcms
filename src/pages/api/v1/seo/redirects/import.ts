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
import { createRedirect } from "../../../../../modules/seo-distribution/application/redirect-directory";
import { checkRedirectSafety } from "../../../../../modules/seo-distribution/application/redirect-safety";
import { resolveTenantAllowedHosts } from "../../../../../modules/seo-distribution/application/tenant-allowed-hosts";
import {
  validateRedirectInput,
  type RedirectRuleInput
} from "../../../../../modules/seo-distribution/domain/redirect-rule";
import {
  SEO_MODULE_KEY,
  SEO_REDIRECT_ACTIVITY_CODE
} from "../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `POST /api/v1/seo/redirects/import` (ADR-0039) — optional bulk import with
 * `dryRun`. Each item is normalized + validated (frozen open-redirect guard) and
 * safety-checked (conflict/loop/chain) against existing rules AND intra-batch
 * duplicates. `dryRun: true` returns the full per-item report writing nothing. A
 * real import is ALL-OR-NOTHING: if any item is invalid/unsafe it writes nothing and
 * returns the report; otherwise every item is created (idempotency-keyed, audited).
 * ABAC `redirect.create`.
 */

const CREATE_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "create" as const
};
const IDEMPOTENCY_SCOPE = "seo_distribution_redirect_import";
const MAX_IMPORT_ITEMS = 200;

type ItemReport = {
  index: number;
  ok: boolean;
  normalizedSourcePath?: string;
  code?: string;
  errors?: unknown;
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

  const body = (bodyRead.value ?? {}) as Record<string, unknown>;
  const dryRun = body.dryRun === true;
  const items = body.redirects;

  if (!Array.isArray(items)) {
    return fail(400, "VALIDATION_ERROR", "redirects must be an array.");
  }
  if (items.length === 0) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "redirects must contain at least one item."
    );
  }
  if (items.length > MAX_IMPORT_ITEMS) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `redirects must contain at most ${MAX_IMPORT_ITEMS} items.`
    );
  }

  const requestHash = computeRequestHash({ dryRun, items });
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

    if (!dryRun) {
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
    }

    const allowedHosts = await resolveTenantAllowedHosts(tx, tenantId);
    const reports: ItemReport[] = [];
    const validRules: RedirectRuleInput[] = [];
    const seenScopeKeys = new Set<string>();
    let allValid = true;

    for (let i = 0; i < items.length; i++) {
      const validation = validateRedirectInput(items[i], {
        allowedHosts,
        defaultOrigin: "import"
      });
      if (!validation.ok) {
        reports.push({
          index: i,
          ok: false,
          code: "VALIDATION_ERROR",
          errors: validation.errors
        });
        allValid = false;
        continue;
      }

      const scopeKey = `${validation.value.normalizedSourcePath} ${validation.value.localeScope ?? ""} ${validation.value.domainScopeHost ?? ""}`;
      if (seenScopeKeys.has(scopeKey)) {
        reports.push({
          index: i,
          ok: false,
          code: "DUPLICATE_IN_BATCH",
          normalizedSourcePath: validation.value.normalizedSourcePath
        });
        allValid = false;
        continue;
      }
      seenScopeKeys.add(scopeKey);

      // Overlay the already-accepted sibling batch items so an INTRA-batch
      // loop/chain (e.g. `[{/a→/b},{/b→/a}]`) is detected here — in both dry-run
      // and real import — instead of both items passing and being created.
      const safety = await checkRedirectSafety(
        tx,
        tenantId,
        validation.value,
        now,
        { allowedHosts, siblingRules: validRules }
      );
      if (!safety.ok) {
        reports.push({
          index: i,
          ok: false,
          code: safety.code,
          normalizedSourcePath: validation.value.normalizedSourcePath
        });
        allValid = false;
        continue;
      }

      reports.push({
        index: i,
        ok: true,
        normalizedSourcePath: validation.value.normalizedSourcePath
      });
      validRules.push(validation.value);
    }

    if (dryRun) {
      return ok({
        dryRun: true,
        total: items.length,
        valid: validRules.length,
        results: reports
      });
    }

    if (!allValid) {
      return fail(
        400,
        "IMPORT_VALIDATION_FAILED",
        "One or more items are invalid; nothing was imported.",
        {},
        { results: reports }
      );
    }

    let created = 0;
    for (const rule of validRules) {
      await createRedirect(tx, tenantId, auth.context.tenantUserId, rule);
      created += 1;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: SEO_MODULE_KEY,
      action: "seo_distribution.redirect.imported",
      resourceType: "seo_redirect",
      resourceId: tenantId,
      severity: "info",
      message: `Bulk redirect import: ${created} rule(s) created.`,
      attributes: { created },
      correlationId
    });

    const responseBody = {
      success: true,
      data: { dryRun: false, total: items.length, created, results: reports },
      meta: {}
    };
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
