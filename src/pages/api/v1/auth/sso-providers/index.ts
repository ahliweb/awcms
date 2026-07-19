import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createAuthProvider,
  listAuthProviders
} from "../../../../../modules/identity-access/application/auth-provider-directory";
import { validateCreateAuthProviderInput } from "../../../../../modules/identity-access/domain/tenant-sso-policy";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "sso_providers",
  action: "read" as const
};

const CREATE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "sso_providers",
  action: "create" as const
};

/**
 * `GET /api/v1/auth/sso-providers` (Issue #185) — admin CRUD, ABAC-protected
 * (`identity_access.sso_providers.read`, sql/026). Deliberately NOT gated by
 * `isSsoEnabled()` — an admin may configure a provider ahead of flipping the
 * deployment-level flag. No network/provider call happens here — pure CRUD.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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

    const providers = await listAuthProviders(tx, tenantId);

    return ok({ providers });
  });
};

/** `POST /api/v1/auth/sso-providers` (Issue #185) — creates a tenant OIDC SSO provider. High-risk admin action: audited. A duplicate providerKey — whether a sequential retry or two concurrent creates racing past the pre-read — is caught inside `createAuthProvider` by the `(tenant_id, provider_key) WHERE deleted_at IS NULL` partial unique index (23505 → `duplicate_key`) and reported as `409 SSO_PROVIDER_KEY_CONFLICT`, never a 500. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
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

  const validation = validateCreateAuthProviderInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "SSO provider input is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
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

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await createAuthProvider(
      tx,
      tenantId,
      auth.context.tenantUserId,
      input
    );

    if (result.outcome === "duplicate_key") {
      return fail(
        409,
        "SSO_PROVIDER_KEY_CONFLICT",
        `A provider already exists for providerKey "${input.providerKey}".`
      );
    }

    if (result.outcome === "limit_exceeded") {
      return fail(
        409,
        "SSO_PROVIDER_LIMIT_EXCEEDED",
        `This tenant already has the maximum of ${result.limit} configured SSO providers.`
      );
    }

    if (result.outcome === "misconfigured") {
      return fail(
        500,
        "SSO_MISCONFIGURED",
        "AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY is not configured on this server."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "sso_provider_created",
      resourceType: "auth_provider",
      resourceId: result.provider.id,
      severity: "warning",
      message: `Tenant OIDC SSO provider created: ${result.provider.providerKey}.`,
      correlationId
    });

    return ok(result.provider);
  });
};
