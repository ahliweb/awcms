/**
 * The connection of `payroll:catalog-boundary:job` ONLY (Issue #1095, owner
 * decision K3): role `awcms_catalog_boundary_audit` (`sql/420`), which holds
 * CONNECT and the catalog views every role can read, and NO privilege on any
 * application table. The scheduled check reads structure, never data, so its
 * login must not be able to read data even if it leaks.
 *
 * `PAYROLL_CATALOG_AUDIT_DATABASE_URL` has NO fallback, unlike the worker and
 * setup seams: falling back would silently run the check as `awcms_app` (which
 * reads every payroll row of every tenant) inside a cron container. A missing
 * value refuses instead (fail closed). Its own file, so that no other job's
 * import graph reaches the code that reads this variable (job-scoped env,
 * `scripts/jobs-env-allowlist.ts`, "dedicated-role job").
 *
 * Two more refusals:
 *
 *   - {@link assertNoSharedLogins}: the job refuses to start if a shared-role
 *     connection string (the app, worker or setup one) is in its environment.
 *     The runner withholds them (`dedicatedRoleTargets`); this is the second
 *     line for a host that runs the job some other way.
 *   - {@link assertConnectedAsPayrollCatalogAuditRole}: after connecting it asks
 *     the server who it is, and stops unless both its login (`session_user`)
 *     and its current user are exactly `awcms_catalog_boundary_audit`, not
 *     SUPERUSER and not BYPASSRLS.
 */
import {
  assertConnectedAsDedicatedRole,
  buildDedicatedRoleClient
} from "./client";

export const PAYROLL_CATALOG_AUDIT_ROLE_NAME = "awcms_catalog_boundary_audit";

/**
 * The shared-role connection strings, spelled by construction rather than as
 * literals: the job-env tracer (`needsAppConnectionString`) reads a quoted
 * literal of the app login's name as "this job needs the app connection", and
 * this file needs the names only to REFUSE them.
 */
export const SHARED_LOGIN_ENV_NAMES = ["", "WORKER_", "SETUP_"].map(
  (prefix) => `${prefix}DATABASE_URL`
);

let client: Bun.SQL | undefined;

/**
 * True when the operator has activated the job: the login URL is present and
 * not blank. Unset means "not activated" (the job logs `SKIPPED` and exits 0, and
 * `security:readiness` warns); a URL that is set but wrong is a refusal.
 */
export function isPayrollCatalogAuditActivated(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (env.PAYROLL_CATALOG_AUDIT_DATABASE_URL ?? "").trim() !== "";
}

export function assertNoSharedLogins(
  env: Record<string, string | undefined> = process.env
): void {
  const present = SHARED_LOGIN_ENV_NAMES.filter(
    (name) => (env[name] ?? "").trim() !== ""
  );

  if (present.length > 0) {
    throw new Error(
      `payroll:catalog-boundary:job refuses to run with a shared database login in its environment (${present.join(", ")}): the check needs the catalog only, and a login that can read payroll rows has no place in it.`
    );
  }
}

export function getPayrollCatalogAuditDatabaseClient(): Bun.SQL {
  if (client) return client;

  // Blank counts as unset, exactly as `readConfiguredUrl` reads the shared seams.
  const databaseUrl =
    process.env.PAYROLL_CATALOG_AUDIT_DATABASE_URL?.trim() || undefined;

  if (!databaseUrl) {
    throw new Error(
      "PAYROLL_CATALOG_AUDIT_DATABASE_URL is required (role awcms_catalog_boundary_audit, sql/420); there is deliberately no fallback to another connection."
    );
  }

  client = buildDedicatedRoleClient(databaseUrl);

  return client;
}

/**
 * Throws unless the server says this connection IS the catalog audit role, as
 * its login AND its current user, without SUPERUSER or BYPASSRLS.
 */
export async function assertConnectedAsPayrollCatalogAuditRole(
  sql: Bun.SQL
): Promise<void> {
  await assertConnectedAsDedicatedRole(
    sql,
    PAYROLL_CATALOG_AUDIT_ROLE_NAME,
    "payroll:catalog-boundary:job"
  );
}
