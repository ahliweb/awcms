/**
 * Issue #1078 — `awcms_worker` cannot read a credential column.
 *
 * `sql/022` gave the worker a TABLE-level `SELECT` on `awcms_identities`, which
 * silently included `password_hash` (and every column added since). RLS trusts
 * `app.current_tenant_id`, so anyone able to run SQL as the worker could read any
 * tenant's password hashes. `sql/304` revokes it and re-grants only the columns a
 * named job reads.
 *
 * This proves it against a real PostgreSQL, as the role itself, in both
 * directions: the credential columns are refused with SQLSTATE 42501, and the
 * statements the worker jobs actually issue still run.
 *
 * Failures are asserted with `assertRejected` (try/catch). Never rewrite them as
 * `expect(sqlQuery).rejects`: against a `Bun.SQL` promise that HANGS the process.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  assertRejected,
  getAdminSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  CREDENTIAL_COLUMNS,
  WORKER_CREDENTIAL_COLUMN_EXCEPTIONS
} from "../../scripts/security-readiness";

const TENANT = "a1078000-0000-4000-8000-00000000000a";

/**
 * A plain transaction with the tenant GUC set, NOT `withTenantOrThrow`: that
 * helper trips the process-wide database circuit breaker after a few errors, and
 * a test whose whole point is to provoke `permission denied` repeatedly would be
 * refused by the breaker ("Database circuit breaker is open") instead of by
 * PostgreSQL.
 */
function probeAsWorker<T>(
  worker: Bun.SQL,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return worker.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;

    return fn(tx);
  }) as Promise<T>;
}

const suite = integrationEnabled ? describe : describe.skip;

async function expectDenied(
  promise: Promise<unknown>,
  what: string
): Promise<void> {
  const error = await assertRejected(promise, what);

  expect(
    `${(error as { errno?: string }).errno} ${error.message} [${what}]`
  ).toStartWith("42501");
}

