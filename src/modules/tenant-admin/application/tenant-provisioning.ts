/**
 * Provisioning tenant number two and beyond (ADR-0054).
 *
 * ## Why this did not exist until now
 *
 * `bootstrapPlatformTenant` is gated by the `awcms_setup_state` singleton, so
 * it can succeed exactly once. Until this file, that made a second tenant
 * literally impossible: the deployment was permanently single-tenant, and the
 * `multi` half of `resolveTenancyMode` was unreachable.
 *
 * That is also why ADR-0053's platform gate had never been exercised against a
 * real second tenant — there was none to exercise it with.
 *
 * ## What it deliberately does NOT do
 *
 * It does not re-implement tenant creation. `createTenantWithOwner` is shared
 * with the setup wizard, because the one thing that must never differ between
 * the two is `WHERE scope = 'tenant'` on the owner grant. A copy of that INSERT
 * written from memory is precisely how the cross-tenant defect ADR-0052 removed
 * would return — and it would look correct.
 *
 * It also does not decide who may call it. That is the chokepoint's job:
 * `tenant_admin.tenant_provisioning.create` is `scope: "platform"`, so only the
 * platform tenant reaches this code at all.
 */
import { assertUuid } from "../../../lib/database/tenant-context";
import { createTenantWithOwner } from "./platform-bootstrap";
import type { CreatedTenant } from "./platform-bootstrap";
import type { SetupInitializeInput } from "../domain/setup-validation";

export type ProvisionTenantResult =
  | { ok: true; tenant: CreatedTenant }
  | { ok: false; reason: "duplicate_tenant_code" };

/** Postgres unique-violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * The SQLSTATE is on `errno`, NOT on `code`. This read `code` until ADR-0056
 * §B's work turned up the same mistake in new code and probed the real error
 * shape: Bun sets `code` to its own `"ERR_POSTGRES_SERVER_ERROR"` for every
 * server error alike, so the comparison was always false. The pre-check SELECT
 * above hid it for the ordinary case; the RACE this savepoint exists for — two
 * callers submitting the same `tenant_code` concurrently — rethrew instead of
 * answering `duplicate_tenant_code`, and `POST /api/v1/tenants` served a 500
 * where it had promised a 409.
 *
 * `String()` because `errno` is typed loosely enough to be a number in other
 * Bun error shapes. This is now the same idiom as the ten other violation
 * checks in this repo (`role-admin.ts`, `office-directory.ts`, ...), which had
 * it right all along.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errno" in error &&
    String((error as { errno?: unknown }).errno) === UNIQUE_VIOLATION
  );
}

/** Savepoint name is a fixed identifier — never built from input. */
const PROVISION_SAVEPOINT = "awcms_provision_tenant";

/**
 * Creates a tenant on behalf of the platform tenant, restoring the caller's
 * tenant context before returning.
 *
 * `restoreTenantId` is not optional in practice here: this runs inside the
 * PLATFORM tenant's transaction, and everything the route does afterwards (the
 * audit row, the idempotency record) must be written in that context. Without
 * the restore they would land in the brand-new tenant's partition — visible to
 * the wrong party, invisible to the operator who acted.
 *
 * ## Why a duplicate needs BOTH a pre-check and a savepoint
 *
 * A duplicate `tenant_code` must answer `409`, and the route returns that from
 * inside the transaction. But in PostgreSQL a `23505` **aborts the
 * transaction** — every statement after it fails with "current transaction is
 * aborted", so simply catching the error and carrying on does not work, and the
 * commit that `withTenant` performs on a returned 4xx would fail too.
 *
 * So: a SELECT answers the ordinary case without ever provoking the error, and
 * a SAVEPOINT makes the racing case recoverable — two callers submitting the
 * same code concurrently both pass the SELECT, one hits the unique index, and
 * `ROLLBACK TO SAVEPOINT` returns the transaction to a usable state instead of
 * turning a user error into a 500.
 */
export async function provisionTenant(
  tx: Bun.SQL,
  input: SetupInitializeInput,
  platformTenantId: string
): Promise<ProvisionTenantResult> {
  // `awcms_tenants` is the RLS-free root table, so this sees every tenant —
  // which is the point: uniqueness of `tenant_code` is platform-wide, not
  // per-tenant.
  const existing = await tx`
    SELECT 1 FROM awcms_tenants WHERE tenant_code = ${input.tenantCode} LIMIT 1
  `;

  if (existing[0]) {
    return { ok: false, reason: "duplicate_tenant_code" };
  }

  await tx.unsafe(`SAVEPOINT ${PROVISION_SAVEPOINT}`);

  try {
    const tenant = await createTenantWithOwner(tx, input, {
      // NEVER true here. A provisioned tenant is an ordinary tenant; granting it
      // the platform catalogue would hand every customer authority over data
      // served to every other customer — the exact defect this scope exists for.
      grantPlatformScope: false,
      restoreTenantId: platformTenantId
    });

    await tx.unsafe(`RELEASE SAVEPOINT ${PROVISION_SAVEPOINT}`);

    return { ok: true, tenant };
  } catch (error) {
    await tx.unsafe(`ROLLBACK TO SAVEPOINT ${PROVISION_SAVEPOINT}`);

    // The rollback also reverted the `SET LOCAL app.current_tenant_id` that
    // `createTenantWithOwner` issued, so the caller's context is already back —
    // but restoring it explicitly costs nothing and does not depend on that
    // being true of every future PostgreSQL version.
    await tx.unsafe(
      `SET LOCAL app.current_tenant_id = '${assertUuid(platformTenantId)}'`
    );

    if (isUniqueViolation(error)) {
      return { ok: false, reason: "duplicate_tenant_code" };
    }
    throw error;
  }
}
