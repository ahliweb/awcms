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
 *
 * ## `resolvePublishCredential` has no composer yet (Issue #1145, audit H1)
 *
 * The same decrypt, for an account that PUBLISHES (`social_publishing`). No
 * script composes it: `awcms_worker` cannot read a social token (`sql/328`) and
 * `social-publishing:dispatch` is deliberately granted no key ring. The first
 * connector composes it under a SEPARATE DB role (ADR-0157 section 6).
 *
 * ## Email (Issue #1160, ADR-0151 section 2)
 *
 * `resolveEmailCredential` is composed by `scripts/email-dispatch.ts` (as
 * `awcms_worker`, which sees a Mailketing account token only through the
 * provider-aware row policy of `sql/348`). `resolveEmailAccountCredential` is
 * composed by `scripts/email-senders-verify.ts` (as `awcms_app`), for the two
 * read-only probes that verify senders and read the credit balance.
 */
import type {
  ChannelEmailAccountCredentialPort,
  ChannelEmailCredentialPort,
  ChannelPublisherCredentialPort,
  ChannelSenderCredentialPort,
  EmailSenderUnavailableReason,
  PublisherUnavailableReason,
  ResolveEmailCredentialResult,
  ResolvePublishCredentialResult,
  ResolveSenderCredentialResult,
  SenderUnavailableReason
} from "../../_shared/ports/channel-account-port";
import { log } from "../../../lib/logging/logger";
import { isStarsenderAdapterEnabled } from "../../_shared/unofficial-provider-flags";
import { isChannelAccountsEnabled } from "../domain/channel-accounts-constants";
import type { ChannelSecretPurpose } from "../domain/channel-accounts-constants";
import { isRiskAcknowledgementProvider } from "../domain/risk-acknowledgements";
import {
  isEmailSenderShape,
  isPublisherShape,
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

/** The providers whose adapter is an opt-in, unofficial one (today: StarSender). */
function isUnofficialProvider(provider: string): boolean {
  return provider === "starsender";
}

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
): ChannelSenderCredentialPort &
  ChannelPublisherCredentialPort &
  ChannelEmailCredentialPort &
  ChannelEmailAccountCredentialPort {
  const store = options.store ?? defaultSecretStore;
  const now = options.now ?? (() => new Date());

  /** The shared tail: status, reference, decrypt. Identical for every channel. */
  async function resolveFor(
    tx: Bun.SQL,
    input: { tenantId: string; accountId: string },
    isRightKind: (account: SenderAccountRow) => boolean,
    wrongKindReason:
      "NOT_A_WHATSAPP_SENDER" | "NOT_A_PUBLISHER" | "NOT_AN_EMAIL_SENDER",
    /**
     * Refusals decided after the status and BEFORE any secret is read (the
     * WhatsApp provider gates of Issue #1142); `null` lets the call go on.
     */
    gate?: (
      account: SenderAccountRow
    ) => Promise<SenderUnavailableReason | null>
  ): Promise<
    | { ok: true; credential: string }
    | {
        ok: false;
        reason:
          SenderUnavailableReason | "NOT_A_PUBLISHER" | "NOT_AN_EMAIL_SENDER";
      }
  > {
    if (!isChannelAccountsEnabled(options.env ?? process.env)) {
      return { ok: false, reason: "CHANNEL_ACCOUNTS_DISABLED" };
    }

    const account = await loadSenderAccount(
      tx,
      input.tenantId,
      input.accountId
    );

    if (!account) return { ok: false, reason: "ACCOUNT_NOT_FOUND" };

    if (!isRightKind(account)) {
      return { ok: false, reason: wrongKindReason };
    }

    const statusReason = reasonForAccountStatus(account.status);

    if (statusReason) return { ok: false, reason: statusReason };

    const gated = gate ? await gate(account) : null;

    if (gated) return { ok: false, reason: gated };

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

  return {
    async resolveWhatsappCredential(
      tx,
      input
    ): Promise<ResolveSenderCredentialResult> {
      const result = await resolveFor(
        tx,
        input,
        (account) =>
          isWhatsappSenderShape(account.provider, account.account_kind),
        "NOT_A_WHATSAPP_SENDER",
        async (account) => {
          // Defence in depth (Issue #1142): the device key of an UNOFFICIAL
          // provider is not decrypted for a tenant whose acknowledgement is not
          // in force, even if a caller skipped the sender decision.
          if (
            isRiskAcknowledgementProvider(account.provider) &&
            !(await hasActiveRiskAcknowledgement(
              tx,
              input.tenantId,
              account.provider
            ))
          ) {
            return "RISK_ACKNOWLEDGEMENT_REQUIRED";
          }

          // The adapter's switch comes before ANY secret is read (audit L2,
          // Issue #1142): with the flag off the device key is not decrypted at
          // all, even if a caller skipped the sender decision.
          if (
            isUnofficialProvider(account.provider) &&
            !isStarsenderAdapterEnabled(options.env ?? process.env)
          ) {
            return "PROVIDER_ADAPTER_DISABLED";
          }

          return null;
        }
      );

      return result.ok
        ? result
        : { ok: false, reason: result.reason as SenderUnavailableReason };
    },

    /**
     * Issue #1160 (ADR-0151 section 2): the API token a Mailketing sender
     * identity borrows from its parent account. A sender holds no credential
     * of its own, so the parent lends it only while it really is this sender's
     * `connected` `esp_account` (`loadLendingParent`, the same rule a WABA
     * number follows). No fallback to the deployment token, ever (ADR-0151
     * section 2: "the deployment token is never used for a tenant-owned
     * account").
     */
    async resolveEmailCredential(
      tx,
      input
    ): Promise<ResolveEmailCredentialResult> {
      const result = await resolveFor(
        tx,
        input,
        (account) => isEmailSenderShape(account.provider, account.account_kind),
        "NOT_AN_EMAIL_SENDER"
      );

      return result.ok
        ? result
        : {
            ok: false,
            reason: result.reason as EmailSenderUnavailableReason
          };
    },

    /**
     * Issue #1160: the token of a Mailketing ACCOUNT itself, for the read-only
     * verification probes. A `pending` or `degraded` account may be probed
     * (that is how it becomes `connected`); a revoked, disabled or deleted one
     * may not. Its own `secret_id` only: an account lends, it never borrows.
     */
    async resolveEmailAccountCredential(
      tx,
      input
    ): Promise<ResolveEmailCredentialResult> {
      if (!isChannelAccountsEnabled(options.env ?? process.env)) {
        return { ok: false, reason: "CHANNEL_ACCOUNTS_DISABLED" };
      }

      const account = await loadSenderAccount(
        tx,
        input.tenantId,
        input.accountId
      );

      if (!account) return { ok: false, reason: "ACCOUNT_NOT_FOUND" };

      if (
        account.provider !== "mailketing" ||
        account.account_kind !== "esp_account" ||
        account.auth_mode !== "api_token"
      ) {
        return { ok: false, reason: "NOT_AN_EMAIL_SENDER" };
      }

      if (!["pending", "connected", "degraded"].includes(account.status)) {
        return {
          ok: false,
          reason: reasonForAccountStatus(account.status) ?? "ACCOUNT_NOT_FOUND"
        };
      }

      if (!account.secret_id) {
        return { ok: false, reason: "CREDENTIAL_UNAVAILABLE" };
      }

      try {
        const credential = await store.resolve(tx, {
          tenantId: input.tenantId,
          secretId: account.secret_id,
          purpose: "api_token"
        });

        return { ok: true, credential };
      } catch (error) {
        // tx-swallow-ok: a SecretStoreError is raised before any statement or
        // after a SUCCESSFUL select, so the transaction is not aborted; any
        // other (database) error is rethrown below.
        if (error instanceof SecretStoreError) {
          log(
            "error",
            "channel_accounts.email_account_credential.unavailable",
            {
              tenantId: input.tenantId,
              moduleKey: "channel_accounts",
              code: error.code
            }
          );

          return {
            ok: false,
            reason:
              error.code === "SECRET_NOT_FOUND"
                ? "CREDENTIAL_UNAVAILABLE"
                : "SECRET_STORE_UNAVAILABLE"
          };
        }

        throw error;
      }
    },

    /** Issue #1145: the same decrypt, for an account that publishes. */
    async resolvePublishCredential(
      tx,
      input
    ): Promise<ResolvePublishCredentialResult> {
      const result = await resolveFor(
        tx,
        input,
        (account) => isPublisherShape(account.provider, account.account_kind),
        "NOT_A_PUBLISHER",
        async () => {
          // L-5 of the #1261 audit: the DB row policy of
          // `awcms_social_dispatch` (sql/358) is keyed on the CONNECTION (a
          // token is visible when SOME publish-granted account uses it). Which
          // account this request is for is checked here, before any secret is
          // read: THAT account must hold a granted `publish` capability.
          const rows = (await tx`
            SELECT 1 FROM awcms_channel_account_capabilities
            WHERE tenant_id = ${input.tenantId} AND account_id = ${input.accountId}
              AND capability = 'publish' AND state = 'granted'
          `) as unknown[];

          return rows.length === 1 ? null : "CAPABILITY_DENIED";
        }
      );

      return result.ok
        ? result
        : { ok: false, reason: result.reason as PublisherUnavailableReason };
    }
  };
}

/** The adapter the dispatchers' composition roots hand to `whatsapp_delivery` and `email`. */
export const channelSenderCredentialAdapter: ChannelSenderCredentialPort &
  ChannelPublisherCredentialPort &
  ChannelEmailCredentialPort &
  ChannelEmailAccountCredentialPort = createChannelSenderCredentialAdapter();
