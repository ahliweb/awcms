/**
 * At-rest protection for the RFC 8291 per-subscription `auth_secret`
 * (Issue #1089). Pure: no I/O, no `process.env` read at module scope.
 *
 * Mirrors `telegram-delivery/domain/telegram-chat.ts`: the shared ADR-0137
 * helper (`src/lib/security/field-encryption.ts`), its own key ring, and an AAD
 * that binds the ciphertext to its place.
 *
 * ## Why the AAD row id is the `endpoint_hash`, not `id`
 *
 * Registration is an UPSERT on `(tenant_id, endpoint_hash)`. When the device is
 * already registered the surviving row keeps its ORIGINAL `id`, which the caller
 * cannot know before the statement runs, so an `id`-bound ciphertext could not
 * be written in one statement. `endpoint_hash` is known up front, is the row's
 * business key and never changes, so it binds identity just as well: moved to
 * another row or another tenant, the ciphertext fails to authenticate.
 *
 * The plaintext secret exists in memory only: the registration handler handing
 * it to `encryptPushAuthSecret`, and the dispatcher handing a decrypted one to
 * the Web Push adapter. It reaches no log, audit row, event or response.
 */
import {
  decryptFieldToString,
  encryptField,
  resolveKeyRing,
  STRICT_KEY_RING_OPTIONS,
  type KeyRing,
  type KeyRingResult
} from "../../../lib/security/field-encryption";

export const PUSH_AUTH_SECRET_ENCRYPTION_PURPOSE =
  "push_delivery.subscription_auth_secret";

export const PUSH_AUTH_SECRET_KEYS_ENV = "PUSH_AUTH_SECRET_ENCRYPTION_KEYS";

/**
 * The auth-secret encryption ring. Its own ring, separate from every other one.
 * Fail closed: `{ ok: false }` means no `web_push` subscription is registered
 * and the dispatcher refuses to deliver a ciphertext row.
 */
export function resolvePushAuthSecretRing(
  env: NodeJS.ProcessEnv = process.env
): KeyRingResult {
  return resolveKeyRing(
    PUSH_AUTH_SECRET_KEYS_ENV,
    { PUSH_AUTH_SECRET_ENCRYPTION_KEYS: env.PUSH_AUTH_SECRET_ENCRYPTION_KEYS },
    STRICT_KEY_RING_OPTIONS
  );
}

export function encryptPushAuthSecret(
  authSecret: string,
  tenantId: string,
  endpointHash: string,
  ring: KeyRing
): string {
  return encryptField(
    authSecret,
    {
      purpose: PUSH_AUTH_SECRET_ENCRYPTION_PURPOSE,
      tenantId,
      rowId: endpointHash
    },
    ring
  );
}

/** Throws a `FieldEncryptionError` on any failure; callers treat a throw as "cannot decrypt" and never fall back to anything. */
export function decryptPushAuthSecret(
  ciphertext: string,
  tenantId: string,
  endpointHash: string,
  ring: KeyRing
): string {
  return decryptFieldToString(
    ciphertext,
    {
      purpose: PUSH_AUTH_SECRET_ENCRYPTION_PURPOSE,
      tenantId,
      rowId: endpointHash
    },
    ring
  );
}

/**
 * Thrown when a subscription's auth secret cannot be produced for delivery.
 * `retryable` is true only when the cause is configuration an operator can fix
 * (no ring, or the ring lacks the key the row was written under).
 * The message never carries key material or the secret.
 */
export class PushAuthSecretError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "PushAuthSecretError";
    this.retryable = retryable;
  }
}
