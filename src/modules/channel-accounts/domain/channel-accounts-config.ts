/**
 * Deployment configuration for `channel_accounts` (Issue #1140, ADR-0148 section 5).
 *
 * Two variables, both off/absent by default:
 *
 * - `CHANNEL_ACCOUNTS_ENABLED=true` turns the module's API on for the
 *   deployment. With it unset every route answers `503 CHANNEL_ACCOUNTS_DISABLED`
 *   after authorization, nothing is written and no credential is read. The
 *   module is also off per tenant until Module Management enables it.
 * - `CHANNEL_SECRETS_ENCRYPTION_KEYS` is the key ring that encrypts every stored
 *   credential: `keyId:base64` pairs separated by commas, the FIRST key writes,
 *   ALL keys read, each exactly 32 random bytes. It lives outside the database
 *   and its backups, has no default and no plaintext fallback (fail closed), and
 *   is NOT needed at boot unless the module is enabled.
 *
 * The variable is spelled out in full in `resolveKeyRing`'s argument (not built
 * dynamically) because the env-coverage scanner finds variables by that
 * spelling; a dynamic lookup would drop it from the inventory.
 */
import {
  resolveKeyRing,
  STRICT_KEY_RING_OPTIONS,
  type KeyRingResult
} from "../../../lib/security/field-encryption";
import { resolveDeclaredBaseUrl } from "../../../lib/http/site-origin";

export { isChannelAccountsEnabled } from "./channel-accounts-constants";

/**
 * The secrets key ring (`CHANNEL_SECRETS_ENCRYPTION_KEYS`). Fail closed:
 * `{ ok: false }` means no credential is written or read.
 */
export function resolveChannelSecretsRing(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    "CHANNEL_SECRETS_ENCRYPTION_KEYS",
    { CHANNEL_SECRETS_ENCRYPTION_KEYS: env.CHANNEL_SECRETS_ENCRYPTION_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

/**
 * This deployment's own OAuth callback URI for a provider: always this
 * deployment's origin plus a fixed path, NEVER client-supplied. A client-chosen
 * redirect URI would let an attacker steer the authorization code to a host they
 * control (T1). The provider app is configured to accept exactly this value.
 */
export function resolveChannelOAuthRedirectUri(
  env: NodeJS.ProcessEnv = process.env
): string {
  return new URL(
    "/api/v1/channel-accounts/connections/oauth/callback",
    resolveDeclaredBaseUrl(env)
  ).toString();
}
