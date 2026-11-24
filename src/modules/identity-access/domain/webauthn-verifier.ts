/**
 * Passkey (WebAuthn) ceremony verification — the pure core of ADR-0168, slice
 * S1. No database, no network, no clock, no configuration: the caller supplies
 * what was expected (challenge digest, origins, RP ID, the stored credential)
 * and gets back either the facts to persist or a coarse rejection reason.
 *
 * The checks are ADR-0168 amendment A6, items 1-10, and every one of them has a
 * test that fails when the check is removed (`tests/webauthn-verifier.test.ts`,
 * the red matrix). What is deliberately NOT here, because it needs state:
 *
 * - consuming the challenge (digest AND purpose AND tenant AND principal or
 *   session in one atomic `UPDATE ... WHERE`) — the caller does that with
 *   {@link VerifiedAssertion.challengeDigest};
 * - the compare-and-set counter update (A7) — {@link evaluateSignCount} only
 *   decides; the caller's `UPDATE ... WHERE sign_count < $n` makes it atomic;
 * - global credential-id uniqueness and its uniform duplicate error (A6.6);
 * - the uniform error and equal work towards the client (A9) — reasons here
 *   are for internal logs and audit only and must never reach a response.
 *
 * Attestation: any `fmt` is accepted and `attStmt` is never verified or
 * trusted (A6); `fmt` is returned for telemetry only.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { decodeCbor, decodeCborItem, type CborMap } from "./webauthn-cbor";
import {
  parseCoseKey,
  supportedCoseAlgorithms,
  verifyCoseSignature,
  CoseError,
  type CoseAlgorithm
} from "./webauthn-cose";

export type WebAuthnRejectReason =
  | "malformed" // shape, encoding, size, CBOR or authenticator-data structure
  | "client_data" // clientDataJSON type, crossOrigin, topOrigin
  | "challenge"
  | "origin"
  | "rp_id"
  | "flags" // UP, UV, BE/BS, AT on assertion
  | "credential" // id/rawId/authData mismatch, not allowed, userHandle
  | "algorithm" // unsupported alg, kty/crv mismatch, unusable key
  | "signature"
  | "counter_quarantine" // counter did not advance, BE=0: quarantine (A7)
  | "counter_synced"; // counter did not advance, BE=1: reject + audit high

export type WebAuthnResult<T> =
  { ok: true; value: T } | { ok: false; reason: WebAuthnRejectReason };

export interface RegistrationExpectation {
  /** SHA-256 of the raw challenge bytes issued for this ceremony. */
  challengeDigest: Uint8Array;
  /** Exact-string origin allow-list (A6.3). */
  origins: readonly string[];
  /** The RP ID the options were issued for; stored per credential. */
  rpId: string;
  /** Policy subset of {@link supportedCoseAlgorithms}; defaults to all of it. */
  algorithms?: readonly CoseAlgorithm[];
}

export interface RegisteredCredential {
  credentialId: Uint8Array;
  /** The COSE_Key exactly as the authenticator sent it. */
  publicKeyCose: Uint8Array;
  alg: CoseAlgorithm;
  signCount: number;
  backupEligible: boolean;
  backupState: boolean;
  aaguid: Uint8Array;
  rpId: string;
  /** Telemetry only — never trusted (A6). */
  fmt: string;
  challengeDigest: Uint8Array;
}

export interface AssertionExpectation {
  challengeDigest: Uint8Array;
  origins: readonly string[];
  /** The non-empty allowCredentials list the options carried (A6.9). */
  allowCredentialIds: readonly Uint8Array[];
  /** The principal's WebAuthn user handle; a returned userHandle must equal it. */
  userHandle: Uint8Array;
}

export interface StoredCredential {
  credentialId: Uint8Array;
  publicKeyCose: Uint8Array;
  alg: CoseAlgorithm;
  signCount: number;
  backupEligible: boolean;
  rpId: string;
}

export interface VerifiedAssertion {
  credentialId: Uint8Array;
  newSignCount: number;
  backupState: boolean;
  challengeDigest: Uint8Array;
}

