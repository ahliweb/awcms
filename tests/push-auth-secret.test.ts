/**
 * Push auth secret at rest (Issue #1089): the pure/unit half. No database; the
 * `tx` is a recording fake. The database half (dispatcher delivery, backfill,
 * grants, CHECK) is tests/integration/push-auth-secret-at-rest.integration.test.ts.
 */
import { describe, expect, spyOn, test } from "bun:test";

import {
  decryptPushAuthSecret,
  encryptPushAuthSecret,
  PushAuthSecretError,
  resolvePushAuthSecretRing
} from "../src/modules/push-delivery/domain/push-auth-secret";
import {
  fetchDeliveryTarget,
  registerPushSubscription
} from "../src/modules/push-delivery/application/subscription-directory";
import { hashPushEndpoint } from "../src/modules/push-delivery/domain/push-endpoint";
import type { KeyRing } from "../src/lib/security/field-encryption";

const KEY_A = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 251)
).toString("base64");
const KEY_B = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 101) % 253)
).toString("base64");

function ring(spec: string): KeyRing {
  const resolved = resolvePushAuthSecretRing({
    PUSH_AUTH_SECRET_ENCRYPTION_KEYS: spec
  });

  if (!resolved.ok) throw new Error(resolved.reason);

  return resolved;
}

const RING_A = ring(`k1:${KEY_A}`);
const TENANT = "11111111-1111-4111-8111-111111111111";
const SECRET = "c2VjcmV0LWF1dGgtc2VjcmV0"; // base64url, 16+ bytes shape
const ENDPOINT = "https://push.example.test/send/abc123";

/** A `tx` that records the interpolated values and answers with `rows`. */
function fakeTx(rows: unknown[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });

    return Promise.resolve(rows);
  };

  return { tx: tx as unknown as Bun.TransactionSQL, calls };
}

describe("push auth secret encryption", () => {
  test("round trips and the envelope does not contain the plaintext", () => {
    const hash = hashPushEndpoint(ENDPOINT);
    const envelope = encryptPushAuthSecret(SECRET, TENANT, hash, RING_A);

    expect(envelope.startsWith("v2:k1:")).toBe(true);
    expect(envelope).not.toContain(SECRET);
    expect(decryptPushAuthSecret(envelope, TENANT, hash, RING_A)).toBe(SECRET);
  });

  test("a fresh IV per encryption", () => {
    const hash = hashPushEndpoint(ENDPOINT);

    expect(encryptPushAuthSecret(SECRET, TENANT, hash, RING_A)).not.toBe(
      encryptPushAuthSecret(SECRET, TENANT, hash, RING_A)
    );
  });

  test("the AAD binds row identity: another endpoint hash or tenant fails", () => {
    const hash = hashPushEndpoint(ENDPOINT);
    const other = hashPushEndpoint("https://push.example.test/send/other");
    const envelope = encryptPushAuthSecret(SECRET, TENANT, hash, RING_A);

    expect(() =>
      decryptPushAuthSecret(envelope, TENANT, other, RING_A)
    ).toThrow();
    expect(() =>
      decryptPushAuthSecret(
        envelope,
        "22222222-2222-4222-8222-222222222222",
        hash,
        RING_A
      )
    ).toThrow();
  });

  test("key rotation: new key writes, the old key still reads", () => {
    const hash = hashPushEndpoint(ENDPOINT);
    const oldEnvelope = encryptPushAuthSecret(SECRET, TENANT, hash, RING_A);
    const rotated = ring(`k2:${KEY_B},k1:${KEY_A}`);
    const fresh = encryptPushAuthSecret(SECRET, TENANT, hash, rotated);

    expect(fresh.startsWith("v2:k2:")).toBe(true);
    expect(decryptPushAuthSecret(oldEnvelope, TENANT, hash, rotated)).toBe(
      SECRET
    );
    expect(decryptPushAuthSecret(fresh, TENANT, hash, rotated)).toBe(SECRET);
  });

  test("the ring resolver fails closed when unset or malformed", () => {
    expect(resolvePushAuthSecretRing({}).ok).toBe(false);
    expect(
      resolvePushAuthSecretRing({ PUSH_AUTH_SECRET_ENCRYPTION_KEYS: "k1:abc" })
        .ok
    ).toBe(false);
  });
});

