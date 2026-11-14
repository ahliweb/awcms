/**
 * Dependency-free QR Code encoder (ISO/IEC 18004) for the TOTP enrolment screen
 * (Issue #1316).
 *
 * Scope is deliberately narrow: **byte mode, error correction level M,
 * versions 1-15** (up to 412 bytes), which is what an `otpauth://` URI needs.
 * A payload that does not fit throws `QrCapacityError`; the caller shows the
 * manual-entry secret instead. Nothing here touches the network or the DOM: the
 * URI carries the shared TOTP secret, so it must never leave the browser (no
 * third-party QR service, no image URL, no log line).
 *
 * The algorithm is the public one in the specification: Reed-Solomon over
 * GF(256) with polynomial 0x11D, interleaved blocks, zig-zag module placement,
 * eight mask patterns scored by the four penalty rules, BCH-protected format
 * and version information. `tests/qr-code.test.ts` verifies the output with an
 * independent decoder and Reed-Solomon syndromes.
 */

/** Error-correction codewords per block, ECC level M, index = version - 1. */
export const ECC_CODEWORDS_PER_BLOCK_M = [
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24
] as const;

/** Number of error-correction blocks, ECC level M, index = version - 1. */
export const BLOCK_COUNT_M = [
  1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10
] as const;

const MAX_VERSION = ECC_CODEWORDS_PER_BLOCK_M.length;

/** Format-information bits for ECC level M (`00`). */
const ECC_FORMAT_BITS_M = 0;

export interface QrMatrix {
  readonly version: number;
  readonly size: number;
  readonly mask: number;
  /** `modules[y][x]`, true = dark. */
  readonly modules: readonly (readonly boolean[])[];
}

/** Number of data+ECC modules in a version, minus function patterns. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;

  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }

  return result;
}

function dataCodewordCount(version: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK_M[version - 1]! * BLOCK_COUNT_M[version - 1]!
  );
}

/** Largest byte-mode payload at ECC M for a version. */
export function byteCapacity(version: number): number {
  const countBits = version < 10 ? 8 : 16;

  return Math.floor((dataCodewordCount(version) * 8 - 4 - countBits) / 8);
}

const MAX_BYTES = byteCapacity(MAX_VERSION);

export class QrCapacityError extends Error {
  readonly byteLength: number;

  constructor(byteLength: number) {
    super(
      `QR payload of ${byteLength} bytes exceeds the ${MAX_BYTES}-byte capacity`
    );
    this.name = "QrCapacityError";
    this.byteLength = byteLength;
  }
}

function gfMultiply(x: number, y: number): number {
  let z = 0;

  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }

  return z;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;

  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < degree) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }

  return result;
}

function reedSolomonRemainder(
  data: readonly number[],
  divisor: readonly number[]
): number[] {
  const result = new Array<number>(divisor.length).fill(0);

  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = result[i]! ^ gfMultiply(coefficient, factor);
    });
  }

  return result;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];

  const count = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const size = version * 4 + 17;
  const result = [6];

  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }

  return result;
}

function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    if (byteLength <= byteCapacity(version)) return version;
  }

  throw new QrCapacityError(byteLength);
}

function buildDataCodewords(
  bytes: readonly number[],
  version: number
): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const capacityBits = dataCodewordCount(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j]!;
    codewords.push(value);
  }

  for (
    let pad = 0xec;
    codewords.length < capacityBits / 8;
    pad ^= 0xec ^ 0x11
  ) {
    codewords.push(pad);
  }

  return codewords;
}

function interleaveWithEcc(data: readonly number[], version: number): number[] {
  const blockCount = BLOCK_COUNT_M[version - 1]!;
  const eccLength = ECC_CODEWORDS_PER_BLOCK_M[version - 1]!;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (rawCodewords % blockCount);
  const shortBlockLength = Math.floor(rawCodewords / blockCount);
  const divisor = reedSolomonDivisor(eccLength);
  const blocks: number[][] = [];

  for (let i = 0, k = 0; i < blockCount; i++) {
    const length = shortBlockLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    const ecc = reedSolomonRemainder(block, divisor);
    if (i < shortBlocks) block.push(0); // placeholder, skipped below
    blocks.push(block.concat(ecc));
  }

  const result: number[] = [];

  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLength - eccLength || j >= shortBlocks) {
        result.push(block[i]!);
      }
    });
  }

  return result;
}

