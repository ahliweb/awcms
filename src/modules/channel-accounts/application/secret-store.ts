/**
 * `SecretStorePort` and its first adapter, the application key ring
 * (Issue #1140, ADR-0148 section 5, pack section 6).
 *
 * ## The port, and why it is shaped this way
 *
 * Callers hold an OPAQUE REFERENCE (`secretId`), never a value. The port has
 * exactly one method that returns plaintext, {@link SecretStorePort.resolve}, and
 * it is for the dispatcher and provider adapters of LATER issues, inside the
 * call that needs the credential, for the claimed row's tenant, in memory. No
 * route in `src/pages` imports it (`tests/channel-accounts-secret-handling.test.ts`
 * holds that), so no API response, log line, event, audit row or job payload can
 * be built from a decrypted value by accident.
 *
 * A KMS or vault adapter replaces {@link createKeyRingSecretStore} without
 * changing a caller: the stored reference is the same uuid, and the seam
 * `resolveKeyRing()` already provides is the only thing that changes.
 *
 * ## Fail closed
 *
 * No ring means no write and no read: `KEY_RING_UNAVAILABLE`, never a plaintext
 * fallback, never a default key. A ciphertext that does not authenticate (wrong
 * tenant, wrong row, wrong purpose, a retired key) is `DECRYPT_FAILED`; the error
 * carries a fixed message and never the value or key material.
 *
 * ## Decrypt telemetry (T11)
 *
 * Every resolution is counted per tenant and purpose in process. The counter is
 * the signal a dispatcher run compares against its own expectation; a compromised
 * worker enumerating credentials shows up as a rate nobody scheduled.
 */
import type { KeyRingResult } from "../../../lib/security/field-encryption";
import {
  decryptChannelSecret,
  encryptChannelSecret
} from "../domain/channel-secret-crypto";
import type { ChannelSecretPurpose } from "../domain/channel-accounts-constants";
import { resolveChannelSecretsRing } from "../domain/channel-accounts-config";

export type SecretRef = { secretId: string; version: number; keyId: string };

export type SecretStoreErrorCode =
  "KEY_RING_UNAVAILABLE" | "SECRET_NOT_FOUND" | "DECRYPT_FAILED";

/** The message is a fixed string per code: it can never carry a key or a value. */
export class SecretStoreError extends Error {
  readonly code: SecretStoreErrorCode;

  constructor(code: SecretStoreErrorCode) {
    super(
      code === "KEY_RING_UNAVAILABLE"
        ? "The channel secret key ring is not available."
        : code === "SECRET_NOT_FOUND"
          ? "The channel secret does not exist for this tenant."
          : "The channel secret cannot be decrypted."
    );
    this.name = "SecretStoreError";
    this.code = code;
  }
}

export interface SecretStorePort {
  /** Stores a NEW credential and returns its reference. */
  put(
    tx: Bun.SQL,
    input: {
      tenantId: string;
      purpose: ChannelSecretPurpose;
      plaintext: string;
      createdBy: string | null;
    }
  ): Promise<SecretRef>;

  /** Overwrites an existing credential in place (same reference, version + 1). Returns `null` for an unknown reference. There is no "show". */
  replace(
    tx: Bun.SQL,
    input: {
      tenantId: string;
      secretId: string;
      purpose: ChannelSecretPurpose;
      plaintext: string;
    }
  ): Promise<SecretRef | null>;

  /**
   * Decrypts. FOR DISPATCHERS AND PROVIDER ADAPTERS ONLY, inside the call that
   * needs it. Throws {@link SecretStoreError}.
   */
  resolve(
    tx: Bun.SQL,
    input: {
      tenantId: string;
      secretId: string;
      purpose: ChannelSecretPurpose;
    }
  ): Promise<string>;

