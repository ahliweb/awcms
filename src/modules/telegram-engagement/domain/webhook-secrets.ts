/**
 * The per-bot webhook material (ADR-0152 sections 3 and 4, TG3).
 *
 * ## One stored secret, two derived values
 *
 * A bot endpoint stores ONE random seed (32 bytes, base64url) as a
 * `channel_secret` (purpose `webhook_signing_secret`). Two values Telegram needs
 * are DERIVED from it with independent HMAC labels:
 *
 *   - the callback path secret, the opaque half of the webhook URL, of which
 *     only the SHA-256 is stored (`callback_hash`);
 *   - the `secret_token` that `setWebhook` registers and Telegram echoes as
 *     `X-Telegram-Bot-Api-Secret-Token` on every update.
 *
 * Because the two are separate HMACs of the seed, someone who learns the URL
 * (a proxy log, a misconfigured monitor) still cannot forge the header, and the
 * connector job can rebuild both from the one encrypted seed without the
 * database ever holding either in a recoverable form. Rotation replaces the seed
 * (a new endpoint row): the old URL and the old header both die with it.
 *
 * ## The callback token names where to look, never what to trust
 *
 * `tge1.<tenantId>.<endpointId>.<pathSecret>`: the website-engagement precedent
 * (ADR-0155). The route opens the NAMED tenant's context and proves the path
 * secret against the stored hash there, then the header against the seed. The
 * ids are not secrets and select nothing on their own: a token that names the
 * wrong tenant finds no row. Nothing in the update body selects a tenant, a bot
 * or a scope.
 *
 * Pure module: no database, no I/O.
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** base64url of 32 bytes (43 chars), the HMAC-SHA256 output encoding below. */
const PATH_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const CALLBACK_URL_SCHEME_TAG = "tge1";

/** Bound before any parsing: an anonymous route must not split an arbitrary string. */
export const MAX_CALLBACK_TOKEN_LENGTH = 140;

/**
 * Telegram accepts a `secret_token` of 1 to 256 characters from `A-Z a-z 0-9 _ -`
 * (to verify against the documentation in force). base64url of 32 bytes is 43
 * such characters.
 */
export const SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export type ParsedCallbackToken = {
  tenantId: string;
  endpointId: string;
  pathSecret: string;
};

/** A fresh random seed: 256 bits, base64url. The ONLY value stored (encrypted). */
export function generateWebhookSeed(): string {
  return randomBytes(32).toString("base64url");
}

function derive(seed: string, label: string): string {
  return createHmac("sha256", Buffer.from(seed, "utf8"))
    .update(`telegram_engagement:webhook:${label}:v1`, "utf8")
    .digest("base64url");
}

export function derivePathSecret(seed: string): string {
  return derive(seed, "path");
}

export function deriveHeaderSecret(seed: string): string {
  return derive(seed, "header");
}

/** `sha256:<hex>` of the path secret: what the endpoint row stores. */
export function hashPathSecret(pathSecret: string): string {
  return `sha256:${createHash("sha256").update(pathSecret, "utf8").digest("hex")}`;
}

export function formatCallbackToken(
  tenantId: string,
  endpointId: string,
  pathSecret: string
): string {
  return [CALLBACK_URL_SCHEME_TAG, tenantId, endpointId, pathSecret].join(".");
}

/** `null` for anything that is not exactly the shape: no partial parse, no echo. */
export function parseCallbackToken(
  raw: string | undefined | null
): ParsedCallbackToken | null {
  if (typeof raw !== "string" || raw.length > MAX_CALLBACK_TOKEN_LENGTH) {
    return null;
  }

  const parts = raw.split(".");

  if (parts.length !== 4 || parts[0] !== CALLBACK_URL_SCHEME_TAG) return null;

  const [, tenantId, endpointId, pathSecret] = parts as [
    string,
    string,
    string,
    string
  ];

  if (
    !UUID_PATTERN.test(tenantId) ||
    !UUID_PATTERN.test(endpointId) ||
    !PATH_SECRET_PATTERN.test(pathSecret)
  ) {
    return null;
  }

  return { tenantId, endpointId, pathSecret };
}

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

/**
 * Constant-time comparison of two strings through their SHA-256 digests, so
 * neither the value nor its length can be timed out of the response. Both
 * digests are ALWAYS computed, whatever the input; a `null` presented value
 * never matches.
 */
export function constantTimeEquals(
  presented: string | null | undefined,
  expected: string
): boolean {
  const equal = timingSafeEqual(digest(presented ?? ""), digest(expected));

  return typeof presented === "string" && presented.length > 0 && equal;
}

/** The webhook URL for an endpoint. The token lives in the PATH, never a query string. */
export function buildWebhookUrl(origin: string, callbackToken: string): string {
  return `${origin}/api/v1/telegram-engagement/webhooks/${callbackToken}`;
}
