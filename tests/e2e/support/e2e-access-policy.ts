/**
 * Seed one stored access policy for `/admin/access-policies` (Issue #1237).
 *
 * ## Why a sweep needs a row
 *
 * `/admin/access-policies` renders its table only when the tenant has at least
 * one policy; on the fresh database the CI `e2e-smoke` job bootstraps, the page
 * is a single "No access policies are stored" notice and cannot overflow. The
 * `responsive-360` sweep therefore passed on a screen that scrolled sideways
 * the moment a real tenant stored a policy (`scrollWidth` 654px at 360px), and
 * CI never saw it.
 *
 * ## Why this row is safe for every other spec
 *
 * It is a FLAT row (`is_dsl_managed = false`, the column default): the
 * evaluator's cache loads `is_active AND is_dsl_managed` only (ADR-0033), so
 * this row is stored and listed but never compiled, never matched and never
 * able to change a decision for any request in the tenant, whatever its
 * `effect`. It is an `allow` with no applicability, and `is_active = false` as
 * well, so even a future change to that discriminator would find it disabled.
 * It is written directly rather than through the API because the read wave must
 * not mutate the tenant through the app (`e2e-waves.ts`).
 *
 * The description is deliberately long, so the row is the width a real
 * operator's description would make it rather than a minimal one.
 */
export const SEEDED_ACCESS_POLICY_CODE = "e2e.responsive.360.seeded-row";

const DESCRIPTION =
  "Seeded by the responsive-360 sweep so the access policies table renders " +
  "on a fresh database. Stored and listed only: it is not DSL-managed, so the " +
  "evaluator never consults it.";

/**
 * Insert the row if it is not there already (idempotent on the unique
 * `(tenant_id, policy_code)` key, so a local re-run against the same database
 * is fine). Same transaction shape as `seedRestrictedUser`: the tenant is set
 * for RLS before the first statement.
 */
export async function seedInertAccessPolicy(
  databaseUrl: string,
  tenantId: string
): Promise<string> {
  const sql = new Bun.SQL(databaseUrl, { max: 1 });

  try {
    await sql.begin(async (tx: Bun.SQL) => {
      await tx.unsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);

      await tx`
        INSERT INTO awcms_abac_policies
          (tenant_id, policy_code, effect, description, is_active)
        VALUES
          (${tenantId}, ${SEEDED_ACCESS_POLICY_CODE}, 'allow', ${DESCRIPTION}, false)
        ON CONFLICT (tenant_id, policy_code) DO NOTHING
      `;
    });
  } finally {
    await sql.end();
  }

  return SEEDED_ACCESS_POLICY_CODE;
}