  /** Hard-deletes the ciphertext. The caller must already have cleared every reference to it. */
  remove(tx: Bun.SQL, tenantId: string, secretId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Decrypt telemetry
// ---------------------------------------------------------------------------

const decryptCounts = new Map<string, number>();

function countDecrypt(tenantId: string, purpose: string): void {
  const key = `${tenantId}|${purpose}`;

  decryptCounts.set(key, (decryptCounts.get(key) ?? 0) + 1);
}

/** Counts of successful `resolve` calls since the last reset, per tenant and purpose. Counts only; never a value. */
export function snapshotSecretDecryptCounts(): {
  tenantId: string;
  purpose: string;
  count: number;
}[] {
  return [...decryptCounts.entries()].map(([key, count]) => {
    const [tenantId, purpose] = key.split("|") as [string, string];

    return { tenantId, purpose, count };
  });
}

export function resetSecretDecryptCounts(): void {
  decryptCounts.clear();
}

// ---------------------------------------------------------------------------
// The application key-ring adapter
// ---------------------------------------------------------------------------

export function createKeyRingSecretStore(
  ringProvider: () => KeyRingResult
): SecretStorePort {
  function requireRing() {
    const ring = ringProvider();

    if (!ring.ok) throw new SecretStoreError("KEY_RING_UNAVAILABLE");

    return ring;
  }

  return {
    async put(tx, input) {
      const ring = requireRing();
      // The id is chosen BEFORE encrypting because the associated data binds the
      // ciphertext to its own row.
      const secretId = crypto.randomUUID();
      const { ciphertext, keyId } = encryptChannelSecret(
        input.plaintext,
        {
          tenantId: input.tenantId,
          secretId,
          purpose: input.purpose
        },
        ring
      );

      await tx`
        INSERT INTO awcms_channel_secrets
          (id, tenant_id, purpose, ciphertext, key_id, created_by)
        VALUES (${secretId}, ${input.tenantId}, ${input.purpose},
                ${ciphertext}, ${keyId}, ${input.createdBy})
      `;

      return { secretId, version: 1, keyId };
    },

    async replace(tx, input) {
      const ring = requireRing();
      const { ciphertext, keyId } = encryptChannelSecret(
        input.plaintext,
        {
          tenantId: input.tenantId,
          secretId: input.secretId,
          purpose: input.purpose
        },
        ring
      );
      const rows = (await tx`
        UPDATE awcms_channel_secrets
        SET ciphertext = ${ciphertext}, key_id = ${keyId},
            version = version + 1, rotated_at = now(), updated_at = now()
        WHERE tenant_id = ${input.tenantId} AND id = ${input.secretId}
          AND purpose = ${input.purpose}
        RETURNING version
      `) as { version: number }[];

      return rows.length === 0
        ? null
        : { secretId: input.secretId, version: rows[0]!.version, keyId };
    },

    async resolve(tx, input) {
      const ring = requireRing();
      const rows = (await tx`
        SELECT ciphertext FROM awcms_channel_secrets
        WHERE tenant_id = ${input.tenantId} AND id = ${input.secretId}
          AND purpose = ${input.purpose}
      `) as { ciphertext: string }[];

      if (rows.length === 0) throw new SecretStoreError("SECRET_NOT_FOUND");

      let plaintext: string;

      try {
        plaintext = decryptChannelSecret(
          rows[0]!.ciphertext,
          {
            tenantId: input.tenantId,
            secretId: input.secretId,
            purpose: input.purpose
          },
          ring
        );
      } catch {
        throw new SecretStoreError("DECRYPT_FAILED");
      }

      countDecrypt(input.tenantId, input.purpose);

      return plaintext;
    },

    async remove(tx, tenantId, secretId) {
      await tx`
        DELETE FROM awcms_channel_secrets
        WHERE tenant_id = ${tenantId} AND id = ${secretId}
      `;
    }
  };
}

/**
 * The store routes and jobs use: the application key ring from
 * `CHANNEL_SECRETS_ENCRYPTION_KEYS`, re-read on every call so a rotated
 * environment takes effect without a restart of long-lived code.
 */
export const defaultSecretStore: SecretStorePort = createKeyRingSecretStore(
  () => resolveChannelSecretsRing()
);
