/**
 * The unauthenticated tenant picker's data source, shared by `/login` and
 * `/forgot-password`.
 *
 * `awcms_tenants` is the RLS-free root table and `tenant_admin` owns it. Both
 * auth pages have to answer the same question before any tenant context exists
 * — "which tenant is this visitor signing in to?" — so the read lives here
 * once rather than as two copies of the same SSR frontmatter query that could
 * drift in their limit, their status filter, or their failure behaviour.
 *
 * ## What it deliberately exposes
 *
 * Only `id` + `tenant_name` of `status = 'active'` rows, and only up to
 * `TENANT_PICKER_LIMIT`. Rendering tenant NAMES to an unauthenticated visitor
 * when more than one exists is an accepted product decision for this base
 * repo's small multi-tenant deployments; past the cap the picker degrades to a
 * manual id field, which bounds the query AND avoids turning the page into a
 * mass tenant-enumeration surface. A deployment with that many tenants resolves
 * the tenant by host (`tenant_domain`) instead.
 *
 * ## Failure is a mode, not an exception
 *
 * No database, a placeholder `DATABASE_URL`, an unmigrated schema, or an open
 * circuit breaker all resolve to `"manual"` rather than throwing — an auth page
 * that cannot render is worse than one that asks for the tenant id.
 */
import { getDatabaseClient } from "../../../lib/database/client";

/** Hard cap on the public dropdown. */
export const TENANT_PICKER_LIMIT = 50;

export type TenantPickerOption = { id: string; name: string };

export type TenantPickerMode = "manual" | "single" | "select";

export type TenantPickerModel = {
  mode: TenantPickerMode;
  /** Empty for `"manual"`; exactly one entry for `"single"`. */
  options: TenantPickerOption[];
};

const MANUAL: TenantPickerModel = { mode: "manual", options: [] };

/**
 * Pure half — decides the mode from the rows a caller read, so the cap and the
 * empty/over-cap branches are testable without a database.
 *
 * `rows.length > limit` is what "over the cap" means, which is why the query
 * reads `LIMIT limit + 1`: reading exactly `limit` rows cannot distinguish "the
 * deployment has exactly that many tenants" from "there are more", and the
 * over-cap case must fall back to the manual field.
 */
export function resolveTenantPickerModel(
  rows: readonly { id: string; tenant_name: string }[],
  limit: number = TENANT_PICKER_LIMIT
): TenantPickerModel {
  if (rows.length === 0 || rows.length > limit) {
    return MANUAL;
  }

  const options = rows.map((row) => ({ id: row.id, name: row.tenant_name }));

  return { mode: options.length === 1 ? "single" : "select", options };
}

/**
 * Reads the active tenant registry with NO tenant context — there is none yet,
 * the visitor has not picked one — and resolves the picker mode.
 *
 * `resolveSql` is a FACTORY, not a client, so that acquiring the client is
 * inside the `try` as well: `getDatabaseClient()` itself throws on a
 * placeholder/absent `DATABASE_URL`, and a page that crashed there would defeat
 * the whole point of the fallback below.
 */
export async function loadTenantPickerModel(
  resolveSql: () => Bun.SQL = getDatabaseClient,
  limit: number = TENANT_PICKER_LIMIT
): Promise<TenantPickerModel> {
  try {
    const sql = resolveSql();
    const rows = (await sql`
      SELECT id, tenant_name
      FROM awcms_tenants
      WHERE status = 'active'
      ORDER BY tenant_name ASC
      LIMIT ${limit + 1}
    `) as Array<{ id: string; tenant_name: string }>;

    return resolveTenantPickerModel(rows, limit);
  } catch {
    return MANUAL;
  }
}