export interface AuthenticatorData {
  rpIdHash: Uint8Array;
  up: boolean;
  uv: boolean;
  be: boolean;
  bs: boolean;
  signCount: number;
  attested?: {
    aaguid: Uint8Array;
    credentialId: Uint8Array;
    publicKeyCose: Uint8Array;
    coseMap: CborMap;
  };
}

export const MAX_CREDENTIAL_ID_BYTES = 1023;
const MAX_ENCODED_BYTES = 16 * 1024;
const MAX_SIGNATURE_BYTES = 1024;
const MAX_USER_HANDLE_BYTES = 64;

class Reject extends Error {
  constructor(readonly reason: WebAuthnRejectReason) {
    super(reason);
  }
}

function reject(reason: WebAuthnRejectReason): never {
  throw new Reject(reason);
}

function run<T>(body: () => T): WebAuthnResult<T> {
  try {
    return { ok: true, value: body() };
  } catch (error) {
    if (error instanceof Reject) return { ok: false, reason: error.reason };
    if (error instanceof CoseError) return { ok: false, reason: "algorithm" };
    return { ok: false, reason: "malformed" }; // CborError and anything unforeseen
  }
}

const sha256 = (data: Uint8Array) =>
  new Uint8Array(createHash("sha256").update(data).digest());

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Strict base64url: URL alphabet, no padding, and canonical (the unused low
 * bits of the last character are zero), so exactly one string maps to each
 * byte sequence.
 */
export function decodeBase64UrlStrict(
  value: unknown,
  maxBytes: number
): Uint8Array {
  if (typeof value !== "string" || value.length === 0) reject("malformed");
  if (value.length > Math.ceil((maxBytes * 4) / 3)) reject("malformed");
  // Re-encoding must give the input back: that one comparison refuses padding,
  // the standard alphabet, whitespace, stray characters and non-zero spare bits.
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) reject("malformed");
  return new Uint8Array(decoded);
}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * A6.1: strict UTF-8, no BOM, one JSON object. The BOM is refused explicitly
 * rather than left to `JSON.parse` (which also refuses U+FEFF today): the rule
 * must not depend on a parser detail.
 */
export function parseClientDataJSON(raw: Uint8Array): Record<string, unknown> {
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    reject("malformed");
  // Invalid UTF-8 or JSON throws a TypeError/SyntaxError here; run() turns
  // it into "malformed". Not wrapped, so a test can tell the BOM refusal apart.
  const parsed: unknown = JSON.parse(utf8.decode(raw));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    reject("malformed");
  return parsed as Record<string, unknown>;
}

/** A6.1-A6.3. Returns the challenge digest after matching it. */
function checkClientData(
  raw: Uint8Array,
  type: "webauthn.create" | "webauthn.get",
  expected: { challengeDigest: Uint8Array; origins: readonly string[] }
): Uint8Array {
  const data = parseClientDataJSON(raw);
  if (data.type !== type) reject("client_data");
  const challengeDigest = sha256(decodeBase64UrlStrict(data.challenge, 1024));
  if (!equalBytes(challengeDigest, expected.challengeDigest))
    reject("challenge");
  if (!expected.origins.includes(data.origin as string)) reject("origin");
  if (Object.hasOwn(data, "crossOrigin") && data.crossOrigin !== false)
    reject("client_data");
  if (Object.hasOwn(data, "topOrigin")) reject("client_data");
  return challengeDigest;
}

/**
 * A6.4. Flags AT and ED alone decide what follows the 37-byte header; the COSE
 * key and the extensions map are each exactly one CBOR item, and any byte left
 * over is refused.
 */
