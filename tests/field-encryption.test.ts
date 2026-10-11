import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import {
  FieldEncryptionError,
  decryptField,
  decryptFieldToString,
  encryptField,
  envelopeKeyId,
  hashesEqual,
  keyedHash,
  keyedHashCandidates,
  keyedHashPrimary,
  matchesAnyHash,
  parseKeyRing,
  resolveKeyRing,
  type FieldContext,
  type KeyRing
} from "../src/lib/security/field-encryption";

const b64 = () => randomBytes(32).toString("base64");
const ENV = "TEST_FIELD_KEYS";

function ring(...ids: string[]): KeyRing {
  const parsed = parseKeyRing(ids.map((id) => `${id}:${b64()}`).join(","), ENV);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed;
}

const ctx: FieldContext = {
  purpose: "test_purpose:v1",
  tenantId: "tenant-a",
  rowId: "row-1"
};
const SECRET = "1234567890123456";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as FieldEncryptionError).code;
  }
  return "NO_THROW";
}

describe("encryptField / decryptField", () => {
  test("round-trips strings and bytes, envelope shape v2:<keyId>:iv:tag:ct", () => {
    const r = ring("k1");
    const envelope = encryptField(SECRET, ctx, r);
    expect(envelope.split(":")).toHaveLength(5);
    expect(envelope.startsWith("v2:k1:")).toBe(true);
    expect(envelope).not.toContain(SECRET);
    expect(decryptFieldToString(envelope, ctx, r)).toBe(SECRET);
    expect(
      decryptField(encryptField(Buffer.from([1, 2, 3]), ctx, r), ctx, r)
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(decryptFieldToString(encryptField("", ctx, r), ctx, r)).toBe("");
  });

  test("a fresh IV per encryption", () => {
    const r = ring("k1");
    expect(encryptField(SECRET, ctx, r)).not.toBe(encryptField(SECRET, ctx, r));
  });

  test("tampering with any envelope part is refused", () => {
    const r = ring("k1");
    const parts = encryptField(SECRET, ctx, r).split(":");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);

    for (const index of [2, 3, 4]) {
      const copy = [...parts];
      copy[index] = flip(copy[index]!);
      expect(codeOf(() => decryptField(copy.join(":"), ctx, r))).toMatch(
        /AUTHENTICATION_FAILED|MALFORMED_ENVELOPE/
      );
    }

    const wrongVersion = ["v1", ...parts.slice(1)].join(":");
    expect(codeOf(() => decryptField(wrongVersion, ctx, r))).toBe(
      "MALFORMED_ENVELOPE"
    );
    expect(
      codeOf(() => decryptField(parts.slice(0, 4).join(":"), ctx, r))
    ).toBe("MALFORMED_ENVELOPE");
    expect(codeOf(() => decryptField(`${parts.join(":")}:x`, ctx, r))).toBe(
      "MALFORMED_ENVELOPE"
    );
    expect(codeOf(() => decryptField("", ctx, r))).toBe("MALFORMED_ENVELOPE");
  });

  test("tampering with the key id is refused (unknown, or another ring key)", () => {
    const r = ring("k1", "k2");
    const parts = encryptField(SECRET, ctx, r).split(":");
    expect(
      codeOf(() =>
        decryptField(["v2", "zz", ...parts.slice(2)].join(":"), ctx, r)
      )
    ).toBe("UNKNOWN_KEY_ID");
    // Swapped to another valid ring key: wrong key, authentication fails.
    expect(
      codeOf(() =>
        decryptField(["v2", "k2", ...parts.slice(2)].join(":"), ctx, r)
      )
    ).toBe("AUTHENTICATION_FAILED");
  });

  test("AAD mismatch (other row, tenant or purpose) is refused", () => {
    const r = ring("k1");
    const envelope = encryptField(SECRET, ctx, r);

    for (const other of [
      { ...ctx, rowId: "row-2" },
      { ...ctx, tenantId: "tenant-b" },
      { ...ctx, purpose: "other_purpose:v1" }
    ]) {
      expect(codeOf(() => decryptField(envelope, other, r))).toBe(
        "AUTHENTICATION_FAILED"
      );
    }
  });

  test("AAD encoding is unambiguous across field boundaries", () => {
    const r = ring("k1");
    const envelope = encryptField(
      SECRET,
      { purpose: "ab", tenantId: "c", rowId: "d" },
      r
    );
    expect(
      codeOf(() =>
        decryptField(envelope, { purpose: "a", tenantId: "bc", rowId: "d" }, r)
      )
    ).toBe("AUTHENTICATION_FAILED");
  });

  test("an empty context field is refused", () => {
    const r = ring("k1");
    for (const bad of [
      { ...ctx, purpose: "" },
      { ...ctx, tenantId: "" },
      { ...ctx, rowId: "" }
    ]) {
      expect(codeOf(() => encryptField(SECRET, bad, r))).toBe(
        "INVALID_CONTEXT"
      );
    }
  });

  test("rotation: new writes use the first key, old rows still decrypt", () => {
    const k1 = ring("k1");
    const old = encryptField(SECRET, ctx, k1);
    const rotated: KeyRing = {
      ok: true,
      keys: [ring("k2").keys[0]!, ...k1.keys]
    };
    expect(envelopeKeyId(old)).toBe("k1");
    expect(envelopeKeyId(encryptField(SECRET, ctx, rotated))).toBe("k2");
    expect(decryptFieldToString(old, ctx, rotated)).toBe(SECRET);
    // Once k1 is dropped, the old row fails closed.
    const dropped: KeyRing = { ok: true, keys: [rotated.keys[0]!] };
    expect(codeOf(() => decryptField(old, ctx, dropped))).toBe(
      "UNKNOWN_KEY_ID"
    );
  });

  test("an empty ring cannot encrypt", () => {
    expect(
      codeOf(() => encryptField(SECRET, ctx, { ok: true, keys: [] }))
    ).toBe("KEY_RING_UNAVAILABLE");
  });

  test("error text never contains plaintext or key material", () => {
    const r = ring("k1");
    const other = ring("k1");
    const envelope = encryptField(SECRET, ctx, r);
    const messages: string[] = [];

    for (const attempt of [
      () => decryptField(envelope, ctx, other),
      () => decryptField(envelope, { ...ctx, rowId: "x" }, r),
      () => decryptField("v2:k1:bad:bad:bad", ctx, r),
      () => encryptField(SECRET, { ...ctx, rowId: "" }, r)
    ]) {
      try {
        attempt();
      } catch (error) {
        messages.push(String((error as Error).message), String(error));
      }
    }

    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).not.toContain(SECRET);
      for (const key of [...r.keys, ...other.keys]) {
        expect(message).not.toContain(key.key.toString("base64"));
        expect(message).not.toContain(key.key.toString("hex"));
      }
    }
  });
});

