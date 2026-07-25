/**
 * Encryption-at-rest for reply-notification subscriber addresses (ADR-0041,
 * ported from awcms-micro Issue #271). Identical shape and rationale to
 * `lib/auth/sso-credential-crypto.ts` and `lib/auth/mfa-secret-crypto.ts`:
 * AES-256-GCM, versioned `v1:<iv>:<tag>:<ciphertext>`, fail-closed key
 * resolution that returns `null` rather than throwing.
 *
 * Keyed by a SEPARATE `COMMENTS_SUBSCRIBER_ENCRYPTION_KEY` so its blast radius
 * stays scoped to the one column it protects,
 * `awcms_comments_reply_subscriptions.subscriber_email_encrypted`. Sharing the
 * SSO or MFA key would mean one compromised key exposes three unrelated
 * datasets.
 *
 * The recipient address must be RECOVERABLE — the email dispatcher needs the
 * literal value to send — so this is reversible encryption, never a hash. It is
 * never exposed in an API response, a domain event, or a log line; only the
 * dispatcher decrypts it, at send time.
 *
 * When no usable key is configured (the default on offline/LAN),
 * `encryptSubscriberEmail` returns `null` and the caller stores
 * `UNRESOLVABLE_SUBSCRIBER_REF`. Reply-notify then degrades to "cannot notify"
 * — provider-optional per ADR-0006 — which is the correct failure: a plaintext
 * address on disk would be strictly worse than a missing notification.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const FORMAT_VERSION = "v1";

export const SUBSCRIBER_ENCRYPTION_KEY_ENV =
  "COMMENTS_SUBSCRIBER_ENCRYPTION_KEY";

/** Sentinel stored when no encryption key is configured — never resolvable to an address. */
export const UNRESOLVABLE_SUBSCRIBER_REF = "unresolvable";

/**
 * Decodes and validates `COMMENTS_SUBSCRIBER_ENCRYPTION_KEY`. Returns `null`
 * (never throws) if unset or not exactly 32 bytes once base64-decoded, so every
 * caller can fail closed rather than crash a public request path.
 */
export function resolveSubscriberEncryptionKey(
  env: NodeJS.ProcessEnv = process.env
): Buffer | null {
  const raw = env[SUBSCRIBER_ENCRYPTION_KEY_ENV];

  if (!raw) {
    return null;
  }

  let key: Buffer;

  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return null;
  }

  return key.length === KEY_BYTE_LENGTH ? key : null;
}

/**
 * `v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>` — versioned so the
 * format can evolve without breaking already-encrypted rows. Returns `null`
 * when no usable key is configured; the caller stores
 * `UNRESOLVABLE_SUBSCRIBER_REF` instead.
 */
export function encryptSubscriberEmail(
  plaintext: string,
  key: Buffer | null
): string | null {
  if (!key) return null;

  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64")
  ].join(":");
}

/**
 * Throws if `encoded` is malformed, the tag doesn't authenticate, or the version
 * is unrecognized — callers must treat any throw as "cannot decrypt, skip this
 * notification", never as "empty address".
 */
export function decryptSubscriberEmail(encoded: string, key: Buffer): string {
  const parts = encoded.split(":");

  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Unrecognized subscriber email ciphertext format.");
  }

  const [, ivPart, tagPart, ciphertextPart] = parts as [
    string,
    string,
    string,
    string
  ];

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivPart, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64")),
    decipher.final()
  ]).toString("utf8");
}
