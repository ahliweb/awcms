/**
 * Webhook subscriptions (`awcms_channel_webhook_subscriptions`, `sql/318`): the
 * first code that WRITES them (Issue #1161). The table is this module's, so the
 * writes live here; a consuming module (today only `email`, for Mailketing)
 * reaches these functions through a lazy loader and never names the table.
 *
 * A subscription holds only the HASH of an opaque callback token, which the
 * consumer computes (its own token format and hash domain) and hands in. The
 * token itself never reaches this module, a log, or the database.
 *
 * - **Issue = rotate.** Issuing a subscription for an account REVOKES every
 *   other live subscription of that account and provider in the same
 *   transaction, under the account's row lock: there is at most one live
 *   callback URL per account, and a leaked URL is cut off by issuing a new one.
 * - **Disconnect and delete revoke** (`account-directory.ts`, through
 *   {@link revokeAccountWebhookSubscriptions}), which also ERASES any signing
 *   secret a subscription holds, so a disconnected account's URL stops
 *   verifying and leaves no recoverable credential behind.
 * - The callback token hash, account and provider are immutable (`sql/320`
 *   trigger); a revoked row is never re-activated.
 *
 * ## Signed Meta subscriptions (Issue #1143)
 *
 * ### Two halves, one secret
 *
 * - {@link createMetaWebhookSubscription}: an administrator registers the Meta
 *   app secret of a number (write-only, envelope-encrypted through the secret
 *   store, purpose `webhook_signing_secret`) and receives an OPAQUE callback
 *   token ONCE. Any earlier subscription of the number is revoked and its
 *   secret erased in the same transaction (rotation).
 * - {@link channelWebhookVerifierAdapter}: the public webhook route asks, per
 *   request, whether a body is genuine. The app secret is decrypted in memory,
 *   in the tenant transaction the token names, and never leaves this file.
 *
 * ### Uniform refusal
 *
 * The verifier always computes the token hash comparison (against a dummy hash
 * when no row matches), so an unknown subscription and a wrong token secret
 * cost the same work. Every refusal reason is for the server's log and counter
 * only; the route answers one `401` for all of them.
 *
 * ### Who runs it
 *
 * The APPLICATION role, in a request. The worker role cannot read a
 * `webhook_signing_secret` (`sql/328`'s RESTRICTIVE policy names only the three
 * send-credential purposes), and nothing here widens that.
 */
import { createHmac } from "node:crypto";

import type {
  ChannelWebhookVerifierPort,
  VerifyMetaWebhookResult
} from "../../_shared/ports/channel-account-port";
import {
  constantTimeEquals,
  hashChannelCallbackToken,
  mintChannelCallbackToken
} from "../../_shared/channel-webhook-token";
import { isChannelAccountsEnabled } from "../domain/channel-accounts-constants";
import { fetchAccountRecord } from "./account-directory";
import {
  defaultSecretStore,
  SecretStoreError,
  type SecretStorePort
} from "./secret-store";

export type WebhookVerificationMode =
  "hmac_signature" | "secret_header" | "challenge" | "unauthenticated";

