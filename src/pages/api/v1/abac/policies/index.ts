import type { APIRoute } from "astro";

import { created, fail, ok } from "../../../../../modules/_shared/api-response";
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
import { listAbacPolicies } from "../../../../../modules/identity-access/application/access-directory";
import {
  createPolicy,
  DuplicatePolicyCodeError
} from "../../../../../modules/identity-access/application/abac-admin";
import { validateCreateAbacPolicyInput } from "../../../../../modules/identity-access/domain/abac-admin-validation";
import { invalidatePolicyCache } from "../../../../../modules/identity-access/application/policy-cache";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "read" as const
};
const CREATE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "configure" as const
};

/**
 * `GET /api/v1/abac/policies` — the tenant's ABAC policies (Issue #166).
 * Read-only. Gated on `identity_access.access_control.read`.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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

    const items = await listAbacPolicies(tx, tenantId);
    return ok({ items });
  });
};

/**
 * `POST /api/v1/abac/policies` — author a new ABAC policy (Issue #171).
 * High-risk access-control change: gated on
 * `identity_access.access_control.configure` (the access-control
 * administration permission — the only seeded write action for this activity;
 * there is no `create`), audit-logged in the application layer. A duplicate
 * `policyCode` surfaces as 409.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateCreateAbacPolicyInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "ABAC policy input is invalid.",
      {},
      validation.errors
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  // This flat #171 surface writes the SAME `awcms_abac_policies` table the
  // Issue #179 evaluator now reads through a tenant-keyed cache. A policy
  // authored here must invalidate that cache too, or the evaluator would keep
  // serving a stale snapshot — i.e. this endpoint would be a way to change
  // access rules WITHOUT them taking effect (the "API must not bypass the
  // evaluator" acceptance criterion). Invalidate AFTER commit, like the DSL
  // surface does.
  let mutated = false;
  const response = await withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      CREATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    try {
      const policy = await createPolicy(
        tx,
        tenantId,
        auth.context.tenantUserId,
        validation.value,
        correlationId
      );
      mutated = true;
      return created(policy);
    } catch (error) {
      // Caught INSIDE `withTenant` on purpose: `DuplicatePolicyCodeError` is not
      // a `Bun.SQL.PostgresError` here, so `tenant-context.ts`'s client-input
      // carve-out would not recognise it and a burst of duplicate submits would
      // count toward the shared circuit breaker. Returning 409 from in here is
      // safe because the unique violation already ABORTED the transaction, so
      // the commit degrades to a rollback and nothing further is written to
      // `tx` (a stray audit write would fail 25P02 and turn this into a 500).
      if (error instanceof DuplicatePolicyCodeError) {
        return fail(409, "POLICY_CODE_ALREADY_EXISTS", error.message);
      }
      throw error;
    }
  });

  if (mutated) {
    invalidatePolicyCache(tenantId);
  }
  return response;
};