describe("parseKeyRing / resolveKeyRing", () => {
  test("parses pairs, first is active, reason names the variable only", () => {
    const parsed = parseKeyRing(`k2:${b64()}, k1:${b64()}`, ENV);
    expect(parsed.ok && parsed.keys.map((k) => k.id)).toEqual(["k2", "k1"]);
    expect(resolveKeyRing("X_KEYS", { X_KEYS: `a:${b64()}` }).ok).toBe(true);
  });

  test("refuses missing, malformed, placeholder, short, constant, duplicate", () => {
    const good = b64();
    const cases: (string | undefined)[] = [
      undefined,
      "  ",
      good,
      `:${good}`,
      `TOOLONGKEYID1:${good}`,
      `K1:${good}`,
      `k1:${Buffer.from("changeme-changeme-changeme-chang!").toString("base64")}`,
      `k1:${Buffer.from("this-is-an-example-key-0123456789ab").toString("base64")}`,
      `k1:${randomBytes(16).toString("base64")}`,
      `k1:${Buffer.alloc(32, 7).toString("base64")}`,
      `k1:${good},k1:${b64()}`,
      `k1:${good},k2:${good}`,
      `k1:${good},`
    ];

    for (const raw of cases) {
      const result = parseKeyRing(raw, ENV);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(ENV);
        expect(result.reason).not.toContain(good);
      }
    }
  });

  test("encryption rings require exactly 32 bytes and canonical base64 (resolveKeyRing)", () => {
    const strict = (raw: string) => resolveKeyRing("K", { K: raw });
    const good = b64();
    expect(strict(`k1:${good}`).ok).toBe(true);
    expect(strict(`k1:${randomBytes(64).toString("base64")}`).ok).toBe(false);
    expect(strict(`k1:${randomBytes(33).toString("base64")}`).ok).toBe(false);
    expect(strict(`k1:${randomBytes(31).toString("base64")}`).ok).toBe(false);
    // typo / inner whitespace / stray characters / non-canonical tail
    expect(strict(`k1:${good.slice(0, 10)} ${good.slice(10)}`).ok).toBe(false);
    expect(strict(`k1:${good.slice(0, 10)}!${good.slice(10)}`).ok).toBe(false);
    expect(strict(`k1:${good.slice(0, -2)}`).ok).toBe(false);
    const urlSafe = good.replace(/\+/g, "-").replace(/\//g, "_");
    if (urlSafe !== good) expect(strict(`k1:${urlSafe}`).ok).toBe(false);
    // duplicates compared on the effective key
    expect(strict(`k1:${good},k2:${good}`).ok).toBe(false);
    // the legacy (non-strict) parser keeps accepting longer keys (WhatsApp ring)
    expect(
      parseKeyRing(`k1:${randomBytes(64).toString("base64")}`, ENV).ok
    ).toBe(true);
  });

  test("hand-built rings: short keys refused for hash, non-32 refused for encryption", () => {
    const short: KeyRing = {
      ok: true,
      keys: [{ id: "k1", key: randomBytes(16) }]
    };
    const long: KeyRing = {
      ok: true,
      keys: [{ id: "k1", key: randomBytes(64) }]
    };
    const d = { purpose: "p", tenantId: "t" };
    expect(codeOf(() => keyedHash("v", d, short.keys[0]!))).toBe(
      "KEY_RING_UNAVAILABLE"
    );
    expect(codeOf(() => keyedHashPrimary("v", d, short))).toBe(
      "KEY_RING_UNAVAILABLE"
    );
    expect(codeOf(() => keyedHashCandidates("v", d, short))).toBe(
      "KEY_RING_UNAVAILABLE"
    );
    expect(codeOf(() => encryptField("x", ctx, short))).toBe(
      "KEY_RING_UNAVAILABLE"
    );
    expect(codeOf(() => encryptField("x", ctx, long))).toBe(
      "KEY_RING_UNAVAILABLE"
    );
    const good = ring("k1");
    const env = encryptField("x", ctx, good);
    const badRing: KeyRing = {
      ok: true,
      keys: [{ id: "k1", key: randomBytes(64) }]
    };
    expect(codeOf(() => decryptField(env, ctx, badRing))).toBe(
      "KEY_RING_UNAVAILABLE"
    );
  });

  test("there is no default: an unset variable is not ok", () => {
    expect(resolveKeyRing("NOPE_NOT_SET_KEYS", {}).ok).toBe(false);
  });
});

