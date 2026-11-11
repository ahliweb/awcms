/**
 * Deployment configuration for `crm_leads` (Issue #1166, ADR-0153).
 *
 * `CRM_LEADS_KEYS` is the key ring that encrypts every lead contact point and
 * keys every contact-point hash (the ADR-0137 shape, ADR-0153 section 5):
 * `keyId:base64` pairs separated by commas, the FIRST key writes, ALL keys
 * read, each exactly 32 random bytes. It lives outside the database and its
 * backups and has no default and no plaintext fallback: without it a contact
 * point can be neither stored nor looked up (fail closed). It is spelled out in
 * full in `resolveKeyRing`'s argument because the env-coverage scanner finds
 * variables by that spelling.
 */
import {
  resolveKeyRing,
  STRICT_KEY_RING_OPTIONS,
  type KeyRingResult
} from "../../../lib/security/field-encryption";

export function resolveCrmLeadsRing(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "CRM_LEADS_KEYS",
    { CRM_LEADS_KEYS: env.CRM_LEADS_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}
