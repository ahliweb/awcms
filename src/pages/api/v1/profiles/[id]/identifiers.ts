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
import {
  addIdentifierToProfile,
  DuplicateIdentifierError
} from "../../../../../modules/profile-identity/application/identifier-directory";
import { validateAddIdentifierInput } from "../../../../../modules/profile-identity/domain/identifier-validation";

const CREATE_GUARD = {
  moduleKey: "profile_identity",
  activityCode: "profile_management",
  action: "create" as const
};

export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const profileId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!profileId)
    return fail(400, "VALIDATION_ERROR", "Profile id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateAddIdentifierInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Identifier input is invalid.",
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

    try {
      const record = await addIdentifierToProfile(
        tx,
        tenantId,
        auth.context.tenantUserId,
        profileId,
        validation.value,
        correlationId
      );
      if (!record) return fail(404, "RESOURCE_NOT_FOUND", "Profile not found.");

      return ok(record);
    } catch (error) {
      // Caught inside `withTenant`, deliberately: a `DuplicateIdentifierError`
      // escaping the callback is not a `Bun.SQL.PostgresError`, so
      // `tenant-context.ts`'s client-input carve-out would not recognise it and
      // a burst of duplicate submits would count against the shared database
      // circuit breaker. The unique violation has already aborted this
      // transaction — nothing further may be written to `tx` here (an audit
      // event for the rejected attempt would itself fail with 25P02 and turn
      // this 409 back into a 500), so we only translate and return.
      if (error instanceof DuplicateIdentifierError) {
        return fail(409, "IDENTIFIER_ALREADY_EXISTS", error.message);
      }

      throw error;
    }
  });
};
