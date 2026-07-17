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
  createOffice,
  DuplicateOfficeCodeError,
  listOffices,
  ParentOfficeNotFoundError
} from "../../../../modules/tenant-admin/application/office-directory";
import { validateCreateOfficeInput } from "../../../../modules/tenant-admin/domain/office-validation";
import { decodeKeysetCursor } from "../../../../modules/_shared/keyset-pagination";

const READ_GUARD = {
  moduleKey: "tenant_admin",
  activityCode: "office_management",
  action: "read" as const
};
const CREATE_GUARD = {
  moduleKey: "tenant_admin",
  activityCode: "office_management",
  action: "create" as const
};

export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  // A malformed cursor is rejected rather than treated as "no cursor": silently
  // serving page 1 for a corrupt cursor is how paging bugs hide.
  const cursorParam = new URL(request.url).searchParams.get("cursor");
  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
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
    if (!auth.allowed) return auth.denied;

    const page = await listOffices(tx, tenantId, cursor);
    return ok({ items: page.items, nextCursor: page.nextCursor });
  });
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateCreateOfficeInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Office creation input is invalid.",
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
      const office = await createOffice(
        tx,
        tenantId,
        auth.context.tenantUserId,
        validation.value,
        correlationId
      );
      return ok(office);
    } catch (error) {
      // Both branches are caught INSIDE `withTenant` on purpose: neither error
      // is a `Bun.SQL.PostgresError` by the time it gets here, so
      // `tenant-context.ts`'s client-input carve-out (which keys off exactly
      // that instanceof) would not recognise them, and a burst of duplicate
      // submits would count toward the shared database circuit breaker and
      // trip it for everyone.
      //
      // Returning 4xx from in here is only safe because of what has NOT been
      // written. `ParentOfficeNotFoundError` is raised before `createOffice`
      // touches anything, so the commit that `withTenant` performs on this
      // normal return commits nothing. `DuplicateOfficeCodeError` follows the
      // unique violation that already aborted the transaction, so the commit
      // degrades to a rollback. Neither may write anything further to `tx`
      // here — an audit event for the rejected attempt would itself fail with
      // 25P02 and turn this 409 back into a 500.
      if (error instanceof ParentOfficeNotFoundError) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "Office creation input is invalid.",
          {},
          [{ field: "parentOfficeId", message: error.message }]
        );
      }

      if (error instanceof DuplicateOfficeCodeError) {
        return fail(409, "OFFICE_CODE_ALREADY_EXISTS", error.message);
      }

      throw error;
    }
  });
};
