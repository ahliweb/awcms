import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  deleteFormDraft,
  fetchActiveFormDraft,
  updateFormDraft
} from "../../../../modules/form-drafts/application/form-draft-directory";
import { validateUpdateFormDraftInput } from "../../../../modules/form-drafts/domain/form-draft-validation";

const READ_GUARD = {
  moduleKey: "form_drafts",
  activityCode: "draft",
  action: "read" as const
};

const UPDATE_GUARD = {
  moduleKey: "form_drafts",
  activityCode: "draft",
  action: "update" as const
};

const DELETE_GUARD = {
  moduleKey: "form_drafts",
  activityCode: "draft",
  action: "delete" as const
};

/** `GET /api/v1/form-drafts/{id}` — read one draft (resume-on-load). */
export const GET: APIRoute = async ({ request, params, cookies }) => {
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

    const draft = await fetchActiveFormDraft(tx, tenantId, draftId);

    if (!draft) {
      return fail(404, "RESOURCE_NOT_FOUND", "Form draft not found.");
    }

    return ok(draft);
  });
};

/**
 * `PATCH /api/v1/form-drafts/{id}` — update `currentStep`/`payload`/
 * `expiresAt`. Only a draft still in `status = 'draft'` is editable; a
 * submitted/abandoned/expired draft returns `404` (it's history now, not a
 * live resource this endpoint mutates). Naturally idempotent — retrying the
 * same PATCH body produces the same end state, so no `Idempotency-Key`.
 */
export const PATCH: APIRoute = async ({ request, params, cookies }) => {
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateFormDraftInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Form draft update is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

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

    const draft = await updateFormDraft(
      tx,
      tenantId,
      auth.context.tenantUserId,
      draftId,
      input
    );

    if (!draft) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Form draft not found or no longer editable."
      );
    }

    return ok(draft);
  });
};

/**
 * `DELETE /api/v1/form-drafts/{id}` — soft-delete ("abandon") a draft.
 * `reason` is optional (unlike `DELETE /api/v1/profiles/{id}`, which
 * requires one) — a draft is low-stakes scratch state a user discards
 * routinely, not a business record where the reason matters for audit; a
 * default is recorded instead of forcing every caller to supply one.
 * Idempotent — repeating the call on an already-deleted draft is a
 * `404`, not an error, and never double-writes `deleted_at`.
 */
export const DELETE: APIRoute = async ({ request, params, cookies }) => {
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const reasonRaw = (body as { reason?: unknown } | null)?.reason;
  const reason =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0
      ? reasonRaw.trim()
      : "Abandoned by user.";

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      DELETE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const deleted = await deleteFormDraft(
      tx,
      tenantId,
      auth.context.tenantUserId,
      draftId,
      reason
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Form draft not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "form_drafts",
      action: "delete",
      resourceType: "form_draft",
      resourceId: draftId,
      severity: "info",
      message: "Form draft deleted.",
      attributes: { reason }
    });

    return ok({ id: draftId, deleted: true });
  });
};
