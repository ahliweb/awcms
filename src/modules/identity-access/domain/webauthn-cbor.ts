/**
 * The CBOR subset WebAuthn needs, and nothing more (ADR-0168 A6.10). Pure: no
 * I/O, no dependency.
 *
 * Everything a WebAuthn server reads in CBOR — the attestation object, the
 * COSE public key, the extensions map — is built from unsigned and negative
 * integers, byte strings, text strings, arrays and maps. This decoder accepts
 * exactly those and refuses the rest, so the parser an attacker can reach is
 * as small as the format allows:
 *
 * - no indefinite lengths (additional info 31) and no reserved encodings
 *   (28-30);
 * - no tags (major type 6) and no simple values or floats (major type 7) —
 *   which also means no `true`/`false`/`null`;
 * - integers and lengths above 2^53 - 1 are refused rather than rounded;
 * - nesting depth at most {@link CBOR_MAX_DEPTH}, input at most
 *   {@link CBOR_MAX_INPUT_BYTES};
 * - map keys are integers or text only, and a repeated key is refused (two
 *   readers that keep the first or the last value would otherwise disagree on
 *   what the key is);
 * - text strings are strict UTF-8.
 *
 * Nothing is allocated from a declared length: strings are bounded by the
 * bytes that remain, and arrays and maps are filled one decoded item at a
 * time, so a header announcing 2^53 elements fails at the first missing one. Shortest-form encoding is deliberately NOT required: the
 * signature covers the raw bytes, nothing is re-encoded, and the subset above
 * leaves no second way to read the same input.
 */

export const CBOR_MAX_DEPTH = 4;
export const CBOR_MAX_INPUT_BYTES = 16 * 1024;

export type CborValue = number | string | Uint8Array | CborValue[] | CborMap;
export type CborMap = Map<number | string, CborValue>;

/** The only exception this module throws; callers turn it into a rejection. */
export class CborError extends Error {}

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function fail(message: string): never {
  throw new CborError(message);
}

/**
 * Decodes ONE item starting at `offset` and returns where it ended. Used for
 * the COSE key and extensions embedded in authenticator data, where the caller
 * must then account for the bytes that follow.
 */
export function decodeCborItem(
  buf: Uint8Array,
  offset = 0
): { value: CborValue; end: number } {
  if (buf.length > CBOR_MAX_INPUT_BYTES) fail("input too large");
  const state = { pos: offset };
  const value = readItem(buf, state, 1);
  return { value, end: state.pos };
}

/** Decodes a buffer that must hold exactly one item — trailing bytes refused. */
export function decodeCbor(buf: Uint8Array): CborValue {
  const { value, end } = decodeCborItem(buf, 0);
  if (end !== buf.length) fail("trailing bytes");
  return value;
}

/** Never-throwing form, for callers and fuzz tests that want a plain result. */
export function tryDecodeCbor(
  buf: Uint8Array
): { ok: true; value: CborValue } | { ok: false } {
  try {
    return { ok: true, value: decodeCbor(buf) };
  } catch {
    return { ok: false };
  }
}

function readArgument(
  buf: Uint8Array,
  state: { pos: number },
  info: number
): number {
  if (info < 24) return info;
  const size =
    info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
  if (size === 0)
    fail(info === 31 ? "indefinite length" : "reserved additional info");
  if (state.pos + size > buf.length) fail("truncated argument");
  let value = 0;
  for (let i = 0; i < size; i++) {
    const byte = buf[state.pos + i] as number;
    // Refuse an 8-byte argument that would leave the exactly representable
    // integer range: 2^53 - 1 is 0x001FFFFFFFFFFFFF: the first byte must be zero and the
    // second at most 0x1f.
    if (size === 8 && i === 1 && (value > 0 || byte > 0x1f))
      fail("integer above 2^53");
    value = value * 256 + byte;
  }
  state.pos += size;
  return value;
}

function readItem(
  buf: Uint8Array,
  state: { pos: number },
  depth: number
): CborValue {
  if (depth > CBOR_MAX_DEPTH) fail("nesting too deep");
  if (state.pos >= buf.length) fail("truncated item");
  const initial = buf[state.pos] as number;
  state.pos += 1;
  const major = initial >> 5;
  // Refused before the argument is read: a tag would otherwise fall through to
  // the map branch below and decode as a map of `arg` entries.
  if (major === 6) fail("tags are not allowed");
  if (major === 7) fail("simple values and floats are not allowed");
  const arg = readArgument(buf, state, initial & 0x1f);
  switch (major) {
    case 0:
      return arg;
    case 1:
      // arg <= 2^53 - 1, so -1 - arg >= -2^53. That bottom value is exactly
      // representable but one below Number.MIN_SAFE_INTEGER; it is accepted
      // deliberately (no WebAuthn field comes near it) and decoded exactly.
      return -1 - arg;
    case 2:
    case 3: {
      if (arg > buf.length - state.pos) fail("truncated string");
      const bytes = buf.subarray(state.pos, state.pos + arg);
      state.pos += arg;
      if (major === 2) return bytes.slice();
      try {
        return utf8.decode(bytes);
      } catch {
        return fail("invalid UTF-8");
      }
    }
    case 4: {
      const items: CborValue[] = [];
      for (let i = 0; i < arg; i++) items.push(readItem(buf, state, depth + 1));
      return items;
    }
    default: {
      // major === 5 (6 and 7 were refused above)
      const map: CborMap = new Map();
      for (let i = 0; i < arg; i++) {
        const key = readItem(buf, state, depth + 1);
        if (typeof key !== "number" && typeof key !== "string")
          fail("map key type");
        if (map.has(key)) fail("duplicate map key");
        map.set(key, readItem(buf, state, depth + 1));
      }
      return map;
    }
  }
}
