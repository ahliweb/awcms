/**
 * The `ChannelSenderCredentialPort` adapter (Issue #1141, ADR-0148 section 5;
 * port in `_shared/ports/channel-account-port.ts`). THE one place a sender's
 * plaintext credential leaves the secret store for a WhatsApp send.
 *
 * ## Who may import this file
 *
 * The dispatcher's composition root (`scripts/whatsapp-dispatch.ts`) and tests.
 * It is its own file, apart from `channel-account-port-adapter.ts`, so that a
 * job which only ENQUEUES never reaches the secret store, and the job-scoped
 * key-ring grant (`CHANNEL_SECRETS_ENCRYPTION_KEYS`, `scripts/jobs-env-allowlist.ts`)
 * stays with the one job that decrypts.
 *
 * ## Where the credential comes from
 *
 * Only from the sender's own record in the caller's tenant, never from a
 * request: an `api_token` / `device_key` account keeps its credential on the
 * account (`secret_id`); an OAuth account keeps it on its connection
 * (`access_secret_id`), and only while that grant is `active` and unexpired. A
 * child identity (a WABA phone number) falls back to its parent container's
 * credential, the one place the registry models a shared token. The ciphertext
 * is bound by AES-GCM associated data to tenant, row and purpose, so even a
 * mis-pointed reference cannot decrypt under another tenant.
 *
 * A failure is a RETURNED reason with no value and no key material; the caller
 * fails the row or holds it. There is no fallback to any other credential.
 */
import type {
  ChannelSenderCredentialPort,
  ResolveSenderCredentialResult,
  SenderUnavailableReason
} from "../../_shared/ports/channel-account-port";
import { log } from "../../../lib/logging/logger";
import { isChannelAccountsEnabled } from "../domain/channel-accounts-constants";
import type { ChannelSecretPurpose } from "../domain/channel-accounts-constants";
import { isRiskAcknowledgementProvider } from "../domain/risk-acknowledgements";
import {
  isWhatsappSenderShape,
  loadLendingParent,
  loadSenderAccount,
  reasonForAccountStatus,
  reasonForGrantState,
  type SenderAccountRow
} from "./channel-account-port-adapter";
import { hasActiveRiskAcknowledgement } from "./risk-acknowledgement-check";
import {
  defaultSecretStore,
  SecretStoreError,
  type SecretStorePort
} from "./secret-store";

type ConnectionRow = {
  grant_state: string;
  access_secret_id: string | null;
  expires_at: Date | string | null;
};

async function loadConnection(
  tx: Bun.SQL,
  tenantId: string,
  connectionId: string
): Promise<ConnectionRow | null> {
  const rows = (await tx`
    SELECT grant_state, access_secret_id, expires_at
    FROM awcms_channel_provider_connections
    WHERE tenant_id = ${tenantId} AND id = ${connectionId}
  `) as ConnectionRow[];

  return rows[0] ?? null;
}

type Reference =
  | { secretId: string; purpose: ChannelSecretPurpose }
  | { reason: SenderUnavailableReason };

async function referenceFor(
  tx: Bun.SQL,
  tenantId: string,
  account: SenderAccountRow,
  now: Date
): Promise<Reference> {
  if (account.auth_mode === "oauth2") {
    let connectionId = account.connection_id;

    if (!connectionId && account.parent_account_id) {
      const lender = await loadLendingParent(tx, tenantId, account);

      if ("reason" in lender) return { reason: lender.reason };

      connectionId = lender.parent.connection_id;
    }

    if (!connectionId) return { reason: "CREDENTIAL_UNAVAILABLE" };

    const connection = await loadConnection(tx, tenantId, connectionId);
    const grantReason = reasonForGrantState(
      connection?.grant_state ?? "missing"
    );

    if (!connection || grantReason) {
      return { reason: grantReason ?? "CONNECTION_NOT_ACTIVE" };
    }

    if (
      connection.expires_at !== null &&
      new Date(connection.expires_at).getTime() <= now.getTime()
    ) {
      // An expired token is not refreshed here and is not used: wait for the
      // connector's refresh or the tenant's re-authorisation.
      return { reason: "CONNECTION_EXPIRED" };
    }

    return connection.access_secret_id
      ? {
          secretId: connection.access_secret_id,
          purpose: "provider_access_token"
        }
      : { reason: "CREDENTIAL_UNAVAILABLE" };
  }

  const purpose: ChannelSecretPurpose | null =
    account.auth_mode === "api_token"
      ? "api_token"
      : account.auth_mode === "device_key"
        ? "device_key"
        : null;

  if (!purpose) return { reason: "CREDENTIAL_UNAVAILABLE" };

  let secretId = account.secret_id;

  if (!secretId && account.parent_account_id) {
    // Only a parent that really is this child's `connected` container lends.
    const lender = await loadLendingParent(tx, tenantId, account);

    if ("reason" in lender) return { reason: lender.reason };

    secretId = lender.parent.secret_id;
  }

  return secretId
    ? { secretId, purpose }
    : { reason: "CREDENTIAL_UNAVAILABLE" };
}

