/**
 * RFC 8291 "Message Encryption for Web Push" — `aes128gcm` (Issue #466,
 * ADR-0074).
 *
 * This is the highest-risk code in the push program, and it is worth saying why
 * before the first line: a push service does not validate the payload. It
 * forwards ciphertext to a browser, and a browser that cannot decrypt it drops
 * the notification silently. A wrong key schedule therefore produces a system
 * that accepts every message, reports every send as a success, and delivers
 * nothing — with no error anywhere in the chain.
 *
 * So this file is verified against the RFC's OWN worked example (§5 and
 * Appendix A) in `tests/push-web-push-adapter.test.ts`, not merely
 * round-tripped against itself. A round-trip proves the encryptor and the
 * decryptor agree; it cannot notice that both misread the spec the same way,
 * which is exactly the failure mode above.
 *
 * ## Why HKDF is hand-rolled here when `crypto.subtle` has it
 *
 * `crypto.subtle.deriveBits({name:"HKDF", …})` performs extract-then-expand as
 * one opaque operation, so the intermediate values the RFC publishes — PRK_key,
 * IKM, PRK — cannot be observed. Implementing HKDF over `crypto.subtle`'s HMAC
 * (RFC 5869, twenty lines, no invented cryptography) makes every one of those
 * assertable against the RFC's printed vector. Given the failure mode, evidence
 * beats brevity here.
 *
 * ## The shape being built (RFC 8188 §2 + RFC 8291 §4)
 *
 *   body = salt(16) || rs(4, big-endian) || idlen(1) || keyid(65) || ciphertext
 *
 * where `keyid` is the application server's uncompressed P-256 public point,
 * and the plaintext is `payload || 0x02` (the last-record delimiter) before
 * AES-128-GCM.
 */

const ENCODER = new TextEncoder();

/** RFC 8291 §3.4 — the ECDH-derived IKM's info string. */
const WEB_PUSH_INFO_PREFIX = ENCODER.encode("WebPush: info\0");

/** RFC 8188 §2.2 — the content-encryption-key info string. */
const CEK_INFO = ENCODER.encode("Content-Encoding: aes128gcm\0");

/** RFC 8188 §2.3 — the nonce info string. */
const NONCE_INFO = ENCODER.encode("Content-Encoding: nonce\0");

const SALT_LENGTH = 16;
const CEK_LENGTH = 16;
const NONCE_LENGTH = 12;
const UNCOMPRESSED_POINT_LENGTH = 65;

/**
 * Record size. 4096 is what every browser and push service handles, and the
 * payloads here are a title and a body — the multi-record path RFC 8188 allows
 * is deliberately not implemented, and `encryptWebPushPayload` refuses rather
 * than silently truncating if a payload would need it.
 */
export const WEB_PUSH_RECORD_SIZE = 4096;

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");

  return Uint8Array.from(
    Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64")
  );
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

async function hmacSha256(
  key: Uint8Array,
  message: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      message as unknown as ArrayBuffer
    )
  );
}

/** RFC 5869 §2.2. The "salt" is an HMAC KEY here, which is the step most often written backwards. */
export async function hkdfExtract(
  salt: Uint8Array,
  ikm: Uint8Array
): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}

/**
 * RFC 5869 §2.3, restricted to L <= 32 (one HMAC block).
 *
 * Every derivation in RFC 8291 asks for 32, 16, or 12 bytes, so the iteration
 * loop the general algorithm needs would be untested code on a path nothing
 * reaches. It throws rather than silently returning a short key.
 */
export async function hkdfExpand(
  prk: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  if (length > 32) {
    throw new Error(
      "hkdfExpand: only single-block output (<= 32 bytes) is implemented; RFC 8291 never needs more."
    );
  }

  const block = await hmacSha256(prk, concatBytes(info, Uint8Array.of(1)));

  return block.slice(0, length);
}

export type WebPushKeySchedule = {
  /** HKDF-Extract(auth_secret, ecdh_secret) — RFC 8291 Appendix A `PRK_key`. */
  prkKey: Uint8Array;
  /** HKDF-Expand(PRK_key, "WebPush: info"\0 || ua_public || as_public, 32). */
  ikm: Uint8Array;
  /** HKDF-Extract(salt, IKM) — RFC 8188's PRK. */
  prk: Uint8Array;
  cek: Uint8Array;
  nonce: Uint8Array;
};

/**
 * The whole key schedule, exposed as data.
 *
 * Separated from encryption ON PURPOSE: it is the part the RFC publishes
 * intermediate values for, so making it a pure function over bytes is what lets
 * a test assert each one. Fold it into `encryptWebPushPayload` and the only
 * observable output is a ciphertext, which can only be checked as a whole —
 * and when it does not match, nothing says which step was wrong.
 */