export function parseAuthenticatorData(buf: Uint8Array): AuthenticatorData {
  if (!(buf instanceof Uint8Array) || buf.length < 37) reject("malformed");
  const flags = buf[32] as number;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: AuthenticatorData = {
    rpIdHash: buf.slice(0, 32),
    up: (flags & 0x01) !== 0,
    uv: (flags & 0x04) !== 0,
    be: (flags & 0x08) !== 0,
    bs: (flags & 0x10) !== 0,
    signCount: view.getUint32(33)
  };
  let pos = 37;
  if (flags & 0x40) {
    if (buf.length < pos + 18) reject("malformed");
    const aaguid = buf.slice(pos, pos + 16);
    const idLength = view.getUint16(pos + 16);
    pos += 18;
    if (idLength === 0 || idLength > MAX_CREDENTIAL_ID_BYTES)
      reject("malformed");
    if (buf.length < pos + idLength) reject("malformed");
    const credentialId = buf.slice(pos, pos + idLength);
    pos += idLength;
    const cose = decodeCborItem(buf, pos);
    if (!(cose.value instanceof Map)) reject("malformed");
    out.attested = {
      aaguid,
      credentialId,
      publicKeyCose: buf.slice(pos, cose.end),
      coseMap: cose.value
    };
    pos = cose.end;
  }
  if (flags & 0x80) {
    const extensions = decodeCborItem(buf, pos);
    if (!(extensions.value instanceof Map)) reject("malformed");
    pos = extensions.end;
  }
  if (pos !== buf.length) reject("malformed");
  return out;
}

/** A6.4 (UP, UV) and A6.5 (BE=0 ⇒ BS=0). */
function checkFlags(authData: AuthenticatorData): void {
  if (!authData.up || !authData.uv) reject("flags");
  if (!authData.be && authData.bs) reject("flags");
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    reject("malformed");
  return value as Record<string, unknown>;
}

/** A6.6: `id` and `rawId` are the same strict base64url string. */
function readCredentialId(input: Record<string, unknown>): Uint8Array {
  if (input.type !== "public-key") reject("malformed");
  if (input.id !== input.rawId) reject("credential");
  return decodeBase64UrlStrict(input.rawId, MAX_CREDENTIAL_ID_BYTES);
}

function checkExpectation(expected: {
  challengeDigest: Uint8Array;
  origins: readonly string[];
}): void {
  // A misconfigured caller fails closed instead of matching nothing loosely.
  if (expected.challengeDigest.length !== 32 || expected.origins.length === 0)
    reject("malformed");
}

/**
 * Verifies a registration (`navigator.credentials.create`) response in its
 * JSON serialization (`PublicKeyCredential.toJSON()`, base64url fields).
 */
export function verifyRegistration(
  input: unknown,
  expected: RegistrationExpectation
): WebAuthnResult<RegisteredCredential> {
  return run(() => {
    checkExpectation(expected);
    const credential = readObject(input);
    const response = readObject(credential.response);
    const rawId = readCredentialId(credential);
    const clientDataJSON = decodeBase64UrlStrict(
      response.clientDataJSON,
      MAX_ENCODED_BYTES
    );
    const challengeDigest = checkClientData(
      clientDataJSON,
      "webauthn.create",
      expected
    );
    const attestation = decodeCbor(
      decodeBase64UrlStrict(response.attestationObject, MAX_ENCODED_BYTES)
    );
    if (!(attestation instanceof Map) || attestation.size !== 3)
      reject("malformed");
    const fmt = attestation.get("fmt");
    const authDataBytes = attestation.get("authData");
    // attStmt must be present and a map, and is then ignored entirely.
    if (typeof fmt !== "string" || !(attestation.get("attStmt") instanceof Map))
      reject("malformed");
    const authData = parseAuthenticatorData(authDataBytes as Uint8Array);
    if (!authData.attested) reject("malformed");
    if (
      !equalBytes(
        authData.rpIdHash,
        sha256(new TextEncoder().encode(expected.rpId))
      )
    )
      reject("rp_id");
    checkFlags(authData);
    if (!equalBytes(authData.attested.credentialId, rawId))
      reject("credential");
    const publicKey = parseCoseKey(authData.attested.coseMap);
    const allowed = expected.algorithms ?? supportedCoseAlgorithms();
    if (
      !allowed.includes(publicKey.alg) ||
      !supportedCoseAlgorithms().includes(publicKey.alg)
    )
      reject("algorithm");
    return {
      credentialId: rawId,
      publicKeyCose: authData.attested.publicKeyCose,
      alg: publicKey.alg,
      signCount: authData.signCount,
      backupEligible: authData.be,
      backupState: authData.bs,
      aaguid: authData.attested.aaguid,
      rpId: expected.rpId,
      fmt,
      challengeDigest
    };
  });
}

