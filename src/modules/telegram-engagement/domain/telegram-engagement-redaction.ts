/**
 * Redaction for any text that may carry a bot token (ADR-0152 TG11).
 *
 * The Bot API puts the token in the request PATH, so an error, a fetch log line
 * or a provider message that echoes the URL leaks a bearer credential. This
 * module's own copy (it imports nothing from `telegram_delivery`, TG1) strips
 * the exact token when known AND anything shaped like one, so a token rotated
 * since, or one this process never held, is still removed. Long digit runs (a
 * chat or user id) and the callback-token shape are stripped too.
 *
 * Pure module.
 */

/** `bot<id>:<secret>` or a bare `<id>:<secret>`, anywhere in a string. */
const TOKEN_IN_TEXT = /(?:bot)?\d{5,20}:[A-Za-z0-9_-]{30,}/g;

/** Our own callback token shape. */
const CALLBACK_IN_TEXT =
  /tge1\.[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}/g;

/** A Telegram user or chat id echoed in provider text. */
const NUMBER_RUN = /-?\d{6,}/g;

export const REDACTED = "[redacted]";

/** Bot token shape, whole-string (`<id>:<secret>`), as BotFather issues it. */
export const BOT_TOKEN_PATTERN = /^\d{5,20}:[A-Za-z0-9_-]{30,}$/;

export function redactSecrets(text: string, token?: string | null): string {
  let result = text;

  if (token && token.length >= 8) {
    result = result.split(token).join(REDACTED);
  }

  return result
    .replace(TOKEN_IN_TEXT, REDACTED)
    .replace(CALLBACK_IN_TEXT, REDACTED);
}

/** Safe for a log line or a stored diagnostic: no token, no id, bounded. */
export function redactProviderText(
  text: string,
  token?: string | null,
  maxLength = 200
): string {
  return redactSecrets(text, token)
    .replace(NUMBER_RUN, "[number]")
    .slice(0, maxLength);
}

/** For tests and assertions: does `text` still contain anything token-shaped? */
export function containsSecretShape(text: string): boolean {
  return (
    new RegExp(TOKEN_IN_TEXT.source).test(text) ||
    new RegExp(CALLBACK_IN_TEXT.source).test(text)
  );
}

/** The numeric bot id a token begins with, or `null`. Never the secret half. */
export function botIdOfToken(token: string): string | null {
  return BOT_TOKEN_PATTERN.test(token)
    ? token.slice(0, token.indexOf(":"))
    : null;
}
