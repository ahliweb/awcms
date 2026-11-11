/**
 * Registering, rotating and revoking a customer bot's webhook (ADR-0152
 * section 3 "connection ceremony" and "revocation and rotation", TG2/TG3).
 *
 * ## The ceremony is split at the provider boundary
 *
 * Everything here is DATABASE work in the request's transaction: the bot is an
 * existing `channel_accounts` row (provider `telegram`, kind `bot`) whose token
 * an administrator already stored write-only through the channel-accounts
 * credential route. Registering creates a `pending` endpoint with a fresh
 * webhook seed and asks the connector job for `set`. The job (outside any
 * transaction, `dispatch.ts`) calls `getMe`, refuses a bot whose id is not the
 * account's external id, then `setWebhook` with the per-bot URL, secret token
 * and minimal `allowed_updates`, and only then marks the endpoint `active`.
 * No provider call happens in a request (ADR-0148 I10), and this file never
 * decrypts the bot token.
 *
 * ## The staff bot is refused here
 *
 * The account's external id is the bot's numeric id. If it is the deployment's
 * staff bot (ADR-0140), registration is refused (ADR-0152 section 1, T-A2): one
 * bot has one webhook, and sharing it would merge two security models on one
 * URL. The job's `getMe` check then binds the TOKEN to that same id.
 *
 * ## Revocation and rotation are a hard cut (ADR-0152 O8)
 *
 * Revoking stamps the endpoint `revoked`, hard-deletes its seed (the old URL and
 * header die in the same transaction), cancels every queued message of the bot
 * and asks the job for `deleteWebhook`. Rotating revokes the live endpoint and
 * creates a new `pending` one with a new seed in the same transaction; the
 * job's `setWebhook` replaces Telegram's single webhook.
 */
import {
  generateWebhookSeed,
  derivePathSecret,
  hashPathSecret
} from "../domain/webhook-secrets";
import { staffBotIdFromEnvironment } from "../domain/staff-bot-identity";
import {
  DEFAULT_BOT_DAILY_CEILING,
  type EndpointState
} from "../domain/telegram-engagement-constants";
import {
  fetchBotAccount,
  removeSecret,
  storeWebhookSeed
} from "../infrastructure/channel-accounts-bridge";
import { cancelQueuedMessages } from "./message-cancellation";

