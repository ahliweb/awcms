/**
 * database-pgbouncer-verify.ts — `bun run database:pgbouncer:verify`.
 *
 * Issue #1286. Proves, against a REAL PgBouncer in transaction mode, that the
 * application's tenant isolation survives pooling. It drives the production
 * `getDatabaseClient()` + `withTenantOrThrow` (so it exercises exactly what the
 * app does under `DATABASE_PGBOUNCER=true`) and checks that:
 *
 *   1. the pool opens at all (no startup parameter PgBouncer refuses),
 *   2. parameterized queries work with `prepare: false`,
 *   3. `SET LOCAL app.current_tenant_id` never leaks to another transaction
 *      that lands on the same backend connection (an RLS-protected scratch
 *      table, many interleaved transactions for two tenants),
 *   4. the tenant GUC is back to the role default outside a transaction,
 *   5. `statement_timeout` is applied per transaction.
 *
 * Environment (all required, nothing is printed back):
 *   DATABASE_PGBOUNCER=true            the mode under test
 *   DATABASE_URL                       the NON-superuser app role THROUGH PgBouncer
 *   DATABASE_PGBOUNCER_VERIFY_ADMIN_URL  a privileged URL straight to PostgreSQL,
 *                                      used only to create and drop one scratch
 *                                      table (`awcms_pgbouncer_verify`).
 *
 * Exit 0 only when every check passes. See
 * `docs/awcms/database-pooling.md` §7 and `deploy/pgbouncer/`.
 */
import {
  getDatabaseClient,
  readConfiguredUrl
} from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const TABLE = "awcms_pgbouncer_verify";
const ZERO_TENANT = "00000000-0000-0000-0000-000000000000";

const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  console.log(
    `${ok ? "[OK]  " : "[FAIL]"} ${name}${detail ? ` — ${detail}` : ""}`
  );

  if (!ok) failures.push(name);
}

async function main(): Promise<number> {
  const adminUrl = readConfiguredUrl("DATABASE_PGBOUNCER_VERIFY_ADMIN_URL");

  if (process.env.DATABASE_PGBOUNCER !== "true" || !adminUrl) {
    console.error(
      "database:pgbouncer:verify needs DATABASE_PGBOUNCER=true, DATABASE_URL (app role via PgBouncer) and DATABASE_PGBOUNCER_VERIFY_ADMIN_URL (direct, privileged)."
    );
    return 2;
  }

  const admin = new Bun.SQL(adminUrl, { max: 1 });
  const app = getDatabaseClient();

  try {
    const who = await app`SELECT current_user AS u`;
    const role = String(who[0]?.u);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(role)) {
      throw new Error("the app role name is not a plain identifier");
    }

    await admin.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await admin.unsafe(
      `CREATE TABLE ${TABLE} (id serial PRIMARY KEY, tenant_id uuid NOT NULL, v text NOT NULL)`
    );
    await admin.unsafe(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
    await admin.unsafe(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`);
    await admin.unsafe(
      `CREATE POLICY tenant_isolation ON ${TABLE} USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)`
    );
    await admin.unsafe(`GRANT SELECT, INSERT ON ${TABLE} TO ${role}`);
    await admin.unsafe(`GRANT USAGE ON SEQUENCE ${TABLE}_id_seq TO ${role}`);

    let leaks = 0;
    let errors = 0;
    let rowsSeen = 0;

    const work = async (tenant: string, i: number) => {
      try {
        await withTenantOrThrow(app, tenant, async (tx) => {
          await tx`INSERT INTO awcms_pgbouncer_verify (tenant_id, v) VALUES (${tenant}::uuid, ${`row-${i}`})`;
          const rows =
            await tx`SELECT tenant_id::text AS tenant_id FROM awcms_pgbouncer_verify`;
          const guc =
            await tx`SELECT current_setting('app.current_tenant_id', true) AS c`;

          rowsSeen += rows.length;
          for (const row of rows) if (row.tenant_id !== tenant) leaks++;
          if (guc[0]?.c !== tenant) leaks++;
        });
      } catch (error) {
        errors++;
        console.error(`transaction failed: ${safeErrorDetail(error)}`);
      }
    };

    // Waves of 8 stay under the "interactive" work-class ceiling, so every
    // transaction is admitted and the backend connection is reused heavily.
    for (let wave = 0; wave < 25; wave++) {
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          work((wave + i) % 2 === 0 ? TENANT_A : TENANT_B, wave * 8 + i)
        )
      );
    }

    check(
      "pool opens through PgBouncer and 200 transactions complete",
      errors === 0,
      `${errors} failed`
    );
    check(
      "no row or tenant GUC from another tenant seen inside any transaction",
      leaks === 0 && rowsSeen > 0,
      `${leaks} leak(s), ${rowsSeen} rows read`
    );

    const outside =
      await app`SELECT current_setting('app.current_tenant_id', true) AS c`;
    const visible =
      await app`SELECT count(*)::int AS n FROM awcms_pgbouncer_verify`;

    check(
      "tenant GUC is the fail-closed role default outside a transaction",
      outside[0]?.c === ZERO_TENANT ||
        outside[0]?.c === "" ||
        outside[0]?.c == null,
      ""
    );
    check(
      "no rows are visible outside a tenant transaction",
      visible[0]?.n === 0,
      `${visible[0]?.n} visible`
    );

    const timeout = await withTenantOrThrow(app, TENANT_A, async (tx) => {
      const r = await tx`SELECT current_setting('statement_timeout') AS s`;
      return String(r[0]?.s);
    });

    check(
      "statement_timeout is applied per transaction",
      timeout !== "0",
      timeout
    );
  } catch (error) {
    check("verification ran to completion", false, safeErrorDetail(error));
  } finally {
    try {
      await admin.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    } catch {
      // best effort; the table is a scratch object
    }
    await admin.close();
  }

  console.log(
    failures.length === 0
      ? "database:pgbouncer:verify OK — tenant isolation holds through PgBouncer transaction pooling."
      : `database:pgbouncer:verify FAIL — ${failures.length} check(s) failed.`
  );

  return failures.length === 0 ? 0 : 1;
}

process.exit(await main());