function maskInverts(mask: number, x: number, y: number): boolean {
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

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false)
    );
    this.isFunction = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false)
    );
    this.drawFunctionPatterns();
  }

  private setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  private drawFunctionPatterns(): void {
    const { size, version } = this;

    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }

    for (const [cx, cy] of [
      [3, 3],
      [size - 4, 3],
      [3, size - 4]
    ] as const) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          this.setFunction(x, y, distance !== 2 && distance !== 4);
        }
      }
    }

    const positions = alignmentPositions(version);
    positions.forEach((cx, i) => {
      positions.forEach((cy, j) => {
        const isFinderCorner =
          (i === 0 && j === 0) ||
          (i === 0 && j === positions.length - 1) ||
          (i === positions.length - 1 && j === 0);
        if (isFinderCorner) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            this.setFunction(
              cx + dx,
              cy + dy,
              Math.max(Math.abs(dx), Math.abs(dy)) !== 1
            );
          }
        }
      });
    });

    this.drawFormatBits(0); // reserve the area; rewritten per mask
    this.drawVersion();
  }

  drawFormatBits(mask: number): void {
    const { size } = this;
    const data = (ECC_FORMAT_BITS_M << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) {
      remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    const bits = ((data << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(i));
    this.setFunction(8, size - 8, true); // the always-dark module
  }

  private drawVersion(): void {
    if (this.version < 7) return;

    let remainder = this.version;
    for (let i = 0; i < 12; i++) {
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }
    const bits = (this.version << 12) | remainder;

    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawCodewords(codewords: readonly number[]): void {
    const { size } = this;
    let i = 0;

    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;
          if (!this.isFunction[y]![x]! && i < codewords.length * 8) {
            this.modules[y]![x] =
              ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y]![x]! && maskInverts(mask, x, y)) {
          this.modules[y]![x] = !this.modules[y]![x];
        }
      }
    }
  }

  penalty(): number {
    const { size, modules } = this;
    let score = 0;

    const lines: boolean[][] = [];
    for (let y = 0; y < size; y++) lines.push(modules[y]!);
    for (let x = 0; x < size; x++) lines.push(modules.map((row) => row[x]!));

    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      const text = line.map((dark) => (dark ? "1" : "0")).join("");
      for (const pattern of ["10111010000", "00001011101"]) {
        let from = 0;
        for (;;) {
          const at = text.indexOf(pattern, from);
          if (at < 0) break;
          score += 40;
          from = at + 1;
        }
      }
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = modules[y]![x];
        if (
          color === modules[y]![x + 1] &&
          color === modules[y + 1]![x] &&
          color === modules[y + 1]![x + 1]
        ) {
          score += 3;
        }
      }
    }

    let dark = 0;
    for (const row of modules) for (const cell of row) if (cell) dark++;
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;

    return score;
  }
}

/**
 * Encode `text` (UTF-8, byte mode, ECC M) into a module matrix.
 *
 * @throws QrCapacityError when the UTF-8 form exceeds 412 bytes.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = chooseVersion(bytes.length);
  const codewords = interleaveWithEcc(
    buildDataCodewords(bytes, version),
    version
  );
  const grid = new Grid(version);
  grid.drawCodewords(codewords);

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask++) {
    grid.applyMask(mask);
    grid.drawFormatBits(mask);
    const score = grid.penalty();
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    grid.applyMask(mask); // XOR again: undo
  }

  grid.applyMask(bestMask);
  grid.drawFormatBits(bestMask);

  return {
    version,
    size: grid.size,
    mask: bestMask,
    modules: grid.modules.map((row) => [...row])
  };
}

/**
 * SVG path data (`M x y h1 v1 h-1 z` per dark module, offset by the quiet
 * zone). Numbers only: there is nothing to escape, and the result is placed in
 * a `d` attribute via `setAttribute`, never parsed as markup.
 */
export function qrPathData(matrix: QrMatrix, border = 4): string {
  const parts: string[] = [];

  matrix.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + border} ${y + border}h1v1h-1z`);
    });
  });

  return parts.join("");
}

/** Edge length of the viewBox for a matrix plus quiet zone. */
export function qrViewBoxSize(matrix: QrMatrix, border = 4): number {
  return matrix.size + border * 2;
}
