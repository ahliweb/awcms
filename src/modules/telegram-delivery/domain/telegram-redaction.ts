/**
 * Redaction for text that may carry the bot token (Issue #965, ADR-0140 section
 * 5.2). Pure.
 *
 * The Bot API puts the token in the URL path
 * (`https://api.telegram.org/bot<token>/<method>`), so any error, fetch log line,
 * breaker record or provider-detail string that echoes the URL leaks a bearer
 * credential. Redaction therefore runs at the ONE place text leaves the adapter
 * (`redactProviderText`), on BOTH the exact configured token and the general
 * token shape, so a token that was rotated since the process started, or never
 * configured here, is still removed.
 */
/** `bot<id>:<secret>` or a bare `<id>:<secret>`, anywhere in a string. */
const TOKEN_IN_TEXT = /(?:bot)?\d{5,15}:[A-Za-z0-9_-]{30,}/g;

/** Chat ids are 6+ digit numbers (negative for groups); provider text may echo one. */
const NUMBER_RUN = /-?\d{6,}/g;

export const REDACTED_TOKEN = "[redacted-token]";

/** Removes the exact token (if known) and anything shaped like one. */
export function redactBotToken(text: string, token?: string): string {
  let result = text;

  if (token && token.length >= 8) {
    result = result.split(token).join(REDACTED_TOKEN);
  }

  return result.replace(TOKEN_IN_TEXT, REDACTED_TOKEN);
}

/**
 * Provider text is stored, logged and shown to operators. Strips the token and
 * long number runs (a chat id), then caps the length. The result is safe to put
 * in `last_error`, an attempt row or a log line.
 */
export function redactProviderText(
  text: string,
  token?: string,
  maxLength = 300
): string {
  return redactBotToken(text, token)
    .replace(NUMBER_RUN, "[number]")
    .slice(0, maxLength);
}

/** True when `text` still contains something shaped like a bot token. For tests and assertions. */
export function containsBotToken(text: string): boolean {
  return new RegExp(TOKEN_IN_TEXT.source).test(text);
}
