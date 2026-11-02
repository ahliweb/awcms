/**
 * `compressImageForUpload` (Issue #1221) — the orchestration between the pure
 * planner and the browser ports, driven by a FAKE codec whose output size is a
 * function of (width, height, quality, type). That makes "reaches the cap by
 * quality, then by dimension" and "reaches the floor and says so" assertions
 * about exact attempts rather than about whatever a real encoder produced.
 */
import { describe, expect, test } from "bun:test";

import {
  compressImageForUpload,
  MAX_SOURCE_PIXELS,
  type DecodedImage,
  type ImageCompressionPorts
} from "../src/lib/ui/media-image-compression";

const MIB = 1024 * 1024;
const CAP = 2 * MIB;

type Encode = {
  width: number;
  height: number;
  quality: number;
  mimeType: string;
};

type Fake = {
  ports: ImageCompressionPorts;
  encodes: Encode[];
  state: { disposed: number; decoded: number; alphaChecked: number };
};

function blobOf(size: number, type: string): Blob {
  return new Blob([new Uint8Array(size)], { type });
}

/**
 * `size` maps one encode request to a byte count; `null` makes the codec say it
 * cannot produce that type.
 */
function fakePorts(options: {
  width: number;
  height: number;
  hasAlpha?: boolean;
  alphaThrows?: boolean;
  decodeThrows?: boolean;
  encodable?: string[];
  size: (request: Encode) => number | null;
  labelAs?: (request: Encode) => string;
}): Fake {
  const encodes: Encode[] = [];
  const state = { disposed: 0, decoded: 0, alphaChecked: 0 };

  const decoded: DecodedImage = {
    width: options.width,
    height: options.height,
    async hasAlpha() {
      state.alphaChecked += 1;
      if (options.alphaThrows) throw new Error("getImageData blocked");
      return options.hasAlpha ?? false;
    },
    async encode(request) {
      encodes.push(request);
      const bytes = options.size(request);
      if (bytes === null) return null;
      return blobOf(bytes, options.labelAs?.(request) ?? request.mimeType);
    },
    dispose() {
      state.disposed += 1;
    }
  };

  return {
    encodes,
    state,
    ports: {
      encodableTypes: options.encodable ?? ["image/webp", "image/jpeg"],
      async decode() {
        state.decoded += 1;
        if (options.decodeThrows) throw new Error("not an image");
        return decoded;
      }
    }
  };
}

function input(type: string, size: number, name = "photo.jpg") {
  return { name, type, size, blob: new Blob([], { type }) };
}

const never = () => {
  throw new Error("the browser ports must not be loaded");
};

describe("passthrough and refusal never touch the browser", () => {
  test("a within-cap file is returned unchanged and ports are never loaded", async () => {
    let loaded = false;
    let compressing = false;

    const result = await compressImageForUpload(
      input("image/jpeg", CAP - 10),
      CAP,
      {
        loadPorts: async () => {
          loaded = true;
          return null;
        },
        onCompressing: () => {
          compressing = true;
        }
      }
    );

    expect(result).toEqual({
      ok: true,
      changed: false,
      name: "photo.jpg",
      mimeType: "image/jpeg",
      byteSize: CAP - 10
    });
    expect(loaded).toBe(false);
    expect(compressing).toBe(false);
  });

  test("a GIF over the cap is refused with its own reason, before any decode", async () => {
    const result = await compressImageForUpload(
      input("image/gif", CAP + 1, "spin.gif"),
      CAP,
      { loadPorts: never as never }
    );

    expect(result).toEqual({
      ok: false,
      reason: "gif_over_cap",
      maxBytes: CAP,
      originalByteSize: CAP + 1
    });
  });

  test("a GIF within the cap goes through untouched", async () => {
    const result = await compressImageForUpload(
      input("image/gif", 5000, "spin.gif"),
      CAP,
      { loadPorts: never as never }
    );

    expect(result).toMatchObject({
      ok: true,
      changed: false,
      mimeType: "image/gif"
    });
  });

  test("an SVG over the cap is refused as not compressible", async () => {
    const result = await compressImageForUpload(
      input("image/svg+xml", CAP + 1, "logo.svg"),
      CAP,
      { loadPorts: never as never }
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "type_not_compressible"
    });
  });
});

