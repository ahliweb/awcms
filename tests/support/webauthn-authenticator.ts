/**
 * A software authenticator for the passkey verifier tests (ADR-0168 S1). It
 * builds `clientDataJSON`, authenticator data, attestation objects and
 * assertions from keys generated here, so every test can start from a VALID
 * ceremony and break exactly one thing. Test-only; never imported by `src/`.
 *
 * Every builder takes an `overrides` object so a test can replace one field
 * (a flag, a byte, a JSON member) and nothing else.
 */
import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject
} from "node:crypto";

export type Alg = -7 | -8 | -257;

// ---------------------------------------------------------------------------
// Minimal CBOR encoder (definite lengths, ints/bytes/text/arrays/maps).
// `raw` lets a test splice arbitrary bytes in where an item would go.

export class Raw {
  constructor(readonly bytes: Uint8Array) {}
}
export type Enc =
  number | string | Uint8Array | Raw | Enc[] | Map<number | string, Enc>;

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  if (n < 0x100000000)
    return [
      (major << 5) | 26,
      (n >>> 24) & 0xff,
      (n >> 16) & 0xff,
      (n >> 8) & 0xff,
      n & 0xff
    ];
  return [
    (major << 5) | 27,
    ...be32(Math.floor(n / 0x100000000)),
    ...be32(n >>> 0)
  ];
}
function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function cbor(value: Enc): Uint8Array {
  const out: number[] = [];
  const push = (v: Enc) => {
    if (v instanceof Raw) out.push(...v.bytes);
    else if (typeof v === "number")
      out.push(...(v >= 0 ? head(0, v) : head(1, -1 - v)));
    else if (typeof v === "string") {
      const b = new TextEncoder().encode(v);
      out.push(...head(3, b.length), ...b);
    } else if (v instanceof Uint8Array) out.push(...head(2, v.length), ...v);
    else if (Array.isArray(v)) {
      out.push(...head(4, v.length));
      v.forEach(push);
    } else {
      out.push(...head(5, v.size));
      for (const [k, x] of v) {
        push(k);
        push(x);
      }
    }
  };
  push(value);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------

export const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
export const fromHex = (h: string) => new Uint8Array(Buffer.from(h, "hex"));
export const sha256 = (b: Uint8Array | string) =>
  new Uint8Array(createHash("sha256").update(b).digest());
export const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export const RP_ID = "auth.example.test";
export const ORIGIN = "https://auth.example.test";

export interface TestKey {
  alg: Alg;
  privateKey: KeyObject;
  publicKey: KeyObject;
  cose: Map<number, Enc>;
}

export function coseFromPublicKey(
  alg: Alg,
  publicKey: KeyObject
): Map<number, Enc> {
  const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  const d = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
  if (alg === -7) {
    return new Map<number, Enc>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, d(jwk.x!)],
      [-3, d(jwk.y!)]
    ]);
  }
  if (alg === -8) {
    return new Map<number, Enc>([
      [1, 1],
      [3, -8],
      [-1, 6],
      [-2, d(jwk.x!)]
    ]);
  }
  return new Map<number, Enc>([
    [1, 3],
    [3, -257],
    [-1, d(jwk.n!)],
    [-2, d(jwk.e!)]
  ]);
}

const keyCache = new Map<string, TestKey>();
export function testKey(alg: Alg, slot = "default"): TestKey {
  const id = `${alg}:${slot}`;
  const hit = keyCache.get(id);
  if (hit) return hit;
  const pair =
    alg === -7
      ? generateKeyPairSync("ec", { namedCurve: "P-256" })
      : alg === -8
        ? generateKeyPairSync("ed25519")
        : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = { alg, ...pair, cose: coseFromPublicKey(alg, pair.publicKey) };
  keyCache.set(id, key);
  return key;
}

export function signWith(
  key: { alg: Alg; privateKey: KeyObject },
  data: Uint8Array
): Uint8Array {
  return new Uint8Array(
    sign(key.alg === -8 ? null : "sha256", data, key.privateKey)
  );
}

export interface ClientDataOverrides {
  type?: string;
  challenge?: string;
  origin?: string;
  extra?: Record<string, unknown>;
  omit?: string[];
  rawText?: string;
}

export function clientDataJSON(
  type: "webauthn.create" | "webauthn.get",
  challenge: Uint8Array,
  o: ClientDataOverrides = {}
): Uint8Array {
  if (o.rawText !== undefined) return new TextEncoder().encode(o.rawText);
  const body: Record<string, unknown> = {
    type: o.type ?? type,
    challenge: o.challenge ?? b64u(challenge),
    origin: o.origin ?? ORIGIN,
    crossOrigin: false,
    ...o.extra
  };
  for (const k of o.omit ?? []) delete body[k];
  return new TextEncoder().encode(JSON.stringify(body));
}

export interface AuthDataOverrides {
  rpId?: string;
  flags?: number;
  signCount?: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
  /** Declared credentialId length, when it must lie. */
  idLength?: number;
  coseBytes?: Uint8Array;
  extensions?: Uint8Array;
  trailing?: Uint8Array;
}

