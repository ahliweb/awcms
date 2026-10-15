/**
 * What the deployment has configured, as BOOLEANS only (Issue #965). For the
 * diagnostics endpoint and the admin screen: an operator staring at a queue that
 * is not draining needs to know which of the five required settings is missing,
 * and must never be shown a value. No token, secret or key is read into the
 * return value, only whether it is present and well-formed.
 */
import {
  isTelegramEnabled,
  isValidTelegramBotToken,
  isValidTelegramWebhookSecret,
  resolveTelegramBotUsername,
  resolveTelegramEncryptionRing,
  resolveTelegramHashRing
} from "./telegram-config";

export type TelegramDeploymentStatus = {
  enabled: boolean;
  botTokenConfigured: boolean;
  botUsernameConfigured: boolean;
  webhookSecretConfigured: boolean;
  encryptionKeysConfigured: boolean;
  hashKeysConfigured: boolean;
  /** Everything a working deployment needs is present. */
  ready: boolean;
};

export function describeTelegramDeployment(
  env: NodeJS.ProcessEnv = process.env
): TelegramDeploymentStatus {
  const botTokenConfigured = isValidTelegramBotToken(
    env.TELEGRAM_BOT_TOKEN?.trim()
  );
  const botUsernameConfigured = resolveTelegramBotUsername(env) !== undefined;
  const webhookSecretConfigured = isValidTelegramWebhookSecret(
    env.TELEGRAM_WEBHOOK_SECRET
  );
  const encryptionKeysConfigured = resolveTelegramEncryptionRing(env).ok;
  const hashKeysConfigured = resolveTelegramHashRing(env).ok;
  const enabled = isTelegramEnabled(env);

  return {
    enabled,
    botTokenConfigured,
    botUsernameConfigured,
    webhookSecretConfigured,
    encryptionKeysConfigured,
    hashKeysConfigured,
    ready:
      enabled &&
      botTokenConfigured &&
      botUsernameConfigured &&
      webhookSecretConfigured &&
      encryptionKeysConfigured &&
      hashKeysConfigured
  };
}
