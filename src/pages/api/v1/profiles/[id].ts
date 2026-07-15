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
import { validateDeleteReasonRequestBody } from "../../../../modules/profile-identity/domain/lifecycle-validation";
import {
  fetchPartyById,
  softDeleteParty,
  updateParty
} from "../../../../modules/profile-identity/application/party-directory";
import { toPartyMaskedAdminDTO } from "../../../../modules/profile-identity/domain/projection";
import { validateUpdatePartyInput } from "../../../../modules/profile-identity/domain/party-validation";

const READ_GUARD = {
  moduleKey: "profile_identity",
  activityCode: "profile_management",
  action: "read" as const
};
const UPDATE_GUARD = {
  moduleKey: "profile_identity",
  activityCode: "profile_management",
  action: "update" as const
};
const DELETE_GUARD = {
  moduleKey: "profile_identity",
  activityCode: "profile_management",
  action: "delete" as const
};

export const GET: APIRoute = async ({ request, params, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const profileId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!profileId)
    return fail(400, "VALIDATION_ERROR", "Profile id is required.");
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

    const record = await fetchPartyById(tx, tenantId, profileId);
    if (!record) return fail(404, "RESOURCE_NOT_FOUND", "Profile not found.");

    return ok(toPartyMaskedAdminDTO(record));
  });
};

export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const profileId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!profileId)
    return fail(400, "VALIDATION_ERROR", "Profile id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateUpdatePartyInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Profile update input is invalid.",
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
      UPDATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const record = await updateParty(
      tx,
      tenantId,
      auth.context.tenantUserId,
      profileId,
      validation.value,
      correlationId
    );
    if (!record) return fail(404, "RESOURCE_NOT_FOUND", "Profile not found.");

    return ok(toPartyMaskedAdminDTO(record));
  });
};

export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const profileId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!profileId)
    return fail(400, "VALIDATION_ERROR", "Profile id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateDeleteReasonRequestBody(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Delete reason input is invalid.",
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

    const deleted = await softDeleteParty(
      tx,
      tenantId,
      auth.context.tenantUserId,
      profileId,
      validation.value.reason,
      correlationId
    );
    if (!deleted) return fail(404, "RESOURCE_NOT_FOUND", "Profile not found.");

    return ok({ id: profileId, status: "deleted" });
  });
};
