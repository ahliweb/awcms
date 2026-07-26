/**
 * Authenticated encryption for sensitive URL query parameters (Wave 2 delta
 * auth, ported from awcms-micro). Packs a flat `{name: value}` map into ONE
 * opaque, tamper-evident token so a link carries `?p=<ciphertext>` instead of a
 * structured `?token=…&tenantId=…`. AES-256-GCM with a fresh random 96-bit IV
 * per seal, mirroring `lib/auth/mfa-secret-crypto.ts` and
 * `lib/auth/sso-credential-crypto.ts` exactly (versioned format, fail-closed
 * key resolution, key from env with NO default). Output is base64url and
 * `.`-joined, so it is URL-safe with no percent-encoding.
 *
 * ## Scope — token-bearing private links only
 *
 * Use this for password-reset links and other private hand-offs. Do NOT wrap
 * PUBLIC SEO URLs (`/blog/**`, `feed.xml`, `sitemap-*.xml`): those must stay
 * clean, human-readable and crawlable, and `seo_distribution` builds its
 * `<loc>` values on that assumption.
 *
 * ## Threat model — hardening, not the primary control
 *
 * What it wraps (the reset token) is already a 256-bit CSPRNG value and
 * unguessable on its own. Sealing additionally hides the tenant id, removes the
 * guessable parameter structure, and makes tampering fail closed via the GCM
 * auth tag. When `AUTH_URL_PARAM_ENCRYPTION_KEY` is unset the callers fall back
 * to plain params (the underlying token is unchanged in strength), so enabling
 * this never breaks a deployment — it only tightens one that sets the key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const FORMAT_VERSION = "v1";

/**
 * Decodes and validates `AUTH_URL_PARAM_ENCRYPTION_KEY`. Returns `null` — never
 * throws — when unset or not exactly 32 bytes once base64-decoded, so callers
 * treat "no usable key" as "sealing unavailable" (fall back to plain params)
 * rather than crashing a public page.
 */
export function resolveUrlParamKey(
  env: NodeJS.ProcessEnv = process.env
): Buffer | null {
  const raw = env.AUTH_URL_PARAM_ENCRYPTION_KEY;

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
 * Seals a flat `{name: value}` map into `v1.<iv>.<tag>.<ciphertext>` (all
 * base64url). Returns `null` when no usable key is configured — the caller then
 * falls back to plain query params.
 */
export function sealUrlParams(
  params: Record<string, string>,
  key: Buffer | null = resolveUrlParamKey()
): string | null {
  if (!key) {
    return null;
  }

  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(params), "utf8")),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return [
    FORMAT_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

/**
 * Opens a token produced by `sealUrlParams`. Returns `null` on ANY problem — no
 * key, malformed token, failed authentication (tampering), or a payload that is
 * not a flat string→string object. Callers MUST treat `null` as "invalid link",
 * never as "empty params": the difference is what stops a tampered link from
 * being read as an absent-parameter fallback.
 */
export function openUrlParams(
  sealed: string,
  key: Buffer | null = resolveUrlParamKey()
): Record<string, string> | null {
  if (!key) {
    return null;
  }

  const parts = sealed.split(".");

  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    return null;
  }

  const [, ivPart, tagPart, ciphertextPart] = parts;

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(ivPart!, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagPart!, "base64url"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart!, "base64url")),
      decipher.final()
    ]).toString("utf8");

    const parsed: unknown = JSON.parse(plaintext);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const out: Record<string, string> = {};

    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        return null;
      }

      out[name] = value;
    }

    return out;
  } catch {
    return null;
  }
}
