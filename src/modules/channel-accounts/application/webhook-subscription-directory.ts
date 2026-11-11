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
 * - **Disconnect and delete already revoke** (`account-directory.ts`), so a
 *   disconnected account's URL stops verifying without any work here.
 * - The callback token hash, account and provider are immutable (`sql/320`
 *   trigger); a revoked row is never re-activated.
 */
import { fetchAccountRecord } from "./account-directory";

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

type SubscriptionRow = {
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

function toView(row: SubscriptionRow): WebhookSubscriptionView {
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
  `) as SubscriptionRow[];

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
  `) as SubscriptionRow[];

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
  `) as SubscriptionRow[];

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
