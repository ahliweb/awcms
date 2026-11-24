/**
 * ADR-0168 S1, gate G4: the red matrix for the passkey verifier.
 *
 * Every test starts from a VALID ceremony built by the software authenticator
 * in `tests/support/webauthn-authenticator.ts` and breaks exactly one thing, so
 * each normative check (amendment A6, items 1-10, and A7) has a test that
 * turns red when that check is deleted. The check each test guards is named in
 * its title as `[A6.n]`; the PR body carries the mutation table that proves it.
 */
import { describe, expect, test } from "bun:test";
import {
  createPublicKey,
  randomBytes,
  verify as cryptoVerify
} from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  decodeBase64UrlStrict,
  evaluateSignCount,
  parseAuthenticatorData,
  parseClientDataJSON,
  verifyAssertion,
  verifyRegistration,
  type AssertionExpectation,
  type RegistrationExpectation,
  type StoredCredential
} from "../src/modules/identity-access/domain/webauthn-verifier";
import {
  availableAlgorithms,
  parseCoseKey
} from "../src/modules/identity-access/domain/webauthn-cose";
import {
  authenticatorData,
  b64u,
  cbor,
  clientDataJSON,
  concat,
  DEFAULT_CHALLENGE,
  FLAG,
  fromHex,
  makeAssertion,
  makeRegistration,
  ORIGIN,
  Raw,
  RP_ID,
  sha256,
  signWith,
  testKey,
  USER_HANDLE,
  type Alg,
  type Enc
} from "./support/webauthn-authenticator";

const ALGS: Alg[] = [-7, -8, -257];

function regExpect(
  over: Partial<RegistrationExpectation> = {}
): RegistrationExpectation {
  return {
    challengeDigest: sha256(DEFAULT_CHALLENGE),
    origins: [ORIGIN],
    rpId: RP_ID,
    ...over
  };
}

function stored(
  alg: Alg = -7,
  over: Partial<StoredCredential> = {}
): StoredCredential {
  const key = testKey(alg);
  return {
    credentialId: sha256(`cred:${alg}`),
    publicKeyCose: cbor(key.cose),
    alg,
    signCount: 0,
    backupEligible: false,
    rpId: RP_ID,
    ...over
  };
}

function authExpect(
  alg: Alg = -7,
  over: Partial<AssertionExpectation> = {}
): AssertionExpectation {
  return {
    challengeDigest: sha256(DEFAULT_CHALLENGE),
    origins: [ORIGIN],
    allowCredentialIds: [sha256(`cred:${alg}`)],
    userHandle: USER_HANDLE,
    ...over
  };
}

const reason = (r: { ok: boolean; reason?: string }) =>
  r.ok ? "ok" : r.reason;

describe("valid ceremonies are accepted", () => {
  for (const alg of ALGS) {
    test(`registration, fmt none, alg ${alg}`, () => {
      const { response, key } = makeRegistration({ alg });
      const result = verifyRegistration(response, regExpect());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.alg).toBe(alg);
      expect(result.value.credentialId).toEqual(sha256(`cred:${alg}`));
      expect(result.value.publicKeyCose).toEqual(cbor(key.cose));
      expect(result.value.fmt).toBe("none");
      expect(result.value.rpId).toBe(RP_ID);
      expect(result.value.challengeDigest).toEqual(sha256(DEFAULT_CHALLENGE));
    });

    test(`assertion, alg ${alg}`, () => {
      const { response } = makeAssertion({ alg, authData: { signCount: 5 } });
      const result = verifyAssertion(
        response,
        authExpect(alg),
        stored(alg, { signCount: 4 })
      );
      expect(result).toEqual({
        ok: true,
        value: {
          credentialId: sha256(`cred:${alg}`),
          newSignCount: 5,
          backupState: false,
          challengeDigest: sha256(DEFAULT_CHALLENGE)
        }
      });
    });
  }

  test("packed self-attestation is accepted and its attStmt is never trusted", () => {
    const good = makeRegistration({ fmt: "packed" });
    expect(reason(verifyRegistration(good.response, regExpect()))).toBe("ok");
    // A garbage signature in attStmt changes nothing: attStmt is not verified.
    const garbage = makeRegistration({
      fmt: "packed",
      attStmt: new Map<string, Enc>([
        ["alg", -7],
        ["sig", new Uint8Array(70)]
      ])
    });
    expect(reason(verifyRegistration(garbage.response, regExpect()))).toBe(
      "ok"
    );
    const unknownFmt = makeRegistration({
      fmt: "tpm",
      attStmt: new Map<string, Enc>([["ver", "2.0"]])
    });
    const r = verifyRegistration(unknownFmt.response, regExpect());
    expect(r.ok && r.value.fmt).toBe("tpm");
  });

  test("backup-eligible synced passkey: BE=1, BS=1 registers and asserts", () => {
    const reg = makeRegistration({
      authData: { flags: FLAG.UP | FLAG.UV | FLAG.AT | FLAG.BE | FLAG.BS }
    });
    const r = verifyRegistration(reg.response, regExpect());
    expect(r.ok && [r.value.backupEligible, r.value.backupState]).toEqual([
      true,
      true
    ]);
    const a = makeAssertion({
      authData: { flags: FLAG.UP | FLAG.UV | FLAG.BE | FLAG.BS, signCount: 0 }
    });
    expect(
      reason(
        verifyAssertion(
          a.response,
          authExpect(),
          stored(-7, { backupEligible: true })
        )
      )
    ).toBe("ok");
  });

  test("extensions (ED) are parsed as one map on both ceremonies", () => {
    const ext = cbor(new Map<string, Enc>([["credProtect", 2]]));
    const reg = makeRegistration({ authData: { extensions: ext } });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe("ok");
    const a = makeAssertion({ authData: { extensions: ext } });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "ok"
    );
  });

  test("a null userHandle is accepted (non-discoverable credential)", () => {
    const a = makeAssertion({ userHandle: null });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "ok"
    );
  });

  test("a credential id of exactly 1023 bytes is accepted", () => {
    const credentialId = new Uint8Array(1023).fill(9);
    const reg = makeRegistration({ credentialId });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe("ok");
  });
});

