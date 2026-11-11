/**
 * The opaque per-account webhook CALLBACK TOKEN (Issue #1143, ADR-0148 I9).
 *
 * A provider webhook reaches a public route that has no session. The tenant
 * and the account must be resolved FROM THIS TOKEN, never from the payload:
 * a payload is written by whoever calls the route, and a Meta payload names a
 * WABA and a phone number id that, read alone, would let one tenant's caller
 * aim at another tenant's rows.
 *
 *     wcb1.<tenant uuid>.<subscription uuid>.<43 base64url chars = 256 bits>
 *
 * The two uuids only locate the row (the tenant transaction is opened from the
 * first, exactly as `website_engagement` opens it from its source token); the
 * 256-bit secret is what authenticates, and only its SHA-256 is stored
 * (`awcms_channel_webhook_subscriptions.callback_token_hash`, UNIQUE). A token
 * whose secret does not match finds nothing, and every refusal is the same
 * refusal.
 *
 * Pure: no I/O, no clock, no secret material held here. Shared because the
 * minting module (`channel_accounts`) and the receiving module
 * (`whatsapp_delivery`) must agree on one shape.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const CHANNEL_CALLBACK_TOKEN_PREFIX = "wcb1";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TOKEN_PATTERN = new RegExp(
  `^${CHANNEL_CALLBACK_TOKEN_PREFIX}\\.(${UUID})\\.(${UUID})\\.([A-Za-z0-9_-]{43})$`
);

export type ParsedChannelCallbackToken = {
  tenantId: string;
  subscriptionId: string;
  /** The whole token, as presented. Hashed for the comparison, never logged. */
  raw: string;
};

/** `null` for anything that is not exactly the token shape (bounded, lower-case uuids). */
export function parseChannelCallbackToken(
  raw: unknown
): ParsedChannelCallbackToken | null {
  if (typeof raw !== "string" || raw.length > 160) return null;

  const match = TOKEN_PATTERN.exec(raw);

  if (!match) return null;

  return { tenantId: match[1]!, subscriptionId: match[2]!, raw };
}

export function mintChannelCallbackToken(
  tenantId: string,
  subscriptionId: string
): string {
  return `${CHANNEL_CALLBACK_TOKEN_PREFIX}.${tenantId.toLowerCase()}.${subscriptionId.toLowerCase()}.${randomBytes(32).toString("base64url")}`;
}

/** The stored form: `sha256:<hex>` (the CHECK of `sql/318`). */
export function hashChannelCallbackToken(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

/** Constant-time equality of two stored-form hashes (or of any two strings of equal shape). */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) {
    // Still spend one comparison, so a length mismatch is not a faster answer.
    timingSafeEqual(left, left);

    return false;
  }

  return timingSafeEqual(left, right);
}