suite("awcms_worker credential column access (#1078)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${TENANT}, 't-1078', 'Credential columns')
    `;
    const profile = (await getAdminSql()`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', 'Credential Person')
      RETURNING id
    `) as { id: string }[];
    await getAdminSql()`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, 'cred@example.com', 'SENTINEL-HASH-1078')
    `;
  });

  test("SET ROLE awcms_worker; SELECT password_hash is refused with 42501", async () => {
    if (!workerRoleActivated) return;

    // The literal statement from the issue, on a superuser connection that
    // steps down to the role inside one transaction.
    await expectDenied(
      (async () =>
        getAdminSql().begin(async (tx) => {
          await tx.unsafe("SET LOCAL ROLE awcms_worker");
          await tx.unsafe(
            `SELECT set_config('app.current_tenant_id', '${TENANT}', true)`
          );
          return tx.unsafe("SELECT password_hash FROM awcms_identities");
        }))(),
      "SELECT password_hash as awcms_worker"
    );
  });

  test("as a real worker login: password_hash, SELECT * and the other unneeded identity columns are refused", async () => {
    if (!workerRoleActivated) return;
    const worker = getWorkerRoleSql();
    const attempt = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
      probeAsWorker(worker, fn);

    for (const probe of [
      (tx: Bun.TransactionSQL) =>
        tx`SELECT password_hash FROM awcms_identities`,
      (tx: Bun.TransactionSQL) => tx`SELECT * FROM awcms_identities`,
      (tx: Bun.TransactionSQL) =>
        tx`SELECT count(*) FROM awcms_identities WHERE password_hash = 'x'`,
      (tx: Bun.TransactionSQL) =>
        tx`SELECT last_login_at FROM awcms_identities`,
      (tx: Bun.TransactionSQL) =>
        tx`SELECT failed_login_count, locked_until FROM awcms_identities`
    ]) {
      await expectDenied(attempt(probe), "an unneeded identity column");
    }
  });

  test("the identity columns the jobs read still work (recipient resolution, projection cursor)", async () => {
    if (!workerRoleActivated) return;
    const worker = getWorkerRoleSql();

    const rows = await withTenantOrThrow(
      worker,
      TENANT,
      (tx) => tx`
        SELECT i.id, i.login_identifier, p.display_name
        FROM awcms_identities i
        JOIN awcms_profiles p ON p.id = i.profile_id AND p.tenant_id = i.tenant_id
        WHERE i.tenant_id = ${TENANT} AND i.status = 'active'
      `
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.login_identifier).toBe("cred@example.com");

    const projection = await withTenantOrThrow(
      worker,
      TENANT,
      (tx) => tx`
        SELECT created_at FROM awcms_identities
        WHERE tenant_id = ${TENANT} ORDER BY created_at ASC LIMIT 10
      `
    );
    expect(projection.length).toBe(1);

    // Module-usage style count: no column is read at all.
    const counted = await withTenantOrThrow(
      worker,
      TENANT,
      (tx) => tx`SELECT count(*)::int AS n FROM awcms_identities`
    );
    expect(counted[0]!.n).toBe(1);
  });

  test("no declared credential column is readable by the worker (has_column_privilege, every table)", async () => {
    if (!workerRoleActivated) return;

    for (const qualified of CREDENTIAL_COLUMNS) {
      if (WORKER_CREDENTIAL_COLUMN_EXCEPTIONS[qualified] !== undefined)
        continue;
      const [table, column] = qualified.split(".") as [string, string];
      const rows = (await getAdminSql()`
        SELECT has_column_privilege('awcms_worker', ${table}, ${column}, 'SELECT') AS readable
      `) as { readable: boolean }[];

      expect(rows[0]!.readable, `${qualified} readable by awcms_worker`).toBe(
        false
      );
    }
  });

  test("the generic hard_delete purge statements still run on every narrowed table", async () => {
    if (!workerRoleActivated) return;
    const worker = getWorkerRoleSql();
    const cutoff = new Date("2000-01-01T00:00:00Z");

    // `archive-purge-job.ts` runGenericPurgePass + `dry-run-planner.ts`, verbatim
    // shape, per table.
    for (const table of [
      "awcms_password_reset_tokens",
      "awcms_invitations",
      "awcms_delegated_access_grants",
      "awcms_omes_enrollments",
      "awcms_newsletter_subscribers",
      "awcms_comments_reply_subscriptions"
    ]) {
      await withTenantOrThrow(worker, TENANT, async (tx) => {
        await tx.unsafe(
          `DELETE FROM ${table}
           WHERE id IN (
             SELECT id FROM ${table}
             WHERE tenant_id = $1 AND created_at < $2
               AND ($3::timestamptz IS NULL OR created_at <= $3)
             ORDER BY created_at ASC LIMIT $4
           )
           RETURNING created_at AS cursor_value`,
          [TENANT, cutoff, null, 100]
        );
        await tx.unsafe(
          `SELECT count(*)::int AS count FROM ${table} WHERE tenant_id = $1 AND created_at < $2`,
          [TENANT, cutoff]
        );
      });
    }

    // comments:retention filters on `confirmed`.
    await withTenantOrThrow(
      worker,
      TENANT,
      (tx) => tx`
        SELECT count(*)::int AS count FROM awcms_comments_reply_subscriptions
        WHERE tenant_id = ${TENANT} AND confirmed = false AND created_at < ${cutoff}
      `
    );
  });

  test("the credential column of each narrowed table is refused, the rest of the row is not", async () => {
    if (!workerRoleActivated) return;
    const worker = getWorkerRoleSql();
    const attempt = <T>(fn: (tx: Bun.TransactionSQL) => Promise<T>) =>
      probeAsWorker(worker, fn);

    for (const qualified of [
      "awcms_password_reset_tokens.token_hash",
      "awcms_invitations.token_hash",
      "awcms_delegated_access_grants.access_code_hash",
      "awcms_omes_enrollments.enrollment_challenge_hash",
      "awcms_newsletter_subscribers.confirmation_token_hash",
      "awcms_newsletter_subscribers.unsubscribe_token_hash",
      "awcms_comments_reply_subscriptions.unsubscribe_token_hash",
      "awcms_telegram_link_codes.code_hash",
      "awcms_telegram_bindings.pin_hash",
      "awcms_tenant_domains.verification_token_hash"
    ]) {
      const [table, column] = qualified.split(".") as [string, string];

      await expectDenied(
        attempt((tx) => tx.unsafe(`SELECT ${column} FROM ${table}`)),
        `SELECT ${qualified}`
      );
      await expectDenied(
        attempt((tx) => tx.unsafe(`SELECT * FROM ${table}`)),
        `SELECT * FROM ${table}`
      );
    }

    // Tables whose job reads the row but not the credential still serve it.
    await attempt(
      (tx) =>
        tx`SELECT id, tenant_id, normalized_hostname, domain_type, status, deleted_at
           FROM awcms_tenant_domains WHERE tenant_id = ${TENANT}`
    );
    await attempt(
      (tx) =>
        tx`SELECT id, status, chat_ciphertext, pending_expires_at, pin_attempts
           FROM awcms_telegram_bindings WHERE tenant_id = ${TENANT}`
    );
    await attempt(
      (tx) =>
        tx`SELECT id, expires_at, consumed_at FROM awcms_telegram_link_codes
           WHERE tenant_id = ${TENANT}`
    );
  });
});