export type WebhookSubscriptionView = {
  id: string;
  accountId: string;
  provider: string;
  verificationMode: WebhookVerificationMode;
  status: "pending" | "active" | "paused" | "revoked";
  lastEventAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type IssuedSubscriptionRow = {
  id: string;
  account_id: string;
  provider: string;
  verification_mode: WebhookVerificationMode;
  status: WebhookSubscriptionView["status"];
  last_event_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function toView(row: IssuedSubscriptionRow): WebhookSubscriptionView {
  return {
    id: row.id,
    accountId: row.account_id,
    provider: row.provider,
    verificationMode: row.verification_mode,
    status: row.status,
    lastEventAt: row.last_event_at ? row.last_event_at.toISOString() : null,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export type IssueWebhookSubscriptionInput = {
  /** Chosen by the caller, because its token format embeds it. */
  id: string;
  accountId: string;
  provider: string;
  /** The account kind the subscription must hang off (e.g. `esp_account`). */
  accountKind: string;
  verificationMode: WebhookVerificationMode;
  callbackTokenHash: string;
  createdBy: string;
};

export type IssueWebhookSubscriptionResult =
  | {
      outcome: "issued";
      subscription: WebhookSubscriptionView;
      revokedIds: string[];
    }
  | { outcome: "account_unavailable" };

/**
 * Issues (or rotates) the live subscription of one account. The account must
 * be live, of `provider` and `accountKind`, and not revoked or disabled;
 * anything else is one answer, `account_unavailable`.
 */
export async function issueWebhookSubscription(
  tx: Bun.SQL,
  tenantId: string,
  input: IssueWebhookSubscriptionInput
): Promise<IssueWebhookSubscriptionResult> {
  const account = await fetchAccountRecord(tx, tenantId, input.accountId, {
    lock: true
  });

  if (
    !account ||
    account.provider !== input.provider ||
    account.accountKind !== input.accountKind ||
    account.status === "revoked" ||
    account.status === "disabled"
  ) {
    return { outcome: "account_unavailable" };
  }

  const revoked = (await tx`
    UPDATE awcms_channel_webhook_subscriptions
    SET status = 'revoked', updated_at = now()
    WHERE tenant_id = ${tenantId} AND account_id = ${input.accountId}
      AND provider = ${input.provider} AND status <> 'revoked'
    RETURNING id
  `) as { id: string }[];

  const rows = (await tx`
    INSERT INTO awcms_channel_webhook_subscriptions
      (id, tenant_id, account_id, provider, callback_token_hash,
       verification_mode, accepts_content_events, status, created_by)
    VALUES
      (${input.id}, ${tenantId}, ${input.accountId}, ${input.provider},
       ${input.callbackTokenHash}, ${input.verificationMode}, false, 'active',
       ${input.createdBy})
    RETURNING id, account_id, provider, verification_mode, status,
              last_event_at, created_by, created_at, updated_at
  `) as IssuedSubscriptionRow[];

  return {
    outcome: "issued",
    subscription: toView(rows[0]!),
    revokedIds: revoked.map((row) => row.id)
  };
}

/** `null` when there is no such subscription of `provider` in this tenant. Idempotent on an already-revoked row. */
export async function revokeWebhookSubscription(
  tx: Bun.SQL,
  tenantId: string,
  provider: string,
  id: string
): Promise<{ subscription: WebhookSubscriptionView; changed: boolean } | null> {
  const before = (await tx`
    SELECT status FROM awcms_channel_webhook_subscriptions
    WHERE tenant_id = ${tenantId} AND id = ${id} AND provider = ${provider}
    FOR UPDATE
  `) as { status: string }[];

  if (before.length === 0) return null;

  const rows = (await tx`
    UPDATE awcms_channel_webhook_subscriptions
    SET status = 'revoked',
        updated_at = CASE WHEN status = 'revoked' THEN updated_at ELSE now() END
    WHERE tenant_id = ${tenantId} AND id = ${id} AND provider = ${provider}
    RETURNING id, account_id, provider, verification_mode, status,
              last_event_at, created_by, created_at, updated_at
  `) as IssuedSubscriptionRow[];

  return {
    subscription: toView(rows[0]!),
    changed: before[0]!.status !== "revoked"
  };
}

/** Newest first, bounded: one live row per account plus its revoked history. */
export async function listWebhookSubscriptions(
  tx: Bun.SQL,
  tenantId: string,
  provider: string
): Promise<WebhookSubscriptionView[]> {
  const rows = (await tx`
    SELECT id, account_id, provider, verification_mode, status,
           last_event_at, created_by, created_at, updated_at
    FROM awcms_channel_webhook_subscriptions
    WHERE tenant_id = ${tenantId} AND provider = ${provider}
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `) as IssuedSubscriptionRow[];

  return rows.map(toView);
}

export type WebhookSubscriptionForVerification = {
  id: string;
  accountId: string;
  provider: string;
  verificationMode: WebhookVerificationMode;
  callbackTokenHash: string;
  /** `true` only when the subscription is `active` and its account is live and `connected`. */
  live: boolean;
};

/**
 * What a public callback route needs to verify a presented token, read INSIDE
 * the tenant the token names. `null` when the row does not exist; the caller
 * still spends its comparison against a dummy hash.
 */
export async function fetchWebhookSubscriptionForVerification(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  expected: { provider: string; accountKind: string }
): Promise<WebhookSubscriptionForVerification | null> {
  const rows = (await tx`
    SELECT s.id, s.account_id, s.provider, s.verification_mode,
           s.callback_token_hash, s.status,
           a.status AS account_status, a.provider AS account_provider,
           a.account_kind, a.deleted_at
    FROM awcms_channel_webhook_subscriptions s
    JOIN awcms_channel_accounts a
      ON a.tenant_id = s.tenant_id AND a.id = s.account_id
    WHERE s.tenant_id = ${tenantId} AND s.id = ${id}
  `) as {
    id: string;
    account_id: string;
    provider: string;
    verification_mode: WebhookVerificationMode;
    callback_token_hash: string;
    status: string;
    account_status: string;
    account_provider: string;
    account_kind: string;
    deleted_at: Date | null;
  }[];

  const row = rows[0];

  if (!row) return null;

  return {
    id: row.id,
    accountId: row.account_id,
    provider: row.provider,
    verificationMode: row.verification_mode,
    callbackTokenHash: row.callback_token_hash,
    live:
      row.status === "active" &&
      row.provider === expected.provider &&
      row.account_provider === expected.provider &&
      row.account_kind === expected.accountKind &&
      row.account_status === "connected" &&
      row.deleted_at === null
  };
}

/** Marks that an event arrived. Never moves the row's status. */
export async function touchWebhookSubscription(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<void> {
  await tx`
    UPDATE awcms_channel_webhook_subscriptions
    SET last_event_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'active'
  `;
}

// ---------------------------------------------------------------------------
// Signed Meta webhook subscriptions (Issue #1143)
// ---------------------------------------------------------------------------

/** The same SHAPE as a stored hash, so a missing row costs the same compare. */
const DUMMY_TOKEN_HASH = `sha256:${"0".repeat(64)}`;

type SubscriptionRow = {
  id: string;
  account_id: string;
  provider: string;
  callback_token_hash: string;
  verification_mode: string;
  status: string;
  signing_secret_id: string | null;
};

type AccountBindingRow = {
  id: string;
  provider: string;
  account_kind: string;
  external_id: string;
  status: string;
  parent_id: string | null;
  parent_provider: string | null;
  parent_kind: string | null;
  parent_external_id: string | null;
};

async function loadBinding(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<AccountBindingRow | null> {
  const rows = (await tx`
    SELECT a.id, a.provider, a.account_kind, a.external_id, a.status,
           p.id AS parent_id, p.provider AS parent_provider,
           p.account_kind AS parent_kind, p.external_id AS parent_external_id
    FROM awcms_channel_accounts a
    LEFT JOIN awcms_channel_accounts p
      ON p.tenant_id = a.tenant_id AND p.id = a.parent_account_id
     AND p.deleted_at IS NULL
    WHERE a.tenant_id = ${tenantId} AND a.id = ${accountId}
      AND a.deleted_at IS NULL
  `) as AccountBindingRow[];

  return rows[0] ?? null;
}

/** A Meta number with a live WABA container of the same provider: the only shape a Meta webhook may be bound to. */
function isBoundMetaNumber(
  row: AccountBindingRow | null
): row is AccountBindingRow & {
  parent_id: string;
  parent_external_id: string;
} {
  return (
    row !== null &&
    row.provider === "whatsapp_cloud" &&
    row.account_kind === "waba_phone_number" &&
    row.status !== "revoked" &&
    row.parent_id !== null &&
    row.parent_provider === "whatsapp_cloud" &&
    row.parent_kind === "waba" &&
    row.parent_external_id !== null
  );
}

// ---------------------------------------------------------------------------
// Creation (and rotation)
// ---------------------------------------------------------------------------

export type CreateMetaWebhookSubscriptionOutcome =
  | {
      outcome: "created";
      subscriptionId: string;
      /** Shown ONCE to the caller; only its hash is stored. */
      callbackToken: string;
      rotated: number;
    }
  | { outcome: "not_found" }
  | {
      outcome: "refused";
      code: "NOT_A_META_NUMBER" | "CONTAINER_BINDING_INVALID";
    };

export async function createMetaWebhookSubscription(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  actorTenantUserId: string,
  accountId: string,
  appSecret: string
): Promise<CreateMetaWebhookSubscriptionOutcome> {
  // Lock the account so a concurrent disconnect cannot land between the check
  // and the insert (the same rule as every read-then-write path here).
  const locked = (await tx`
    SELECT id FROM awcms_channel_accounts
    WHERE tenant_id = ${tenantId} AND id = ${accountId} AND deleted_at IS NULL
    FOR UPDATE
  `) as { id: string }[];

  if (locked.length === 0) return { outcome: "not_found" };

  const binding = await loadBinding(tx, tenantId, accountId);

  if (
    !binding ||
    binding.provider !== "whatsapp_cloud" ||
    binding.account_kind !== "waba_phone_number" ||
    binding.status === "revoked"
  ) {
    return { outcome: "refused", code: "NOT_A_META_NUMBER" };
  }

  if (!isBoundMetaNumber(binding)) {
    return { outcome: "refused", code: "CONTAINER_BINDING_INVALID" };
  }

  // Rotation: every earlier subscription of this number stops verifying NOW,
  // and its app-secret ciphertext is erased (a revoked subscription must not
  // keep a recoverable credential alive).
  const rotated = await revokeAccountWebhookSubscriptions(
    tx,
    store,
    tenantId,
    accountId
  );

  const secret = await store.put(tx, {
    tenantId,
    purpose: "webhook_signing_secret",
    plaintext: appSecret,
    createdBy: actorTenantUserId
  });
  const subscriptionId = crypto.randomUUID();
  const callbackToken = mintChannelCallbackToken(tenantId, subscriptionId);

  await tx`
    INSERT INTO awcms_channel_webhook_subscriptions
      (id, tenant_id, account_id, provider, callback_token_hash,
       verification_mode, accepts_content_events, replay_window_seconds,
       signing_secret_id, status, created_by)
    VALUES (${subscriptionId}, ${tenantId}, ${accountId}, 'whatsapp_cloud',
            ${hashChannelCallbackToken(callbackToken)}, 'hmac_signature', true,
            300, ${secret.secretId}, 'active', ${actorTenantUserId})
  `;

  return {
    outcome: "created",
    subscriptionId,
    callbackToken,
    rotated
  };
}

/**
 * Revokes every subscription of an account that is still live or still holds
 * a signing secret, and HARD-DELETES those secrets (the rule of `sql/318`: a
 * revoked credential is not kept recoverable). Used by rotation AND by
 * `disconnectAccount`/`deleteAccount` (security review M-3: they used to revoke
 * the subscription but leave the app-secret ciphertext behind). Returns how many
 * subscriptions it touched.
 */
export async function revokeAccountWebhookSubscriptions(
  tx: Bun.SQL,
  store: SecretStorePort,
  tenantId: string,
  accountId: string
): Promise<number> {
  const previous = (await tx`
    SELECT id, signing_secret_id FROM awcms_channel_webhook_subscriptions
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
      AND (status <> 'revoked' OR signing_secret_id IS NOT NULL)
    FOR UPDATE
  `) as { id: string; signing_secret_id: string | null }[];

  for (const row of previous) {
    await tx`
      UPDATE awcms_channel_webhook_subscriptions
      SET status = 'revoked', signing_secret_id = NULL, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${row.id}
    `;

    if (row.signing_secret_id) {
      await store.remove(tx, tenantId, row.signing_secret_id);
    }
  }

  return previous.length;
}

// ---------------------------------------------------------------------------
// Verification (the public route's question)
// ---------------------------------------------------------------------------

/** `sha256=<64 lower-case hex>`, exactly as Meta documents `X-Hub-Signature-256`. */
const SIGNATURE_HEADER = /^sha256=([0-9a-f]{64})$/;

/** HMAC-SHA256 over the EXACT bytes received (security review L-5): a string argument is encoded as UTF-8 for callers that hold text. */
export function computeMetaSignature(
  secret: string,
  rawBody: Uint8Array | string
): string {
  return createHmac("sha256", secret)
    .update(
      typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody
    )
    .digest("hex");
}

async function loadSubscription(
  tx: Bun.SQL,
  tenantId: string,
  subscriptionId: string
): Promise<SubscriptionRow | null> {
  const rows = (await tx`
    SELECT id, account_id, provider, callback_token_hash, verification_mode,
           status, signing_secret_id
    FROM awcms_channel_webhook_subscriptions
    WHERE tenant_id = ${tenantId} AND id = ${subscriptionId}
  `) as SubscriptionRow[];

  return rows[0] ?? null;
}

/** The token half of every check: always one constant-time compare, row or no row. */
function tokenMatches(row: SubscriptionRow | null, token: string): boolean {
  const matches = constantTimeEquals(
    row?.callback_token_hash ?? DUMMY_TOKEN_HASH,
    hashChannelCallbackToken(token)
  );

  return row !== null && matches;
}

export function createChannelWebhookVerifierAdapter(
  options: { store?: SecretStorePort; env?: NodeJS.ProcessEnv } = {}
): ChannelWebhookVerifierPort {
  const store = options.store ?? defaultSecretStore;
  const envOf = () => options.env ?? process.env;

  return {
    async verifyMetaWebhook(tx, input): Promise<VerifyMetaWebhookResult> {
      const subscription = await loadSubscription(
        tx,
        input.tenantId,
        input.subscriptionId
      );
      const tokenOk = tokenMatches(subscription, input.token);

      if (!isChannelAccountsEnabled(envOf())) {
        return { ok: false, reason: "DISABLED" };
      }

      if (!tokenOk || !subscription) {
        return { ok: false, reason: "TOKEN_INVALID" };
      }

      if (
        subscription.status !== "active" ||
        subscription.provider !== "whatsapp_cloud" ||
        subscription.verification_mode !== "hmac_signature" ||
        !subscription.signing_secret_id
      ) {
        return { ok: false, reason: "SUBSCRIPTION_INACTIVE" };
      }

      const binding = await loadBinding(
        tx,
        input.tenantId,
        subscription.account_id
      );

      if (!isBoundMetaNumber(binding)) {
        return { ok: false, reason: "BINDING_INVALID" };
      }

      const presented = SIGNATURE_HEADER.exec(
        (input.signatureHeader ?? "").trim()
      );

      let secret: string;

      try {
        secret = await store.resolve(tx, {
          tenantId: input.tenantId,
          secretId: subscription.signing_secret_id,
          purpose: "webhook_signing_secret"
        });
      } catch (error) {
        // tx-swallow-ok: a SecretStoreError is raised before any statement (no
        // key ring) or after a SUCCESSFUL select (not found, does not
        // authenticate), so the transaction is not aborted; any other error, a
        // database one, is rethrown below.
        if (error instanceof SecretStoreError) {
          return { ok: false, reason: "SECRET_UNAVAILABLE" };
        }

        throw error;
      }

      const expected = computeMetaSignature(secret, input.rawBody);

      // Compared even when the header is malformed (against itself), so a
      // missing header is not a faster answer than a wrong one.
      const signatureOk = constantTimeEquals(
        presented?.[1] ?? "0".repeat(64),
        expected
      );

      if (!presented || !signatureOk) {
        return { ok: false, reason: "SIGNATURE_INVALID" };
      }

      await tx`
        UPDATE awcms_channel_webhook_subscriptions
        SET last_event_at = now()
        WHERE tenant_id = ${input.tenantId} AND id = ${subscription.id}
      `;

      return {
        ok: true,
        binding: {
          subscriptionId: subscription.id,
          accountId: binding.id,
          phoneNumberId: binding.external_id,
          containerAccountId: binding.parent_id,
          wabaId: binding.parent_external_id
        }
      };
    },

    async verifyMetaHandshake(tx, input): Promise<boolean> {
      const subscription = await loadSubscription(
        tx,
        input.tenantId,
        input.subscriptionId
      );
      const tokenOk = tokenMatches(subscription, input.token);
      const verifyOk = constantTimeEquals(input.verifyToken ?? "", input.token);

      return (
        isChannelAccountsEnabled(envOf()) &&
        tokenOk &&
        verifyOk &&
        subscription !== null &&
        subscription.status === "active" &&
        subscription.provider === "whatsapp_cloud" &&
        subscription.verification_mode === "hmac_signature"
      );
    }
  };
}

/** The adapter the webhook route's loader hands to `whatsapp_delivery`. */
export const channelWebhookVerifierAdapter: ChannelWebhookVerifierPort =
  createChannelWebhookVerifierAdapter();
