import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
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
import { checkRedirectSafety } from "../../../../../modules/seo-distribution/application/redirect-safety";
import { resolveTenantAllowedHosts } from "../../../../../modules/seo-distribution/application/tenant-allowed-hosts";
import type { RedirectChainOutcome } from "../../../../../modules/seo-distribution/domain/redirect-chain";
import { validateRedirectInput } from "../../../../../modules/seo-distribution/domain/redirect-rule";
import {
  SEO_MODULE_KEY,
  SEO_REDIRECT_ACTIVITY_CODE
} from "../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `POST /api/v1/seo/redirects/validate` (ADR-0039) — read-only DRY RUN: normalize +
 * validate a proposed rule (through the frozen open-redirect guard), preview the
 * redirect chain it would produce (overlaid on existing rules), and explain any
 * source conflict / loop / over-long chain — WITHOUT writing anything. Gated by
 * `seo_distribution.redirect.read`.
 */

const READ_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "read" as const
};

function describeChain(outcome: RedirectChainOutcome) {
  if (outcome.outcome === "redirect") {
    return {
      outcome: "redirect" as const,
      hops: outcome.hops.map((h) => ({
        target: h.target,
        statusCode: h.statusCode
      })),
      finalTarget: outcome.finalTarget,
      finalStatusCode: outcome.statusCode
    };
  }
  if (outcome.outcome === "none") {
    return { outcome: "none" as const, hops: [] };
  }
  return {
    outcome: outcome.outcome,
    hops: outcome.hops.map((h) => ({
      target: h.target,
      statusCode: h.statusCode
    }))
  };
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

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

    const allowedHosts = await resolveTenantAllowedHosts(tx, tenantId);
    const validation = validateRedirectInput(bodyRead.value, { allowedHosts });

    if (!validation.ok) {
      return ok({ valid: false, errors: validation.errors });
    }

    const safety = await checkRedirectSafety(
      tx,
      tenantId,
      validation.value,
      now,
      { allowedHosts }
    );

    return ok({
      valid: safety.ok,
      normalizedSourcePath: validation.value.normalizedSourcePath,
      targetType: validation.value.targetType,
      target: validation.value.target,
      chain: safety.chain ? describeChain(safety.chain) : null,
      conflict: safety.ok ? null : (safety.conflict ?? null),
      issue: safety.ok ? null : { code: safety.code, message: safety.message }
    });
  });
};