describe("[A6.1] clientDataJSON: raw bytes, strict UTF-8, no BOM", () => {
  test("the signature covers the RAW clientDataJSON bytes, not a re-serialization", () => {
    // Same JSON value, different bytes (extra whitespace): the authenticator
    // signed the compact form, the client sends the spaced one.
    const compact = clientDataJSON("webauthn.get", DEFAULT_CHALLENGE);
    const spaced = new TextEncoder().encode(
      JSON.stringify(JSON.parse(new TextDecoder().decode(compact)), null, 1)
    );
    const ad = authenticatorData({ signCount: 1 });
    const key = testKey(-7);
    const a = makeAssertion({
      clientDataBytes: spaced,
      authDataBytes: ad,
      signature: signWith(key, concat(ad, sha256(compact)))
    });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "signature"
    );
  });

  test("a UTF-8 BOM is refused", () => {
    const body = clientDataJSON("webauthn.create", DEFAULT_CHALLENGE);
    const reg = makeRegistration({
      clientDataBytes: concat(Uint8Array.of(0xef, 0xbb, 0xbf), body)
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("the BOM refusal is our own check, not a JSON.parse side effect", () => {
    const body = clientDataJSON("webauthn.create", DEFAULT_CHALLENGE);
    expect(parseClientDataJSON(body).type).toBe("webauthn.create");
    // A BOM-tolerant parser would hide a removed check: assert WHICH layer refused.
    expect(() =>
      parseClientDataJSON(concat(Uint8Array.of(0xef, 0xbb, 0xbf), body))
    ).toThrow(/^malformed$/);
  });

  test("invalid UTF-8 is refused", () => {
    const body = clientDataJSON("webauthn.create", DEFAULT_CHALLENGE, {
      extra: { x: "AB" }
    });
    const broken = body.map((b, i, arr) =>
      b === 0x41 && arr[i + 1] === 0x42 ? 0xff : b
    );
    const reg = makeRegistration({ clientDataBytes: broken });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("clientDataJSON that is not a JSON object is refused", () => {
    for (const rawText of ["[]", "null", "42", "{"]) {
      const reg = makeRegistration({ clientData: { rawText } });
      expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
        "malformed"
      );
    }
  });
});

describe("[A6.2] type and challenge", () => {
  test("type must be exact", () => {
    for (const type of [
      "webauthn.get",
      "webauthn.create ",
      "WEBAUTHN.CREATE"
    ]) {
      const reg = makeRegistration({ clientData: { type } });
      expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
        "client_data"
      );
    }
    const a = makeAssertion({ clientData: { type: "webauthn.create" } });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "client_data"
    );
  });

  test("a different challenge is refused", () => {
    const reg = makeRegistration({ challenge: new Uint8Array(32).fill(1) });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "challenge"
    );
    const a = makeAssertion({ challenge: new Uint8Array(32).fill(1) });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "challenge"
    );
  });

  test("the challenge must be strict base64url (padding refused)", () => {
    const reg = makeRegistration({
      clientData: { challenge: `${b64u(DEFAULT_CHALLENGE)}=` }
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("a missing challenge is refused", () => {
    const reg = makeRegistration({ clientData: { omit: ["challenge"] } });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("the expected digest must be 32 bytes, so a misconfigured caller fails closed", () => {
    const reg = makeRegistration();
    expect(
      reason(
        verifyRegistration(
          reg.response,
          regExpect({ challengeDigest: new Uint8Array(0) })
        )
      )
    ).toBe("malformed");
  });
});

describe("[A6.3] origin, crossOrigin, topOrigin", () => {
  test("origin must match the allow-list exactly", () => {
    for (const origin of [
      "https://auth.example.test:443",
      "https://AUTH.example.test",
      "https://evil.test",
      "https://auth.example.test/"
    ]) {
      const reg = makeRegistration({ clientData: { origin } });
      expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
        "origin"
      );
    }
    const a = makeAssertion({ clientData: { origin: "https://evil.test" } });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "origin"
    );
  });

  test("a non-string origin is refused", () => {
    const reg = makeRegistration({
      clientData: { extra: { origin: [ORIGIN] } }
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "origin"
    );
  });

  test("an empty origin allow-list fails closed", () => {
    const reg = makeRegistration();
    expect(
      reason(verifyRegistration(reg.response, regExpect({ origins: [] })))
    ).toBe("malformed");
  });

  test("crossOrigin must be absent or false", () => {
    for (const crossOrigin of [true, "false", null, 0]) {
      const reg = makeRegistration({ clientData: { extra: { crossOrigin } } });
      expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
        "client_data"
      );
    }
    const absent = makeRegistration({ clientData: { omit: ["crossOrigin"] } });
    expect(reason(verifyRegistration(absent.response, regExpect()))).toBe("ok");
  });

  test("topOrigin must be absent", () => {
    const reg = makeRegistration({
      clientData: { extra: { topOrigin: ORIGIN } }
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "client_data"
    );
    const a = makeAssertion({ clientData: { extra: { topOrigin: ORIGIN } } });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "client_data"
    );
  });
});

describe("[A6.4] authenticator data", () => {
  test("shorter than 37 bytes is refused", () => {
    const a = makeAssertion({ authDataBytes: new Uint8Array(36) });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "malformed"
    );
    // Refused by the length check itself, not by a DataView RangeError.
    expect(() => parseAuthenticatorData(new Uint8Array(36))).toThrow(
      /^malformed$/
    );
  });

  test("authenticator data must be a byte string", () => {
    expect(() =>
      parseAuthenticatorData("x".repeat(64) as unknown as Uint8Array)
    ).toThrow(/^malformed$/);
    expect(() =>
      parseAuthenticatorData(new Array(64).fill(0) as unknown as Uint8Array)
    ).toThrow(/^malformed$/);
  });

  test("rpIdHash must be SHA-256 of the expected RP ID (registration) / stored rp_id (assertion)", () => {
    const reg = makeRegistration({ authData: { rpId: "example.test" } });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe("rp_id");
    const a = makeAssertion();
    expect(
      reason(
        verifyAssertion(
          a.response,
          authExpect(),
          stored(-7, { rpId: "other.example.test" })
        )
      )
    ).toBe("rp_id");
  });

  test("UP must be set", () => {
    const reg = makeRegistration({ authData: { flags: FLAG.UV | FLAG.AT } });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe("flags");
    const a = makeAssertion({ authData: { flags: FLAG.UV } });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "flags"
    );
  });

  test("UV must be set", () => {
    const reg = makeRegistration({ authData: { flags: FLAG.UP | FLAG.AT } });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe("flags");
    const a = makeAssertion({ authData: { flags: FLAG.UP } });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "flags"
    );
  });

  test("registration without attested credential data (AT=0) is refused", () => {
    const reg = makeRegistration({ authDataBytes: authenticatorData({}) });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("AT=1 on an assertion is refused", () => {
    const ad = authenticatorData({
      attested: true,
      credentialId: sha256("cred:-7"),
      cose: testKey(-7).cose,
      signCount: 1
    });
    const a = makeAssertion({ authDataBytes: ad });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "flags"
    );
  });

  test("attested data header truncated is refused", () => {
    const ad = concat(
      authenticatorData({ flags: FLAG.UP | FLAG.UV | FLAG.AT }),
      new Uint8Array(17)
    );
    const reg = makeRegistration({ authDataBytes: ad });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
    expect(() => parseAuthenticatorData(ad)).toThrow(/^malformed$/);
  });

  test("a credential id longer than 1023 bytes is refused", () => {
    const reg = makeRegistration({
      credentialId: new Uint8Array(1024).fill(9)
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
    // The authData limit holds on its own, independent of the rawId budget.
    const ad = authenticatorData({
      attested: true,
      credentialId: new Uint8Array(1024).fill(9),
      cose: testKey(-7).cose
    });
    expect(() => parseAuthenticatorData(ad)).toThrow(/^malformed$/);
  });

  test("a zero-length credential id is refused", () => {
    expect(() =>
      parseAuthenticatorData(
        authenticatorData({
          attested: true,
          credentialId: new Uint8Array(0),
          cose: testKey(-7).cose
        })
      )
    ).toThrow(/^malformed$/);
  });

  test("a declared credential id length past the end is refused", () => {
    const ad = authenticatorData({
      attested: true,
      credentialId: new Uint8Array(4),
      idLength: 600,
      coseBytes: new Uint8Array(0)
    });
    expect(() => parseAuthenticatorData(ad)).toThrow(/^malformed$/);
  });

  test("the COSE key must be a CBOR map", () => {
    const reg = makeRegistration({ authData: { coseBytes: cbor([1, 2]) } });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("bytes after the COSE key are refused when ED=0", () => {
    const reg = makeRegistration({
      authData: { trailing: Uint8Array.of(0xa0) }
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("bytes after the header are refused on an assertion without AT/ED", () => {
    const a = makeAssertion({ authData: { trailing: Uint8Array.of(0) } });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "malformed"
    );
  });

  test("ED=1 requires a map, and nothing after it", () => {
    const notMap = makeAssertion({ authData: { extensions: cbor([1]) } });
    expect(
      reason(verifyAssertion(notMap.response, authExpect(), stored()))
    ).toBe("malformed");
    const after = makeAssertion({
      authData: { extensions: cbor(new Map()), trailing: Uint8Array.of(0) }
    });
    expect(
      reason(verifyAssertion(after.response, authExpect(), stored()))
    ).toBe("malformed");
    const missing = makeAssertion({
      authData: { flags: FLAG.UP | FLAG.UV | FLAG.ED }
    });
    expect(
      reason(verifyAssertion(missing.response, authExpect(), stored()))
    ).toBe("malformed");
  });
});

describe("[A6.5] backup flags", () => {
  test("BS=1 with BE=0 is refused", () => {
    const reg = makeRegistration({
      authData: { flags: FLAG.UP | FLAG.UV | FLAG.AT | FLAG.BS }
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe("flags");
    const a = makeAssertion({
      authData: { flags: FLAG.UP | FLAG.UV | FLAG.BS }
    });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "flags"
    );
  });

  test("BE must not change from registration, in either direction", () => {
    const became = makeAssertion({
      authData: { flags: FLAG.UP | FLAG.UV | FLAG.BE }
    });
    expect(
      reason(verifyAssertion(became.response, authExpect(), stored()))
    ).toBe("flags");
    const lost = makeAssertion();
    expect(
      reason(
        verifyAssertion(
          lost.response,
          authExpect(),
          stored(-7, { backupEligible: true })
        )
      )
    ).toBe("flags");
  });
});

describe("[A6.6] credential identity", () => {
  test("id and rawId must be the same string", () => {
    const reg = makeRegistration({ id: b64u(new Uint8Array(32)) });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "credential"
    );
  });

  test("rawId must equal the credential id inside authenticator data", () => {
    const other = b64u(new Uint8Array(32).fill(3));
    const reg = makeRegistration({ id: other, rawId: other });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "credential"
    );
  });

  test("rawId must be strict base64url", () => {
    const id = `${b64u(sha256("cred:-7"))}=`;
    const reg = makeRegistration({ id, rawId: id });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("type must be public-key", () => {
    const reg = makeRegistration();
    expect(
      reason(
        verifyRegistration({ ...reg.response, type: "password" }, regExpect())
      )
    ).toBe("malformed");
  });

  test("an assertion for a different stored credential is refused", () => {
    const a = makeAssertion();
    expect(
      reason(
        verifyAssertion(
          a.response,
          authExpect(),
          stored(-7, { credentialId: new Uint8Array(32) })
        )
      )
    ).toBe("credential");
  });

  test("non-object input and response are refused", () => {
    for (const bad of [null, "x", [], 1]) {
      expect(reason(verifyRegistration(bad, regExpect()))).toBe("malformed");
      expect(reason(verifyAssertion(bad, authExpect(), stored()))).toBe(
        "malformed"
      );
    }
    const reg = makeRegistration();
    expect(
      reason(verifyRegistration({ ...reg.response, response: [] }, regExpect()))
    ).toBe("malformed");
  });
});

describe("[A6.7] COSE algorithm and key consistency", () => {
  const ec = testKey(-7).cose;
  const ed = testKey(-8).cose;
  const rsa = testKey(-257).cose;
  const withLabel = (
    base: Map<number, Enc>,
    label: number,
    value: Enc | undefined
  ) => {
    const m = new Map(base);
    if (value === undefined) m.delete(label);
    else m.set(label, value);
    return m;
  };
  const regWithCose = (cose: Map<number, Enc>) =>
    reason(
      verifyRegistration(
        makeRegistration({ authData: { coseBytes: cbor(cose) } }).response,
        regExpect()
      )
    );

  test("ES256 needs kty EC2 and crv P-256", () => {
    expect(regWithCose(withLabel(ec, 1, 1))).toBe("algorithm");
    expect(regWithCose(withLabel(ec, -1, 2))).toBe("algorithm"); // P-384
  });

  test("ES256 coordinates are 32-byte byte strings", () => {
    // The runtime ACCEPTS a 33-byte coordinate with a leading zero (measured on
    // Bun 1.4.4), so this length check is ours alone and is load-bearing.
    expect(
      regWithCose(
        withLabel(ec, -2, concat(Uint8Array.of(0), ec.get(-2) as Uint8Array))
      )
    ).toBe("algorithm");
    expect(() =>
      parseCoseKey(cbor(withLabel(ec, -2, new Uint8Array(31))))
    ).toThrow("label -2 length");
    expect(regWithCose(withLabel(ec, -2, new Uint8Array(31)))).toBe(
      "algorithm"
    );
    expect(regWithCose(withLabel(ec, -3, 5))).toBe("algorithm");
  });

  test("an EC point off the P-256 curve is refused", () => {
    const off = withLabel(
      ec,
      -3,
      (() => {
        const y = new Uint8Array(ec.get(-3) as Uint8Array);
        y[31] = (y[31] as number) ^ 1;
        return y;
      })()
    );
    expect(regWithCose(off)).toBe("algorithm");
  });

  test("EdDSA needs kty OKP and crv Ed25519 (Ed448 refused)", () => {
    expect(regWithCose(withLabel(ed, 1, 2))).toBe("algorithm");
    expect(regWithCose(withLabel(ed, -1, 7))).toBe("algorithm");
  });

  // #1456 G7 H1: BoringSSL accepts a non-canonical y (y >= p). y = p + 1 is the
  // identity, y = p a point of order 4; neither is byte-equal to a blocklist
  // entry. Wycheproof carries only canonical small-order keys.
  const NON_CANONICAL_H1 = [
    `ee${"ff".repeat(30)}7f`, // y = p + 1 -> identity
    `ee${"ff".repeat(31)}`, // same, sign bit set
    `ed${"ff".repeat(30)}7f`, // y = p -> order 4
    `ed${"ff".repeat(31)}` // same, sign bit set
  ];
  const edCose = (xHex: string) => withLabel(ed, -2, fromHex(xHex));

  test("H1: the four non-canonical small-order encodings are refused by the key parser", () => {
    for (const xHex of NON_CANONICAL_H1) {
      expect(() => parseCoseKey(cbor(edCose(xHex)))).toThrow(
        "non-canonical key"
      );
    }
  });

  test("H1: every y >= p (byte 0 in ed..ff, either sign bit) is refused", () => {
    for (let b0 = 0xed; b0 <= 0xff; b0++) {
      for (const top of ["7f", "ff"]) {
        const xHex = `${b0.toString(16)}${"ff".repeat(30)}${top}`;
        expect(() => parseCoseKey(cbor(edCose(xHex)))).toThrow(
          "non-canonical key"
        );
      }
    }
    // The largest canonical y (p - 1) is not "non-canonical": it is refused
    // as small-order (order 2) instead, by the masked blocklist.
    expect(() => parseCoseKey(cbor(edCose(`ec${"ff".repeat(30)}7f`)))).toThrow(
      "small-order key"
    );
  });

  test("H1: registration of a non-canonical small-order key is refused end to end", () => {
    for (const xHex of NON_CANONICAL_H1)
      expect(regWithCose(edCose(xHex))).toBe("algorithm");
  });

  test("H1: the constant signature R = B, S = 1 never verifies", () => {
    // Pinned hazard: the RUNTIME accepts this key and this constant signature
    // for any message. If this ever stops holding, the runtime fixed it; the
    // parser check below must stay regardless.
    const forged = fromHex(`58${"66".repeat(31)}01${"00".repeat(31)}`);
    const identity = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: b64u(fromHex(NON_CANONICAL_H1[0]!))
      },
      format: "jwk"
    });
    expect(cryptoVerify(null, randomBytes(32), identity, forged)).toBe(true);
    // Through our verifier: a stored credential carrying that key is refused
    // before any signature is checked, for a random challenge.
    const credentialId = sha256("cred:h1");
    const challenge = new Uint8Array(randomBytes(32));
    const a = makeAssertion({
      credentialId,
      challenge,
      authData: { signCount: 0 },
      signature: forged
    });
    const result = verifyAssertion(
      a.response,
      authExpect(-8, {
        challengeDigest: sha256(challenge),
        allowCredentialIds: [credentialId]
      }),
      stored(-8, {
        credentialId,
        publicKeyCose: cbor(edCose(NON_CANONICAL_H1[0]!))
      })
    );
    expect(reason(result)).toBe("algorithm");
  });

  test("small-order keys are refused with either sign bit (masked blocklist)", () => {
    for (const xHex of [
      `01${"00".repeat(30)}80`,
      `00${"00".repeat(30)}80`,
      `ec${"ff".repeat(31)}`,
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85"
    ]) {
      expect(() => parseCoseKey(cbor(edCose(xHex)))).toThrow("small-order key");
    }
  });

  test("Ed25519 small-order public keys are refused", () => {
    expect(
      regWithCose(withLabel(ed, -2, fromHex(`01${"00".repeat(31)}`)))
    ).toBe("algorithm");
  });

  test("RS256 needs kty RSA", () => {
    expect(regWithCose(withLabel(rsa, 1, 2))).toBe("algorithm");
  });

  test("RSA modulus: no leading zero, at least 2048 bits, at most 4096", () => {
    const n = rsa.get(-1) as Uint8Array;
    expect(regWithCose(withLabel(rsa, -1, concat(Uint8Array.of(0), n)))).toBe(
      "algorithm"
    );
    expect(regWithCose(withLabel(rsa, -1, n.slice(1)))).toBe("algorithm");
    const short = new Uint8Array(n);
    short[0] = 0x7f;
    expect(regWithCose(withLabel(rsa, -1, short))).toBe("algorithm"); // 2047 bits
    expect(
      regWithCose(
        withLabel(rsa, -1, concat(Uint8Array.of(1), new Uint8Array(512)))
      )
    ).toBe("algorithm");
  });

  test("RSA exponent must be 65537", () => {
    expect(regWithCose(withLabel(rsa, -2, Uint8Array.of(3)))).toBe("algorithm");
    expect(regWithCose(withLabel(rsa, -2, Uint8Array.of(0, 1, 0, 1)))).toBe(
      "algorithm"
    );
    expect(regWithCose(withLabel(rsa, -2, Uint8Array.of(1, 0, 3)))).toBe(
      "algorithm"
    );
  });

  test("unsupported algorithms are refused (-35 ES384, -36 ES512, -19 Ed25519, -65535 RS1)", () => {
    for (const alg of [-35, -36, -19, -65535, 0])
      expect(regWithCose(withLabel(ec, 3, alg))).toBe("algorithm");
  });

  test("alg and kty must be integers", () => {
    expect(regWithCose(withLabel(ec, 3, "ES256"))).toBe("algorithm");
    expect(regWithCose(withLabel(ec, 1, undefined))).toBe("algorithm");
  });

  test("the RSA modulus must be a byte string", () => {
    expect(regWithCose(withLabel(rsa, -1, 7))).toBe("algorithm");
  });

  test("a COSE key that is not a map is refused by the key parser", () => {
    expect(() => parseCoseKey(cbor([1]))).toThrow();
  });

  test("G1: an algorithm whose runtime probe fails or throws is never advertised", () => {
    const boom = () => {
      throw new Error("unsupported");
    };
    expect(
      availableAlgorithms([
        [-7, () => true],
        [-8, boom],
        [-257, () => false]
      ])
    ).toEqual([-7]);
  });

  test("the expectation can narrow the algorithms (policy)", () => {
    const reg = makeRegistration({ alg: -8 });
    expect(
      reason(verifyRegistration(reg.response, regExpect({ algorithms: [-7] })))
    ).toBe("algorithm");
  });

  test("assertion: the algorithm comes from the stored credential, never the response", () => {
    // Stored alg says RS256, stored key is ES256: refused rather than trusting
    // either one.
    const a = makeAssertion();
    expect(
      reason(
        verifyAssertion(a.response, authExpect(), stored(-7, { alg: -257 }))
      )
    ).toBe("algorithm");
  });
});

describe("[A6.8] signatures", () => {
  for (const alg of ALGS) {
    test(`a signature over different data is refused (alg ${alg})`, () => {
      const a = makeAssertion({ alg, signOver: new Uint8Array(10) });
      expect(
        reason(verifyAssertion(a.response, authExpect(alg), stored(alg)))
      ).toBe("signature");
    });

    test(`a signature by another key is refused (alg ${alg})`, () => {
      const a = makeAssertion({ alg, key: testKey(alg, "other") });
      expect(
        reason(verifyAssertion(a.response, authExpect(alg), stored(alg)))
      ).toBe("signature");
    });
  }

  test("ECDSA r = s = 0 (CVE-2022-21449) is refused", () => {
    const a = makeAssertion({ signature: fromHex("3006020100020100") });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "signature"
    );
  });

  test("ECDSA in P1363 form instead of DER is refused", () => {
    const a = makeAssertion();
    const der = Buffer.from(
      a.response.response.signature as string,
      "base64url"
    );
    const rLen = der[3] as number;
    const r = der.subarray(4, 4 + rLen);
    const s = der.subarray(6 + rLen);
    const fixed = (x: Uint8Array) => concat(new Uint8Array(32), x).slice(-32);
    const p1363 = concat(fixed(r), fixed(s));
    a.response.response.signature = b64u(p1363);
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "signature"
    );
  });

  test("ECDSA DER with a trailing byte is refused", () => {
    const a = makeAssertion();
    const der = Buffer.from(
      a.response.response.signature as string,
      "base64url"
    );
    a.response.response.signature = b64u(concat(der, Uint8Array.of(0)));
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "signature"
    );
  });

  test("a signature that is not strict base64url is refused", () => {
    const a = makeAssertion();
    a.response.response.signature = `${a.response.response.signature}=`;
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "malformed"
    );
  });
});

describe("[A6.9] allowCredentials and userHandle", () => {
  test("the credential must be in allowCredentials", () => {
    const a = makeAssertion();
    expect(
      reason(
        verifyAssertion(
          a.response,
          authExpect(-7, { allowCredentialIds: [new Uint8Array(32)] }),
          stored()
        )
      )
    ).toBe("credential");
  });

  test("an empty allowCredentials list refuses everything", () => {
    const a = makeAssertion();
    expect(
      reason(
        verifyAssertion(
          a.response,
          authExpect(-7, { allowCredentialIds: [] }),
          stored()
        )
      )
    ).toBe("credential");
  });

  test("a userHandle for another principal is refused", () => {
    const a = makeAssertion({ userHandle: b64u(new Uint8Array(32).fill(1)) });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "credential"
    );
  });

  test("a userHandle that is not strict base64url is refused", () => {
    const a = makeAssertion({ userHandle: "" });
    expect(reason(verifyAssertion(a.response, authExpect(), stored()))).toBe(
      "malformed"
    );
  });
});

describe("[A6.10] CBOR limits reach the ceremony", () => {
  test("an attestation object with an extra top-level key is refused", () => {
    const reg = makeRegistration({ attestationExtra: [["x", 1]] });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("an attestation object that is not a map is refused", () => {
    const reg = makeRegistration({ attestationBytes: cbor([1, 2, 3]) });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("fmt must be text, attStmt a map, authData bytes", () => {
    const base = makeRegistration();
    const att = (fmt: Enc, attStmt: Enc, authData: Enc) =>
      makeRegistration({
        attestationBytes: cbor(
          new Map<string, Enc>([
            ["fmt", fmt],
            ["attStmt", attStmt],
            ["authData", authData]
          ])
        )
      });
    const ad = authenticatorData({
      attested: true,
      credentialId: base.credentialId,
      cose: base.key.cose
    });
    expect(
      reason(verifyRegistration(att(1, new Map(), ad).response, regExpect()))
    ).toBe("malformed");
    expect(
      reason(verifyRegistration(att("none", [], ad).response, regExpect()))
    ).toBe("malformed");
    expect(
      reason(
        verifyRegistration(att("none", new Map(), "ad").response, regExpect())
      )
    ).toBe("malformed");
    expect(
      reason(
        verifyRegistration(att("none", new Map(), ad).response, regExpect())
      )
    ).toBe("ok");
  });

  test("a tag inside attStmt is refused even though attStmt is otherwise ignored", () => {
    const reg = makeRegistration({
      attStmt: new Map<string, Enc>([["x", new Raw(Uint8Array.of(0xc0))]])
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });

  test("an attestation object above 16 KiB is refused", () => {
    const reg = makeRegistration({
      attStmt: new Map<string, Enc>([["x", new Uint8Array(16 * 1024)]])
    });
    expect(reason(verifyRegistration(reg.response, regExpect()))).toBe(
      "malformed"
    );
  });
});

describe("[A7] sign counter", () => {
  test("rule table", () => {
    expect(evaluateSignCount(0, 0, false)).toEqual({ ok: true });
    expect(evaluateSignCount(0, 1, false)).toEqual({ ok: true });
    expect(evaluateSignCount(5, 6, false)).toEqual({ ok: true });
    expect(evaluateSignCount(5, 5, false)).toEqual({
      ok: false,
      reason: "counter_quarantine"
    });
    expect(evaluateSignCount(5, 4, false)).toEqual({
      ok: false,
      reason: "counter_quarantine"
    });
    expect(evaluateSignCount(5, 0, false)).toEqual({
      ok: false,
      reason: "counter_quarantine"
    });
    expect(evaluateSignCount(5, 5, true)).toEqual({
      ok: false,
      reason: "counter_synced"
    });
  });

  test("a counter that does not advance is refused with the BE-specific reason", () => {
    const a = makeAssertion({ authData: { signCount: 3 } });
    expect(
      reason(
        verifyAssertion(a.response, authExpect(), stored(-7, { signCount: 3 }))
      )
    ).toBe("counter_quarantine");
    const synced = makeAssertion({
      authData: { signCount: 3, flags: FLAG.UP | FLAG.UV | FLAG.BE }
    });
    expect(
      reason(
        verifyAssertion(
          synced.response,
          authExpect(),
          stored(-7, { signCount: 3, backupEligible: true })
        )
      )
    ).toBe("counter_synced");
  });

  test("the counter is evaluated only AFTER the signature: a forgery cannot quarantine", () => {
    const a = makeAssertion({
      authData: { signCount: 1 },
      key: testKey(-7, "other")
    });
    expect(
      reason(
        verifyAssertion(a.response, authExpect(), stored(-7, { signCount: 9 }))
      )
    ).toBe("signature");
  });
});

describe("strict base64url", () => {
  test("accepts canonical input and refuses everything else", () => {
    expect(decodeBase64UrlStrict("AQID", 16)).toEqual(Uint8Array.of(1, 2, 3));
    for (const bad of [
      "",
      "AQID=",
      "AQ==",
      "AQ+D",
      "AQ/D",
      "AQ D",
      "AR",
      "A",
      7,
      null
    ]) {
      expect(() => decodeBase64UrlStrict(bad, 16)).toThrow();
    }
  });

  test("refuses input longer than the byte budget before decoding", () => {
    expect(() => decodeBase64UrlStrict("A".repeat(24), 16)).toThrow();
    expect(decodeBase64UrlStrict("AAAAAAAAAAAAAAAAAAAAAA", 16).length).toBe(16);
  });
});

describe("S1 ships dark: nothing outside the pure module reaches it", () => {
  // ADR-0168 A10: S1 ships behind `AUTH_PASSKEY_ENABLED=false`. In S1 there is
  // no caller at all — no endpoint, no migration, no UI — so the flag itself
  // lands with the first caller (S3). Until then this test is the switch: it
  // turns red the moment anything in `src/` other than the three files of the
  // module imports them, which is when the flag (and G7 review) must exist.
  test("no file in src/ imports the webauthn modules except each other", () => {
    const root = join(import.meta.dir, "..");
    const own = new Set(
      ["webauthn-cbor.ts", "webauthn-cose.ts", "webauthn-verifier.ts"].map(
        (f) => `src/modules/identity-access/domain/${f}`
      )
    );
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const name = entry.name;
        const path = join(dir, name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile() && /\.(ts|astro|mts)$/.test(name)) {
          const rel = relative(root, path);
          if (
            !own.has(rel) &&
            /webauthn-(cbor|cose|verifier)/.test(readFileSync(path, "utf8"))
          )
            importers.push(rel);
        }
      }
    };
    walk(join(root, "src"));
    expect(importers).toEqual([]);
  });
});
