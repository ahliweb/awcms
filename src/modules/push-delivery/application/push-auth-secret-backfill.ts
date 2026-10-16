/**
 * Runtime backfill for `awcms_push_subscriptions.auth_secret` (Issue #1089).
 *
 * `sql/314` added `auth_secret_ciphertext` but a migration cannot reach the key
 * ring, so rows registered before it still hold the secret in plaintext. This
 * encrypts them under the ring's active key and NULLs the plaintext in the SAME
 * statement (the CHECK demands exactly one of the two, so a half-converted row
 * cannot exist).
 *
 * - **Idempotent.** The work-finding predicate is `auth_secret IS NOT NULL`; a
 *   converted row no longer matches, so re-running does nothing.
 * - **Resumable.** Progress is the data itself. A run killed mid-way leaves
 *   every batch either fully converted (its transaction committed) or untouched;
 *   the next run picks up the rest. Within one run a keyset cursor (`id > last`)
 *   walks the table so a row that cannot be converted is skipped, not re-read.
 * - **Batched.** One transaction per batch of `limit` rows, so a long table never
 *   holds one long lock.
 * - **Race-safe with registration.** Rows are read `FOR UPDATE`, so a concurrent
 *   re-registration (which also clears the plaintext) either completes first (the
 *   row no longer matches) or waits.
 * - **Disabled and revoked rows are converted too:** at-rest plaintext is the
 *   finding, regardless of status.
 * - **No plaintext leaves this function:** not into a log, a result or an error.
 */
import type { KeyRing } from "../../../lib/security/field-encryption";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { encryptPushAuthSecret } from "../domain/push-auth-secret";

const MODULE_KEY = "push_delivery";

export const PUSH_AUTH_SECRET_BACKFILL_DEFAULT_LIMIT = 200;

export type BackfillPushAuthSecretsResult = {
  /** Rows encrypted and cleared by this call. */
  converted: number;
  /** True when the cursor reached the end of the tenant's matching rows. */
  complete: boolean;
  /** The last id examined, to pass back as `afterId` to continue. */
  lastId: string | null;
};

type PlaintextRow = {
  id: string;
  endpoint_hash: string;
  auth_secret: string;
};

/**
 * Converts one batch for a tenant. `afterId` is the keyset cursor (exclusive).
 * Throws on a database error; never on an individual row.
 */
export async function backfillPushAuthSecretsBatch(
  sql: Bun.SQL,
  tenantId: string,
  ring: KeyRing,
  options: { afterId?: string | null; limit?: number } = {}
): Promise<BackfillPushAuthSecretsResult> {
  const limit = options.limit ?? PUSH_AUTH_SECRET_BACKFILL_DEFAULT_LIMIT;
  const afterId = options.afterId ?? null;

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT id, endpoint_hash, auth_secret
        FROM awcms_push_subscriptions
        WHERE tenant_id = ${tenantId}
          AND auth_secret IS NOT NULL
          AND auth_secret_ciphertext IS NULL
          AND (${afterId}::uuid IS NULL OR id > ${afterId}::uuid)
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE
      `) as PlaintextRow[];

      let converted = 0;

      for (const row of rows) {
        const ciphertext = encryptPushAuthSecret(
          row.auth_secret,
          tenantId,
          row.endpoint_hash,
          ring
        );
        const updated = (await tx`
          UPDATE awcms_push_subscriptions
          SET auth_secret_ciphertext = ${ciphertext}, auth_secret = NULL,
              updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
            AND auth_secret IS NOT NULL AND auth_secret_ciphertext IS NULL
          RETURNING id
        `) as { id: string }[];

        converted += updated.length;
      }

      return {
        converted,
        complete: rows.length < limit,
        lastId: rows.length > 0 ? rows[rows.length - 1]!.id : afterId
      };
    },
    { workClass: "maintenance" }
  );
}

/** Drains one tenant (batch after batch) until nothing remains or `maxBatches` is hit. */
export async function backfillPushAuthSecretsForTenant(
  sql: Bun.SQL,
  tenantId: string,
  ring: KeyRing,
  options: { limit?: number; maxBatches?: number; correlationId?: string } = {}
): Promise<{ converted: number; complete: boolean }> {
  const maxBatches = options.maxBatches ?? 1000;
  let converted = 0;
  let afterId: string | null = null;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result: BackfillPushAuthSecretsResult =
      await backfillPushAuthSecretsBatch(sql, tenantId, ring, {
        afterId,
        ...(options.limit === undefined ? {} : { limit: options.limit })
      });

    converted += result.converted;
    afterId = result.lastId;

    if (result.complete) {
      if (converted > 0) {
        log("info", "push.auth_secret.backfilled", {
          tenantId,
          moduleKey: MODULE_KEY,
          converted,
          ...(options.correlationId
            ? { correlationId: options.correlationId }
            : {})
        });
      }

      return { converted, complete: true };
    }
  }

  return { converted, complete: false };
}

/** Plaintext rows still at rest for one tenant (a count only; never a value). */
export async function countPlaintextPushAuthSecrets(
  sql: Bun.SQL,
  tenantId: string
): Promise<number> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS remaining
        FROM awcms_push_subscriptions
        WHERE tenant_id = ${tenantId} AND auth_secret IS NOT NULL
      `) as { remaining: number }[];

      return rows[0]?.remaining ?? 0;
    },
    { workClass: "maintenance" }
  );
}
