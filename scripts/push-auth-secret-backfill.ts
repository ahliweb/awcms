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
 * `--rekey` (Issue #1098) is the key-rotation mode: instead of encrypting
 * plaintext it re-encrypts every ciphertext row whose key id is not the ACTIVE
 * (first) key of the ring, so an old key can be retired. The ring must still
 * contain the old key (all keys read, the first writes). Same guarantees:
 * idempotent, resumable, batched, worker role, no key material or ciphertext in
 * any output. Exits 2 when a tenant did not finish, 3 when rows could not be
 * decrypted under the ring (reported as a count, left untouched).
 *
 * Like `push:queue:purge` this does not go through `runJob`: no advisory lock.
 * Concurrent runs are still safe (rows are locked `FOR UPDATE` and the
 * predicate is re-checked in the UPDATE), but run it from one place.
 */
import { getWorkerDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  backfillPushAuthSecretsForTenant,
  rekeyPushAuthSecretsForTenant
} from "../src/modules/push-delivery/application/push-auth-secret-backfill";
import { resolvePushAuthSecretRing } from "../src/modules/push-delivery/domain/push-auth-secret";

type TenantRow = { id: string };

async function main() {
  const rekey = process.argv.slice(2).includes("--rekey");
  const label = rekey
    ? "push:auth-secret:backfill --rekey"
    : "push:auth-secret:backfill";
  const ring = resolvePushAuthSecretRing(process.env);

  if (!ring.ok) {
    console.error(
      `${label} REFUSED — ${ring.reason} Set PUSH_AUTH_SECRET_ENCRYPTION_KEYS first.`
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
    let failed = 0;
    let incomplete = 0;

    for (const tenant of tenants) {
      const result = rekey
        ? await rekeyPushAuthSecretsForTenant(sql, tenant.id, ring, {
            correlationId
          })
        : {
            ...(await backfillPushAuthSecretsForTenant(sql, tenant.id, ring, {
              correlationId
            })),
            failed: 0
          };

      converted += result.converted;
      failed += result.failed;

      if (!result.complete) {
        incomplete += 1;
      }
    }

    console.log(
      `${label} complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} converted=${converted}` +
        (rekey ? ` undecryptable=${failed}` : "") +
        ` incompleteTenants=${incomplete}`
    );

    if (incomplete > 0) {
      process.exitCode = 2;
    } else if (failed > 0) {
      process.exitCode = 3;
    }
  } catch (error) {
    logScriptFailure(`${label} FAILED`, error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