export type BotView = {
  endpointId: string;
  accountId: string;
  accountName: string;
  accountStatus: string;
  businessScope: { type: string; id: string } | null;
  state: EndpointState;
  pendingProviderAction: "set" | "delete" | null;
  verifiedBotId: string | null;
  botUsername: string | null;
  lastErrorCode: string | null;
  dailySendCeiling: number;
  breakerOpenUntil: string | null;
  activatedAt: string | null;
  lastUpdateAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

type EndpointRow = {
  id: string;
  account_id: string;
  display_name: string;
  account_status: string;
  business_scope_type: string | null;
  business_scope_id: string | null;
  state: EndpointState;
  provider_action: "set" | "delete" | null;
  verified_bot_id: string | null;
  bot_username: string | null;
  last_error_code: string | null;
  daily_send_ceiling: number;
  breaker_open_until: Date | null;
  activated_at: Date | null;
  last_update_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
};

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function toView(row: EndpointRow): BotView {
  return {
    endpointId: row.id,
    accountId: row.account_id,
    accountName: row.display_name,
    accountStatus: row.account_status,
    businessScope:
      row.business_scope_type && row.business_scope_id
        ? { type: row.business_scope_type, id: row.business_scope_id }
        : null,
    state: row.state,
    pendingProviderAction: row.provider_action,
    verifiedBotId: row.verified_bot_id,
    botUsername: row.bot_username,
    lastErrorCode: row.last_error_code,
    dailySendCeiling: row.daily_send_ceiling,
    breakerOpenUntil: iso(row.breaker_open_until),
    activatedAt: iso(row.activated_at),
    lastUpdateAt: iso(row.last_update_at),
    createdAt: row.created_at.toISOString(),
    revokedAt: iso(row.revoked_at)
  };
}

const SELECT_VIEW = `
  SELECT e.id, e.account_id, a.display_name, a.status AS account_status,
         a.business_scope_type, a.business_scope_id, e.state, e.provider_action,
         e.verified_bot_id, e.bot_username, e.last_error_code,
         e.daily_send_ceiling, e.breaker_open_until, e.activated_at,
         e.last_update_at, e.created_at, e.revoked_at
  FROM awcms_telegram_engagement_endpoints e
  JOIN awcms_channel_accounts a
    ON a.tenant_id = e.tenant_id AND a.id = e.account_id
`;

/** The live (non-revoked) endpoints of the tenant, newest first. Bounded: one per bot. */
export async function listBots(
  tx: Bun.SQL,
  tenantId: string
): Promise<BotView[]> {
  const rows = (await tx.unsafe(
    `${SELECT_VIEW}
     WHERE e.tenant_id = $1 AND e.state <> 'revoked'
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 200`,
    [tenantId]
  )) as EndpointRow[];

  return rows.map(toView);
}

export async function fetchLiveBot(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<BotView | null> {
  const rows = (await tx.unsafe(
    `${SELECT_VIEW}
     WHERE e.tenant_id = $1 AND e.account_id = $2 AND e.state <> 'revoked'`,
    [tenantId, accountId]
  )) as EndpointRow[];

  return rows.length === 0 ? null : toView(rows[0]!);
}

export type RegisterOutcome =
  | { outcome: "registered"; bot: BotView }
  | { outcome: "not_found" }
  | {
      outcome: "refused";
      code:
        | "ACCOUNT_NOT_USABLE"
        | "CREDENTIAL_MISSING"
        | "STAFF_BOT_REFUSED"
        | "ALREADY_REGISTERED";
    };

async function insertEndpoint(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  actor: string | null,
  dailySendCeiling: number
): Promise<string> {
  const seed = generateWebhookSeed();
  const secretId = await storeWebhookSeed(tx, {
    tenantId,
    plaintext: seed,
    createdBy: actor
  });
  const callbackHash = hashPathSecret(derivePathSecret(seed));
  const rows = (await tx`
    INSERT INTO awcms_telegram_engagement_endpoints
      (tenant_id, account_id, secret_id, callback_hash, state, provider_action,
       daily_send_ceiling, created_by)
    VALUES (${tenantId}, ${accountId}, ${secretId}, ${callbackHash}, 'pending',
            'set', ${dailySendCeiling}, ${actor})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

export async function registerBot(
  tx: Bun.SQL,
  tenantId: string,
  actor: string,
  input: { accountId: string; dailySendCeiling: number | null },
  env: NodeJS.ProcessEnv = process.env
): Promise<RegisterOutcome> {
  const account = await fetchBotAccount(tx, tenantId, input.accountId, {
    lock: true
  });

  if (!account) return { outcome: "not_found" };

  const refusal = refusalFor(account, env);

  if (refusal) return { outcome: "refused", code: refusal };

  const existing = await fetchLiveBot(tx, tenantId, account.id);

  if (existing) return { outcome: "refused", code: "ALREADY_REGISTERED" };

  await insertEndpoint(
    tx,
    tenantId,
    account.id,
    actor,
    input.dailySendCeiling ?? DEFAULT_BOT_DAILY_CEILING
  );

  return {
    outcome: "registered",
    bot: (await fetchLiveBot(tx, tenantId, account.id))!
  };
}

type LiveEndpoint = {
  id: string;
  secret_id: string | null;
  daily_send_ceiling: number;
};

async function lockLiveEndpoint(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string
): Promise<LiveEndpoint | null> {
  const rows = (await tx`
    SELECT id, secret_id, daily_send_ceiling
    FROM awcms_telegram_engagement_endpoints
    WHERE tenant_id = ${tenantId} AND account_id = ${accountId}
      AND state <> 'revoked'
    FOR UPDATE
  `) as LiveEndpoint[];

  return rows[0] ?? null;
}

/** Stamps the endpoint revoked and hard-deletes its seed in the same transaction. */
async function revokeEndpointRow(
  tx: Bun.SQL,
  tenantId: string,
  endpoint: LiveEndpoint,
  actor: string | null,
  reason: string,
  providerAction: "delete" | null
): Promise<void> {
  await tx`
    UPDATE awcms_telegram_engagement_endpoints
    SET state = 'revoked', secret_id = NULL, revoked_at = now(),
        revoked_by = ${actor}, revoke_reason = ${reason},
        provider_action = ${providerAction}, next_attempt_at = now(),
        connector_attempts = 0, connector_lease_until = NULL,
        updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${endpoint.id}
  `;

  if (endpoint.secret_id) {
    await removeSecret(tx, tenantId, endpoint.secret_id);
  }
}

export type RotateOutcome =
  | { outcome: "rotated"; bot: BotView }
  | { outcome: "not_found" }
  | {
      outcome: "refused";
      code: "ACCOUNT_NOT_USABLE" | "CREDENTIAL_MISSING" | "STAFF_BOT_REFUSED";
    };

/**
 * The checks registration makes, re-made for every new endpoint (audit L-3 of
 * PR #1260): a rotation creates a new pending endpoint that the connector will
 * `setWebhook`, so it must not do that for an account that has since been
 * disabled, lost its token, or turned out to be the staff bot.
 */
function refusalFor(
  account: NonNullable<Awaited<ReturnType<typeof fetchBotAccount>>>,
  env: NodeJS.ProcessEnv
): "ACCOUNT_NOT_USABLE" | "CREDENTIAL_MISSING" | "STAFF_BOT_REFUSED" | null {
  if (
    account.status === "revoked" ||
    account.status === "disabled" ||
    account.status === "deleted" ||
    account.authMode !== "bot_token"
  ) {
    return "ACCOUNT_NOT_USABLE";
  }

  if (!account.tokenSecretId) return "CREDENTIAL_MISSING";

  const staffBotId = staffBotIdFromEnvironment(env);

  if (staffBotId !== null && staffBotId === account.externalId) {
    return "STAFF_BOT_REFUSED";
  }

  return null;
}

export async function rotateBot(
  tx: Bun.SQL,
  tenantId: string,
  actor: string,
  accountId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<RotateOutcome> {
  const account = await fetchBotAccount(tx, tenantId, accountId, {
    lock: true
  });

  if (!account) return { outcome: "not_found" };

  const live = await lockLiveEndpoint(tx, tenantId, accountId);

  if (!live) return { outcome: "not_found" };

  const refusal = refusalFor(account, env);

  if (refusal) return { outcome: "refused", code: refusal };

  // The new `setWebhook` replaces Telegram's one webhook: no deleteWebhook for
  // the old row (it would race the new registration).
  await revokeEndpointRow(tx, tenantId, live, actor, "ROTATED", null);
  await insertEndpoint(tx, tenantId, accountId, actor, live.daily_send_ceiling);

  return {
    outcome: "rotated",
    bot: (await fetchLiveBot(tx, tenantId, accountId))!
  };
}

export type RevokeOutcome =
  { outcome: "revoked"; cancelledMessages: number } | { outcome: "not_found" };

export async function revokeBot(
  tx: Bun.SQL,
  tenantId: string,
  actor: string | null,
  accountId: string,
  reason = "REVOKED_BY_OPERATOR"
): Promise<RevokeOutcome> {
  const live = await lockLiveEndpoint(tx, tenantId, accountId);

  if (!live) return { outcome: "not_found" };

  await revokeEndpointRow(tx, tenantId, live, actor, reason, "delete");

  const cancelledMessages = await cancelQueuedMessages(
    tx,
    tenantId,
    { accountId },
    "ENDPOINT_REVOKED"
  );

  return { outcome: "revoked", cancelledMessages };
}
