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
  createFormDraft,
  listFormDrafts
} from "../../../../modules/form-drafts/application/form-draft-directory";
import { validateCreateFormDraftInput } from "../../../../modules/form-drafts/domain/form-draft-validation";

const READ_GUARD = {
  moduleKey: "form_drafts",
  activityCode: "draft",
  action: "read" as const
};

const CREATE_GUARD = {
  moduleKey: "form_drafts",
  activityCode: "draft",
  action: "create" as const
};

const VALID_STATUSES = new Set(["draft", "submitted", "abandoned", "expired"]);

/**
 * `GET /api/v1/form-drafts` (ported from awcms Issue #484) — list the caller's own tenant's
 * non-deleted drafts, optionally filtered by `moduleKey`/`wizardKey`/
 * `status` query params (e.g. a page resuming its own wizard queries
 * `?moduleKey=admin_examples&wizardKey=wizard_fixture&status=draft`).
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const statusParam = url.searchParams.get("status");

  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "status must be one of draft, submitted, abandoned, expired."
    );
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

    const drafts = await listFormDrafts(tx, tenantId, {
      moduleKey: url.searchParams.get("moduleKey") ?? undefined,
      wizardKey: url.searchParams.get("wizardKey") ?? undefined,
      status:
        (statusParam as
          "draft" | "submitted" | "abandoned" | "expired" | null) ?? undefined
    });

    return ok({ drafts });
  });
};

/**
 * `POST /api/v1/form-drafts` — create a new draft. Not treated as high-risk
 * (no `Idempotency-Key` required): worst case for a network retry is one
 * extra low-value scratch row the caller can delete, not a domain-level
 * side effect — unlike `submit`, which really does need one (see
 * `[id]/submit.ts`).
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateCreateFormDraftInput(bodyRead.value);

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      CREATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Form draft input is invalid.",
        {},
        validation.errors
      );
    }

    const input = validation.value;

    const draft = await createFormDraft(
      tx,
      tenantId,
      auth.context.tenantUserId,
      input
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "form_drafts",
      action: "create",
      resourceType: "form_draft",
      resourceId: draft.id,
      severity: "info",
      message: `Form draft created for ${input.moduleKey}/${input.wizardKey}.`,
      attributes: {
        moduleKey: input.moduleKey,
        wizardKey: input.wizardKey,
        resourceType: input.resourceType
      }
    });

    return ok(draft);
  });
};