describe("browser support is explicit", () => {
  test("oversize with no ports (no createImageBitmap/canvas) is a named failure, not an oversize upload", async () => {
    let compressing = false;

    const result = await compressImageForUpload(
      input("image/jpeg", 5 * MIB),
      CAP,
      {
        loadPorts: async () => null,
        onCompressing: () => {
          compressing = true;
        }
      }
    );

    expect(result).toEqual({
      ok: false,
      reason: "unsupported_browser",
      maxBytes: CAP,
      originalByteSize: 5 * MIB
    });
    expect(compressing).toBe(true);
  });

  test("a loader that throws is treated as unsupported, not as an unhandled error", async () => {
    const result = await compressImageForUpload(
      input("image/jpeg", 5 * MIB),
      CAP,
      {
        loadPorts: async () => {
          throw new Error("boom");
        }
      }
    );

    expect(result).toMatchObject({ ok: false, reason: "unsupported_browser" });
  });

  test("a file the browser cannot decode is a named failure", async () => {
    const fake = fakePorts({
      width: 100,
      height: 100,
      decodeThrows: true,
      size: () => 1
    });

    const result = await compressImageForUpload(
      input("image/png", 5 * MIB, "x.png"),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: false, reason: "decode_failed" });
  });

  test("an absurd pixel count is refused before any encode, and the bitmap is released", async () => {
    const fake = fakePorts({
      width: 20_000,
      height: MAX_SOURCE_PIXELS / 20_000 + 1,
      size: () => 1
    });

    const result = await compressImageForUpload(
      input("image/jpeg", 5 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: false, reason: "source_too_large" });
    expect(fake.encodes).toHaveLength(0);
    expect(fake.state.disposed).toBe(1);
  });

  test("a browser that encodes nothing is a named failure", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      encodable: [],
      size: () => 1
    });

    const result = await compressImageForUpload(
      input("image/jpeg", 5 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: false, reason: "no_encoder" });
    expect(fake.encodes).toHaveLength(0);
  });
});

describe("reaching the cap", () => {
  test("a photo that fits at the first attempt stops there", async () => {
    const fake = fakePorts({ width: 4000, height: 3000, size: () => MIB });

    const result = await compressImageForUpload(
      input("image/jpeg", 6 * MIB, "IMG_1.JPG"),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      width: 2560,
      height: 1920,
      byteSize: MIB,
      originalByteSize: 6 * MIB,
      attemptsUsed: 1
    });
    // First attempt encodes both candidates (webp + jpeg) and keeps the smaller.
    expect(fake.encodes.map((e) => e.mimeType)).toEqual([
      "image/webp",
      "image/jpeg"
    ]);
    expect(fake.encodes.every((e) => e.quality === 0.85)).toBe(true);
    expect(fake.state.disposed).toBe(1);
  });

  test("steps quality before dimension: fits at 0.65 on the first edge, never shrinks the picture", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      size: ({ quality }) => (quality > 0.7 ? 3 * MIB : 1.5 * MIB)
    });

    const result = await compressImageForUpload(
      input("image/png", 9 * MIB, "shot.png"),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      width: 2560,
      attemptsUsed: 3
    });
    expect(new Set(fake.encodes.map((e) => e.width))).toEqual(new Set([2560]));
    expect(fake.encodes.map((e) => e.quality)).toEqual([0.85, 0.75, 0.65]);
  });

  test("steps the long edge down once every quality at the larger edge is too big", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      // Only the 1600 px edge (or smaller) fits, at any quality.
      size: ({ width }) => (width > 1600 ? 4 * MIB : MIB)
    });

    const result = await compressImageForUpload(
      input("image/jpeg", 9 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      width: 1600,
      height: 1200,
      // 5 qualities at 2560 + 5 at 1920 + the first at 1600.
      attemptsUsed: 11
    });
  });

  test("the result is the SMALLER of WebP and JPEG for an opaque JPEG", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      size: ({ mimeType }) =>
        mimeType === "image/webp" ? 1.4 * MIB : 1.1 * MIB
    });

    const result = await compressImageForUpload(
      input("image/jpeg", 6 * MIB, "a.jpeg"),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      mimeType: "image/jpeg",
      name: "a.jpg"
    });
  });

  test("a result exactly at the cap is accepted", async () => {
    const fake = fakePorts({ width: 4000, height: 3000, size: () => CAP });

    const result = await compressImageForUpload(
      input("image/jpeg", 6 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: true, changed: true, byteSize: CAP });
  });

  test("an image already below the first step is not enlarged and keeps its size", async () => {
    const fake = fakePorts({
      width: 1500,
      height: 1000,
      size: ({ quality }) => (quality > 0.6 ? 3 * MIB : MIB)
    });

    const result = await compressImageForUpload(
      input("image/png", 5 * MIB, "big.png"),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      width: 1500,
      height: 1000
    });
    expect(fake.encodes.every((e) => e.width <= 1500 && e.height <= 1000)).toBe(
      true
    );
  });

  test("onCompressing fires once, before the ports are consulted", async () => {
    const order: string[] = [];
    const fake = fakePorts({ width: 4000, height: 3000, size: () => MIB });

    await compressImageForUpload(input("image/jpeg", 6 * MIB), CAP, {
      onCompressing: () => order.push("compressing"),
      loadPorts: async () => {
        order.push("ports");
        return fake.ports;
      }
    });

    expect(order).toEqual(["compressing", "ports"]);
  });
});

