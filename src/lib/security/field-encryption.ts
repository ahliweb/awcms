/**
 * Shared field-level encryption and keyed hashing (ADR-0137 sections 2-3, Issue
 * #986). A second consumer (the Telegram chat-id store, ADR-0140) and payroll
 * payout accounts reuse this ONE helper; neither may write its own copy.
 *
 * Unlike the three older `v1` helpers (`mfa-secret-crypto`, `sso-credential-
 * crypto`, `comments/domain/subscriber-crypto`, deliberately untouched so their
 * stored rows stay readable) this one has:
 *
 * - a key id INSIDE the value, so rotation needs no schema change and no
 *   flag-day re-encryption: `v2:<keyId>:<iv>:<tag>:<ciphertext>`, base64url
 *   segments, AES-256-GCM, a fresh 12-byte random IV per encryption;
 * - associated data binding {purpose, tenantId, rowId}, so a ciphertext copied
 *   to another row, tenant or dataset fails authentication;
 * - a key RING: the FIRST key encrypts, ALL keys decrypt;
 * - fail-closed key handling: no default key, and placeholder, short, constant
 *   or duplicate keys are refused.
 *
 * The keys come from an env variable whose NAME the caller supplies, through
 * `resolveKeyRing()`, the seam a future KMS-backed provider replaces without
 * changing the stored format or any caller. Nothing here reads a
 * consumer-specific variable, so nothing is required at boot.
 *
 * Error text never contains key material or plaintext. A decryption failure is
 * a throw, never an empty value: callers treat any throw as "cannot decrypt".
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const MIN_KEY_BYTE_LENGTH = 32;
const ENCRYPTION_KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const TAG_BYTE_LENGTH = 16;
const FORMAT_VERSION = "v2";
const KEY_ID_PATTERN = /^[a-z0-9]{1,8}$/;
const PLACEHOLDER_PATTERN = /change|example|placeholder|secret/i;
const AAD_LABEL = "awcms.field-encryption.v2";
const HASH_LABEL = "awcms.keyed-hash.v1";

export type KeyRingKey = { id: string; key: Buffer };

export type KeyRing = { ok: true; keys: KeyRingKey[] };

export type KeyRingResult = KeyRing | { ok: false; reason: string };

export type FieldEncryptionErrorCode =
  | "KEY_RING_UNAVAILABLE"
  | "INVALID_CONTEXT"
  | "MALFORMED_ENVELOPE"
  | "UNKNOWN_KEY_ID"
  | "AUTHENTICATION_FAILED";

/** The message is a fixed string per code: it can never carry a key or a value. */
export class FieldEncryptionError extends Error {
  readonly code: FieldEncryptionErrorCode;

  constructor(code: FieldEncryptionErrorCode, message: string) {
    super(message);
    this.name = "FieldEncryptionError";
    this.code = code;
  }
}

/**
 * Parses `keyId:base64` pairs separated by commas (`openssl rand -base64 32`
 * per key). Key ids are 1-8 lower-case letters or digits. `envName` only
 * appears in the reason text. Returns `{ ok: false }` rather than throwing so
 * every caller can fail closed.
 */
export type ParseKeyRingOptions = {
  /** Require exactly this many decoded bytes (encryption rings: 32). Default: at least 32. */
  exactBytes?: number;
  /** Require canonical base64: key text must equal its own decode/re-encode (refuses typos, inner whitespace, stray characters). */
  strictBase64?: boolean;
};

/** The options encryption and hash rings use: exactly 32 bytes, canonical base64 (ADR-0137 section 2). */
export const STRICT_KEY_RING_OPTIONS: ParseKeyRingOptions = {
  exactBytes: ENCRYPTION_KEY_BYTE_LENGTH,
  strictBase64: true
};

