/**
 * channel-accounts-secrets-rekey.ts — `bun run channel-accounts:secrets:rekey`.
 *
 * Issue #1140 / ADR-0148 section 5. Manual key-rotation job: re-encrypts every
 * `awcms_channel_secrets` row whose envelope key id is not the ACTIVE (first)
 * key of `CHANNEL_SECRETS_ENCRYPTION_KEYS`, so an old key can be retired. The
 * ring must still contain the old key. See
 * `src/modules/channel-accounts/application/secret-rekey.ts` for the contract.
 *
 * Exits 1 without a valid ring (nothing converted must never read as success),
 * 2 when a tenant did not finish, 3 when rows could not be decrypted under the
 * ring. Never prints key material, ciphertext or a credential.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { rekeyChannelSecretsForTenant } from "../src/modules/channel-accounts/application/secret-rekey";
import { resolveChannelSecretsRing } from "../src/modules/channel-accounts/domain/channel-accounts-config";

async function main() {
  const ring = resolveChannelSecretsRing(process.env);

  if (!ring.ok) {
    console.error(
      `channel-accounts:secrets:rekey REFUSED — ${ring.reason} Set CHANNEL_SECRETS_ENCRYPTION_KEYS first.`
    );
    process.exitCode = 1;

    return;
  }

  const sql = getDatabaseClient();
  const correlationId = crypto.randomUUID();

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants ORDER BY id
    `) as { id: string }[];

    let converted = 0;
    let failed = 0;
    let incomplete = 0;

    for (const tenant of tenants) {
      const result = await rekeyChannelSecretsForTenant(sql, tenant.id, ring, {
        correlationId
      });

      converted += result.converted;
      failed += result.failed;

      if (!result.complete) {
        incomplete += 1;
      }
    }

    console.log(
      `channel-accounts:secrets:rekey complete — correlationId=${correlationId} ` +
        `tenants=${tenants.length} converted=${converted} undecryptable=${failed} incompleteTenants=${incomplete}`
    );

    if (incomplete > 0) {
      process.exitCode = 2;
    } else if (failed > 0) {
      process.exitCode = 3;
    }
  } catch (error) {
    logScriptFailure("channel-accounts:secrets:rekey FAILED", error);
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
