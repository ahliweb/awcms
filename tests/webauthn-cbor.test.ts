/**
 * ADR-0168 S1: the CBOR subset decoder (A6.10, red matrix part of G4) and the
 * fuzz/property gate G5 for every parser an attacker reaches.
 *
 * G5 asserts, for random bytes, truncations, giant declared lengths, deep
 * nesting, duplicate keys and trailing bytes:
 *  - no exception ever escapes `verifyRegistration`/`verifyAssertion`/
 *    `tryDecodeCbor`;
 *  - nothing malformed is ever ACCEPTED;
 *  - the mean cost per input stays at or under 1 ms (measured, and printed so
 *    the PR can quote the number).
 */
import { describe, expect, test } from "bun:test";
import {
  CBOR_MAX_DEPTH,
  CBOR_MAX_INPUT_BYTES,
  decodeCbor,
  decodeCborItem,
  tryDecodeCbor
} from "../src/modules/identity-access/domain/webauthn-cbor";
import {
  verifyAssertion,
  verifyRegistration
} from "../src/modules/identity-access/domain/webauthn-verifier";
import {
  b64u,
  cbor,
  DEFAULT_CHALLENGE,
  makeAssertion,
  makeRegistration,
  ORIGIN,
  RP_ID,
  sha256,
  testKey,
  USER_HANDLE
} from "./support/webauthn-authenticator";

const h = (hex: string) =>
  Uint8Array.from(Buffer.from(hex.replace(/\s/g, ""), "hex"));
const refuses = (hex: string) => expect(tryDecodeCbor(h(hex)).ok).toBe(false);

describe("CBOR subset: accepted items", () => {
  test("ints, bytes, text, arrays, maps", () => {
    expect(decodeCbor(h("00"))).toBe(0);
    expect(decodeCbor(h("17"))).toBe(23);
    expect(decodeCbor(h("1818"))).toBe(24);
    expect(decodeCbor(h("190100"))).toBe(256);
    expect(decodeCbor(h("1a00010000"))).toBe(65536);
    expect(decodeCbor(h("1b001fffffffffffff"))).toBe(Number.MAX_SAFE_INTEGER);
    expect(decodeCbor(h("3b001ffffffffffffe"))).toBe(-Number.MAX_SAFE_INTEGER);
    expect(decodeCbor(h("20"))).toBe(-1);
    expect(decodeCbor(h("4401020304"))).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(decodeCbor(h("6449455446"))).toBe("IETF");
    expect(decodeCbor(h("83010203"))).toEqual([1, 2, 3]);
    expect(decodeCbor(h("a201020304"))).toEqual(
      new Map([
        [1, 2],
        [3, 4]
      ])
    );
    expect(decodeCbor(h("a1616101"))).toEqual(new Map([["a", 1]]));
  });

  test("non-shortest-form lengths are accepted (no re-encoding happens)", () => {
    expect(decodeCbor(h("1800"))).toBe(0);
  });

  test("depth exactly 4 is accepted", () => {
    expect(decodeCbor(h("81818180"))).toEqual([[[[]]]]);
  });

  test("decodeCborItem reports where the item ended", () => {
    expect(decodeCborItem(h("0102"), 0)).toEqual({ value: 1, end: 1 });
    expect(decodeCborItem(h("0102"), 1)).toEqual({ value: 2, end: 2 });
  });
});