describe("registerPushSubscription", () => {
  const input = {
    tenantUserId: "33333333-3333-4333-8333-333333333333",
    transport: "web_push" as const,
    endpoint: ENDPOINT,
    p256dhKey: "BPublicKey",
    authSecret: SECRET
  };

  test("writes ciphertext and never the plaintext secret", async () => {
    const { tx, calls } = fakeTx([
      {
        id: "x",
        tenant_user_id: input.tenantUserId,
        transport: "web_push",
        endpoint_masked: "m",
        status: "active",
        disabled_reason: null,
        last_success_at: null,
        created_at: new Date()
      }
    ]);

    await registerPushSubscription(tx, TENANT, input, RING_A);

    const values = calls[0]!.values;

    expect(values).not.toContain(SECRET);
    expect(
      values.some((v) => typeof v === "string" && v.startsWith("v2:k1:"))
    ).toBe(true);
    // The INSERT never names the plaintext column; the conflicting-row UPDATE
    // (Issue #1098 split the upsert so the previous owner can be locked and
    // compared) clears the legacy plaintext, proven end to end by the
    // integration test "re-registering a legacy plaintext row migrates it".
    expect(calls[0]!.text).toContain("auth_secret_ciphertext");
    expect(calls[0]!.text).not.toMatch(/\bauth_secret\b/);
    const source = await Bun.file(
      "src/modules/push-delivery/application/subscription-directory.ts"
    ).text();

    expect(source).toContain("auth_secret = NULL,");
  });

  test("fails closed without a key ring: nothing is written", async () => {
    const { tx, calls } = fakeTx();

    await expect(
      registerPushSubscription(tx, TENANT, input)
    ).rejects.toBeInstanceOf(PushAuthSecretError);
    expect(calls).toHaveLength(0);
  });

  test("an fcm registration (no secret) needs no ring", async () => {
    const { tx, calls } = fakeTx([
      {
        id: "x",
        tenant_user_id: input.tenantUserId,
        transport: "fcm",
        endpoint_masked: "m",
        status: "active",
        disabled_reason: null,
        last_success_at: null,
        created_at: new Date()
      }
    ]);

    await registerPushSubscription(tx, TENANT, {
      tenantUserId: input.tenantUserId,
      transport: "fcm",
      endpoint: "fcm-registration-token-1234567890"
    });
    expect(calls).toHaveLength(1);
  });

  test("no plaintext reaches the log", async () => {
    const lines: string[] = [];
    const spy = spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.map(String).join(" "));
    });

    try {
      const { tx } = fakeTx([
        {
          id: "x",
          tenant_user_id: input.tenantUserId,
          transport: "web_push",
          endpoint_masked: "m",
          status: "active",
          disabled_reason: null,
          last_success_at: null,
          created_at: new Date()
        }
      ]);

      await registerPushSubscription(tx, TENANT, input, RING_A);
      await expect(
        fetchDeliveryTarget(
          fakeTx([
            {
              transport: "web_push",
              endpoint: ENDPOINT,
              endpoint_hash: "wrong-hash",
              endpoint_masked: "m",
              p256dh_key: "BPublicKey",
              auth_secret: null,
              auth_secret_ciphertext: encryptPushAuthSecret(
                SECRET,
                TENANT,
                hashPushEndpoint(ENDPOINT),
                RING_A
              )
            }
          ]).tx,
          TENANT,
          "sub",
          RING_A
        )
      ).rejects.toBeInstanceOf(PushAuthSecretError);
    } finally {
      spy.mockRestore();
    }

    expect(lines.join("\n")).not.toContain(SECRET);
  });
});

describe("fetchDeliveryTarget", () => {
  const hash = hashPushEndpoint(ENDPOINT);

  function row(overrides: Record<string, unknown>) {
    return {
      transport: "web_push",
      endpoint: ENDPOINT,
      endpoint_hash: hash,
      endpoint_masked: "m",
      p256dh_key: "BPublicKey",
      auth_secret: null,
      auth_secret_ciphertext: null,
      ...overrides
    };
  }

  test("a ciphertext row is decrypted", async () => {
    const ciphertext = encryptPushAuthSecret(SECRET, TENANT, hash, RING_A);
    const target = await fetchDeliveryTarget(
      fakeTx([row({ auth_secret_ciphertext: ciphertext })]).tx,
      TENANT,
      "sub",
      RING_A
    );

    expect(target?.authSecret).toBe(SECRET);
  });

  test("a legacy plaintext row (no ciphertext) still delivers, even without a ring", async () => {
    const target = await fetchDeliveryTarget(
      fakeTx([row({ auth_secret: SECRET })]).tx,
      TENANT,
      "sub",
      null
    );

    expect(target?.authSecret).toBe(SECRET);
  });

  test("ciphertext wins over a stale plaintext value", async () => {
    const ciphertext = encryptPushAuthSecret(
      "the-new-secret",
      TENANT,
      hash,
      RING_A
    );
    const target = await fetchDeliveryTarget(
      fakeTx([row({ auth_secret: SECRET, auth_secret_ciphertext: ciphertext })])
        .tx,
      TENANT,
      "sub",
      RING_A
    );

    expect(target?.authSecret).toBe("the-new-secret");
  });

  test("a ciphertext moved to another row fails and does not fall back to plaintext", async () => {
    const moved = encryptPushAuthSecret(
      SECRET,
      TENANT,
      hashPushEndpoint("https://push.example.test/send/elsewhere"),
      RING_A
    );

    const error = await fetchDeliveryTarget(
      fakeTx([row({ auth_secret: SECRET, auth_secret_ciphertext: moved })]).tx,
      TENANT,
      "sub",
      RING_A
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PushAuthSecretError);
    expect((error as PushAuthSecretError).retryable).toBe(false);
    expect((error as Error).message).not.toContain(SECRET);
  });

  test("an endpoint that does not hash to endpoint_hash is refused, non-retryably, with a fixed message", async () => {
    const error = await fetchDeliveryTarget(
      fakeTx([row({ auth_secret: SECRET, endpoint: "https://evil.test/x" })])
        .tx,
      TENANT,
      "sub",
      RING_A
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PushAuthSecretError);
    expect((error as PushAuthSecretError).retryable).toBe(false);
    expect((error as Error).message).not.toContain("evil.test");
    expect((error as Error).message).not.toContain(SECRET);
  });

  test("ciphertext with no ring, or without its key, is a retryable configuration error", async () => {
    const ciphertext = encryptPushAuthSecret(SECRET, TENANT, hash, RING_A);
    const noRing = await fetchDeliveryTarget(
      fakeTx([row({ auth_secret_ciphertext: ciphertext })]).tx,
      TENANT,
      "sub",
      null
    ).catch((caught: unknown) => caught);
    const wrongKey = await fetchDeliveryTarget(
      fakeTx([row({ auth_secret_ciphertext: ciphertext })]).tx,
      TENANT,
      "sub",
      ring(`k9:${KEY_B}`)
    ).catch((caught: unknown) => caught);

    expect((noRing as PushAuthSecretError).retryable).toBe(true);
    expect((wrongKey as PushAuthSecretError).retryable).toBe(true);
  });
});
