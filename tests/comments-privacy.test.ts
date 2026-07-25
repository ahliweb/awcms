import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import {
  decryptSubscriberEmail,
  encryptSubscriberEmail,
  resolveSubscriberEncryptionKey,
  UNRESOLVABLE_SUBSCRIBER_REF
} from "../src/modules/comments/domain/subscriber-crypto";
import { hashRequestSignal } from "../src/modules/comments/domain/request-hashing";

describe("subscriber-crypto (reply-notify recipient minimization)", () => {
  test("round-trips a recipient address only with a valid key", () => {
    const key = randomBytes(32);
    const ct = encryptSubscriberEmail("visitor@example.com", key);
    expect(ct).not.toBeNull();
    // Ciphertext never contains the plaintext address.
    expect(ct).not.toContain("visitor@example.com");
    expect(decryptSubscriberEmail(ct!, key)).toBe("visitor@example.com");
  });

  test("returns null (caller stores the unresolvable sentinel) when no key is configured", () => {
    expect(resolveSubscriberEncryptionKey({})).toBeNull();
    expect(encryptSubscriberEmail("visitor@example.com", null)).toBeNull();
    expect(UNRESOLVABLE_SUBSCRIBER_REF).toBe("unresolvable");
  });

  test("a wrong key cannot decrypt (authenticated encryption)", () => {
    const ct = encryptSubscriberEmail("a@b.com", randomBytes(32))!;
    expect(() => decryptSubscriberEmail(ct, randomBytes(32))).toThrow();
  });
});

describe("request-hashing (abuse signals are one-way + tenant-scoped)", () => {
  test("hashes are non-reversible and tenant-scoped", () => {
    const a = hashRequestSignal("tenant-a", "203.0.113.9");
    const b = hashRequestSignal("tenant-b", "203.0.113.9");
    expect(a).not.toBeNull();
    expect(a).not.toContain("203.0.113.9");
    expect(a).not.toBe(b); // same IP, different tenant → different hash
  });

  test("null/empty input yields null (nothing to correlate)", () => {
    expect(hashRequestSignal("t", null)).toBeNull();
    expect(hashRequestSignal("t", "")).toBeNull();
  });
});
