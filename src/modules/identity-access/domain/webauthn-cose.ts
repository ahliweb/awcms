/**
 * COSE public keys and signature verification for passkeys (ADR-0168 A6.7,
 * A6.8, A10/G1). Pure apart from calling the runtime's own crypto: there is no
 * curve or big-integer arithmetic here, only shape checks and `node:crypto`.
 *
 * Three algorithms, each bound to exactly one key type:
 *
 * | alg  | name  | kty      | crv / size                 |
 * | ---- | ----- | -------- | -------------------------- |
 * | -7   | ES256 | EC2 (2)  | P-256 (1), x and y 32 B    |
 * | -8   | EdDSA | OKP (1)  | Ed25519 (6) only, x 32 B   |
 * | -257 | RS256 | RSA (3)  | n 2048-4096 bit, e = 65537 |
 *
 * Off-curve EC points are refused by the runtime when the key is imported
 * (proved by a test). ECDSA signatures are DER and are handed to
 * `node:crypto` with `dsaEncoding: "der"`, whose parser is strict about
 * non-canonical encodings, zero or out-of-range `r`/`s` and trailing bytes —
 * proved against the Wycheproof vectors, including the CVE-2022-21449 class.
 */
import {
  constants,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from "node:crypto";
import { decodeCbor, type CborMap, type CborValue } from "./webauthn-cbor";

export type CoseAlgorithm = -7 | -8 | -257;
export const COSE_ALGORITHMS: readonly CoseAlgorithm[] = [-7, -8, -257];

export interface CosePublicKey {
  alg: CoseAlgorithm;
  key: KeyObject;
}

export class CoseError extends Error {}

function fail(message: string): never {
  throw new CoseError(message);
}

function int(map: CborMap, label: number): number {
  const value = map.get(label);
  if (typeof value !== "number") fail(`label ${label} must be an integer`);
  return value;
}

function bytes(map: CborMap, label: number, length?: number): Uint8Array {
  const value = map.get(label);
  if (!(value instanceof Uint8Array)) fail(`label ${label} must be bytes`);
  if (length !== undefined && value.length !== length)
    fail(`label ${label} length`);
  return value;
}

const b64u = (value: Uint8Array) => Buffer.from(value).toString("base64url");

/**
 * Ed25519 public keys of small order (the identity, the points of order 2, 4
 * and 8), written with the sign bit (bit 255) CLEARED. Signatures under them
 * prove nothing: under the identity, R = basepoint and S = 1 verifies for
 * every message. Matched after masking the sign bit, so each entry also covers
 * its sign-bit twin. Constant comparison, no curve math (G1).
 *
 * This list alone is NOT enough: the runtime (BoringSSL) also accepts a
 * NON-CANONICAL y (y >= p), and y = p + 1 decodes to the identity, y = p to a
 * point of order 4. Wycheproof only carries the canonical encodings, so it
 * never exercised that. {@link isNonCanonicalEd25519} runs first (#1456 G7 H1).
 */
const ED25519_SMALL_ORDER = new Set([
  "0100000000000000000000000000000000000000000000000000000000000000", // identity (y = 1)
  "0000000000000000000000000000000000000000000000000000000000000000", // y = 0, order 4
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f", // y = p - 1, order 2
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a", // order 8
  "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05" // order 8
]);

/**
 * True when the little-endian y in an Ed25519 public key is >= p = 2^255 - 19
 * once the sign bit is masked: byte 31 is 0x7f (masked), bytes 1-30 are 0xff
 * and byte 0 is >= 0xed. RFC 8032 §5.1.3 says to reject such a point; the
 * runtime does not, so we do. Byte comparisons only.
 */
export function isNonCanonicalEd25519(x: Uint8Array): boolean {
  if (x.length !== 32 || ((x[31] as number) & 0x7f) !== 0x7f) return false;
  for (let i = 1; i < 31; i++) if (x[i] !== 0xff) return false;
  return (x[0] as number) >= 0xed;
}

function isSmallOrderEd25519(x: Uint8Array): boolean {
  const masked = Uint8Array.from(x);
  masked[31] = (masked[31] as number) & 0x7f;
  return ED25519_SMALL_ORDER.has(Buffer.from(masked).toString("hex"));
}

/**
 * Parses a COSE_Key — either raw bytes holding exactly one CBOR map, or a map
 * already decoded from authenticator data — and imports it. `alg` decides the
 * key type; a key whose `kty`/`crv` disagrees with its `alg` is refused, as is
 * any algorithm outside {@link COSE_ALGORITHMS}.
 */
export function parseCoseKey(input: Uint8Array | CborValue): CosePublicKey {
  const map = input instanceof Uint8Array ? decodeCbor(input) : input;
  if (!(map instanceof Map)) fail("COSE key must be a map");
  const alg = int(map, 3);
  const kty = int(map, 1);
  try {
    if (alg === -7) {
      if (kty !== 2 || int(map, -1) !== 1) fail("ES256 needs EC2 P-256");
      const x = bytes(map, -2, 32);
      const y = bytes(map, -3, 32);
      const jwk = { kty: "EC", crv: "P-256", x: b64u(x), y: b64u(y) };
      return { alg, key: createPublicKey({ key: jwk, format: "jwk" }) };
    }
    if (alg === -8) {
      if (kty !== 1 || int(map, -1) !== 6) fail("EdDSA needs OKP Ed25519");
      const x = bytes(map, -2, 32);
      // Non-canonical first: y = p + 1 IS the identity, but its bytes are not
      // in the small-order list.
      if (isNonCanonicalEd25519(x)) fail("non-canonical key");
      if (isSmallOrderEd25519(x)) fail("small-order key");
      const jwk = { kty: "OKP", crv: "Ed25519", x: b64u(x) };
      return { alg, key: createPublicKey({ key: jwk, format: "jwk" }) };
    }
    if (alg === -257) {
      if (kty !== 3) fail("RS256 needs RSA");
      const n = bytes(map, -1);
      const e = bytes(map, -2);
      // n is minimal (no leading zero byte) and 2048..4096 bits long; a
      // 256-byte modulus is 2048 bits only when its top bit is set.
      if (n[0] === 0 || n.length > 512 || n.length < 256) fail("RSA size");
      if (n.length === 256 && (n[0] as number) < 0x80) fail("RSA size");
      if (e.length !== 3 || e[0] !== 1 || e[1] !== 0 || e[2] !== 1)
        fail("RSA exponent");
      const jwk = { kty: "RSA", n: b64u(n), e: b64u(e) };
      return { alg, key: createPublicKey({ key: jwk, format: "jwk" }) };
    }
  } catch (error) {
    // Our own shape refusals keep their message (tests tell them apart); the
    // runtime's (an EC point that is not on the curve, for one) become one.
    if (error instanceof CoseError) throw error;
    fail("key refused by the runtime");
  }
  return fail("unsupported algorithm");
}

/** Verifies `signature` over `data`; never throws, false on any doubt. */
export function verifyCoseSignature(
  publicKey: CosePublicKey,
  data: Uint8Array,
  signature: Uint8Array
): boolean {
  // Signature length and encoding are left to the runtime on purpose: its
  // checks are the ones the Wycheproof vectors prove, and a second, weaker
  // copy here could only disagree with them.
  try {
    if (publicKey.alg === -7) {
      return verify(
        "sha256",
        data,
        { key: publicKey.key, dsaEncoding: "der" },
        signature
      );
    }
    if (publicKey.alg === -8)
      return verify(null, data, publicKey.key, signature);
    const key = { key: publicKey.key, padding: constants.RSA_PKCS1_PADDING };
    return verify("sha256", data, key, signature);
  } catch {
    return false;
  }
}

let probed: readonly CoseAlgorithm[] | undefined;

/** The algorithms whose probe returns true; a probe that throws counts as false. */
export function availableAlgorithms(
  probes: ReadonlyArray<readonly [CoseAlgorithm, () => boolean]>
): readonly CoseAlgorithm[] {
  return Object.freeze(
    probes
      .filter(([, probe]) => {
        try {
          return probe();
        } catch {
          return false;
        }
      })
      .map(([alg]) => alg)
  );
}

/**
 * The algorithms this runtime can actually verify, found by a sign/verify
 * round trip per algorithm the first time it is asked (G1: never advertise an
 * algorithm the runtime lacks). Callers advertise `pubKeyCredParams` from this
 * list at start-up; registration refuses anything outside it.
 */
export function supportedCoseAlgorithms(): readonly CoseAlgorithm[] {
  if (probed) return probed;
  const message = new TextEncoder().encode("awcms-webauthn-probe");
  probed = availableAlgorithms([
    [
      -7,
      () =>
        roundTrip(
          generateKeyPairSync("ec", { namedCurve: "P-256" }),
          "sha256",
          message
        )
    ],
    [-8, () => roundTrip(generateKeyPairSync("ed25519"), null, message)],
    [
      -257,
      () =>
        roundTrip(
          generateKeyPairSync("rsa", { modulusLength: 2048 }),
          "sha256",
          message
        )
    ]
  ]);
  return probed;
}

function roundTrip(
  pair: { publicKey: KeyObject; privateKey: KeyObject },
  hash: string | null,
  message: Uint8Array
): boolean {
  const signature = sign(hash, message, pair.privateKey);
  const tampered = Uint8Array.from(message, (b, i) => (i === 0 ? b ^ 1 : b));
  return (
    verify(hash, message, pair.publicKey, signature) &&
    !verify(hash, tampered, pair.publicKey, signature)
  );
}
