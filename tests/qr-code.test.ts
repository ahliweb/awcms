/**
 * The local QR encoder (Issue #1316) is verified against an INDEPENDENT
 * decoder written here (format BCH check, unmasking, zig-zag read,
 * de-interleave, byte-mode parse) and against Reed-Solomon syndromes, not
 * against its own output. Pure: no database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  BLOCK_COUNT_M as ENCODER_BLOCK_COUNT_M,
  ECC_CODEWORDS_PER_BLOCK_M as ENCODER_ECC_CODEWORDS_PER_BLOCK_M,
  QrCapacityError,
  byteCapacity,
  encodeQr,
  qrPathData
} from "../src/lib/qr/qr-code";
import {
  clearEnrolmentSecret,
  finishEnrolment,
  renderEnrolmentQr,
  restoreAfterPageCache
} from "../src/lib/ui/enrolment-qr";

// Capacities from ISO/IEC 18004 (byte mode, level M).
const SPEC_CAPACITY = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412
];

// Frozen from ISO/IEC 18004 Table 9, level M, versions 1-15. A literal copy
// on purpose: the decoder below must not share the encoder's tables, or a wrong
// table that keeps the same total ECC length would pass both.
const ECC_CODEWORDS_PER_BLOCK_M = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24
];
const BLOCK_COUNT_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];

// Version information words (18 bits) from ISO/IEC 18004 Annex D, versions 7-15.
const VERSION_INFO = [
  0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d,
  0x0f928
];

// Format words (15 bits, after masking) for ECC level M, masks 0..7.
const FORMAT_WORDS_M = [
  0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
  0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000
];

function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function isFunctionModule(version: number, x: number, y: number): boolean {
  const size = version * 4 + 17;
  if (x === 6 || y === 6) return true;
  if (x < 9 && y < 9) return true;
  if (x >= size - 8 && y < 9) return true;
  if (x < 9 && y >= size - 8) return true;
  if (
    version >= 7 &&
    ((x >= size - 11 && y < 6) || (y >= size - 11 && x < 6))
  ) {
    return true;
  }
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    const step = Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
    const pos = [6];
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (
          (i === 0 && j === 0) ||
          (i === 0 && j === n - 1) ||
          (i === n - 1 && j === 0)
        ) {
          continue;
        }
        if (Math.abs(x - pos[i]!) <= 2 && Math.abs(y - pos[j]!) <= 2) {
          return true;
        }
      }
    }
  }
  return false;
}

function inverted(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function decode(modules: readonly (readonly boolean[])[]): {
  text: string;
  mask: number;
} {
  const size = modules.length;
  const version = (size - 17) / 4;
  const at = (x: number, y: number) => (modules[y]![x]! ? 1 : 0);

  // Format info copy 1 must equal copy 2 and be a valid BCH word.
  let f1 = 0;
  for (let i = 0; i <= 5; i++) f1 |= at(8, i) << i;
  f1 |= at(8, 7) << 6;
  f1 |= at(8, 8) << 7;
  f1 |= at(7, 8) << 8;
  for (let i = 9; i < 15; i++) f1 |= at(14 - i, 8) << i;
  let f2 = 0;
  for (let i = 0; i < 8; i++) f2 |= at(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) f2 |= at(8, size - 15 + i) << i;
  expect(f2).toBe(f1);
  expect(FORMAT_WORDS_M).toContain(f1);
  const mask = FORMAT_WORDS_M.indexOf(f1);
  expect(at(8, size - 8)).toBe(1);

  if (version >= 7) {
    // Both copies of the version information must equal Annex D.
    let v1 = 0;
    let v2 = 0;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      v1 |= at(a, b) << i;
      v2 |= at(b, a) << i;
    }
    expect(v1).toBe(VERSION_INFO[version - 7]!);
    expect(v2).toBe(VERSION_INFO[version - 7]!);
  }

  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      const y = upward ? size - 1 - v : v;
      for (const x of [right, right - 1]) {
        if (isFunctionModule(version, x, y)) continue;
        bits.push(at(x, y) ^ (inverted(mask, x, y) ? 1 : 0));
      }
    }
    upward = !upward;
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    codewords.push(b);
  }

  const blocks = BLOCK_COUNT_M[version - 1]!;
  const eccLen = ECC_CODEWORDS_PER_BLOCK_M[version - 1]!;
  const total = codewords.length;
  const shortBlocks = blocks - (total % blocks);
  const shortLen = Math.floor(total / blocks);
  const dataBlocks: number[][] = Array.from({ length: blocks }, () => []);
  const eccBlocks: number[][] = Array.from({ length: blocks }, () => []);
  let k = 0;
  for (let i = 0; i < shortLen - eccLen + 1; i++) {
    for (let j = 0; j < blocks; j++) {
      if (i === shortLen - eccLen && j < shortBlocks) continue;
      dataBlocks[j]!.push(codewords[k++]!);
    }
  }
  for (let i = 0; i < eccLen; i++) {
    for (let j = 0; j < blocks; j++) eccBlocks[j]!.push(codewords[k++]!);
  }
  expect(k).toBe(total);

  // Reed-Solomon syndromes: each block evaluated at alpha^0..alpha^(ecc-1) is 0.
  for (let j = 0; j < blocks; j++) {
    const word = [...dataBlocks[j]!, ...eccBlocks[j]!];
    let root = 1;
    for (let s = 0; s < eccLen; s++) {
      let acc = 0;
      for (const c of word) acc = mul(acc, root) ^ c;
      expect(acc).toBe(0);
      root = mul(root, 2);
    }
  }

  const dbits = dataBlocks
    .flat()
    .flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >>> (7 - i)) & 1));
  const read = (from: number, n: number) =>
    dbits.slice(from, from + n).reduce((a, b) => (a << 1) | b, 0);
  expect(read(0, 4)).toBe(0b0100);
  const countBits = version < 10 ? 8 : 16;
  const length = read(4, countBits);
  const bytes = Array.from({ length }, (_, i) =>
    read(4 + countBits + i * 8, 8)
  );

  return { text: new TextDecoder().decode(new Uint8Array(bytes)), mask };
}

describe("QR encoder tables match the frozen ISO values", () => {
  test("block counts and ECC lengths per block (Table 9, level M)", () => {
    expect([...ENCODER_ECC_CODEWORDS_PER_BLOCK_M]).toEqual(
      ECC_CODEWORDS_PER_BLOCK_M
    );
    expect([...ENCODER_BLOCK_COUNT_M]).toEqual(BLOCK_COUNT_M);
  });

  test("version information of every version 7-15 matches Annex D", () => {
    for (let version = 7; version <= 15; version++) {
      const text = "a".repeat(byteCapacity(version));
      expect(encodeQr(text).version).toBe(version);
      decode(encodeQr(text).modules); // asserts both version-info copies
    }
  });

  test("golden vector: a version 8 otpauth symbol is byte-for-byte stable", () => {
    const uri =
      "otpauth://totp/AWCMS:user%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=AWCMS&algorithm=SHA1&digits=6&period=30";
    const matrix = encodeQr(uri);
    expect(matrix.version).toBe(8);
    const dump = matrix.modules
      .map((row) => row.map((m) => (m ? "1" : "0")).join(""))
      .join("");
    expect(new Bun.CryptoHasher("sha256").update(dump).digest("hex")).toBe(
      "81252dbe7e6ccfefaf36f4fa22224aa4d0560d5b3cd4b6ba3c450ccf0c3a6fb0"
    );
  });
});

describe("QR encoder capacity", () => {
  test("byte capacity matches the specification table for versions 1-15", () => {
    expect(Array.from({ length: 15 }, (_, i) => byteCapacity(i + 1))).toEqual(
      SPEC_CAPACITY
    );
  });

  test("a payload over the largest supported capacity is refused", () => {
    expect(() => encodeQr("a".repeat(413))).toThrow(QrCapacityError);
    expect(encodeQr("a".repeat(412)).version).toBe(15);
  });

  test("picks the smallest version that fits", () => {
    expect(encodeQr("a".repeat(14)).version).toBe(1);
    expect(encodeQr("a".repeat(15)).version).toBe(2);
    expect(encodeQr("a".repeat(213)).version).toBe(10);
    expect(encodeQr("a".repeat(214)).version).toBe(11);
  });
});

describe("QR encoder round trip against an independent decoder", () => {
  const otpauth =
    "otpauth://totp/AWCMS:user%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=AWCMS&algorithm=SHA1&digits=6&period=30";

  test("the otpauth URI decodes back exactly", () => {
    const matrix = encodeQr(otpauth);
    expect(decode(matrix.modules).text).toBe(otpauth);
    expect(decode(matrix.modules).mask).toBe(matrix.mask);
  });

  test("every supported version round-trips with valid RS syndromes", () => {
    for (let version = 1; version <= 15; version++) {
      const text = Array.from({ length: byteCapacity(version) }, (_, i) =>
        String.fromCharCode(33 + ((i * 7 + version) % 90))
      ).join("");
      const matrix = encodeQr(text);
      expect(matrix.version).toBe(version);
      expect(decode(matrix.modules).text).toBe(text);
    }
  });

  test("multi-byte UTF-8 survives", () => {
    const text = "otpauth://totp/Ünï:a?secret=ABC&issuer=日本";
    expect(decode(encodeQr(text).modules).text).toBe(text);
  });

  test("finder patterns, timing patterns and the dark module are in place", () => {
    const { modules, size } = encodeQr("hello");
    const finder = (ox: number, oy: number) => {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
          expect(modules[oy + y]![ox + x]).toBe(ring !== 2);
        }
      }
    };
    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6]![i]).toBe(i % 2 === 0);
      expect(modules[i]![6]).toBe(i % 2 === 0);
    }
    expect(modules[size - 8]![8]).toBe(true);
  });

  test("is deterministic", () => {
    expect(encodeQr(otpauth).modules).toEqual(encodeQr(otpauth).modules);
  });
});

// A minimal document stub: enough of the DOM for the enrolment module, so the
// tests below run the real code and inspect the resulting tree.
class FakeNode {
  hidden = false;
  textContent = "";
  readonly attributes = new Map<string, string>();
  children: FakeNode[] = [];
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  append(...nodes: FakeNode[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = nodes;
  }
}

function fakeDocument() {
  const byId = new Map<string, FakeNode>();
  for (const id of [
    "account-mfa-qr",
    "account-mfa-secret",
    "account-mfa-enrolment",
    "account-mfa-start-form"
  ]) {
    byId.set(id, new FakeNode("div"));
  }
  byId.get("account-mfa-enrolment")!.hidden = true;
  byId.get("account-mfa-start-form")!.hidden = true;
  const doc = {
    getElementById: (id: string) => byId.get(id) ?? null,
    createElementNS: (_ns: string, tag: string) => new FakeNode(tag)
  };
  return { doc: doc as unknown as Document, byId };
}

/** Every string held anywhere under (and including) a node. */
function strings(node: FakeNode): string[] {
  return [
    node.tag,
    node.textContent,
    ...node.attributes.keys(),
    ...node.attributes.values(),
    ...node.children.flatMap(strings)
  ];
}

