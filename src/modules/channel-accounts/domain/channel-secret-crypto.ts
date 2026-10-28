/**
 * Envelope encryption for channel credentials (Issue #1140, ADR-0148 section 5).
 *
 * ONE place a channel credential is encrypted or decrypted, through the shared
 * ADR-0137 helper (`src/lib/security/field-encryption.ts`; this is not a second
 * copy of it). Pure: no I/O.
 *
 * The associated data binds `{purpose, tenantId, secretId}`, where the purpose
 * carries this module's own prefix AND the secret's kind: a ciphertext copied to
 * another row, another tenant, or relabelled as a different kind of credential
 * fails authentication. A failure is a throw, never an empty value; callers
 * treat any throw as "cannot decrypt" and never fall back to anything.
 */
import {
  decryptFieldToString,
  encryptField,
  envelopeKeyId,
  type KeyRing
} from "../../../lib/security/field-encryption";
import {
  CHANNEL_SECRET_AAD_PURPOSE_PREFIX,
  type ChannelSecretPurpose
} from "./channel-accounts-constants";

export type ChannelSecretContext = {
  tenantId: string;
  secretId: string;
  purpose: ChannelSecretPurpose;
};

function fieldContext(context: ChannelSecretContext) {
  return {
    purpose: `${CHANNEL_SECRET_AAD_PURPOSE_PREFIX}${context.purpose}`,
    tenantId: context.tenantId,
    rowId: context.secretId
  };
}

export function encryptChannelSecret(
  plaintext: string,
  context: ChannelSecretContext,
  ring: KeyRing
): { ciphertext: string; keyId: string } {
  const ciphertext = encryptField(plaintext, fieldContext(context), ring);
  const keyId = envelopeKeyId(ciphertext);

  if (keyId === null) {
    // Cannot happen with a well-formed ring; fail closed rather than store a
    // value the re-encrypt job could not classify.
    throw new Error("channel secret envelope has no key id");
  }

  return { ciphertext, keyId };
}

/** Throws a `FieldEncryptionError` on any failure. */
export function decryptChannelSecret(
  ciphertext: string,
  context: ChannelSecretContext,
  ring: KeyRing
): string {
  return decryptFieldToString(ciphertext, fieldContext(context), ring);
}
