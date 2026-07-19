/**
 * Admin CRUD for tenant-configured OIDC SSO providers (Issue #185, epic
 * ERP-readiness enterprise auth #177) over `awcms_auth_providers` (sql/025).
 * Ported/adapted from awcms-mini `application/auth-provider-directory.ts`
 * (Issue #591). Tenant master data with soft delete.
 *
 * The client secret is NEVER returned by any function here (issue's own
 * acceptance criterion) — `toProviderView` exposes only whether a secret is
 * configured and, for the env-referenced case, the environment variable NAME.
 */
import {
  encryptSsoClientSecret,
  resolveSsoEncryptionKey
} from "../../../lib/auth/sso-credential-crypto";
import { resolveSsoMaxProvidersPerTenant } from "../../../lib/auth/sso-config";
import type {
  CreateAuthProviderInput,
  UpdateAuthProviderInput
} from "../domain/tenant-sso-policy";

const POSTGRES_UNIQUE_VIOLATION = "23505";

export type AuthProviderView = {
  id: string;
  providerKey: string;
  providerType: string;
  displayName: string;
  issuerUrl: string;
  clientId: string;
  secretSource: "encrypted" | "env";
  clientSecretEnvVar: string | null;
  scopes: string;
  allowedEmailDomains: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuthProviderRow = {
  id: string;
  provider_key: string;
  provider_type: string;
  display_name: string;
  issuer_url: string;
  client_id: string;
  client_secret_ciphertext: string | null;
  client_secret_env_var: string | null;
  scopes: string;
  allowed_email_domains: unknown;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

function toProviderView(row: AuthProviderRow): AuthProviderView {
  return {
    id: row.id,
    providerKey: row.provider_key,
    providerType: row.provider_type,
    displayName: row.display_name,
    issuerUrl: row.issuer_url,
    clientId: row.client_id,
    secretSource: row.client_secret_ciphertext !== null ? "encrypted" : "env",
    clientSecretEnvVar: row.client_secret_env_var,
    scopes: row.scopes,
    allowedEmailDomains: Array.isArray(row.allowed_email_domains)
      ? (row.allowed_email_domains as string[])
      : [],
    enabled: row.enabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function listAuthProviders(
  tx: Bun.SQL,
  tenantId: string
): Promise<AuthProviderView[]> {
  const rows = (await tx`
    SELECT id, provider_key, provider_type, display_name, issuer_url, client_id,
           client_secret_ciphertext, client_secret_env_var, scopes,
           allowed_email_domains, enabled, created_at, updated_at
    FROM awcms_auth_providers
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY created_at DESC
  `) as AuthProviderRow[];

  return rows.map(toProviderView);
}

export async function fetchAuthProviderById(
  tx: Bun.SQL,
  tenantId: string,
  providerId: string
): Promise<AuthProviderView | null> {
  const rows = (await tx`
    SELECT id, provider_key, provider_type, display_name, issuer_url, client_id,
           client_secret_ciphertext, client_secret_env_var, scopes,
           allowed_email_domains, enabled, created_at, updated_at
    FROM awcms_auth_providers
    WHERE tenant_id = ${tenantId} AND id = ${providerId} AND deleted_at IS NULL
  `) as AuthProviderRow[];

  return rows[0] ? toProviderView(rows[0]) : null;
}

/**
 * Loads the raw row (including the secret material) for OAuth-time use only —
 * `tenant-sso.ts`'s `resolveProviderClientSecret` is the sole consumer that
 * ever needs the ciphertext/env-var name, and it never leaves that function as
 * plaintext beyond the in-memory token-exchange call.
 */
export async function fetchAuthProviderRowByKey(
  tx: Bun.SQL,
  tenantId: string,
  providerKey: string
): Promise<AuthProviderRow | null> {
  const rows = (await tx`
    SELECT id, provider_key, provider_type, display_name, issuer_url, client_id,
           client_secret_ciphertext, client_secret_env_var, scopes,
           allowed_email_domains, enabled, created_at, updated_at
    FROM awcms_auth_providers
    WHERE tenant_id = ${tenantId} AND provider_key = ${providerKey} AND deleted_at IS NULL
  `) as AuthProviderRow[];

  return rows[0] ?? null;
}

export type CreateAuthProviderResult =
  | { outcome: "created"; provider: AuthProviderView }
  | { outcome: "duplicate_key" }
  | { outcome: "limit_exceeded"; limit: number }
  | { outcome: "misconfigured" };

export async function createAuthProvider(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  input: CreateAuthProviderInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<CreateAuthProviderResult> {
  // Fast, clean-path duplicate check for the sequential case. NOT sufficient on
  // its own: two concurrent creates with the same providerKey both pass this
  // pre-read, so the INSERT below is wrapped in a 23505 catch (the real
  // invariant is the `(tenant_id, provider_key) WHERE deleted_at IS NULL`
  // partial unique index) — same convention as office-directory / user-admin.
  const existingRows = await tx`
    SELECT id FROM awcms_auth_providers
    WHERE tenant_id = ${tenantId} AND provider_key = ${input.providerKey} AND deleted_at IS NULL
  `;

  if (existingRows.length > 0) {
    return { outcome: "duplicate_key" };
  }

  // Count-then-insert (not atomic): this bounds a tenant's total probing budget,
  // it is not a security invariant. A concurrent burst can land a single bounded
  // overshoot, but each subsequent create re-reads the committed count and is
  // rejected — harmless for what this defends against.
  const limit = resolveSsoMaxProvidersPerTenant(env);
  const countRows = (await tx`
    SELECT count(*)::int AS count FROM awcms_auth_providers
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
  `) as { count: number }[];

  if ((countRows[0]?.count ?? 0) >= limit) {
    return { outcome: "limit_exceeded", limit };
  }

  let clientSecretCiphertext: string | null = null;

  if (input.clientSecret) {
    const key = resolveSsoEncryptionKey(env);

    if (!key) {
      return { outcome: "misconfigured" };
    }

    clientSecretCiphertext = encryptSsoClientSecret(input.clientSecret, key);
  }

  // The INSERT is the last write in this function, so a concurrent-duplicate
  // 23505 (caught here, mapped to duplicate_key) leaves no half-applied state:
  // the failed statement aborts the transaction, withTenant's COMMIT degrades
  // to ROLLBACK, and the caller returns a clean 409 instead of an unhandled 500.
  let rows: AuthProviderRow[];

  try {
    rows = (await tx`
      INSERT INTO awcms_auth_providers
        (tenant_id, provider_key, display_name, issuer_url, client_id,
         client_secret_ciphertext, client_secret_env_var, scopes,
         allowed_email_domains, enabled, created_by, updated_by)
      VALUES (
        ${tenantId}, ${input.providerKey}, ${input.displayName}, ${input.issuerUrl},
        ${input.clientId}, ${clientSecretCiphertext}, ${input.clientSecretEnvVar},
        ${input.scopes}, ${input.allowedEmailDomains}::jsonb,
        ${input.enabled}, ${actorTenantUserId}, ${actorTenantUserId}
      )
      RETURNING id, provider_key, provider_type, display_name, issuer_url, client_id,
                client_secret_ciphertext, client_secret_env_var, scopes,
                allowed_email_domains, enabled, created_at, updated_at
    `) as AuthProviderRow[];
  } catch (error) {
    if (
      error instanceof Bun.SQL.PostgresError &&
      String(error.errno) === POSTGRES_UNIQUE_VIOLATION
    ) {
      return { outcome: "duplicate_key" };
    }

    throw error;
  }

  return { outcome: "created", provider: toProviderView(rows[0]!) };
}

export type UpdateAuthProviderResult =
  | { outcome: "updated"; provider: AuthProviderView }
  | { outcome: "not_found" }
  | { outcome: "misconfigured" };

export async function updateAuthProvider(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  providerId: string,
  input: UpdateAuthProviderInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<UpdateAuthProviderResult> {
  const existing = await fetchRawById(tx, tenantId, providerId);

  if (!existing) {
    return { outcome: "not_found" };
  }

  let clientSecretCiphertext = existing.client_secret_ciphertext;
  let clientSecretEnvVar = existing.client_secret_env_var;

  if (
    input.clientSecret !== undefined ||
    input.clientSecretEnvVar !== undefined
  ) {
    if (input.clientSecret) {
      const key = resolveSsoEncryptionKey(env);

      if (!key) {
        return { outcome: "misconfigured" };
      }

      clientSecretCiphertext = encryptSsoClientSecret(input.clientSecret, key);
      clientSecretEnvVar = null;
    } else if (input.clientSecretEnvVar) {
      clientSecretCiphertext = null;
      clientSecretEnvVar = input.clientSecretEnvVar;
    }
  }

  const displayName = input.displayName ?? existing.display_name;
  const issuerUrl = input.issuerUrl ?? existing.issuer_url;
  const clientId = input.clientId ?? existing.client_id;
  const scopes = input.scopes ?? existing.scopes;
  const allowedEmailDomains =
    input.allowedEmailDomains ??
    (Array.isArray(existing.allowed_email_domains)
      ? (existing.allowed_email_domains as string[])
      : []);
  const enabled = input.enabled ?? existing.enabled;

  const rows = (await tx`
    UPDATE awcms_auth_providers
    SET display_name = ${displayName},
        issuer_url = ${issuerUrl},
        client_id = ${clientId},
        client_secret_ciphertext = ${clientSecretCiphertext},
        client_secret_env_var = ${clientSecretEnvVar},
        scopes = ${scopes},
        allowed_email_domains = ${allowedEmailDomains}::jsonb,
        enabled = ${enabled},
        updated_at = now(),
        updated_by = ${actorTenantUserId}
    WHERE tenant_id = ${tenantId} AND id = ${providerId} AND deleted_at IS NULL
    RETURNING id, provider_key, provider_type, display_name, issuer_url, client_id,
              client_secret_ciphertext, client_secret_env_var, scopes,
              allowed_email_domains, enabled, created_at, updated_at
  `) as AuthProviderRow[];

  return { outcome: "updated", provider: toProviderView(rows[0]!) };
}

async function fetchRawById(
  tx: Bun.SQL,
  tenantId: string,
  providerId: string
): Promise<AuthProviderRow | null> {
  const rows = (await tx`
    SELECT id, provider_key, provider_type, display_name, issuer_url, client_id,
           client_secret_ciphertext, client_secret_env_var, scopes,
           allowed_email_domains, enabled, created_at, updated_at
    FROM awcms_auth_providers
    WHERE tenant_id = ${tenantId} AND id = ${providerId} AND deleted_at IS NULL
  `) as AuthProviderRow[];

  return rows[0] ?? null;
}

export async function softDeleteAuthProvider(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  providerId: string,
  reason: string
): Promise<boolean> {
  const rows = await tx`
    UPDATE awcms_auth_providers
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason}
    WHERE tenant_id = ${tenantId} AND id = ${providerId} AND deleted_at IS NULL
    RETURNING id
  `;

  return rows.length > 0;
}
