/**
 * Encryption-at-rest for tenant OIDC SSO client secrets (Issue #185, epic
 * ERP-readiness enterprise auth #177). Ported/adapted from awcms-mini
 * `src/lib/auth/sso-credential-crypto.ts` (Issue #591) — identical shape and
 * rationale to sql/024's MFA secret crypto (AES-256-GCM, versioned
 * `v1:<iv>:<tag>:<ciphertext>`, fail-closed key resolution), keyed by a
 * SEPARATE `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY` (distinct from MFA's own key so
 * each key's blast radius stays scoped to the one column it protects,
 * `awcms_auth_providers.client_secret_ciphertext`).
 *
 * Unlike a TOTP seed, an OIDC client secret must be recoverable in full (the
 * provider's token endpoint expects the literal value) — so this is reversible
 * encryption, never a hash. There is no default key by design: a DB backup
 * alone yields no usable secret.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const FORMAT_VERSION = "v1";

/**
 * Decodes and validates `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`. Returns `null`
 * (never throws) if unset or not exactly 32 bytes once base64-decoded, so every
 * caller can fail closed (treat "no usable key" as "cannot encrypt/decrypt this
 * provider's secret") rather than crash.
 */
export function resolveSsoEncryptionKey(
  env: NodeJS.ProcessEnv = process.env
): Buffer | null {
  const raw = env.AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY;

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

/** `v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>` — versioned so the format can evolve without breaking already-encrypted rows. */
export function encryptSsoClientSecret(plaintext: string, key: Buffer): string {
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

/** Throws if `encoded` is malformed, the tag doesn't authenticate, or the version is unrecognized — callers must treat any throw as "cannot decrypt", never as "empty secret". */
export function decryptSsoClientSecret(encoded: string, key: Buffer): string {
  const parts = encoded.split(":");

  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Unrecognized SSO client secret ciphertext format.");
  }

  const [, ivPart, tagPart, ciphertextPart] = parts;
  const iv = Buffer.from(ivPart!, "base64");
  const authTag = Buffer.from(tagPart!, "base64");
  const ciphertext = Buffer.from(ciphertextPart!, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf8");
}