export const FLAG = {
  UP: 0x01,
  UV: 0x04,
  BE: 0x08,
  BS: 0x10,
  AT: 0x40,
  ED: 0x80
} as const;

export function authenticatorData(
  o: AuthDataOverrides & { attested?: boolean; cose?: Map<number, Enc> }
): Uint8Array {
  const flagsDefault =
    FLAG.UP |
    FLAG.UV |
    (o.attested ? FLAG.AT : 0) |
    (o.extensions ? FLAG.ED : 0);
  const flags = o.flags ?? flagsDefault;
  const count = o.signCount ?? 0;
  const header = concat(
    sha256(o.rpId ?? RP_ID),
    Uint8Array.of(flags),
    Uint8Array.from(be32(count))
  );
  const parts: Uint8Array[] = [header];
  if (o.attested) {
    const id = o.credentialId ?? new Uint8Array(32).fill(7);
    const len = o.idLength ?? id.length;
    parts.push(
      o.aaguid ?? new Uint8Array(16),
      Uint8Array.of(len >> 8, len & 0xff),
      id
    );
    parts.push(o.coseBytes ?? cbor(o.cose ?? new Map()));
  }
  if (o.extensions) parts.push(o.extensions);
  if (o.trailing) parts.push(o.trailing);
  return concat(...parts);
}

export interface RegistrationOptions {
  alg?: Alg;
  key?: TestKey;
  challenge?: Uint8Array;
  credentialId?: Uint8Array;
  fmt?: string;
  attStmt?: Enc;
  attestationExtra?: [string, Enc][];
  clientData?: ClientDataOverrides;
  clientDataBytes?: Uint8Array;
  authData?: AuthDataOverrides;
  authDataBytes?: Uint8Array;
  attestationBytes?: Uint8Array;
  id?: string;
  rawId?: string;
}

export const DEFAULT_CHALLENGE = new Uint8Array(32).fill(0x42);

export function makeRegistration(o: RegistrationOptions = {}) {
  const key = o.key ?? testKey(o.alg ?? -7);
  const challenge = o.challenge ?? DEFAULT_CHALLENGE;
  const credentialId = o.credentialId ?? sha256(`cred:${key.alg}`);
  const cd =
    o.clientDataBytes ??
    clientDataJSON("webauthn.create", challenge, o.clientData);
  const ad =
    o.authDataBytes ??
    authenticatorData({
      attested: true,
      credentialId,
      cose: key.cose,
      ...o.authData
    });
  let attStmt: Enc = o.attStmt ?? new Map();
  if (o.fmt === "packed" && o.attStmt === undefined) {
    // Self attestation: signed with the credential key itself. The verifier
    // must ignore it either way.
    attStmt = new Map<string, Enc>([
      ["alg", key.alg],
      ["sig", signWith(key, concat(ad, sha256(cd)))]
    ]);
  }
  const att =
    o.attestationBytes ??
    cbor(
      new Map<string, Enc>([
        ["fmt", o.fmt ?? "none"],
        ["attStmt", attStmt],
        ["authData", ad],
        ...(o.attestationExtra ?? [])
      ])
    );
  return {
    key,
    challenge,
    credentialId,
    response: {
      id: o.id ?? b64u(credentialId),
      rawId: o.rawId ?? b64u(credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64u(cd),
        attestationObject: b64u(att),
        transports: ["internal"]
      },
      clientExtensionResults: {}
    }
  };
}

export interface AssertionOptions {
  key?: TestKey;
  alg?: Alg;
  challenge?: Uint8Array;
  credentialId?: Uint8Array;
  clientData?: ClientDataOverrides;
  clientDataBytes?: Uint8Array;
  authData?: AuthDataOverrides & { attested?: boolean };
  authDataBytes?: Uint8Array;
  signature?: Uint8Array;
  /** Sign this instead of the real authData||hash(clientData). */
  signOver?: Uint8Array;
  userHandle?: string | null;
  id?: string;
  rawId?: string;
}

export const USER_HANDLE = new Uint8Array(32).fill(0x55);

export function makeAssertion(o: AssertionOptions = {}) {
  const key = o.key ?? testKey(o.alg ?? -7);
  const challenge = o.challenge ?? DEFAULT_CHALLENGE;
  const credentialId = o.credentialId ?? sha256(`cred:${key.alg}`);
  const cd =
    o.clientDataBytes ??
    clientDataJSON("webauthn.get", challenge, o.clientData);
  const ad =
    o.authDataBytes ?? authenticatorData({ signCount: 1, ...o.authData });
  const signature =
    o.signature ?? signWith(key, o.signOver ?? concat(ad, sha256(cd)));
  const response: Record<string, unknown> = {
    clientDataJSON: b64u(cd),
    authenticatorData: b64u(ad),
    signature: b64u(signature)
  };
  if (o.userHandle !== undefined) response.userHandle = o.userHandle;
  else response.userHandle = b64u(USER_HANDLE);
  return {
    key,
    challenge,
    credentialId,
    response: {
      id: o.id ?? b64u(credentialId),
      rawId: o.rawId ?? b64u(credentialId),
      type: "public-key",
      response,
      clientExtensionResults: {}
    }
  };
}
