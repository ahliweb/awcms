/**
 * email-senders-verify.ts — `bun run email:senders:verify`.
 *
 * Issue #1160 (ADR-0151 sections 2 and 6). For every active tenant, reads each
 * Mailketing account's credit balance (`GET /api/v2/credits`) and verified
 * senders (`GET /api/v2/senders`), read-only, and records them as the
 * accounts' health. That record is what makes a sender identity `connected`
 * (verified) and what `email:dispatch` reads before it sends as a tenant
 * sender: a sender nobody verified, or whose verification or account credit is
 * stale or unknown, is held, never assumed fine.
 *
 * Runs as `awcms_app` (like `channel-accounts:secrets:rekey`): it WRITES
 * `channel_accounts` health and status through `channel_accounts`' own
 * `recordAccountHealth`, and the worker role is deliberately unable to (a
 * worker that could write health could mark an unverified sender verified).
 * It is granted the key ring `CHANNEL_SECRETS_ENCRYPTION_KEYS` for the one
 * decrypt per account the probes need; the token is never printed.
 *
 * No-op (exits 0) when `EMAIL_SENDER_ROUTING_ENABLED` is not `"true"`.
 * Requires real network egress to the provider; not run in CI.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { recordAccountHealth } from "../src/modules/channel-accounts/application/account-directory";
import { emailAccountDirectoryAdapter } from "../src/modules/channel-accounts/application/channel-account-port-adapter";
import { channelSenderCredentialAdapter } from "../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { isEmailSenderRoutingEnabled } from "../src/modules/email/domain/email-sender-config";
import {
  MAILKETING_V2_UNVERIFIED_WARNING,
  isMailketingV2Verified
} from "../src/modules/email/domain/mailketing-v2-contract";
import {
  emailSendersVerifyRunFailed,
  verifyEmailSendersForTenant
} from "../src/modules/email/application/email-sender-verify";

type TenantRow = { id: string };

async function main() {
  if (!isEmailSenderRoutingEnabled(process.env)) {
    console.log(
      'email:senders:verify SKIPPED — EMAIL_SENDER_ROUTING_ENABLED is not "true".'
    );
    return;
  }

  if (!isMailketingV2Verified(process.env)) {
    console.warn(`email:senders:verify — ${MAILKETING_V2_UNVERIFIED_WARNING}`);
  }

  const sql = getDatabaseClient();
  let failedTenants = 0;

  try {
    const tenants = (await sql`
      SELECT id FROM awcms_tenants WHERE status = 'active'
    `) as TenantRow[];
    const totals = {
      accounts: 0,
      accountsProbed: 0,
      accountsSkipped: 0,
      secretStoreFailures: 0,
      sendersVerified: 0,
      sendersUnverified: 0,
      sendersUnknown: 0
    };

    for (const tenant of tenants) {
      try {
        const summary = await verifyEmailSendersForTenant(sql, tenant.id, {
          directory: emailAccountDirectoryAdapter,
          credentials: channelSenderCredentialAdapter,
          recordHealth: (tx, tenantId, accountId, input) =>
            recordAccountHealth(tx, tenantId, accountId, input)
        });

        for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
          totals[key] += summary[key];
        }
      } catch (error) {
        failedTenants += 1;
        logScriptFailure("email:senders:verify tenant pass FAILED", error);
      }
    }

    console.log(
      `email:senders:verify complete — tenants=${tenants.length} ` +
        `accounts=${totals.accounts} probed=${totals.accountsProbed} ` +
        `skipped=${totals.accountsSkipped} secretStoreFailures=${totals.secretStoreFailures} verified=${totals.sendersVerified} ` +
        `unverified=${totals.sendersUnverified} unknown=${totals.sendersUnknown} ` +
        `failedTenants=${failedTenants}`
    );

    if (emailSendersVerifyRunFailed(totals, failedTenants)) {
      process.exitCode = 1;
    }
  } catch (error) {
    logScriptFailure("email:senders:verify FAILED", error);
    // Audit L-2/L-1 of PR #1301: a failure here (the tenant list could not be
    // read) used to leave the exit code 0, which cron monitoring reads as success.
    process.exitCode = 1;
  } finally {
    await sql.close({ timeout: 1 });
  }
}

if (import.meta.main) {
  await main();
}
