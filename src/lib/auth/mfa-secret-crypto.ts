/**
 * Encryption-at-rest for TOTP secrets (Issue #184). Ported from awcms-mini
 * `src/lib/auth/mfa-secret-crypto.ts` (Issue #589). Unlike every other secret
 * this repo hashes one-way (session tokens, recovery codes — see
 * `session-token.ts`/`mfa-recovery-code.ts`), a TOTP secret must be
 * *recoverable* to compute the expected code at verification time, so it is
 * encrypted (reversible), not hashed. AES-256-GCM keyed by
 * `AUTH_MFA_SECRET_ENCRYPTION_KEY` (base64-encoded 32 random bytes, e.g.
 * `openssl rand -base64 32`) — an authenticated cipher, so tampering with the
 * stored ciphertext is detected (`decryptMfaSecret` throws) rather than
 * silently producing garbage.
 *
 * There is NO default key by design: a missing/invalid key yields `null` from
 * `resolveMfaEncryptionKey`, and every caller then fails closed
 * (`MFA_MISCONFIGURED`). A database backup alone therefore never yields a
 * usable TOTP secret without the separately-held encryption key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const FORMAT_VERSION = "v1";

/**
 * Decodes and validates `AUTH_MFA_SECRET_ENCRYPTION_KEY` from env. Returns
 * `null` — never throws — if unset or not exactly 32 bytes once
 * base64-decoded, so every caller can fail closed (treat "no usable key" as
 * "cannot verify/encrypt") rather than crash.
 */
export function resolveMfaEncryptionKey(
  env: NodeJS.ProcessEnv = process.env
): Buffer | null {
  const raw = env.AUTH_MFA_SECRET_ENCRYPTION_KEY;

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
export function encryptMfaSecret(plaintext: Buffer, key: Buffer): string {
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64")
  ].join(":");
}

/** Throws if `encoded` is malformed, the tag doesn't authenticate, or the version is unrecognized — callers must treat any throw as "cannot decrypt", never as "empty secret". */
export function decryptMfaSecret(encoded: string, key: Buffer): Buffer {
  const parts = encoded.split(":");

  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Unrecognized MFA secret ciphertext format.");
  }

  const [, ivPart, tagPart, ciphertextPart] = parts;
  const iv = Buffer.from(ivPart!, "base64");
  const authTag = Buffer.from(tagPart!, "base64");
  const ciphertext = Buffer.from(ciphertextPart!, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
