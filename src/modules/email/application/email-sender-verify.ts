/**
 * `email:senders:verify` (Issue #1160, ADR-0151 sections 2 and 6): reads each
 * tenant Mailketing account's credit balance and verified senders from the
 * provider (read-only `GET /credits` and `GET /senders`) and records them as
 * the accounts' health, which is what makes a sender identity `connected`
 * (verified) and what the dispatcher's freshness gate reads.
 *
 * ## Fail closed, never "assume fine"
 *
 * - A sender becomes usable ONLY when the provider lists its address as
 *   verified, explicitly (`parseMailketingV2Senders`). Not listed, or listed
 *   without the flag: `degraded` / `SENDER_UNVERIFIED`. A response the parser
 *   does not recognise: `unknown`, which the dispatcher treats as a hold.
 * - The balance is read only from an explicit number; a 402 is `degraded` /
 *   `CREDIT_DEPLETED` with a balance of 0; a 401 is `failing` /
 *   `CREDENTIAL_REJECTED`, which takes the account (and therefore every one of
 *   its senders) out of service until an operator replaces the token.
 * - A probe that learnt NOTHING (network, timeout, 5xx, 429) writes nothing: the
 *   last recorded fact stands and simply goes STALE, and stale holds.
 * - This job NEVER creates or verifies a domain or a sender at the provider.
 *   Mailketing's documented API offers no such call (ADR-0151 section 8); SPF,
 *   DKIM and DMARC are configured at the tenant's DNS and the provider, by
 *   people, and only the provider's own verdict is read here.
 *
 * ## Provider I/O outside every transaction (ADR-0006)
 *
 * Per account: one short transaction decrypts the token, the two GETs run with
 * no transaction open, and one short transaction records the results. The
 * token lives in memory for that account only and is never logged, stored,
 * returned or put in a URL (ADR-0151 M1).
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import type {
  ChannelEmailAccountCredentialPort,
  ChannelEmailAccountDirectoryPort
} from "../../_shared/ports/channel-account-port";
import { resolveEmailSenderProbeTimeoutMs } from "../domain/email-sender-config";
import { isMailketingTokenHeaderSafe } from "../domain/mailketing-v2-contract";
import {
  createMailketingV2AccountProbe,
  type MailketingV2AccountProbe
} from "../infrastructure/mailketing-v2-provider";

const MODULE_KEY = "email";

export type EmailHealthState = "ok" | "degraded" | "failing" | "unknown";

export type RecordEmailAccountHealth = (
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  input: {
    state: EmailHealthState;
    reasonCode: string | null;
    quotaRemaining?: number | null;
  }
) => Promise<unknown>;

export type EmailSenderVerifyDeps = {
  directory: ChannelEmailAccountDirectoryPort;
  credentials: ChannelEmailAccountCredentialPort;
  /** `channel_accounts`' own health writer (it owns the status transitions). */
  recordHealth: RecordEmailAccountHealth;
  env?: NodeJS.ProcessEnv;
  /** Test seam (no network). */
  buildProbe?: (apiToken: string) => MailketingV2AccountProbe;
};

export type EmailSenderVerifySummary = {
  accounts: number;
  accountsProbed: number;
  accountsSkipped: number;
  sendersVerified: number;
  sendersUnverified: number;
  sendersUnknown: number;
};

export async function verifyEmailSendersForTenant(
  sql: Bun.SQL,
  tenantId: string,
  deps: EmailSenderVerifyDeps
): Promise<EmailSenderVerifySummary> {
  const env = deps.env ?? process.env;
  const summary: EmailSenderVerifySummary = {
    accounts: 0,
    accountsProbed: 0,
    accountsSkipped: 0,
    sendersVerified: 0,
    sendersUnverified: 0,
    sendersUnknown: 0
  };
  const accounts = await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => deps.directory.listEmailAccounts(tx, tenantId),
    { workClass: "background_sync" }
  );

  summary.accounts = accounts.length;

  for (const account of accounts) {
    const credential = await withTenantOrThrow(
      sql,
      tenantId,
      (tx) =>
        deps.credentials.resolveEmailAccountCredential(tx, {
          tenantId,
          accountId: account.espAccountId
        }),
      { workClass: "background_sync" }
    );

    if (!credential.ok || !isMailketingTokenHeaderSafe(credential.credential)) {
      summary.accountsSkipped += 1;
      log("warning", "email.senders_verify.account_skipped", {
        tenantId,
        moduleKey: MODULE_KEY,
        accountId: account.espAccountId,
        reason: credential.ok ? "CREDENTIAL_UNUSABLE" : credential.reason
      });
      continue;
    }

    const probe = (
      deps.buildProbe ??
      ((apiToken: string) =>
        createMailketingV2AccountProbe({
          apiToken,
          timeoutMs: resolveEmailSenderProbeTimeoutMs(env),
          env
        }))
    )(credential.credential);
    // No transaction is open across these two calls.
    const credits = await probe.readCredits();
    const senders = await probe.listVerifiedSenders();

    summary.accountsProbed += 1;

    await withTenantOrThrow(
      sql,
      tenantId,
      async (tx) => {
        if (credits.ok) {
          await deps.recordHealth(tx, tenantId, account.espAccountId, {
            state: "ok",
            reasonCode: null,
            quotaRemaining: credits.value
          });
        } else if (credits.failure === "auth") {
          await deps.recordHealth(tx, tenantId, account.espAccountId, {
            state: "failing",
            reasonCode: "CREDENTIAL_REJECTED",
            quotaRemaining: null
          });
        } else if (credits.failure === "credit") {
          await deps.recordHealth(tx, tenantId, account.espAccountId, {
            state: "degraded",
            reasonCode: "CREDIT_DEPLETED",
            quotaRemaining: 0
          });
        } else if (credits.failure === "malformed") {
          await deps.recordHealth(tx, tenantId, account.espAccountId, {
            state: "unknown",
            reasonCode: "CREDIT_RESPONSE_UNRECOGNISED",
            quotaRemaining: null
          });
        }
        // `unavailable`: nothing learnt, nothing written; the last fact goes stale.

        for (const sender of account.senders) {
          if (senders.ok) {
            const verified = senders.value.has(sender.address);

            await deps.recordHealth(tx, tenantId, sender.accountId, {
              state: verified ? "ok" : "degraded",
              reasonCode: verified ? null : "SENDER_UNVERIFIED"
            });

            if (verified) summary.sendersVerified += 1;
            else summary.sendersUnverified += 1;
          } else if (senders.failure === "malformed") {
            await deps.recordHealth(tx, tenantId, sender.accountId, {
              state: "unknown",
              reasonCode: "SENDER_LIST_UNRECOGNISED"
            });
            summary.sendersUnknown += 1;
          } else if (senders.failure === "auth") {
            // The account's own row already says why; a sender of a rejected
            // token cannot be called verified, so it is not left `ok`.
            await deps.recordHealth(tx, tenantId, sender.accountId, {
              state: "unknown",
              reasonCode: "ACCOUNT_CREDENTIAL_REJECTED"
            });
            summary.sendersUnknown += 1;
          } else {
            summary.sendersUnknown += 1;
          }
        }
      },
      { workClass: "background_sync" }
    );

    log("info", "email.senders_verify.account_checked", {
      tenantId,
      moduleKey: MODULE_KEY,
      accountId: account.espAccountId,
      credits: credits.ok ? "ok" : credits.failure,
      senders: senders.ok ? "ok" : senders.failure
    });
  }

  return summary;
}
