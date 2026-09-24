/**
 * Pure-unit coverage for the worker identity primitives (ahliweb/omes#199):
 * canonical envelope construction, Ed25519 signature verification, public
 * key shape validation, and bounded-window timestamp freshness. No
 * database.
 */
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

import {
  buildCanonicalEnvelope,
  checkEnvelopeFreshness,
  isWellFormedNonce,
  validateEd25519PublicKeyPem,
  verifyEd25519Signature,
  ENVELOPE_TIMESTAMP_WINDOW_MS
} from "../src/modules/omes-control/domain/worker-identity";

function generateWorkerKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string
  };
}

function signWith(privateKeyPem: string, data: string): string {
  return cryptoSign(null, Buffer.from(data, "utf8"), privateKeyPem).toString(
    "base64"
  );
}

describe("worker-identity", () => {
  test("buildCanonicalEnvelope binds every scoping field and the body hash", () => {
    const base = {
      method: "POST",
      path: "/api/v1/omes/worker/poll",
      tenantId: "11111111-1111-4111-8111-111111111111",
      serverId: "srv-1",
      workerId: "worker_abc",
      timestamp: "2026-09-24T00:00:00Z",
      nonce: "nonce_abcdefghijklmnop",
      rawBody: '{"a":1}'
    };

    const canonical = buildCanonicalEnvelope(base);

    // Changing ANY single field changes the canonical string — this is what
    // makes cross-tenant/cross-server/cross-worker signature substitution
    // detectable rather than merely "probably fine".
    expect(buildCanonicalEnvelope({ ...base, tenantId: "22222222-2222-4222-8222-222222222222" })).not.toBe(canonical);
    expect(buildCanonicalEnvelope({ ...base, serverId: "srv-2" })).not.toBe(canonical);
    expect(buildCanonicalEnvelope({ ...base, workerId: "worker_xyz" })).not.toBe(canonical);
    expect(buildCanonicalEnvelope({ ...base, nonce: "nonce_zzzzzzzzzzzzzzzz" })).not.toBe(canonical);
    expect(buildCanonicalEnvelope({ ...base, rawBody: '{"a":2}' })).not.toBe(canonical);
    expect(buildCanonicalEnvelope({ ...base, path: "/api/v1/omes/worker/result" })).not.toBe(canonical);
  });

  test("validateEd25519PublicKeyPem accepts a real SPKI Ed25519 PEM and rejects everything else", () => {
    const { publicKeyPem } = generateWorkerKeypair();

    expect(validateEd25519PublicKeyPem(publicKeyPem).valid).toBe(true);
    expect(validateEd25519PublicKeyPem("not a key").valid).toBe(false);
    expect(validateEd25519PublicKeyPem("").valid).toBe(false);

    // The pre-#199 stub worker's fake "ssh-ed25519 <sha256 hex>" shape must
    // NOT be accepted — this module intentionally does not relax
    // verification to match that placeholder (see worker-identity.ts's
    // module doc).
    expect(
      validateEd25519PublicKeyPem("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIdeadbeef")
        .valid
    ).toBe(false);
  });

  test("verifyEd25519Signature accepts a genuine signature and rejects a tampered one", () => {
    const { publicKeyPem, privateKeyPem } = generateWorkerKeypair();
    const data = "canonical-envelope-string";
    const signature = signWith(privateKeyPem, data);

    expect(verifyEd25519Signature(publicKeyPem, data, signature)).toBe(true);
    expect(verifyEd25519Signature(publicKeyPem, "tampered-data", signature)).toBe(
      false
    );

    const other = generateWorkerKeypair();
    // Signed by a DIFFERENT worker's key — must not verify against this
    // public key (the cross-worker substitution case).
    const otherSignature = signWith(other.privateKeyPem, data);
    expect(verifyEd25519Signature(publicKeyPem, data, otherSignature)).toBe(false);
  });

  test("verifyEd25519Signature fails closed on malformed input rather than throwing", () => {
    const { publicKeyPem } = generateWorkerKeypair();

    expect(verifyEd25519Signature(publicKeyPem, "data", "not-base64!!!")).toBe(
      false
    );
    expect(verifyEd25519Signature(publicKeyPem, "data", "")).toBe(false);
    expect(verifyEd25519Signature("not a key", "data", "AAAA")).toBe(false);
  });

  test("checkEnvelopeFreshness rejects malformed timestamps and both directions outside the window", () => {
    const now = new Date("2026-09-24T00:00:00Z");

    expect(checkEnvelopeFreshness("not-a-date", now).fresh).toBe(false);

    const withinPast = new Date(now.getTime() - ENVELOPE_TIMESTAMP_WINDOW_MS / 2);
    expect(checkEnvelopeFreshness(withinPast.toISOString(), now).fresh).toBe(true);

    const tooOld = new Date(now.getTime() - ENVELOPE_TIMESTAMP_WINDOW_MS - 1000);
    expect(checkEnvelopeFreshness(tooOld.toISOString(), now).fresh).toBe(false);

    // A FUTURE timestamp is rejected too — a captured envelope must not be
    // replayable "until it expires" by presenting a future-dated timestamp.
    const tooFuture = new Date(now.getTime() + ENVELOPE_TIMESTAMP_WINDOW_MS + 1000);
    expect(checkEnvelopeFreshness(tooFuture.toISOString(), now).fresh).toBe(false);
  });

  test("isWellFormedNonce enforces the shared nonce pattern", () => {
    expect(isWellFormedNonce("nonce_abcdefghijklmnop")).toBe(true);
    expect(isWellFormedNonce("short")).toBe(false);
    expect(isWellFormedNonce("has spaces in it 1234567")).toBe(false);
    expect(isWellFormedNonce(123)).toBe(false);
    expect(isWellFormedNonce(undefined)).toBe(false);
  });
});
