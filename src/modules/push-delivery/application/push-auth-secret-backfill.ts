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
import {
  decryptPushAuthSecret,
  encryptPushAuthSecret
} from "../domain/push-auth-secret";

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

// ---------------------------------------------------------------------------
// Re-key (Issue #1098)
// ---------------------------------------------------------------------------

/**
 * Re-encrypts rows whose ciphertext is NOT under the ring's active key (the
 * first key) so an old key can be retired. The runbook's rule is "keep an old
 * key until no row carries it"; without this only a device re-registering ever
 * moved a row, so the rule could not be satisfied after a key compromise.
 *
 * Same contract as the backfill: idempotent (a re-keyed row no longer matches),
 * resumable (progress is the data; a keyset cursor skips rows that cannot be
 * converted within one run), batched (one transaction per batch) and race-safe
 * (rows are read `FOR UPDATE` and the UPDATE is a compare-and-swap on the exact
 * old ciphertext, so a concurrent re-registration wins and is never overwritten
 * with a stale secret).
 *
 * A row that cannot be decrypted under the ring (its key was already dropped, or
 * the envelope fails authentication) is counted in `failed` and left untouched:
 * it is not silently "fixed". Nothing secret reaches a log, result or error.
 */
export type RekeyPushAuthSecretsResult = BackfillPushAuthSecretsResult & {
  /** Rows that could not be decrypted under the ring and were left as they were. */
  failed: number;
};

type CiphertextRow = {
  id: string;
  endpoint_hash: string;
  auth_secret_ciphertext: string;
};

export async function rekeyPushAuthSecretsBatch(
  sql: Bun.SQL,
  tenantId: string,
  ring: KeyRing,
  options: { afterId?: string | null; limit?: number } = {}
): Promise<RekeyPushAuthSecretsResult> {
  const limit = options.limit ?? PUSH_AUTH_SECRET_BACKFILL_DEFAULT_LIMIT;
  const afterId = options.afterId ?? null;
  const activeKeyId = ring.keys[0]!.id;

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT id, endpoint_hash, auth_secret_ciphertext
        FROM awcms_push_subscriptions
        WHERE tenant_id = ${tenantId}
          AND auth_secret_ciphertext IS NOT NULL
          AND split_part(auth_secret_ciphertext, ':', 2) <> ${activeKeyId}
          AND (${afterId}::uuid IS NULL OR id > ${afterId}::uuid)
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE
      `) as CiphertextRow[];

      let converted = 0;
      let failed = 0;

      for (const row of rows) {
        let fresh: string;

        try {
          fresh = encryptPushAuthSecret(
            decryptPushAuthSecret(
              row.auth_secret_ciphertext,
              tenantId,
              row.endpoint_hash,
              ring
            ),
            tenantId,
            row.endpoint_hash,
            ring
          );
        } catch {
          // The row stays untouched and only the COUNT is reported.
          failed += 1;
          continue;
        }

        const updated = (await tx`
          UPDATE awcms_push_subscriptions
          SET auth_secret_ciphertext = ${fresh}, updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
            AND auth_secret_ciphertext = ${row.auth_secret_ciphertext}
          RETURNING id
        `) as { id: string }[];

        converted += updated.length;
      }

      return {
        converted,
        failed,
        complete: rows.length < limit,
        lastId: rows.length > 0 ? rows[rows.length - 1]!.id : afterId
      };
    },
    { workClass: "maintenance" }
  );
}

/** Drains one tenant's re-key (batch after batch) until nothing remains or `maxBatches` is hit. */
export async function rekeyPushAuthSecretsForTenant(
  sql: Bun.SQL,
  tenantId: string,
  ring: KeyRing,
  options: { limit?: number; maxBatches?: number; correlationId?: string } = {}
): Promise<{ converted: number; failed: number; complete: boolean }> {
  const maxBatches = options.maxBatches ?? 1000;
  let converted = 0;
  let failed = 0;
  let afterId: string | null = null;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result: RekeyPushAuthSecretsResult = await rekeyPushAuthSecretsBatch(
      sql,
      tenantId,
      ring,
      {
        afterId,
        ...(options.limit === undefined ? {} : { limit: options.limit })
      }
    );

    converted += result.converted;
    failed += result.failed;
    afterId = result.lastId;

    if (result.complete) {
      if (converted > 0 || failed > 0) {
        log("info", "push.auth_secret.rekeyed", {
          tenantId,
          moduleKey: MODULE_KEY,
          converted,
          failed,
          ...(options.correlationId
            ? { correlationId: options.correlationId }
            : {})
        });
      }

      return { converted, failed, complete: true };
    }
  }

  return { converted, failed, complete: false };
}

/**
 * Rows per ciphertext key id for one tenant (counts only; never a value).
 * Plaintext legacy rows are reported separately by
 * {@link countPlaintextPushAuthSecrets}. A ciphertext that is not a `v2`
 * envelope is bucketed under `"?"`.
 */
export async function countPushAuthSecretsByKeyId(
  sql: Bun.SQL,
  tenantId: string
): Promise<Record<string, number>> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT CASE WHEN auth_secret_ciphertext ~ '^v2:[a-z0-9]{1,8}:' THEN split_part(auth_secret_ciphertext, ':', 2) ELSE '?' END AS key_id,
               count(*)::int AS rows
        FROM awcms_push_subscriptions
        WHERE tenant_id = ${tenantId} AND auth_secret_ciphertext IS NOT NULL
        GROUP BY 1
      `) as { key_id: string; rows: number }[];

      return Object.fromEntries(rows.map((row) => [row.key_id, row.rows]));
    },
    { workClass: "maintenance" }
  );
}
