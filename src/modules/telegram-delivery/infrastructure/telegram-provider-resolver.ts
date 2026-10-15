/**
 * Production resolver (Issue #965) — mirrors `whatsapp-provider-resolver.ts`:
 * builds the `TelegramProvider` from configuration and DEGRADES to a
 * failed-result provider on misconfiguration rather than throwing, so one
 * misconfigured deployment cannot crash the dispatcher. The degraded provider
 * returns `retryable: false`: a missing or malformed token will not fix itself
 * between passes, and retrying would burn every queued row's budget against a
 * condition only an operator can change. It never echoes the configured value.
 */
import {
  isValidTelegramBotToken,
  resolveTelegramGlobalPerSecond,
  resolveTelegramRetryAfterCapSeconds,
  resolveTelegramSendTimeoutMs
} from "../domain/telegram-config";
import type { TelegramProvider } from "../domain/telegram-provider-contract";
import { createTelegramBotProvider } from "./telegram-bot-provider";

function createMisconfiguredProvider(reason: string): TelegramProvider {
  return {
    async send() {
      return {
        ok: false,
        error: reason,
        retryable: false,
        failureCode: "misconfigured"
      };
    },
    async healthCheck() {
      return { ok: false, error: reason };
    }
  };
}

/**
 * One adapter instance per distinct configuration, shared by every tenant a
 * dispatch run drains. The global rate pacer and the `429` pause live INSIDE the
 * adapter, and the ceiling is per bot (per deployment), not per tenant: a fresh
 * adapter per tenant would reset both and let N tenants send at N times the
 * ceiling.
 */
let cached: { key: string; provider: TelegramProvider } | undefined;

export function resetTelegramProviderForTests(): void {
  cached = undefined;
}

export function resolveTelegramProvider(
  env: NodeJS.ProcessEnv = process.env
): TelegramProvider {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();

  if (!isValidTelegramBotToken(token)) {
    return createMisconfiguredProvider(
      "TELEGRAM_BOT_TOKEN is missing or is not a Telegram bot token."
    );
  }

  const timeoutMs = resolveTelegramSendTimeoutMs(env);
  const minSendIntervalMs = Math.ceil(
    1000 / resolveTelegramGlobalPerSecond(env)
  );
  const retryAfterCapSeconds = resolveTelegramRetryAfterCapSeconds(env);
  const key = [token, timeoutMs, minSendIntervalMs, retryAfterCapSeconds].join(
    "|"
  );

  if (cached?.key !== key) {
    cached = {
      key,
      provider: createTelegramBotProvider({
        token,
        timeoutMs,
        minSendIntervalMs,
        retryAfterCapSeconds
      })
    };
  }

  return cached.provider;
}