/**
 * Verifies an authentication (`navigator.credentials.get`) response against
 * the credential the caller looked up by `rawId`. The algorithm always comes
 * from the stored credential, never from the response (A6.7).
 */
export function verifyAssertion(
  input: unknown,
  expected: AssertionExpectation,
  stored: StoredCredential
): WebAuthnResult<VerifiedAssertion> {
  return run(() => {
    checkExpectation(expected);
    const credential = readObject(input);
    const response = readObject(credential.response);
    const rawId = readCredentialId(credential);
    if (!equalBytes(rawId, stored.credentialId)) reject("credential");
    if (!expected.allowCredentialIds.some((id) => equalBytes(id, rawId)))
      reject("credential");
    const clientDataJSON = decodeBase64UrlStrict(
      response.clientDataJSON,
      MAX_ENCODED_BYTES
    );
    const challengeDigest = checkClientData(
      clientDataJSON,
      "webauthn.get",
      expected
    );
    const authDataBytes = decodeBase64UrlStrict(
      response.authenticatorData,
      MAX_ENCODED_BYTES
    );
    const authData = parseAuthenticatorData(authDataBytes);
    if (authData.attested) reject("flags");
    if (
      !equalBytes(
        authData.rpIdHash,
        sha256(new TextEncoder().encode(stored.rpId))
      )
    )
      reject("rp_id");
    checkFlags(authData);
    if (authData.be !== stored.backupEligible) reject("flags");
    if (response.userHandle !== undefined && response.userHandle !== null) {
      const handle = decodeBase64UrlStrict(
        response.userHandle,
        MAX_USER_HANDLE_BYTES
      );
      if (!equalBytes(handle, expected.userHandle)) reject("credential");
    }
    const publicKey = parseCoseKey(stored.publicKeyCose);
    if (
      publicKey.alg !== stored.alg ||
      !supportedCoseAlgorithms().includes(publicKey.alg)
    )
      reject("algorithm");
    const signature = decodeBase64UrlStrict(
      response.signature,
      MAX_SIGNATURE_BYTES
    );
    const signed = new Uint8Array(authDataBytes.length + 32);
    signed.set(authDataBytes);
    signed.set(sha256(clientDataJSON), authDataBytes.length);
    if (!verifyCoseSignature(publicKey, signed, signature)) reject("signature");
    // Only now, after the signature, may the counter decide anything: a forged
    // response must never be able to quarantine someone's credential.
    const counter = evaluateSignCount(
      stored.signCount,
      authData.signCount,
      stored.backupEligible
    );
    if (!counter.ok) reject(counter.reason);
    return {
      credentialId: rawId,
      newSignCount: authData.signCount,
      backupState: authData.bs,
      challengeDigest
    };
  });
}

/**
 * The sign-counter rule (ADR-0168 §5.4 as amended by A7). Both zero: accept
 * (many synced passkeys never count). Otherwise the presented counter must be
 * strictly greater. A counter that does not advance quarantines a device-bound
 * credential (BE=0) and is a plain rejection, audited `high`, for a synced one
 * (BE=1).
 */
export function evaluateSignCount(
  stored: number,
  presented: number,
  backupEligible: boolean
):
  | { ok: true }
  | { ok: false; reason: "counter_quarantine" | "counter_synced" } {
  if (stored === 0 && presented === 0) return { ok: true };
  if (presented > stored) return { ok: true };
  return {
    ok: false,
    reason: backupEligible ? "counter_synced" : "counter_quarantine"
  };
}
