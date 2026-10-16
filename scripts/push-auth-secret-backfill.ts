/**
 * push-auth-secret-backfill.ts — `bun run push:auth-secret:backfill`.
 *
 * Issue #1089. One-time (re-runnable) worker entrypoint: encrypts every
 * `awcms_push_subscriptions.auth_secret` still held in plaintext under the
 * `PUSH_AUTH_SECRET_ENCRYPTION_KEYS` ring and NULLs the plaintext. See
 * `src/modules/push-delivery/application/push-auth-secret-backfill.ts` for the
 * idempotency / resumability / batching contract, and
 * `docs/awcms/push-notifications.md` for the rollout order (set the key, deploy,
 * run this, check `security:readiness`, only then drop the column).
 *
 * Runs as `awcms_worker` (it holds UPDATE on exactly the two columns, sql/314).
 * Exits non-zero when the key ring is missing: converting nothing and reporting
 * success would let an operator believe the rollout finished.
 *
 * Like `push:queue:purge` this does not go through `runJob`: no advisory lock.
 * Concurrent runs are still safe (rows are locked `FOR UPDATE` and the
 * predicate is re-checked in the UPDATE), but run it from one place.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { backfillPushAuthSecretsForTenant } from "../src/modules/push-delivery/application/push-auth-secret-backfill";
import { resolvePushAuthSecretRing } from "../src/modules/push-delivery/domain/push-auth-secret";

type TenantRow = { id: string };

async function main() {
  const ring = resolvePushAuthSecretRing(process.env);

  if (!ring.ok) {
    console.error(
      `push:auth-secret:backfill REFUSED — ${ring.reason} Set PUSH_AUTH_SECRET_ENCRYPTION_KEYS first.`
    );
    process.exitCode = 1;

    return;
  }

  const sql = getWorkerDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants ORDER BY id
    `) as TenantRow[];

    let converted = 0;
    let incomplete = 0;

    for (const tenant of tenants) {
      const result = await backfillPushAuthSecretsForTenant(
        sql,
        tenant.id,
        ring,
        { correlationId }
      );

      converted += result.converted;

      if (!result.complete) {
        incomplete += 1;
      }
    }

    console.log(
      `push:auth-secret:backfill complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} converted=${converted} incompleteTenants=${incomplete}`
    );

    if (incomplete > 0) {
      process.exitCode = 2;
    }
  } catch (error) {
    logScriptFailure("push:auth-secret:backfill FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