describe("alpha", () => {
  test("a transparent PNG is encoded as WebP only, so transparency survives", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      hasAlpha: true,
      size: () => MIB
    });

    const result = await compressImageForUpload(
      input("image/png", 6 * MIB, "logo.png"),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      mimeType: "image/webp",
      name: "logo.webp"
    });
    expect(fake.encodes.every((e) => e.mimeType === "image/webp")).toBe(true);
  });

  test("a JPEG is never scanned for alpha (it cannot have any)", async () => {
    const fake = fakePorts({ width: 4000, height: 3000, size: () => MIB });

    await compressImageForUpload(input("image/jpeg", 6 * MIB), CAP, {
      loadPorts: async () => fake.ports
    });

    expect(fake.state.alphaChecked).toBe(0);
  });

  test("a PNG IS scanned, and an opaque one may become JPEG when it is smaller", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      hasAlpha: false,
      encodable: ["image/jpeg"],
      size: () => MIB
    });

    const result = await compressImageForUpload(
      input("image/png", 6 * MIB, "photo.png"),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(fake.state.alphaChecked).toBe(1);
    expect(result).toMatchObject({
      ok: true,
      mimeType: "image/jpeg",
      name: "photo.jpg"
    });
  });

  test("if the alpha scan itself fails, transparency is assumed (WebP only)", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      alphaThrows: true,
      size: () => MIB
    });

    await compressImageForUpload(input("image/png", 6 * MIB, "x.png"), CAP, {
      loadPorts: async () => fake.ports
    });

    expect(fake.encodes.every((e) => e.mimeType === "image/webp")).toBe(true);
  });

  test("transparency with no WebP encoder is a named failure, never a flattened JPEG", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      hasAlpha: true,
      encodable: ["image/jpeg"],
      size: () => MIB
    });

    const result = await compressImageForUpload(
      input("image/png", 6 * MIB, "logo.png"),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: false, reason: "alpha_needs_webp" });
    expect(fake.encodes).toHaveLength(0);
  });
});

describe("the floor", () => {
  test("every attempt over the cap ends in floor_reached with the smallest size seen", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      // Gets smaller as the picture shrinks, but never fits.
      size: ({ width, quality }) => Math.round(width * quality * 5000)
    });

    const result = await compressImageForUpload(
      input("image/jpeg", 9 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toBe("floor_reached");
    expect(result.maxBytes).toBe(CAP);
    expect(result.originalByteSize).toBe(9 * MIB);
    // The floor attempt: 1280 px at quality 0.5.
    expect(result.smallestByteSize).toBe(1280 * 0.5 * 5000);
    // 20 attempts x 2 candidate types.
    expect(fake.encodes).toHaveLength(40);
    expect(fake.state.disposed).toBe(1);
  });

  test("nothing oversize is ever returned as a success", async () => {
    const fake = fakePorts({ width: 4000, height: 3000, size: () => CAP + 1 });

    const result = await compressImageForUpload(
      input("image/jpeg", 9 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: false, reason: "floor_reached" });
  });
});

describe("codec misbehaviour is not a result", () => {
  test("a blob labelled with another type (Safari answering PNG for WebP) drops that type and keeps going", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      size: () => MIB,
      labelAs: ({ mimeType }) =>
        mimeType === "image/webp" ? "image/png" : mimeType
    });

    const result = await compressImageForUpload(
      input("image/jpeg", 6 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: true, mimeType: "image/jpeg" });
    // WebP was tried once, found unusable, and not retried at later attempts.
    expect(
      fake.encodes.filter((e) => e.mimeType === "image/webp")
    ).toHaveLength(1);
  });

  test("when every type turns out unusable mid-run the failure is no_encoder", async () => {
    const fake = fakePorts({
      width: 4000,
      height: 3000,
      size: () => null
    });

    const result = await compressImageForUpload(
      input("image/jpeg", 6 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: false, reason: "no_encoder" });
    expect(fake.state.disposed).toBe(1);
  });

  test("an empty blob is not a result", async () => {
    const fake = fakePorts({ width: 4000, height: 3000, size: () => 0 });

    const result = await compressImageForUpload(
      input("image/jpeg", 6 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: false, reason: "no_encoder" });
  });

  test("an encode that throws drops that type; the other still works", async () => {
    const encodes: string[] = [];
    const ports: ImageCompressionPorts = {
      encodableTypes: ["image/webp", "image/jpeg"],
      async decode() {
        return {
          width: 4000,
          height: 3000,
          async hasAlpha() {
            return false;
          },
          async encode(request) {
            encodes.push(request.mimeType);
            if (request.mimeType === "image/webp") throw new Error("nope");
            return blobOf(MIB, request.mimeType);
          },
          dispose() {}
        };
      }
    };

    const result = await compressImageForUpload(
      input("image/jpeg", 6 * MIB),
      CAP,
      { loadPorts: async () => ports }
    );

    expect(result).toMatchObject({ ok: true, mimeType: "image/jpeg" });
  });

  test("the decoded bitmap is released even when the plan is rejected", async () => {
    const fake = fakePorts({ width: 0, height: 0, size: () => 1 });

    const result = await compressImageForUpload(
      input("image/jpeg", 6 * MIB),
      CAP,
      { loadPorts: async () => fake.ports }
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid_dimensions" });
    expect(fake.state.disposed).toBe(1);
  });
});
