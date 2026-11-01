/**
 * Key rotation for `awcms_channel_secrets` (Issue #1140, ADR-0148 section 5,
 * pack section 6): "prepend a new key, run the re-encrypt job, retire the old
 * key when no row and no restorable backup needs it". Unlike a keyed hash,
 * ciphertext CAN be re-encrypted.
 *
 * Re-encrypts every secret whose envelope key id is not the ring's ACTIVE
 * (first) key. Idempotent (a converted row no longer matches), resumable
 * (progress is the data plus a keyset cursor), batched (one transaction per
 * batch), race-safe (`FOR UPDATE` plus a compare-and-swap on the exact old
 * ciphertext, so a concurrent revoke that deleted the row is never resurrected).
 * A row that cannot be decrypted under the ring is counted in `failed` and left
 * untouched. The associated data (purpose, tenant, secret id) is unchanged, so
 * only the key id, IV and tag differ. Never logs or returns a value.
 *
 * Runs as `awcms_app` (DATABASE_URL), like `telegram:chat:rekey`: no worker
 * role holds any privilege on these tables.
 */
import type { KeyRing } from "../../../lib/security/field-encryption";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import type { ChannelSecretPurpose } from "../domain/channel-accounts-constants";
import {
  decryptChannelSecret,
  encryptChannelSecret
} from "../domain/channel-secret-crypto";

export const CHANNEL_SECRET_REKEY_DEFAULT_LIMIT = 200;

export type RekeyChannelSecretsResult = {
  converted: number;
  failed: number;
  complete: boolean;
  lastId: string | null;
};

type SecretRow = {
  id: string;
  purpose: ChannelSecretPurpose;
  ciphertext: string;
};

export async function rekeyChannelSecretsBatch(
  sql: Bun.SQL,
  tenantId: string,
  ring: KeyRing,
  options: { afterId?: string | null; limit?: number } = {}
): Promise<RekeyChannelSecretsResult> {
  const limit = options.limit ?? CHANNEL_SECRET_REKEY_DEFAULT_LIMIT;
  const afterId = options.afterId ?? null;
  const activeKeyId = ring.keys[0]!.id;

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT id, purpose, ciphertext
        FROM awcms_channel_secrets
        WHERE tenant_id = ${tenantId}
          AND key_id <> ${activeKeyId}
          AND (${afterId}::uuid IS NULL OR id > ${afterId}::uuid)
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE
      `) as SecretRow[];

      let converted = 0;
      let failed = 0;

      for (const row of rows) {
        const context = {
          tenantId,
          secretId: row.id,
          purpose: row.purpose
        };
        let fresh: { ciphertext: string; keyId: string };

        try {
          fresh = encryptChannelSecret(
            decryptChannelSecret(row.ciphertext, context, ring),
            context,
            ring
          );
        } catch {
          failed += 1;
          continue;
        }

        const updated = (await tx`
          UPDATE awcms_channel_secrets
          SET ciphertext = ${fresh.ciphertext}, key_id = ${fresh.keyId},
              version = version + 1, rotated_at = now(), updated_at = now()
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
            AND ciphertext = ${row.ciphertext}
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

export async function rekeyChannelSecretsForTenant(
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
    const result: RekeyChannelSecretsResult = await rekeyChannelSecretsBatch(
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
        log("info", "channel_accounts.secrets.rekeyed", {
          tenantId,
          moduleKey: "channel_accounts",
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

/** Secrets per key id for one tenant (counts only), for `security:readiness` and the rotation runbook. */
export async function countChannelSecretsByKeyId(
  sql: Bun.SQL,
  tenantId: string
): Promise<Record<string, number>> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT key_id, count(*)::int AS rows
        FROM awcms_channel_secrets
        WHERE tenant_id = ${tenantId}
        GROUP BY key_id
      `) as { key_id: string; rows: number }[];

      return Object.fromEntries(rows.map((row) => [row.key_id, row.rows]));
    },
    { workClass: "maintenance" }
  );
}