export type ChannelSenderCredentialOptions = {
  store?: SecretStorePort;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

export function createChannelSenderCredentialAdapter(
  options: ChannelSenderCredentialOptions = {}
): ChannelSenderCredentialPort {
  const store = options.store ?? defaultSecretStore;
  const now = options.now ?? (() => new Date());

  return {
    async resolveWhatsappCredential(
      tx,
      input
    ): Promise<ResolveSenderCredentialResult> {
      if (!isChannelAccountsEnabled(options.env ?? process.env)) {
        return { ok: false, reason: "CHANNEL_ACCOUNTS_DISABLED" };
      }

      const account = await loadSenderAccount(
        tx,
        input.tenantId,
        input.accountId
      );

      if (!account) return { ok: false, reason: "ACCOUNT_NOT_FOUND" };

      if (!isWhatsappSenderShape(account.provider, account.account_kind)) {
        return { ok: false, reason: "NOT_A_WHATSAPP_SENDER" };
      }

      const statusReason = reasonForAccountStatus(account.status);

      if (statusReason) return { ok: false, reason: statusReason };

      // Defence in depth (Issue #1142): the device key of an UNOFFICIAL provider
      // is not decrypted for a tenant whose acknowledgement is not in force, even
      // if a caller skipped the sender decision.
      if (
        isRiskAcknowledgementProvider(account.provider) &&
        !(await hasActiveRiskAcknowledgement(
          tx,
          input.tenantId,
          account.provider
        ))
      ) {
        return { ok: false, reason: "RISK_ACKNOWLEDGEMENT_REQUIRED" };
      }

      const reference = await referenceFor(tx, input.tenantId, account, now());

      if ("reason" in reference) return { ok: false, reason: reference.reason };

      try {
        const credential = await store.resolve(tx, {
          tenantId: input.tenantId,
          secretId: reference.secretId,
          purpose: reference.purpose
        });

        return { ok: true, credential };
      } catch (error) {
        // tx-swallow-ok: a SecretStoreError is raised before any statement (no
        // key ring) or after a SUCCESSFUL select (not found, does not
        // authenticate), so the transaction is not aborted; any other error, a
        // database one, is rethrown below.
        if (error instanceof SecretStoreError) {
          // Only a secret-store REFUSAL is answered here. It is raised before any
          // statement (no key ring) or after a successful SELECT (not found, does
          // not authenticate), so it leaves the transaction usable. Only the code
          // is logged: the error carries a fixed message, never the value or key
          // material, and neither does this line.
          log("error", "channel_accounts.sender_credential.unavailable", {
            tenantId: input.tenantId,
            moduleKey: "channel_accounts",
            code: error.code
          });

          return {
            ok: false,
            reason:
              error.code === "SECRET_NOT_FOUND"
                ? "CREDENTIAL_UNAVAILABLE"
                : "SECRET_STORE_UNAVAILABLE"
          };
        }

        // Anything else is a database error, which WOULD have aborted the
        // transaction: never swallowed.
        throw error;
      }
    }
  };
}

/** The adapter the dispatcher's composition root hands to `whatsapp_delivery`. */
export const channelSenderCredentialAdapter: ChannelSenderCredentialPort =
  createChannelSenderCredentialAdapter();