describe("keyed hash", () => {
  const domain = { purpose: "p:v1", tenantId: "tenant-a" };

  test("deterministic keyId:hex; separated by purpose, tenant, key and value", () => {
    const r = ring("k1");
    const h = keyedHash("v", domain, r.keys[0]!);
    expect(h).toMatch(/^k1:[0-9a-f]{64}$/);
    expect(h).toBe(keyedHash("v", domain, r.keys[0]!));
    expect(h).not.toBe(keyedHash("w", domain, r.keys[0]!));
    expect(h).not.toBe(
      keyedHash("v", { ...domain, purpose: "q:v1" }, r.keys[0]!)
    );
    expect(h).not.toBe(
      keyedHash("v", { ...domain, tenantId: "tenant-b" }, r.keys[0]!)
    );
    expect(h.slice(3)).not.toBe(
      keyedHash("v", domain, { id: "k1", key: randomBytes(32) }).slice(3)
    );
    // boundary ambiguity: ("ab","c") vs ("a","bc")
    expect(
      keyedHash("c", { purpose: "ab", tenantId: "t" }, r.keys[0]!)
    ).not.toBe(keyedHash("bc", { purpose: "a", tenantId: "t" }, r.keys[0]!));
  });

  test("candidates cover every ring key, active first; survives rotation", () => {
    const k1 = ring("k1");
    const stored = keyedHashPrimary("v", domain, k1);
    const rotated: KeyRing = {
      ok: true,
      keys: [ring("k2").keys[0]!, ...k1.keys]
    };
    const candidates = keyedHashCandidates("v", domain, rotated);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.startsWith("k2:")).toBe(true);
    expect(keyedHashPrimary("v", domain, rotated)).toBe(candidates[0]!);
    expect(matchesAnyHash(stored, candidates)).toBe(true);
    expect(
      matchesAnyHash(stored, keyedHashCandidates("w", domain, rotated))
    ).toBe(false);
  });

  test("constant-time comparison handles unequal lengths and empties", () => {
    expect(hashesEqual("k1:aa", "k1:aa")).toBe(true);
    expect(hashesEqual("k1:aa", "k1:ab")).toBe(false);
    expect(hashesEqual("k1:aa", "k1:aaa")).toBe(false);
    expect(matchesAnyHash("x", [])).toBe(false);
  });

  test("empty domain or empty ring is refused", () => {
    const r = ring("k1");
    expect(
      codeOf(() => keyedHash("v", { purpose: "", tenantId: "t" }, r.keys[0]!))
    ).toBe("INVALID_CONTEXT");
    expect(
      codeOf(() => keyedHashCandidates("v", domain, { ok: true, keys: [] }))
    ).toBe("KEY_RING_UNAVAILABLE");
    expect(
      codeOf(() => keyedHashPrimary("v", domain, { ok: true, keys: [] }))
    ).toBe("KEY_RING_UNAVAILABLE");
  });
});
