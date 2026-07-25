import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { submitFormDraft } from "../../../../../modules/form-drafts/application/form-draft-directory";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";

const SUBMIT_GUARD = {
  moduleKey: "form_drafts",
  activityCode: "draft",
  action: "update" as const
};

const IDEMPOTENCY_SCOPE = "form_draft_submit";

/**
 * `POST /api/v1/form-drafts/{id}/submit` (ported from awcms Issue #484) — transitions a draft
 * from `status = 'draft'` to `'submitted'`. Reuses the `update` ABAC action
 * (submitting is a state transition on an existing draft, not a distinct
 * permission — same reasoning `workflow.approval.approve` uses for both
 * approve/reject).
 *
 * High-risk mutation: requires `Idempotency-Key`, same replay/conflict shape
 * as `workflows/tasks/{id}/decisions.ts` — a network retry after the
 * transition already committed must return the original response, not a
 * second submission or a confusing error.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const draftId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!draftId) {
    return fail(400, "VALIDATION_ERROR", "Form draft id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const requestHash = computeRequestHash({ draftId });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        SUBMIT_GUARD
      );

      if (!auth.allowed) {
        return auth.denied;
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

      const draft = await submitFormDraft(
        tx,
        tenantId,
        auth.context.tenantUserId,
        draftId
      );

      if (!draft) {
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "Form draft not found, already submitted, or no longer editable."
        );
      }

      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "form_drafts",
        action: "submit",
        resourceType: "form_draft",
        resourceId: draftId,
        severity: "warning",
        message: `Form draft submitted for ${draft.moduleKey}/${draft.wizardKey}.`,
        attributes: { moduleKey: draft.moduleKey, wizardKey: draft.wizardKey },
        correlationId
      });

      const successResponse = ok(draft);
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
    },
    { workClass: "interactive" }
  );
};
