/**
 * Human/bot classification (ported from awcms-micro epic #617-#624). Pure —
 * combines `user-agent.ts`'s parse result with whether the request is on an
 * authenticated session to decide the `human_status`/`is_human` values
 * migration 050's tables expect.
 *
 * BINDING (repeated from `user-agent.ts`): this classification is for
 * ANALYTICS ONLY — never wire its output into an authorization, rate-limit,
 * or security decision. A spoofed UA trivially defeats it, and that is an
 * acceptable trade-off for analytics but not for access control.
 */
import type { ParsedUserAgent } from "./user-agent";

/** Matches `awcms_visit_events.human_status`'s CHECK constraint exactly. */
export type HumanStatus = "human" | "bot" | "unknown";

export type ClassifyHumanInput = {
  isAuthenticated: boolean;
  parsedUserAgent: ParsedUserAgent;
};

/**
 * `bot` wins regardless of authentication (a clearly-bot UA is never
 * reclassified as human just because it presented a valid session). An
 * authenticated session with a non-bot but unparseable UA is still `human`.
 * Everything else with an unrecognized device type is `unknown`, never
 * defaulted to `human` — unknown/ambiguous user-agents must not be blindly
 * trusted.
 */
export function classifyHumanStatus(input: ClassifyHumanInput): HumanStatus {
  const { isAuthenticated, parsedUserAgent } = input;

  if (parsedUserAgent.isBot) return "bot";
  if (isAuthenticated) return "human";
  if (parsedUserAgent.deviceType === "unknown") return "unknown";
  return "human";
}

export type ClassifySessionHumanityInput = {
  isAuthenticated: boolean;
  parsedUserAgent: ParsedUserAgent;
};

export type SessionHumanity = {
  isHuman: boolean;
  botReason: string | null;
};

/**
 * `awcms_visitor_sessions.is_human` is a plain boolean (no `unknown`
 * tri-state, and defaults `true`) — an unparseable/unknown UA on a session
 * stays `is_human: true` unless the UA is clearly a bot, matching the
 * table's own privacy-first default rather than inventing a third state the
 * schema has no column for.
 */
export function classifySessionHumanity(
  input: ClassifySessionHumanityInput
): SessionHumanity {
  const { parsedUserAgent } = input;

  return {
    isHuman: !parsedUserAgent.isBot,
    botReason: parsedUserAgent.isBot ? parsedUserAgent.botReason : null
  };
}
