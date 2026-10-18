#!/usr/bin/env bun
/**
 * generate-pwa-icons.ts -- `bun run pwa:icons:generate` (Issue #1105).
 *
 * Writes the installable-admin icons into `public/icons/`:
 *
 *   icon-192.png            192x192  manifest, purpose "any"
 *   icon-512.png            512x512  manifest, purpose "any"
 *   icon-maskable-512.png   512x512  manifest, purpose "maskable"
 *   apple-touch-icon.png    180x180  `<link rel="apple-touch-icon">`
 *
 * ## Why a generator and not a design file
 *
 * The icons are a neutral placeholder mark (a ring around a dot on the admin
 * primary colour) -- deliberately NOT a consumer or tenant brand. A deployment
 * that wants its own artwork replaces the four PNGs (same names, same sizes);
 * the manifest and layout do not change. The generator is deterministic (pure
 * arithmetic + a fixed zlib level, no clock, no randomness) so the committed
 * bytes are reproducible and nothing is fetched from a CDN.
 *
 * Every icon is FULL-BLEED and opaque: iOS fills transparency with black on the
 * Home Screen, and a maskable icon must supply its own background. The mark sits
 * inside the central 60% so a maskable crop never touches it.
 */
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BACKGROUND: [number, number, number] = [0x25, 0x63, 0xeb];
const FOREGROUND: [number, number, number] = [0xff, 0xff, 0xff];

/** Coverage (0..1) of the mark at a point in 0..1 canvas space. */
function inMark(x: number, y: number): boolean {
  const distance = Math.hypot(x - 0.5, y - 0.5);
  const ring = distance <= 0.26 && distance >= 0.17;
  const dot = distance <= 0.075;

  return ring || dot;
}

/** 3x3 supersampling gives 0..9 covered samples, i.e. a 10-entry palette. */
const SAMPLES = 3;
const LEVELS = SAMPLES * SAMPLES + 1;

function render(size: number): Uint8Array {
  // Indexed colour, 4 bits per pixel: the art is two flat colours plus an
  // antialiased edge, so a 10-entry palette is exact and an order of magnitude
  // smaller than truecolour (the icons count against the app asset budget).
  const rowBytes = Math.ceil(size / 2);
  const raw = new Uint8Array(size * (1 + rowBytes));
  let offset = 0;

  for (let row = 0; row < size; row += 1) {
    raw[offset++] = 0; // PNG filter: none

    for (let col = 0; col < size; col += 2) {
      let packed = 0;

      for (let k = 0; k < 2; k += 1) {
        const px = col + k;
        let hits = 0;

        if (px < size) {
          for (let sy = 0; sy < SAMPLES; sy += 1) {
            for (let sx = 0; sx < SAMPLES; sx += 1) {
              const x = (px + (sx + 0.5) / SAMPLES) / size;
              const y = (row + (sy + 0.5) / SAMPLES) / size;
              if (inMark(x, y)) hits += 1;
            }
          }
        }

        packed = (packed << 4) | hits;
      }

      raw[offset++] = packed;
    }
  }

  return raw;
}

function palette(): Uint8Array {
  const out = new Uint8Array(LEVELS * 3);

  for (let level = 0; level < LEVELS; level += 1) {
    const coverage = level / (LEVELS - 1);

    for (let channel = 0; channel < 3; channel += 1) {
      out[level * 3 + channel] = Math.round(
        BACKGROUND[channel]! +
          (FOREGROUND[channel]! - BACKGROUND[channel]!) * coverage
      );
    }
  }

  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, Bun.hash.crc32(body));

  return out;
}

export function encodePng(size: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header[8] = 4; // bit depth
  header[9] = 3; // colour type: indexed

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", palette()),
    chunk("IDAT", deflateSync(render(size), { level: 9 })),
    chunk("IEND", new Uint8Array(0))
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let at = 0;

  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }

  return png;
}

export const ICON_FILES: ReadonlyArray<{ file: string; size: number }> = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 }
];

if (import.meta.main) {
  const outDir = path.resolve(import.meta.dir, "..", "public", "icons");
  await mkdir(outDir, { recursive: true });

  for (const { file, size } of ICON_FILES) {
    await writeFile(path.join(outDir, file), encodePng(size));
    console.log(`wrote public/icons/${file} (${size}x${size})`);
  }
}