export async function deriveWebPushKeys(input: {
  ecdhSecret: Uint8Array;
  authSecret: Uint8Array;
  /** Subscriber's uncompressed P-256 public point (`p256dh`). */
  uaPublicKey: Uint8Array;
  /** This server's ephemeral uncompressed P-256 public point. */
  asPublicKey: Uint8Array;
  salt: Uint8Array;
}): Promise<WebPushKeySchedule> {
  const prkKey = await hkdfExtract(input.authSecret, input.ecdhSecret);
  const keyInfo = concatBytes(
    WEB_PUSH_INFO_PREFIX,
    input.uaPublicKey,
    input.asPublicKey
  );
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const prk = await hkdfExtract(input.salt, ikm);

  return {
    prkKey,
    ikm,
    prk,
    cek: await hkdfExpand(prk, CEK_INFO, CEK_LENGTH),
    nonce: await hkdfExpand(prk, NONCE_INFO, NONCE_LENGTH)
  };
}

export type WebPushSubscriptionKeys = {
  /** `p256dh`, base64url — the subscriber's public key. */
  p256dh: string;
  /** `auth`, base64url — 16 bytes of subscriber-supplied entropy. */
  authSecret: string;
};

export type EncryptWebPushOptions = {
  /** Test seam: the RFC's worked example fixes both, and a real send generates both. */
  salt?: Uint8Array;
  serverKeyPair?: CryptoKeyPair;
};

/**
 * Produces the complete `aes128gcm` body for one subscription.
 *
 * The server key pair is EPHEMERAL per message unless one is injected. That is
 * RFC 8291's design, not an optimisation left undone: reusing one ECDH key pair
 * across messages would make every notification to a given subscriber share a
 * key schedule, so recovering one plaintext would recover them all.
 */
export async function encryptWebPushPayload(
  payload: string,
  keys: WebPushSubscriptionKeys,
  options: EncryptWebPushOptions = {}
): Promise<Uint8Array> {
  const plaintext = ENCODER.encode(payload);

  // header + delimiter + GCM tag must fit one record.
  const maxPayload = WEB_PUSH_RECORD_SIZE - UNCOMPRESSED_POINT_LENGTH - 16 - 21;

  if (plaintext.length > maxPayload) {
    throw new Error(
      `encryptWebPushPayload: payload is ${plaintext.length} bytes; the single-record limit here is ${maxPayload}.`
    );
  }

  const uaPublicKey = base64UrlDecode(keys.p256dh);
  const authSecret = base64UrlDecode(keys.authSecret);

  if (uaPublicKey.length !== UNCOMPRESSED_POINT_LENGTH) {
    throw new Error(
      `encryptWebPushPayload: p256dh must be a ${UNCOMPRESSED_POINT_LENGTH}-byte uncompressed point, got ${uaPublicKey.length}.`
    );
  }

  const salt =
    options.salt ?? crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const serverKeyPair =
    options.serverKeyPair ??
    ((await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    )) as CryptoKeyPair);

  const asPublicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeyPair.publicKey)
  );

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublicKey as unknown as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaKey },
      serverKeyPair.privateKey,
      256
    )
  );

  const schedule = await deriveWebPushKeys({
    ecdhSecret,
    authSecret,
    uaPublicKey,
    asPublicKey,
    salt
  });

  const contentKey = await crypto.subtle.importKey(
    "raw",
    schedule.cek as unknown as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // RFC 8188 §2: the LAST record's plaintext ends with the delimiter 0x02.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: schedule.nonce as unknown as ArrayBuffer },
      contentKey,
      concatBytes(plaintext, Uint8Array.of(2)) as unknown as ArrayBuffer
    )
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, WEB_PUSH_RECORD_SIZE, false);

  return concatBytes(
    salt,
    recordSize,
    Uint8Array.of(asPublicKey.length),
    asPublicKey,
    ciphertext
  );
}

/**
 * Builds a `CryptoKeyPair` from raw base64url key material.
 *
 * `crypto.subtle` cannot import a bare EC private scalar, so the private key is
 * assembled as a JWK whose `x`/`y` come from the public point. That is also a
 * check: a mismatched pair is rejected by the import rather than producing a
 * key schedule the browser silently cannot use.
 */
export async function importEcdhKeyPair(
  publicKeyBase64Url: string,
  privateKeyBase64Url: string,
  usages: KeyUsage[]
): Promise<CryptoKeyPair> {
  const publicBytes = base64UrlDecode(publicKeyBase64Url);

  if (
    publicBytes.length !== UNCOMPRESSED_POINT_LENGTH ||
    publicBytes[0] !== 4
  ) {
    throw new Error(
      "importEcdhKeyPair: public key must be a 65-byte uncompressed P-256 point (0x04 prefix)."
    );
  }

  const namedCurve = "P-256";
  const algorithm = usages.includes("sign")
    ? { name: "ECDSA", namedCurve }
    : { name: "ECDH", namedCurve };

  const jwk = {
    kty: "EC",
    crv: namedCurve,
    x: base64UrlEncode(publicBytes.slice(1, 33)),
    y: base64UrlEncode(publicBytes.slice(33, 65)),
    ext: true
  };

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    algorithm,
    true,
    usages.includes("sign") ? ["verify"] : []
  );

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, d: privateKeyBase64Url },
    algorithm,
    true,
    usages
  );

  return { publicKey, privateKey };
}