describe("CBOR subset: refusals (red matrix)", () => {
  test("indefinite lengths", () => {
    refuses("5f42010243030405ff");
    refuses("9f0102ff");
    refuses("bf6161 01ff");
  });

  test("reserved additional info 28-30", () => {
    refuses("1c");
    refuses("1d");
    refuses("1e");
  });

  test("truncated argument", () => {
    refuses("19 01");
    refuses("1b 00 00 00");
    // decodeCborItem has no trailing-bytes backstop, so the bound must hold here.
    expect(() => decodeCborItem(h("19 01"))).toThrow("truncated argument");
  });

  test("integers above 2^53 - 1", () => {
    refuses("1b0020000000000000");
    refuses("1b0100000000000000");
    refuses("3b0020000000000000");
  });

  test("nesting deeper than 4", () => {
    expect(CBOR_MAX_DEPTH).toBe(4);
    refuses("8181818180");
    refuses("a1 01 a1 01 a1 01 a1 01 a0");
  });

  test("truncated item", () => {
    refuses("");
    refuses("82 01");
    refuses("a1 01");
    refuses("9b 001fffffffffffff 00");
  });

  test("tags", () => {
    // A bare tag with no trailing bytes: before the explicit major-6 refusal
    // these decoded as an EMPTY MAP (the tag fell through to the map branch),
    // and the older cases below only failed for unrelated reasons (trailing
    // byte, map-key type).
    refuses("c0");
    refuses("c1");
    refuses("c2 40");
    refuses("c0 00");
    refuses("d818 41 00");
    expect(() => decodeCbor(h("c0"))).toThrow("tags are not allowed");
  });

  test("simple values and floats, including true/false/null", () => {
    for (const hex of [
      "f4",
      "f5",
      "f6",
      "f7",
      "f93c00",
      "fa47c35000",
      "fb3ff199999999999a",
      "e0"
    ])
      refuses(hex);
  });

  test("a byte or text string longer than the input", () => {
    refuses("44 0102");
    refuses("64 4945");
    expect(() => decodeCborItem(h("44 0102"))).toThrow("truncated string");
  });

  test("invalid UTF-8 in text strings", () => {
    refuses("62 c328");
    refuses("61 ff");
  });

  test("map keys other than ints and text", () => {
    refuses("a1 4101 00");
    refuses("a1 80 00");
  });

  test("duplicate map keys", () => {
    refuses("a2 01 00 01 00");
    refuses("a2 6161 00 6161 00");
  });

  test("trailing bytes after the single item", () => {
    refuses("00 00");
  });

  test("input above 16 KiB", () => {
    expect(CBOR_MAX_INPUT_BYTES).toBe(16384);
    // A byte string with a 2-byte length (0x59) filling the buffer exactly.
    const exact = new Uint8Array(CBOR_MAX_INPUT_BYTES);
    exact.set([0x59, 0x3f, 0xfd]); // 16381 + 3 = 16384
    expect(tryDecodeCbor(exact).ok).toBe(true);
    const over = new Uint8Array(CBOR_MAX_INPUT_BYTES + 1);
    over.set([0x59, 0x3f, 0xfe]); // 16382 + 3 = 16385
    expect(tryDecodeCbor(over).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// G5 — fuzz / property tests.

/** Deterministic PRNG (mulberry32) so a failure is reproducible from the seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x1405;
const ITERATIONS = 4000;

function randomBytes(next: () => number, max: number): Uint8Array {
  const out = new Uint8Array(Math.floor(next() * max));
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(next() * 256);
  return out;
}

/** Mutations of a valid encoding: flip, truncate, extend, splice. */
function mutate(next: () => number, input: Uint8Array): Uint8Array {
  const kind = Math.floor(next() * 6);
  const copy = new Uint8Array(input);
  const at = Math.floor(next() * Math.max(1, copy.length));
  if (kind === 0 && copy.length)
    copy[at] = (copy[at] as number) ^ (1 << Math.floor(next() * 8));
  if (kind === 1) return copy.subarray(0, at);
  if (kind === 2) return Uint8Array.from([...copy, ...randomBytes(next, 8)]);
  if (kind === 3 && copy.length)
    copy[at] = [0x1b, 0x5b, 0x7b, 0x9b, 0xbb, 0x9f, 0xbf, 0xc0, 0xf5][
      Math.floor(next() * 9)
    ] as number;
  if (kind === 4)
    return Uint8Array.from([
      ...copy.subarray(0, at),
      ...randomBytes(next, 4),
      ...copy.subarray(at)
    ]);
  if (kind === 5 && copy.length) copy[at] = Math.floor(next() * 256);
  return copy;
}

const regExpected = {
  challengeDigest: sha256(DEFAULT_CHALLENGE),
  origins: [ORIGIN],
  rpId: RP_ID
};
const authExpected = {
  challengeDigest: sha256(DEFAULT_CHALLENGE),
  origins: [ORIGIN],
  allowCredentialIds: [sha256("cred:-7")],
  userHandle: USER_HANDLE
};
const storedCred = {
  credentialId: sha256("cred:-7"),
  publicKeyCose: cbor(testKey(-7).cose),
  alg: -7 as const,
  signCount: 0,
  backupEligible: false,
  rpId: RP_ID
};

function timeEach(label: string, inputs: number, body: () => void) {
  const before = process.memoryUsage().heapUsed;
  const start = Bun.nanoseconds();
  body();
  const perInputMs = (Bun.nanoseconds() - start) / 1e6 / inputs;
  const heapGrowthMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
  console.log(
    `[G5] ${label}: ${inputs} inputs, mean ${perInputMs.toFixed(4)} ms/input, heap delta ${heapGrowthMb.toFixed(1)} MiB`
  );
  expect(perInputMs).toBeLessThanOrEqual(1);
  return perInputMs;
}

describe("G5: fuzz / property", () => {
  test("random bytes into the CBOR decoder: never throws, accepts only well-formed items", () => {
    const next = rng(SEED);
    timeEach("cbor random bytes", ITERATIONS, () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const input = randomBytes(next, 64);
        let result;
        expect(() => (result = tryDecodeCbor(input))).not.toThrow();
        // Property: whatever is accepted re-decodes to the same value.
        if (result!.ok) expect(decodeCbor(input)).toEqual(result!.value);
      }
    });
  });

  test("hostile shapes: giant lengths, deep nesting, duplicate keys", () => {
    const shapes = [
      h("9b001fffffffffffff"), // array of 2^53 - 1 items, no items
      h("bb001fffffffffffff"), // map of 2^53 - 1 entries
      h("5b001fffffffffffff"), // byte string of 2^53 - 1 bytes
      h("7b001fffffffffffff"),
      new Uint8Array(10_000).fill(0x81), // 10k levels of nesting
      new Uint8Array(10_000).fill(0xa1),
      Uint8Array.from([0xb9, 0x27, 0x10, ...new Array(20_000).fill(0)]) // 10k entries, all key 0
    ];
    timeEach("cbor hostile shapes", shapes.length, () => {
      for (const s of shapes) expect(tryDecodeCbor(s).ok).toBe(false);
    });
  });

  test("mutated registrations: never throw; acceptance never changes the key or id", () => {
    const next = rng(SEED + 1);
    const base = makeRegistration();
    const att = Buffer.from(
      base.response.response.attestationObject,
      "base64url"
    );
    let accepted = 0;
    timeEach("registration mutations", ITERATIONS, () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const mutated = mutate(next, att);
        const response = {
          ...base.response,
          response: {
            ...base.response.response,
            attestationObject: b64u(mutated)
          }
        };
        let result;
        expect(
          () => (result = verifyRegistration(response, regExpected))
        ).not.toThrow();
        if (result!.ok) {
          accepted++;
          // Under attestation "none" nothing in a registration is signed (the
          // session and the challenge carry the trust), so a mutation that
          // still passes every check is legitimate: it touched telemetry such
          // as fmt, the AAGUID or the counter. It must never have changed the
          // public key or the credential id that get stored.
          const original = verifyRegistration(base.response, regExpected);
          expect(original.ok && result!.value.publicKeyCose).toEqual(
            original.ok && original.value.publicKeyCose
          );
          expect(original.ok && result!.value.credentialId).toEqual(
            original.ok && original.value.credentialId
          );
        }
      }
    });
    console.log(
      `[G5] registration mutations accepted (facts unchanged): ${accepted}`
    );
  });

  test("mutated assertions: never throw, never accept", () => {
    const next = rng(SEED + 2);
    const base = makeAssertion({ authData: { signCount: 2 } });
    const ad = Buffer.from(
      base.response.response.authenticatorData as string,
      "base64url"
    );
    const cd = Buffer.from(
      base.response.response.clientDataJSON as string,
      "base64url"
    );
    const sig = Buffer.from(
      base.response.response.signature as string,
      "base64url"
    );
    timeEach("assertion mutations", ITERATIONS, () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const target = i % 3;
        const r = { ...base.response.response };
        if (target === 0) r.authenticatorData = b64u(mutate(next, ad));
        if (target === 1) r.clientDataJSON = b64u(mutate(next, cd));
        if (target === 2) r.signature = b64u(mutate(next, sig));
        const unchanged =
          r.authenticatorData === base.response.response.authenticatorData &&
          r.clientDataJSON === base.response.response.clientDataJSON &&
          r.signature === base.response.response.signature;
        let result;
        expect(
          () =>
            (result = verifyAssertion(
              { ...base.response, response: r },
              authExpected,
              storedCred
            ))
        ).not.toThrow();
        if (!unchanged) expect(result!.ok).toBe(false);
      }
    });
  });

  test("random JSON-ish garbage into both ceremonies never throws or accepts", () => {
    const next = rng(SEED + 3);
    const pick = () => {
      const r = next();
      if (r < 0.2) return b64u(randomBytes(next, 200));
      if (r < 0.3) return null;
      if (r < 0.4) return Math.floor(next() * 1e6);
      if (r < 0.5) return { a: 1 };
      if (r < 0.6) return ["x"];
      return "A".repeat(Math.floor(next() * 30_000));
    };
    timeEach("garbage objects", ITERATIONS, () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const input = {
          id: pick(),
          rawId: pick(),
          type: next() < 0.8 ? "public-key" : pick(),
          response: {
            clientDataJSON: pick(),
            attestationObject: pick(),
            authenticatorData: pick(),
            signature: pick(),
            userHandle: pick()
          }
        };
        expect(verifyRegistration(input, regExpected).ok).toBe(false);
        expect(verifyAssertion(input, authExpected, storedCred).ok).toBe(false);
      }
    });
  });
});
