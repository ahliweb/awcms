import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../../modules/identity-access/application/access-guard";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../../modules/_shared/idempotency";
import {
  approveSoDConflictException,
  findSoDConflictExceptionRuleKey
} from "../../../../../../../modules/identity-access/application/sod-exception-service";
import { resolveSoDApprovalAuthority } from "../../../../../../../modules/identity-access/domain/sod-approval-authority";
import { collectSoDRuleDescriptors } from "../../../../../../../modules/identity-access/domain/sod-rule-registry";
import { listModules } from "../../../../../../../modules";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../../lib/security/request-body-limit";

const IDEMPOTENCY_SCOPE = "identity_access_sod_conflict_exception_approve";

/**
 * The composed registry's SoD rules, read here for the SECOND gate below — the
 * one each rule declares for itself.
 */
const SOD_RULES = collectSoDRuleDescriptors(listModules());

/** The fixed permission every approval needs, whatever the rule adds. */
const BASE_APPROVE_KEY = "identity_access.business_scope_exceptions.approve";

type DecideExceptionBody = {
  decisionReason?: unknown;
};

/**
 * `POST /api/v1/identity/business-scope/exceptions/{id}/approve` (Issue #181)
 * — approve a pending SoD conflict exception (the sanctioned "administrative
 * override"). Gated on the DEDICATED `identity_access.business_scope_exceptions.approve`
 * permission and denies self-approval (re-checked from the DB row, never
 * trusted from the request body). High-risk: `Idempotency-Key` required,
 * audited `critical`.
 *
 * ## TWO gates, because the rule gets to name its own checker (#545)
 *
 * `SoDRuleDescriptor.exceptionPolicy.requiresApprovalPermission` is described
 * by the contract as "the permission key a DIFFERENT tenant user must hold to
 * approve an exception to THIS rule", the registry gate refuses a rule that
 * omits it, and until #545 nothing on any code path ever read it. The single
 * rule this base ships names exactly the fixed key above, so the omission was
 * invisible: the first module to declare a rule approvable only by a finance
 * controller would have had that requirement silently ignored, and the
 * descriptor would have kept saying otherwise.
 *
 * So the fixed gate runs first — an unauthorized caller learns nothing about
 * which rule an id belongs to — and only then is the rule looked up and its
 * own key asked for, when it differs.
 *
 * A rule the registry does not know REFUSES. An exception's whole meaning is
 * "proceed despite THIS rule", so an override nobody can describe is one
 * nobody can review; it is also already inert, because the evaluator resolves
 * exceptions by rule key and no decision consults a rule that is gone.
 * Rejecting and revoking stay available, which is the direction that lets an
 * operator clean up.
 */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const exceptionId = params.id;
  if (!exceptionId) {
    return fail(400, "VALIDATION_ERROR", "Exception id is required.");
  }

  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  const bodyRead = await readJsonBody<DecideExceptionBody>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = (bodyRead.value ?? {}) as DecideExceptionBody;

  const decisionReason =
    typeof body.decisionReason === "string" ? body.decisionReason : null;
  const requestHash = computeRequestHash({
    ...body,
    id: exceptionId,
    action: "approve"
  });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "identity_access",
      activityCode: "business_scope_exceptions",
      action: "approve"
    });

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

    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    // Read AFTER the fixed gate: the rule key is information about the row,
    // and a caller who may not approve anything must not learn it. `null` is
    // left to `approveSoDConflictException` to answer as `not_found`, so the
    // missing-row response has exactly one author.
    const ruleKey = await findSoDConflictExceptionRuleKey(
      tx,
      tenantId,
      exceptionId
    );

    if (ruleKey !== null) {
      const authority = resolveSoDApprovalAuthority(
        ruleKey,
        SOD_RULES,
        BASE_APPROVE_KEY
      );

      if (authority.outcome === "refused") {
        return fail(403, authority.code, authority.message);
      }

      if (authority.outcome === "additional") {
        const ruleAuth = await authorizeInTransaction(
          tx,
          tenantId,
          tokenHash,
          now,
          authority.request
        );

        if (!ruleAuth.allowed) {
          return ruleAuth.denied;
        }
      }
    }

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

    const result = await approveSoDConflictException(
      tx,
      tenantId,
      auth.context.tenantUserId,
      exceptionId,
      decisionReason,
      correlationId
    );

    if (!result.ok) {
      if (result.reason === "not_found") {
        return fail(404, "NOT_FOUND", "SoD conflict exception not found.");
      }
      if (result.reason === "self_approval_denied") {
        return fail(
          403,
          "SELF_APPROVAL_DENIED",
          "Approving your own exception request is not allowed."
        );
      }
      return fail(
        409,
        "INVALID_STATE",
        "SoD conflict exception is not pending."
      );
    }

    const successResponse = ok({ exception: result.exception });
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
