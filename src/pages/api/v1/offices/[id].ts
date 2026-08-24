import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import {
  fetchOfficeById,
  softDeleteOffice,
  updateOffice
} from "../../../../modules/tenant-admin/application/office-directory";
import {
  validateDeleteOfficeInput,
  validateUpdateOfficeInput
} from "../../../../modules/tenant-admin/domain/office-validation";

const READ_GUARD = {
  moduleKey: "tenant_admin",
  activityCode: "office_management",
  action: "read" as const
};
const UPDATE_GUARD = {
  moduleKey: "tenant_admin",
  activityCode: "office_management",
  action: "update" as const
};
const DELETE_GUARD = {
  moduleKey: "tenant_admin",
  activityCode: "office_management",
  action: "delete" as const
};

export const GET: APIRoute = async ({ request, params, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const officeId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!officeId) return fail(400, "VALIDATION_ERROR", "Office id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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

    const office = await fetchOfficeById(tx, tenantId, officeId);
    if (!office) return fail(404, "RESOURCE_NOT_FOUND", "Office not found.");

    return ok(office);
  });
};

export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const officeId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!officeId) return fail(400, "VALIDATION_ERROR", "Office id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateUpdateOfficeInput(bodyRead.value);
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
    if (!auth.allowed) return auth.denied;

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Office update input is invalid.",
        {},
        validation.errors
      );
    }

    const office = await updateOffice(
      tx,
      tenantId,
      auth.context.tenantUserId,
      officeId,
      validation.value,
      correlationId
    );
    if (!office) return fail(404, "RESOURCE_NOT_FOUND", "Office not found.");

    return ok(office);
  });
};

export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const officeId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!officeId) return fail(400, "VALIDATION_ERROR", "Office id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  // Bodyless DELETE is allowed (reason → null); a present-but-blank reason is
  // rejected here rather than stored as "".
  const validation = validateDeleteOfficeInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Office delete input is invalid.",
      {},
      validation.errors
    );
  }

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
      DELETE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const deleted = await softDeleteOffice(
      tx,
      tenantId,
      auth.context.tenantUserId,
      officeId,
      validation.value.reason,
      correlationId
    );
    if (!deleted) return fail(404, "RESOURCE_NOT_FOUND", "Office not found.");

    return ok({ id: officeId, status: "deleted" });
  });
};
