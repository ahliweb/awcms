/**
 * Webhook registration (Issue #965, ADR-0140 section 7). `setWebhook` is a
 * deliberate OPERATOR act, run from `bun run telegram:webhook:register`, never at
 * boot and never at runtime. This file is the logic; the script is a thin shell
 * around it so the rules are unit-tested without a network.
 *
 * What it enforces:
 *
 * - The URL is HTTPS, has no credentials, query or fragment, and its path is
 *   exactly `/api/v1/telegram/webhook`. A typo cannot point the bot at some other
 *   route, and the secret is never put in the URL.
 * - `allowed_updates` is `["message"]`: a group that merely contains the bot, a
 *   `my_chat_member` update, an edit or a callback query is not even delivered.
 * - The `secret_token` is `TELEGRAM_WEBHOOK_SECRET`, which Telegram then sends back
 *   in `X-Telegram-Bot-Api-Secret-Token` on every call.
 * - `drop_pending_updates` is NOT set: a re-registration must not silently discard
 *   a staff member's `/start` that was in flight.
 * - Every string printed passes `redactProviderText`, so a failure shows Telegram's
 *   description and never the token (which is in the request path).
 */
import {
  isValidTelegramBotToken,
  isValidTelegramWebhookSecret,
  resolveTelegramSendTimeoutMs
} from "../domain/telegram-config";
import { redactProviderText } from "../domain/telegram-redaction";
import {
  defaultTelegramHttpClient,
  type TelegramHttpClient
} from "./telegram-http-client";

export const TELEGRAM_WEBHOOK_PATH = "/api/v1/telegram/webhook";

export type WebhookRegistrationAction = "set" | "delete";

export type WebhookRegistrationPlan =
  | {
      ok: true;
      action: WebhookRegistrationAction;
      method: "setWebhook" | "deleteWebhook";
      /** The JSON body. Contains the secret token for `set`, so it is never printed. */
      body: string;
      /** A printable description with no secret in it. */
      summary: string;
    }
  | { ok: false; error: string };

export function planWebhookRegistration(input: {
  action: WebhookRegistrationAction;
  url?: string;
  env?: NodeJS.ProcessEnv;
}): WebhookRegistrationPlan {
  const env = input.env ?? process.env;

  if (!isValidTelegramBotToken(env.TELEGRAM_BOT_TOKEN?.trim())) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is missing or malformed." };
  }

  if (input.action === "delete") {
    return {
      ok: true,
      action: "delete",
      method: "deleteWebhook",
      body: JSON.stringify({}),
      summary: "deleteWebhook (pending updates are kept)"
    };
  }

  if (!isValidTelegramWebhookSecret(env.TELEGRAM_WEBHOOK_SECRET)) {
    return {
      ok: false,
      error:
        "TELEGRAM_WEBHOOK_SECRET is missing or weak (43-256 characters from A-Za-z0-9_-, at least 12 distinct, no placeholder word)."
    };
  }

  let url: URL;

  try {
    url = new URL(input.url ?? "");
  } catch {
    return { ok: false, error: "--url must be an absolute https URL." };
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== TELEGRAM_WEBHOOK_PATH
  ) {
    return {
      ok: false,
      error: `--url must be https, without credentials, query or fragment, and end in exactly ${TELEGRAM_WEBHOOK_PATH}.`
    };
  }

  return {
    ok: true,
    action: "set",
    method: "setWebhook",
    body: JSON.stringify({
      url: url.toString(),
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"]
    }),
    summary: `setWebhook host=${url.host} path=${TELEGRAM_WEBHOOK_PATH} allowed_updates=["message"] secret_token=(set)`
  };
}

export type WebhookRegistrationResult =
  { ok: true; message: string } | { ok: false; error: string };

/** Executes a plan. Every returned string is redacted. */
export async function executeWebhookRegistration(
  plan: Extract<WebhookRegistrationPlan, { ok: true }>,
  options: { env?: NodeJS.ProcessEnv; http?: TelegramHttpClient } = {}
): Promise<WebhookRegistrationResult> {
  const env = options.env ?? process.env;
  const token = env.TELEGRAM_BOT_TOKEN!.trim();
  const http = options.http ?? defaultTelegramHttpClient;

  let response: Awaited<ReturnType<TelegramHttpClient>>;

  try {
    response = await http(token, {
      method: plan.method,
      body: plan.body,
      timeoutMs: resolveTelegramSendTimeoutMs(env)
    });
  } catch (error) {
    return {
      ok: false,
      error: redactProviderText(
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : "Unknown error.",
        token
      )
    };
  }

  if (!response.ok) {
    return { ok: false, error: redactProviderText(response.reason, token) };
  }

  let description = "";
  let accepted = false;

  try {
    const parsed = JSON.parse(response.body) as {
      ok?: unknown;
      description?: unknown;
    };

    accepted = parsed.ok === true;
    description =
      typeof parsed.description === "string" ? parsed.description : "";
  } catch {
    // Fall through to the HTTP status.
  }

  if (response.status >= 200 && response.status < 300 && accepted) {
    return {
      ok: true,
      message: redactProviderText(description || "Telegram accepted it.", token)
    };
  }

  return {
    ok: false,
    error: redactProviderText(
      description || `Telegram answered HTTP ${response.status}.`,
      token
    )
  };
}