describe("enrolment QR behaviour (Issue #1316)", () => {
  const uri =
    "otpauth://totp/AWCMS:user%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=AWCMS";
  const label = "QR code for your authenticator app.";

  test("the URI and its secret appear nowhere in the rendered tree", () => {
    const { doc, byId } = fakeDocument();
    renderEnrolmentQr(doc, uri, label);
    const host = byId.get("account-mfa-qr")!;

    expect(host.children).toHaveLength(1);
    const all = strings(host).join("\n");
    expect(all).not.toContain("otpauth");
    expect(all).not.toContain("JBSWY3DP");
    expect(all).not.toContain("secret=");
    expect(host.children[0]!.attributes.get("aria-label")).toBe(label);
  });

  test("clearing empties the QR and the secret text", () => {
    const { doc, byId } = fakeDocument();
    byId.get("account-mfa-secret")!.textContent = "JBSWY3DP";
    renderEnrolmentQr(doc, uri, label);
    clearEnrolmentSecret(doc);

    expect(byId.get("account-mfa-qr")!.children).toHaveLength(0);
    expect(byId.get("account-mfa-secret")!.textContent).toBe("");
  });

  test("finishing enrolment clears the QR as well", () => {
    const { doc, byId } = fakeDocument();
    renderEnrolmentQr(doc, uri, label);
    finishEnrolment(doc);

    expect(byId.get("account-mfa-qr")!.children).toHaveLength(0);
  });

  test("a URI over capacity leaves no QR and does not throw", () => {
    const { doc, byId } = fakeDocument();
    renderEnrolmentQr(doc, uri, label);
    renderEnrolmentQr(doc, "a".repeat(413), label);

    expect(byId.get("account-mfa-qr")!.children).toHaveLength(0);
  });

  test("a pending enrolment restored from the page cache offers the start form again", () => {
    const { doc, byId } = fakeDocument();
    renderEnrolmentQr(doc, uri, label);
    byId.get("account-mfa-enrolment")!.hidden = false;
    clearEnrolmentSecret(doc); // pagehide
    restoreAfterPageCache(doc); // pageshow, persisted

    expect(byId.get("account-mfa-enrolment")!.hidden).toBe(true);
    expect(byId.get("account-mfa-start-form")!.hidden).toBe(false);
  });

  test("a COMPLETED enrolment restored from the page cache is left alone", () => {
    const { doc, byId } = fakeDocument();
    renderEnrolmentQr(doc, uri, label);
    finishEnrolment(doc);
    restoreAfterPageCache(doc);

    expect(byId.get("account-mfa-start-form")!.hidden).toBe(true);
  });
});

