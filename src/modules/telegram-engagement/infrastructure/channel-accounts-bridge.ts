/**
 * The ONE place `telegram_engagement` reaches into `channel_accounts` (#1140,
 * ADR-0152 section 3, TG2). A customer bot IS a channel account (provider
 * `telegram`, kind `bot`), its token IS that account's `channel_secret`, and who
 * may see or operate it (assignments, business scope, the administrator bypass)
 * is decided by `channel_accounts`, never re-invented here.
 *
 * `channel_accounts` is a hard dependency of this module (`module.ts`): a bot
 * without the account registry has no identity, no token and no owner.
 *
 * Per-caller visibility (assignments, business scope) is in
 * `channel-accounts-access.ts`, imported by the ROUTES only: the dispatcher's
 * import graph must not reach the request-path access chokepoint.
 *
 * ## What leaves this file
 *
 * Metadata, booleans and, from the two `resolve*` functions only, a decrypted
 * secret held in memory by the caller for ONE provider call (the connector job,
 * the dispatcher and the webhook verification). Nothing here returns a secret
 * reference to a route response, and no route file imports this file's
 * `resolve*` functions directly (`tests/telegram-engagement-boundary.test.ts`).
 */
import {
  fetchAccountRecord,
  recordAccountHealth,
  type RecordHealthInput
} from "../../channel-accounts/application/account-directory";
import { resolveCapability } from "../../channel-accounts/application/capability-directory";
import { defaultSecretStore } from "../../channel-accounts/application/secret-store";
import { isChannelAccountsEnabled } from "../../channel-accounts/domain/channel-accounts-constants";
import { resolveChannelSecretsRing } from "../../channel-accounts/domain/channel-accounts-config";
import type { ChannelCapability } from "../../channel-accounts/domain/provider-matrix";
import {
  TELEGRAM_BOT_KIND,
  TELEGRAM_PROVIDER
} from "../domain/telegram-engagement-constants";

export type BotAccount = {
  id: string;
  externalId: string;
  displayName: string;
  status: string;
  authMode: string;
  businessScope: { type: string; id: string } | null;
  /** Internal reference to the bot token secret. Never leaves the module. */
  tokenSecretId: string | null;
};

export function channelAccountsAvailable(): boolean {
  return isChannelAccountsEnabled() && resolveChannelSecretsRing().ok;
}

/** A live telegram bot account of this tenant, or `null` (unknown, foreign, deleted or another kind: one answer). */
export async function fetchBotAccount(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  options: { lock?: boolean } = {}
): Promise<BotAccount | null> {
  const record = await fetchAccountRecord(tx, tenantId, accountId, options);

  if (
    !record ||
    record.provider !== TELEGRAM_PROVIDER ||
    record.accountKind !== TELEGRAM_BOT_KIND
  ) {
    return null;
  }

  return {
    id: record.id,
    externalId: record.externalId,
    displayName: record.displayName,
    status: record.status,
    authMode: record.authMode,
    businessScope: record.businessScope,
    tokenSecretId: record.secretId
  };
}

export async function storeWebhookSeed(
  tx: Bun.SQL,
  input: { tenantId: string; plaintext: string; createdBy: string | null }
): Promise<string> {
  const ref = await defaultSecretStore.put(tx, {
    tenantId: input.tenantId,
    purpose: "webhook_signing_secret",
    plaintext: input.plaintext,
    createdBy: input.createdBy
  });

  return ref.secretId;
}

/** CONNECTOR, DISPATCHER AND WEBHOOK VERIFICATION ONLY. Throws `SecretStoreError`. */
export async function resolveWebhookSeed(
  tx: Bun.SQL,
  tenantId: string,
  secretId: string
): Promise<string> {
  return defaultSecretStore.resolve(tx, {
    tenantId,
    secretId,
    purpose: "webhook_signing_secret"
  });
}

/** CONNECTOR AND DISPATCHER ONLY. Throws `SecretStoreError`. */
export async function resolveBotToken(
  tx: Bun.SQL,
  tenantId: string,
  secretId: string
): Promise<string> {
  return defaultSecretStore.resolve(tx, {
    tenantId,
    secretId,
    purpose: "bot_token"
  });
}

export async function removeSecret(
  tx: Bun.SQL,
  tenantId: string,
  secretId: string
): Promise<void> {
  await defaultSecretStore.remove(tx, tenantId, secretId);
}

export async function recordBotHealth(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  input: RecordHealthInput
): Promise<void> {
  await recordAccountHealth(tx, tenantId, accountId, input);
}

/** Fail-closed per account (ADR-0148 I2): anything but an explicit allow, including a throw, is a denial. */
export async function botCapabilityAllowed(
  tx: Bun.SQL,
  tenantId: string,
  accountId: string,
  capability: ChannelCapability
): Promise<boolean> {
  // Every caller holds a tenant transaction; the savepoint keeps a failed read
  // a denial instead of an abort of the caller's transaction.
  const trx = tx as Bun.TransactionSQL;

  try {
    const verdict = await trx.savepoint((sp) =>
      resolveCapability(sp, tenantId, accountId, capability)
    );

    return verdict.allowed;
  } catch {
    return false;
  }
}
