/**
 * Deployment configuration for `crm_leads` (Issue #1166, ADR-0153 section 5).
 *
 * TWO rings, never one (ADR-0137 section 3):
 *
 *   `CRM_LEADS_ENCRYPTION_KEYS`  AES-256-GCM envelope of every contact point.
 *   `CRM_LEADS_HASH_KEYS`        HMAC key of every per-tenant contact-point hash.
 *
 * A hash key that is also an encryption key would make the keyed hash a
 * function of the key material protecting the ciphertext, so the two rings must
 * share no key. That is enforced HERE, at runtime (the telegram_delivery
 * pattern, Issue #1008 L11), and again by `config:validate`: a deployment
 * started without the validator still refuses to run on overlapping rings.
 *
 * Format of both: `keyId:base64` pairs separated by commas, the FIRST key
 * writes, ALL keys read, each exactly 32 random bytes. No default and no
 * plaintext fallback: without them a contact point can be neither stored nor
 * looked up (fail closed). Spelled out in full in `resolveKeyRing`'s argument
 * because the env-coverage scanner finds variables by that spelling.
 */
import {
  resolveKeyRing,
  STRICT_KEY_RING_OPTIONS,
  type KeyRing,
  type KeyRingResult
} from "../../../lib/security/field-encryption";

/** The encryption ring as the environment spells it, with no distinctness check (the validator words its own problem). */
export function resolveCrmLeadsEncryptionRingUnchecked(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "CRM_LEADS_ENCRYPTION_KEYS",
    { CRM_LEADS_ENCRYPTION_KEYS: env.CRM_LEADS_ENCRYPTION_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

/** The hash ring as the environment spells it, with no distinctness check. */
export function resolveCrmLeadsHashRingUnchecked(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "CRM_LEADS_HASH_KEYS",
    { CRM_LEADS_HASH_KEYS: env.CRM_LEADS_HASH_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

/** True when the two rings share a key. */
export function crmLeadsRingsShareAKey(
  encryption: KeyRingResult,
  hash: KeyRingResult
): boolean {
  return (
    encryption.ok &&
    hash.ok &&
    encryption.keys.some((encryptionKey) =>
      hash.keys.some((hashKey) => hashKey.key.equals(encryptionKey.key))
    )
  );
}

const RINGS_NOT_DISTINCT_REASON =
  "CRM_LEADS_ENCRYPTION_KEYS and CRM_LEADS_HASH_KEYS must not share a key.";

export type CrmLeadsRings = { encryption: KeyRing; hash: KeyRing };

/**
 * Both rings, checked: each must parse and they must share no key. Every code
 * path that encrypts or hashes a contact value goes through this.
 */
export function resolveCrmLeadsRings(
  env: NodeJS.ProcessEnv = process.env
): { ok: true; rings: CrmLeadsRings } | { ok: false; reason: string } {
  const encryption = resolveCrmLeadsEncryptionRingUnchecked(env);
  const hash = resolveCrmLeadsHashRingUnchecked(env);

  if (!encryption.ok) return { ok: false, reason: encryption.reason };
  if (!hash.ok) return { ok: false, reason: hash.reason };

  if (crmLeadsRingsShareAKey(encryption, hash)) {
    return { ok: false, reason: RINGS_NOT_DISTINCT_REASON };
  }

  return { ok: true, rings: { encryption, hash } };
}