describe("enrolment screen wiring (Issue #1316)", () => {
  const read = (path: string) => Bun.file(path).text();

  test("the module never builds markup, stores the URI or makes requests", async () => {
    const source = await read("src/lib/ui/enrolment-qr.ts");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

    for (const forbidden of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "DOMParser",
      "setHTMLUnsafe",
      "dataset",
      "sessionStorage",
      "localStorage",
      "indexedDB",
      "fetch(",
      "XMLHttpRequest",
      "sendBeacon",
      "<img",
      "data:image",
      "console."
    ]) {
      expect(code).not.toContain(forbidden);
    }
    // The URI is only ever the argument of the encoder.
    const uses = code.match(/otpauthUri/g) ?? [];
    expect(uses).toHaveLength(2); // the parameter and the encodeQr call
    expect(code).toContain("encodeQr(otpauthUri)");
  });

  test("the client wires clearing, completion and the page-cache restore", async () => {
    const client = await read("src/lib/ui/admin-account-client.ts");

    expect(client).toContain(
      'addEventListener("pagehide", () => clearEnrolmentSecret(document))'
    );
    expect(client).toContain("event.persisted");
    expect(client).toContain("restoreAfterPageCache(document)");
    const verify = client.slice(
      client.indexOf('onSubmit("account-mfa-verify-form"')
    );
    const cleared = verify.indexOf("finishEnrolment(document)");
    expect(cleared).toBeGreaterThan(-1);
    expect(cleared).toBeLessThan(
      verify.indexOf("renderRecoveryCodes(result.data")
    );
    expect(client).not.toMatch(/otpauthUri[^)]*\.(dataset|title)/);
  });

  test("the page has the QR host and its translated text alternative", async () => {
    const page = await read("src/pages/admin/account.astro");

    expect(page).toContain('id="account-mfa-qr"');
    expect(page).toContain("data-mfa-qr-label");
  });
});

describe("QR path data", () => {
  test("contains only path commands and digits (nothing to inject)", () => {
    const d = qrPathData(encodeQr("otpauth://totp/x?secret=ABC"));
    expect(d).toMatch(/^[Mhvz0-9 -]+$/);
  });
});