export function parseKeyRing(
  rawValue: string | undefined,
  envName: string,
  options: ParseKeyRingOptions = {}
): KeyRingResult {
  const raw = rawValue?.trim() ?? "";

  if (raw === "") {
    return { ok: false, reason: `${envName} is not set.` };
  }

  const keys: KeyRingKey[] = [];

  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    const id = entry.slice(0, separator).trim();
    const encoded = entry.slice(separator + 1).trim();

    if (separator < 1 || !KEY_ID_PATTERN.test(id)) {
      return {
        ok: false,
        reason: `${envName} entries must be keyId:base64 with a keyId of 1-8 lower-case letters or digits.`
      };
    }

    const key = Buffer.from(encoded, "base64");

    if (options.strictBase64 && key.toString("base64") !== encoded) {
      return {
        ok: false,
        reason: `${envName} key "${id}" is not canonical base64.`
      };
    }

    // Checked on the encoded text AND on the decoded bytes: a placeholder such
    // as "changeme..." base64-encodes into something that no longer spells it.
    if (
      PLACEHOLDER_PATTERN.test(encoded) ||
      PLACEHOLDER_PATTERN.test(key.toString("latin1"))
    ) {
      return {
        ok: false,
        reason: `${envName} key "${id}" looks like a placeholder.`
      };
    }

    if (
      options.exactBytes !== undefined
        ? key.length !== options.exactBytes
        : key.length < MIN_KEY_BYTE_LENGTH
    ) {
      return {
        ok: false,
        reason:
          options.exactBytes !== undefined
            ? `${envName} key "${id}" must be exactly ${options.exactBytes} random bytes (openssl rand -base64 32).`
            : `${envName} key "${id}" must be at least 32 random bytes (openssl rand -base64 32).`
      };
    }

    if (key.every((byte) => byte === key[0])) {
      return {
        ok: false,
        reason: `${envName} key "${id}" must be at least 32 random bytes (openssl rand -base64 32).`
      };
    }

    if (
      keys.some((existing) => existing.id === id || existing.key.equals(key))
    ) {
      return {
        ok: false,
        reason: `${envName} has a duplicate key id or key.`
      };
    }

    keys.push({ id, key });
  }

  return { ok: true, keys };
}

/**
 * The key-source seam: today the named env variable, later a KMS-backed
 * provider with the same return shape. No default and no fallback. Strict
 * (exactly 32 bytes, canonical base64) unless the caller overrides.
 */
export function resolveKeyRing(
  envName: string,
  env: NodeJS.ProcessEnv = process.env,
  options: ParseKeyRingOptions = STRICT_KEY_RING_OPTIONS
): KeyRingResult {
  return parseKeyRing(env[envName], envName, options);
}

/** What binds a ciphertext or a hash to its place; every field is required. */
export type FieldContext = {
  purpose: string;
  tenantId: string;
  rowId: string;
};

