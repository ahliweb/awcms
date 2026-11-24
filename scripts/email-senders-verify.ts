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
 * ## It runs as its own role, `awcms_email_senders_verify` (ADR-0162 O1)
 *
 * Owner decision K19.1 (24 November 2026, Issue #1479): the job no longer runs
 * as `awcms_app`. Connected through `EMAIL_SENDERS_VERIFY_DATABASE_URL`, with
 * NO fallback: without it the job refuses to run. It refuses as well when a
 * shared login (the app, worker or setup connection string) is in its
 * environment, and when the server says the connection is not exactly that
 * role. The role (`sql/460`, `sql/461`) reads, of the channel secrets, only the
 * `api_token` of a live Mailketing ESP account, and writes only the status and
 * health values this job writes, each bounded per row and per value, so the key
 * ring this job holds meets no login that could read a WhatsApp, Telegram or
 * social secret. It still WRITES health and status through `channel_accounts`'
 * own `recordAccountHealth` (unchanged code; the role's policies bound it).
 *
 * ## Advisory DNS evidence (owner decision K19.2)
 *
 * After the provider verification, SPF, DMARC and (with selectors configured)
 * DKIM records of each sender's domain are looked up and recorded with their
 * check date. DNS egress is made from THIS container only. The evidence never
 * changes a sender's status and never fails the run.
 *
 * No-op (exits 0, opens no connection) when `EMAIL_SENDER_ROUTING_ENABLED` is
 * not `"true"`. Requires real network egress to the provider; not run in CI.
 */
import {
  assertConnectedAsEmailSendersVerifyRole,
  assertNoSharedLogins,
  getEmailSendersVerifyDatabaseClient
} from "../src/lib/database/email-senders-verify-client";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { recordAccountHealth } from "../src/modules/channel-accounts/application/account-directory";
import { emailAccountDirectoryAdapter } from "../src/modules/channel-accounts/application/channel-account-port-adapter";
import { channelSenderCredentialAdapter } from "../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { isEmailSenderRoutingEnabled } from "../src/modules/email/domain/email-sender-config";
import {
  MAILKETING_V2_UNVERIFIED_WARNING,
  isMailketingV2Verified
} from "../src/modules/email/domain/mailketing-v2-contract";
import { newEmailSenderDnsDeps } from "../src/modules/email/application/email-sender-dns-evidence";
import {
  emailSendersVerifyRunFailed,
  verifyEmailSendersForTenant
} from "../src/modules/email/application/email-sender-verify";
import {
  isEmailSenderDnsEvidenceEnabled,
  resolveEmailSenderDkimSelectors
} from "../src/modules/email/domain/email-sender-dns";
import { createEmailSenderTxtResolver } from "../src/modules/email/infrastructure/email-sender-dns-resolver";

type TenantRow = { id: string };

/** The job's own connection, or `null` (logged, exit 1): never a broader fallback. */
async function openVerifyConnection(): Promise<Bun.SQL | null> {
  try {
    assertNoSharedLogins();

    const connection = getEmailSendersVerifyDatabaseClient();

    await assertConnectedAsEmailSendersVerifyRole(connection);

    return connection;
  } catch (error) {
    logScriptFailure("email:senders:verify REFUSED", error);
    process.exitCode = 1;

    return null;
  }
}

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

  const sql = await openVerifyConnection();

  if (sql === null) return;

  let failedTenants = 0;
  const dns = isEmailSenderDnsEvidenceEnabled()
    ? newEmailSenderDnsDeps(
        createEmailSenderTxtResolver(),
        resolveEmailSenderDkimSelectors()
      )
    : undefined;

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
      sendersUnknown: 0,
      dnsChecked: 0,
      dnsLearntNothing: 0,
      dnsSkipped: 0,
      dnsFailed: 0
    };

    for (const tenant of tenants) {
      try {
        const summary = await verifyEmailSendersForTenant(sql, tenant.id, {
          directory: emailAccountDirectoryAdapter,
          credentials: channelSenderCredentialAdapter,
          dns,
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
        `failedTenants=${failedTenants} ` +
        `dns=${dns ? "on" : "off"} dnsChecked=${totals.dnsChecked} ` +
        `dnsLearntNothing=${totals.dnsLearntNothing} dnsSkipped=${totals.dnsSkipped} ` +
        `dnsFailed=${totals.dnsFailed}`
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
