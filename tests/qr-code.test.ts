/**
 * The local QR encoder (Issue #1316) is verified against an INDEPENDENT
 * decoder written here (format BCH check, unmasking, zig-zag read,
 * de-interleave, byte-mode parse) and against Reed-Solomon syndromes, not
 * against its own output. Pure: no database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  BLOCK_COUNT_M,
  ECC_CODEWORDS_PER_BLOCK_M,
  QrCapacityError,
  byteCapacity,
  encodeQr,
  qrPathData
} from "../src/lib/qr/qr-code";

// Capacities from ISO/IEC 18004 (byte mode, level M).
const SPEC_CAPACITY = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412
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

describe("enrolment screen wiring (Issue #1316)", () => {
  const read = (path: string) => Bun.file(path).text();

  test("the client renders the QR locally and never builds markup or requests", async () => {
    const client = await read("src/lib/ui/admin-account-client.ts");
    const start = client.indexOf("function renderEnrolmentQr");
    const end = client.indexOf("window.addEventListener", start);
    const body = client.slice(start, end);

    expect(body).toContain("encodeQr(otpauthUri)");
    expect(body).toContain("createElementNS");
    for (const forbidden of [
      "innerHTML",
      "insertAdjacentHTML",
      "fetch(",
      "XMLHttpRequest",
      "<img",
      "data:image",
      "console."
    ]) {
      expect(body).not.toContain(forbidden);
    }
    expect(body).not.toMatch(/setAttribute\([^)]*otpauthUri/);
  });

  test("the QR is cleared together with the secret, on completion and page exit", async () => {
    const client = await read("src/lib/ui/admin-account-client.ts");

    expect(client).toMatch(
      /function clearEnrolmentSecret\(\)[\s\S]*account-mfa-qr[\s\S]*account-mfa-secret/
    );
    expect(client).toContain(
      'addEventListener("pagehide", clearEnrolmentSecret)'
    );
    const verify = client.slice(
      client.indexOf('onSubmit("account-mfa-verify-form"')
    );
    const cleared = verify.indexOf("clearEnrolmentSecret()");
    expect(cleared).toBeGreaterThan(-1);
    expect(cleared).toBeLessThan(
      verify.indexOf("renderRecoveryCodes(result.data")
    );
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