/** Length-prefixed (4-byte big-endian) so no two field tuples encode alike. */
function canonicalEncode(label: string, fields: string[]): Buffer {
  const parts: Buffer[] = [];

  for (const field of [label, ...fields]) {
    const bytes = Buffer.from(field, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }

  return Buffer.concat(parts);
}

function requireNonEmpty(values: string[]): void {
  for (const value of values) {
    if (typeof value !== "string" || value === "") {
      throw new FieldEncryptionError(
        "INVALID_CONTEXT",
        "Field context requires a non-empty purpose, tenant id and row id."
      );
    }
  }
}

function aadFor(context: FieldContext): Buffer {
  requireNonEmpty([context.purpose, context.tenantId, context.rowId]);

  return canonicalEncode(AAD_LABEL, [
    context.purpose,
    context.tenantId,
    context.rowId
  ]);
}

function activeKey(ring: KeyRing): KeyRingKey {
  const key = ring.keys[0];

  if (!key || key.key.length !== ENCRYPTION_KEY_BYTE_LENGTH) {
    throw new FieldEncryptionError(
      "KEY_RING_UNAVAILABLE",
      "No usable encryption key ring."
    );
  }

  return key;
}

/** Encrypts under the FIRST (active) key. Always a fresh IV. */
export function encryptField(
  plaintext: string | Uint8Array,
  context: FieldContext,
  ring: KeyRing
): string {
  const aad = aadFor(context);
  const { id, key } = activeKey(ring);
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const input =
    typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);

  return [
    FORMAT_VERSION,
    id,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

/** Strict base64url: refuses anything that does not re-encode to itself. */
function decodeSegment(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(segment)) {
    throw malformed();
  }

  const bytes = Buffer.from(segment, "base64url");

  if (bytes.toString("base64url") !== segment) {
    throw malformed();
  }

  return bytes;
}

function malformed(): FieldEncryptionError {
  return new FieldEncryptionError(
    "MALFORMED_ENVELOPE",
    "Unrecognized field ciphertext format."
  );
}

/** The key id an envelope was written under, or null if it is not a `v2` envelope. For re-encryption queries. */
export function envelopeKeyId(envelope: string): string | null {
  const parts = envelope.split(":");

  return parts.length === 5 &&
    parts[0] === FORMAT_VERSION &&
    KEY_ID_PATTERN.test(parts[1]!)
    ? parts[1]!
    : null;
}

/**
 * Decrypts with the ring key named in the envelope. Throws a
 * `FieldEncryptionError` on a malformed value, an unknown key id, or any
 * authentication failure (tampered part, wrong row, tenant or purpose).
 */
export function decryptField(
  envelope: string,
  context: FieldContext,
  ring: KeyRing
): Buffer {
  const aad = aadFor(context);
  const parts = typeof envelope === "string" ? envelope.split(":") : [];

  if (parts.length !== 5 || parts[0] !== FORMAT_VERSION) {
    throw malformed();
  }

  const [, keyId, ivPart, tagPart, ciphertextPart] = parts as [
    string,
    string,
    string,
    string,
    string
  ];
  const iv = decodeSegment(ivPart);
  const tag = decodeSegment(tagPart);
  const ciphertext = decodeSegment(ciphertextPart);

  if (
    !KEY_ID_PATTERN.test(keyId) ||
    iv.length !== IV_BYTE_LENGTH ||
    tag.length !== TAG_BYTE_LENGTH
  ) {
    throw malformed();
  }

  const entry = ring.keys.find((candidate) => candidate.id === keyId);

  if (!entry) {
    throw new FieldEncryptionError(
      "UNKNOWN_KEY_ID",
      "Field ciphertext was written under a key that is not in the ring."
    );
  }

  if (entry.key.length !== ENCRYPTION_KEY_BYTE_LENGTH) {
    throw new FieldEncryptionError(
      "KEY_RING_UNAVAILABLE",
      "No usable encryption key ring."
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, entry.key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new FieldEncryptionError(
      "AUTHENTICATION_FAILED",
      "Field ciphertext failed authentication."
    );
  }
}

/** `decryptField` for a value that was encrypted from a string. */
export function decryptFieldToString(
  envelope: string,
  context: FieldContext,
  ring: KeyRing
): string {
  return decryptField(envelope, context, ring).toString("utf8");
}

/** Hash domain: what separates one dataset's, or one tenant's, hashes from another's. */
export type HashDomain = { purpose: string; tenantId: string };

/**
 * `keyId:hex` of `HMAC-SHA256(key, purpose, tenantId, value)` with a
 * length-prefixed encoding, so the same value under another purpose or tenant
 * is unrelated and no field boundary is ambiguous.
 */
export function keyedHash(
  value: string,
  domain: HashDomain,
  key: KeyRingKey
): string {
  requireNonEmpty([domain.purpose, domain.tenantId]);

  if (key.key.length < MIN_KEY_BYTE_LENGTH) {
    throw new FieldEncryptionError(
      "KEY_RING_UNAVAILABLE",
      "No usable hash key ring."
    );
  }

  if (typeof value !== "string") {
    throw new FieldEncryptionError(
      "INVALID_CONTEXT",
      "Keyed hash input must be a string."
    );
  }

  const mac = createHmac("sha256", key.key)
    .update(
      canonicalEncode(HASH_LABEL, [domain.purpose, domain.tenantId, value])
    )
    .digest("hex");

  return `${key.id}:${mac}`;
}

/** The hash a new row is WRITTEN under (the first, active key). */
export function keyedHashPrimary(
  value: string,
  domain: HashDomain,
  ring: KeyRing
): string {
  return keyedHash(value, domain, activeKeyForHash(ring));
}

function activeKeyForHash(ring: KeyRing): KeyRingKey {
  const key = ring.keys[0];

  if (!key || key.key.length < MIN_KEY_BYTE_LENGTH) {
    throw new FieldEncryptionError(
      "KEY_RING_UNAVAILABLE",
      "No usable hash key ring."
    );
  }

  return key;
}

/** Every hash an existing row may carry (one per ring key, active first), for a lookup that must survive rotation. */
export function keyedHashCandidates(
  value: string,
  domain: HashDomain,
  ring: KeyRing
): string[] {
  if (ring.keys.length === 0) {
    throw new FieldEncryptionError(
      "KEY_RING_UNAVAILABLE",
      "No usable hash key ring."
    );
  }

  return ring.keys.map((key) => keyedHash(value, domain, key));
}

/** Constant-time equality of two `keyId:hex` hashes (or any two strings). */
export function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");

  return a.length === b.length && timingSafeEqual(a, b);
}

/** True if `stored` equals any candidate, comparing every candidate in constant time per comparison. */
export function matchesAnyHash(stored: string, candidates: string[]): boolean {
  let matched = false;

  for (const candidate of candidates) {
    if (hashesEqual(stored, candidate)) {
      matched = true;
    }
  }

  return matched;
}
