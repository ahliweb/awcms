/**
 * Per-tenant GitHub repository-progress configuration (Issue
 * ahliweb/omes#249, ADR-0030). Read by
 * `application/repository-progress-poller.ts` (as `awcms_worker`) and
 * written only through `omes_control.repository_progress.configure`
 * (`src/pages/api/v1/omes/repository-progress/config.ts`, as `awcms_app`).
 *
 * `secret_ref` NEVER holds a raw token. For v1 this repository resolves
 * exactly ONE optional credential shape:
 * `{"store": "env", "key": "OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN"}` — a
 * single, fixed, statically-scannable env var name, the same convention
 * `src/modules/tenant-domain/domain/tenant-domain-dns-config.ts`'s
 * `TENANT_DOMAIN_CLOUDFLARE_*` vars already use, and required by
 * `scripts/jobs-env-allowlist.ts`'s static `collectEnvReads()` walk (a
 * dynamic, tenant-chosen env var NAME could not be statically discovered,
 * and would either be silently dropped from the job container's environment
 * or require widening the allow-list to "every env var", both worse). A
 * tenant with a public repository configures no token at all — `secret_ref`
 * stays `NULL` and the poll runs unauthenticated. Multiple tenants that all
 * opt in to a token share the one operator-provisioned env var; this is a
 * deliberate v1 simplification (documented in the module README), not a
 * multi-tenant-distinct-credential system — ADR-0030 requires the shape be
 * a `secret_ref`, not that it be one-token-per-tenant.
 */
import {
  isValidGithubOwnerOrName,
  buildRepositoryHtmlUrl
} from "../domain/repository-progress";

export const REPOSITORY_PROGRESS_GITHUB_TOKEN_SECRET_REF = {
  store: "env",
  key: "OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN"
} as const;

export type RepositoryProgressConfig = {
  owner: string;
  name: string;
  htmlUrl: string;
  usesToken: boolean;
  createdAt: string;
  updatedAt: string;
};

type ConfigRow = {
  owner: string;
  name: string;
  secret_ref: { store: string; key: string } | null;
  created_at: Date;
  updated_at: Date;
};

function toConfig(row: ConfigRow): RepositoryProgressConfig {
  return {
    owner: row.owner,
    name: row.name,
    htmlUrl: buildRepositoryHtmlUrl(row.owner, row.name),
    usesToken: row.secret_ref !== null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

/** The tenant's configured repository, or `null` if none is configured yet ("unconfigured" screen state). */
export async function getRepositoryProgressConfig(
  tx: Bun.SQL,
  tenantId: string
): Promise<RepositoryProgressConfig | null> {
  const rows = (await tx`
    SELECT owner, name, secret_ref, created_at, updated_at
    FROM awcms_omes_repository_progress_config
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `) as ConfigRow[];

  return rows.length > 0 ? toConfig(rows[0]!) : null;
}

export type SetRepositoryProgressConfigInput = {
  owner: string;
  name: string;
  useToken: boolean;
};

export type SetRepositoryProgressConfigOutcome =
  | { outcome: "saved"; config: RepositoryProgressConfig }
  | { outcome: "invalid_owner_or_name" };

/**
 * Validates and upserts the tenant's repository-progress configuration.
 * Charset validation matches the vendored contract's `repository.owner`/
 * `repository.name` pattern exactly (`domain/repository-progress.ts`'s
 * `GITHUB_OWNER_OR_NAME_RE`) — this is also the ONLY place a raw owner/name
 * string from an admin form reaches the database, so this is the fail-closed
 * gate against anything that is not a plain GitHub identifier.
 *
 * Changing the configured repository (or clearing it — see
 * `clearRepositoryProgressConfig`) also clears any existing projection row:
 * a stale projection for a DIFFERENT, no-longer-configured repository must
 * never keep rendering under the new configuration.
 */
export async function setRepositoryProgressConfig(
  tx: Bun.SQL,
  tenantId: string,
  input: SetRepositoryProgressConfigInput
): Promise<SetRepositoryProgressConfigOutcome> {
  if (
    !isValidGithubOwnerOrName(input.owner) ||
    !isValidGithubOwnerOrName(input.name)
  ) {
    return { outcome: "invalid_owner_or_name" };
  }

  const secretRef = input.useToken
    ? REPOSITORY_PROGRESS_GITHUB_TOKEN_SECRET_REF
    : null;

  const rows = (await tx`
    INSERT INTO awcms_omes_repository_progress_config (
      tenant_id, owner, name, secret_ref
    ) VALUES (
      ${tenantId}, ${input.owner}, ${input.name}, ${secretRef}::jsonb
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      owner = EXCLUDED.owner,
      name = EXCLUDED.name,
      secret_ref = EXCLUDED.secret_ref,
      updated_at = now()
    RETURNING owner, name, secret_ref, created_at, updated_at
  `) as ConfigRow[];

  // A reconfiguration to a different repository invalidates any existing
  // projection row for the OLD repository — see header. Harmless no-op if
  // there was no prior projection, or if owner/name did not actually change.
  await tx`
    DELETE FROM awcms_omes_repository_progress
    WHERE tenant_id = ${tenantId}
      AND (owner <> ${input.owner} OR name <> ${input.name})
  `;

  return { outcome: "saved", config: toConfig(rows[0]!) };
}

/** Clears the tenant's configuration (back to "unconfigured") and any existing projection row for the previously-configured repository. */
export async function clearRepositoryProgressConfig(
  tx: Bun.SQL,
  tenantId: string
): Promise<void> {
  await tx`DELETE FROM awcms_omes_repository_progress_config WHERE tenant_id = ${tenantId}`;
  await tx`DELETE FROM awcms_omes_repository_progress WHERE tenant_id = ${tenantId}`;
}

/** Internal shape the poller reads. Kept separate from the admin-facing `RepositoryProgressConfig` type so a future field never accidentally leaks into an API response by sharing a type. */
export type PollableRepositoryProgressConfig = {
  owner: string;
  name: string;
  secretRef: { store: string; key: string } | null;
};

/**
 * The tenant's repository-progress configuration for the scheduled poller,
 * or `null` if none is configured. `awcms_omes_repository_progress_config`
 * carries `FORCE ROW LEVEL SECURITY` (sql/166) — this MUST be called inside a
 * per-tenant transaction (`withTenant`/`withTenantOrThrow`) with
 * `app.current_tenant_id` already set, exactly like `getRepositoryProgressConfig`
 * above and every other scheduled job in this codebase
 * (`fetchActiveTenants` + a per-tenant `withTenant` loop) — a query with no
 * tenant context set matches zero rows under this table's RLS policy, not
 * every tenant's rows, so there is no way to "accidentally" read cross-tenant
 * here even if a caller forgot to scope it; it would simply return nothing.
 */
export async function getPollableRepositoryProgressConfig(
  tx: Bun.SQL
): Promise<PollableRepositoryProgressConfig | null> {
  const rows = (await tx`
    SELECT owner, name, secret_ref
    FROM awcms_omes_repository_progress_config
    LIMIT 1
  `) as {
    owner: string;
    name: string;
    secret_ref: { store: string; key: string } | null;
  }[];

  return rows.length > 0
    ? {
        owner: rows[0]!.owner,
        name: rows[0]!.name,
        secretRef: rows[0]!.secret_ref
      }
    : null;
}
