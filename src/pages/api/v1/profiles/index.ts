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
import {
  createParty,
  listParties,
  type ListPartiesOptions
} from "../../../../modules/profile-identity/application/party-directory";
import { toPartyMaskedAdminDTO } from "../../../../modules/profile-identity/domain/projection";
import {
  validateCreatePartyInput,
  type PartyType
} from "../../../../modules/profile-identity/domain/party-validation";

const READ_GUARD = {
  moduleKey: "profile_identity",
  activityCode: "profile_management",
  action: "read" as const
};
const CREATE_GUARD = {
  moduleKey: "profile_identity",
  activityCode: "profile_management",
  action: "create" as const
};
const PARTY_TYPES: readonly PartyType[] = ["person", "organization"];

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const typeParam = url.searchParams.get("type");
  if (typeParam !== null && !PARTY_TYPES.includes(typeParam as PartyType)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "type must be one of: person, organization."
    );
  }

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;
  if (
    limitParam !== null &&
    (!Number.isFinite(limit) || (limit as number) < 1)
  ) {
    return fail(400, "VALIDATION_ERROR", "limit must be a positive number.");
  }

  const options: ListPartiesOptions = {
    profileType: (typeParam as PartyType) ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    query: url.searchParams.get("q") ?? undefined,
    limit
  };

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

    const result = await listParties(tx, tenantId, options);
    return ok({ items: result.items.map(toPartyMaskedAdminDTO) });
  });
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateCreatePartyInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Profile creation input is invalid.",
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
      CREATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const record = await createParty(
      tx,
      tenantId,
      auth.context.tenantUserId,
      validation.value,
      correlationId
    );
    return ok(toPartyMaskedAdminDTO(record));
  });
};
