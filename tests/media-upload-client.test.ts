/**
 * `uploadMediaBytes` (Issue #595) — the three-step direct-to-R2 upload.
 *
 * The transport is injected, so these drive the SEQUENCE without a browser:
 * what runs, in what order, what cancels when, and which error survives when
 * two things fail at once.
 *
 * The cases that matter are the failure paths. A created session is a
 * `pending_upload` row, so every abandonment is an orphan somebody's job has to
 * clean up — "it cancelled" is the property under test, not an implementation
 * detail.
 */
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_COMPRESSION_MESSAGES,
  describeCompressionFailure,
  describeCompressionSuccess,
  describeUploadFailure,
  formatProgress,
  readCompressionMessages,
  uploadMediaBytes,
  uploadMediaFile,
  type CompressionSummary,
  type UploadMediaFileOutcome,
  type UploadSessionData,
  type UploadTransport
} from "../src/lib/ui/media-upload-client";
import type {
  DecodedImage,
  ImageCompressionPorts
} from "../src/lib/ui/media-image-compression";

const SESSION: UploadSessionData = {
  objectId: "obj-1",
  objectKey: "news/2026/obj-1.jpg",
  presignedUrl: "https://acct.r2.cloudflarestorage.com/bucket/key?sig=x",
  expiresAt: "2026-08-20T00:00:00.000Z"
};

const FILE = {
  name: "photo.jpg",
  type: "image/jpeg",
  bytes: new Uint8Array([1, 2, 3, 4]).buffer
};

type Calls = string[];

function transportFor(
  calls: Calls,
  overrides: Partial<UploadTransport> = {}
): UploadTransport {
  return {
    async createSession() {
      calls.push("createSession");
      return { ok: true, data: SESSION, errorCode: null };
    },
    async putBytes({ onProgress }) {
      calls.push("putBytes");
      onProgress({ loaded: 4, total: 4 });
      return { ok: true, errorCode: null };
    },
    async finalize() {
      calls.push("finalize");
      return { ok: true, errorCode: null };
    },
    async cancel() {
      calls.push("cancel");
    },
    async digest() {
      calls.push("digest");
      return "a".repeat(64);
    },
    ...overrides
  };
}

describe("uploadMediaBytes — the happy path", () => {
  test("runs session -> transfer -> digest -> finalize, and never cancels", async () => {
    const calls: Calls = [];

    const outcome = await uploadMediaBytes(FILE, transportFor(calls));

    expect(outcome).toEqual({ ok: true, objectId: "obj-1" });
    expect(calls).toEqual(["createSession", "putBytes", "digest", "finalize"]);
    expect(calls).not.toContain("cancel");
  });

  test("declares the real byte length, not something the caller passed in", async () => {
    let declared = -1;
    const calls: Calls = [];

    await uploadMediaBytes(
      FILE,
      transportFor(calls, {
        async createSession(input) {
          declared = input.byteSize;
          return { ok: true, data: SESSION, errorCode: null };
        }
      })
    );

    expect(declared).toBe(4);
  });

  test("reports progress to the caller", async () => {
    const seen: number[] = [];

    await uploadMediaBytes(FILE, transportFor([]), (progress) =>
      seen.push(progress.loaded)
    );

    expect(seen).toEqual([4]);
  });
});

describe("uploadMediaBytes — failure paths all leave no pending session", () => {
  test("a failed session start sends nothing and has nothing to cancel", async () => {
    const calls: Calls = [];

    const outcome = await uploadMediaBytes(
      FILE,
      transportFor(calls, {
        async createSession() {
          calls.push("createSession");
          return { ok: false, data: null, errorCode: "PROVIDER_ERROR" };
        }
      })
    );

    expect(outcome).toEqual({
      ok: false,
      step: "session",
      errorCode: "PROVIDER_ERROR"
    });
    // Nothing was created, so cancelling would be a call against an id that
    // does not exist.
    expect(calls).toEqual(["createSession"]);
  });

  test("a failed transfer CANCELS the session it created", async () => {
    const calls: Calls = [];

    const outcome = await uploadMediaBytes(
      FILE,
      transportFor(calls, {
        async putBytes() {
          calls.push("putBytes");
          return { ok: false, errorCode: "STORAGE_403" };
        }
      })
    );

    expect(outcome).toEqual({
      ok: false,
      step: "transfer",
      errorCode: "STORAGE_403"
    });
    expect(calls).toEqual(["createSession", "putBytes", "cancel"]);
  });

  test("a failed finalize CANCELS too — the bytes landed but nothing references them", async () => {
    const calls: Calls = [];

    const outcome = await uploadMediaBytes(
      FILE,
      transportFor(calls, {
        async finalize() {
          calls.push("finalize");
          return { ok: false, errorCode: "VALIDATION_ERROR" };
        }
      })
    );

    expect(outcome).toEqual({
      ok: false,
      step: "finalize",
      errorCode: "VALIDATION_ERROR"
    });
    expect(calls).toContain("cancel");
  });

  test("a cancel that itself fails does not replace the error the operator can act on", async () => {
    const calls: Calls = [];

    const outcome = await uploadMediaBytes(
      FILE,
      transportFor(calls, {
        async putBytes() {
          return { ok: false, errorCode: "STORAGE_500" };
        },
        async cancel() {
          calls.push("cancel");
          throw new Error("cancel endpoint is down too");
        }
      })
    );

    // The transfer error survives; the cancel failure is swallowed because the
    // orphan-reconcile job is the backstop and "cleanup also failed" is not
    // something the person uploading can do anything about.
    expect(outcome).toEqual({
      ok: false,
      step: "transfer",
      errorCode: "STORAGE_500"
    });
    expect(calls).toContain("cancel");
  });

  test("a missing error code degrades to UNKNOWN rather than undefined", async () => {
    const outcome = await uploadMediaBytes(
      FILE,
      transportFor([], {
        async createSession() {
          return { ok: false, data: null, errorCode: null };
        }
      })
    );

    expect(outcome).toEqual({
      ok: false,
      step: "session",
      errorCode: "UNKNOWN"
    });
  });

  test("ok:true with no data is treated as a failure, not dereferenced", async () => {
    // A malformed success response must not crash the flow.
    const outcome = await uploadMediaBytes(
      FILE,
      transportFor([], {
        async createSession() {
          return { ok: true, data: null, errorCode: null };
        }
      })
    );

    expect(outcome.ok).toBe(false);
  });
});

describe("uploadMediaBytes — the checksum is optional", () => {
  test("finalizes with null when crypto.subtle is unavailable, rather than failing", async () => {
    // The LAN/offline profile is a supported deployment and may be plain HTTP,
    // where `crypto.subtle` does not exist. An upload must still complete.
    let sent: string | null | undefined;
    const calls: Calls = [];

    const outcome = await uploadMediaBytes(
      FILE,
      transportFor(calls, {
        async digest() {
          return null;
        },
        async finalize({ checksumSha256 }) {
          sent = checksumSha256;
          return { ok: true, errorCode: null };
        }
      })
    );

    expect(outcome.ok).toBe(true);
    expect(sent).toBeNull();
  });

  test("a THROWING digest does not fail the upload either", async () => {
    let sent: string | null | undefined;

    const outcome = await uploadMediaBytes(
      FILE,
      transportFor([], {
        async digest() {
          throw new Error("subtle crypto exploded");
        },
        async finalize({ checksumSha256 }) {
          sent = checksumSha256;
          return { ok: true, errorCode: null };
        }
      })
    );

    expect(outcome.ok).toBe(true);
    expect(sent).toBeNull();
  });

  test("passes the digest through when there is one", async () => {
    let sent: string | null | undefined;

    await uploadMediaBytes(
      FILE,
      transportFor([], {
        async finalize({ checksumSha256 }) {
          sent = checksumSha256;
          return { ok: true, errorCode: null };
        }
      })
    );

    expect(sent).toBe("a".repeat(64));
  });
});

describe("describeUploadFailure", () => {
  test("a provider error names an administrator, because retrying cannot fix it", () => {
    const message = describeUploadFailure({
      step: "session",
      errorCode: "PROVIDER_ERROR"
    });

    expect(message).toContain("administrator");
    expect(message).not.toContain("try again");
  });

  test("a transfer failure says nothing is left half-written", () => {
    const message = describeUploadFailure({
      step: "transfer",
      errorCode: "STORAGE_500"
    });

    expect(message).toContain("cancelled");
  });

  test("every step produces a non-empty message, including unknown codes", () => {
    for (const step of ["session", "transfer", "finalize"] as const) {
      expect(
        describeUploadFailure({ step, errorCode: "SOMETHING_NEW" }).length
      ).toBeGreaterThan(0);
    }
  });
});

describe("formatProgress", () => {
  test("reports a percentage when the total is known", () => {
    expect(formatProgress({ loaded: 50, total: 200 })).toBe("25%");
  });

  test("never exceeds 100%", () => {
    expect(formatProgress({ loaded: 300, total: 200 })).toBe("100%");
  });

  test("falls back to bytes sent when the total is unknown", () => {
    expect(formatProgress({ loaded: 2048, total: null })).toBe("2 kB sent");
  });

  test("a zero total does not divide by zero", () => {
    expect(formatProgress({ loaded: 0, total: 0 })).toBe("0 kB sent");
  });
});

/**
 * Issue #1221 — compression happens BEFORE the session exists, and the session
 * claims the size and type of the bytes actually sent.
 */
const MIB = 1024 * 1024;
const CAP = 2 * MIB;

const MAGIC: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
};

function chosenFile(size: number, type: string, name: string): File {
  // Real bytes of the claimed size: `size` is what the browser reports and
  // `arrayBuffer()` is what is sent, and the client must trust only the latter.
  const bytes = new Uint8Array(size);
  // The real magic bytes of the claimed type: compression decides from them.
  bytes.set(MAGIC[type] ?? []);
  return new File([bytes], name, { type });
}

function portsProducing(
  encodedBytes: number,
  options: { width?: number; height?: number; alpha?: boolean } = {}
): ImageCompressionPorts {
  const decoded: DecodedImage = {
    width: options.width ?? 4000,
    height: options.height ?? 3000,
    async hasAlpha() {
      return options.alpha ?? false;
    },
    async encode(request) {
      return new Blob([new Uint8Array(encodedBytes)], {
        type: request.mimeType
      });
    },
    dispose() {}
  };

  return {
    encodableTypes: ["image/webp", "image/jpeg"],
    async decode() {
      return decoded;
    }
  };
}

type Claimed = {
  createSession: unknown[];
  put: Array<{ bytes: number; contentType: string }>;
};

function recordingTransport(claimed: Claimed): UploadTransport {
  return {
    async createSession(input) {
      claimed.createSession.push(input);
      return { ok: true, data: SESSION, errorCode: null };
    },
    async putBytes({ bytes, contentType }) {
      claimed.put.push({ bytes: bytes.byteLength, contentType });
      return { ok: true, errorCode: null };
    },
    async finalize() {
      return { ok: true, errorCode: null };
    },
    async cancel() {},
    async digest() {
      return null;
    }
  };
}

describe("uploadMediaFile — compression before the session", () => {
  test("an oversize JPEG is compressed, and the session claims the COMPRESSED size and type", async () => {
    const claimed: Claimed = { createSession: [], put: [] };
    const events: string[] = [];
    let summary: CompressionSummary | null = null;

    const outcome = await uploadMediaFile(
      chosenFile(5 * MIB, "image/jpeg", "IMG_0001.JPG"),
      {
        transport: recordingTransport(claimed),
        maxBytes: CAP,
        loadPorts: async () => portsProducing(1.2 * MIB),
        onCompressing: () => events.push("compressing"),
        onCompressed: (value) => {
          events.push("compressed");
          summary = value;
        }
      }
    );

    expect(outcome.ok).toBe(true);
    expect(events).toEqual(["compressing", "compressed"]);

    // Both candidates cost the same in this fake; WebP is listed first and wins ties.
    expect(claimed.createSession).toEqual([
      {
        fileName: "IMG_0001.webp",
        mimeType: "image/webp",
        byteSize: Math.floor(1.2 * MIB)
      }
    ]);
    // And the bytes put to storage are exactly what was claimed.
    expect(claimed.put).toEqual([
      { bytes: Math.floor(1.2 * MIB), contentType: "image/webp" }
    ]);
    expect(summary).toMatchObject({
      originalByteSize: 5 * MIB,
      byteSize: Math.floor(1.2 * MIB),
      mimeType: "image/webp",
      name: "IMG_0001.webp"
    });
    expect(outcome.ok && outcome.compression).toEqual(summary);
  });

  test("the claimed byteSize never exceeds the cap the server enforces", async () => {
    const claimed: Claimed = { createSession: [], put: [] };

    await uploadMediaFile(chosenFile(9 * MIB, "image/png", "scan.png"), {
      transport: recordingTransport(claimed),
      maxBytes: CAP,
      loadPorts: async () => portsProducing(CAP)
    });

    const [session] = claimed.createSession as Array<{ byteSize: number }>;
    expect(session!.byteSize).toBeLessThanOrEqual(CAP);
  });

  test("a file within the cap is sent unchanged: same bytes, same type, no compression", async () => {
    const claimed: Claimed = { createSession: [], put: [] };
    let loaded = false;
    let compressing = false;

    const outcome = await uploadMediaFile(
      chosenFile(900_000, "image/jpeg", "small.jpg"),
      {
        transport: recordingTransport(claimed),
        maxBytes: CAP,
        loadPorts: async () => {
          loaded = true;
          return null;
        },
        onCompressing: () => {
          compressing = true;
        }
      }
    );

    expect(outcome).toEqual({ ok: true, objectId: "obj-1", compression: null });
    expect(claimed.createSession).toEqual([
      { fileName: "small.jpg", mimeType: "image/jpeg", byteSize: 900_000 }
    ]);
    expect(loaded).toBe(false);
    expect(compressing).toBe(false);
  });

  test("a GIF over the cap is refused: no session, no transfer, a named reason", async () => {
    const claimed: Claimed = { createSession: [], put: [] };

    const outcome = await uploadMediaFile(
      chosenFile(3 * MIB, "image/gif", "spin.gif"),
      {
        transport: recordingTransport(claimed),
        maxBytes: CAP,
        loadPorts: async () => portsProducing(1)
      }
    );

    expect(outcome).toEqual({
      ok: false,
      step: "compress",
      reason: "gif_over_cap",
      maxBytes: CAP,
      originalByteSize: 3 * MIB,
      smallestByteSize: null
    });
    expect(claimed.createSession).toEqual([]);
    expect(claimed.put).toEqual([]);
  });

  test("a browser that cannot compress refuses an oversize image instead of sending it", async () => {
    const claimed: Claimed = { createSession: [], put: [] };

    const outcome = await uploadMediaFile(
      chosenFile(5 * MIB, "image/jpeg", "big.jpg"),
      {
        transport: recordingTransport(claimed),
        maxBytes: CAP,
        loadPorts: async () => null
      }
    );

    expect(outcome).toMatchObject({
      ok: false,
      step: "compress",
      reason: "unsupported_browser"
    });
    expect(claimed.createSession).toEqual([]);
  });

  test("the floor reached is refused with the smallest size and nothing is created", async () => {
    const claimed: Claimed = { createSession: [], put: [] };

    const outcome = await uploadMediaFile(
      chosenFile(9 * MIB, "image/jpeg", "dense.jpg"),
      {
        transport: recordingTransport(claimed),
        maxBytes: CAP,
        loadPorts: async () => portsProducing(CAP + 5)
      }
    );

    expect(outcome).toMatchObject({
      ok: false,
      step: "compress",
      reason: "floor_reached",
      smallestByteSize: CAP + 5
    });
    expect(claimed.createSession).toEqual([]);
  });

  test("a file whose real bytes are larger than its reported size cannot slip past the cap", async () => {
    // `size` says 1 MiB but the buffer read is 3 MiB (a file changed on disk
    // between the check and the read). The measured length is what counts.
    const lying = new File([new Uint8Array(3 * MIB)], "lie.jpg", {
      type: "image/jpeg"
    });
    Object.defineProperty(lying, "size", { value: MIB });
    const claimed: Claimed = { createSession: [], put: [] };

    const outcome = await uploadMediaFile(lying, {
      transport: recordingTransport(claimed),
      maxBytes: CAP,
      loadPorts: async () => null
    });

    expect(outcome).toMatchObject({
      ok: false,
      step: "compress",
      reason: "floor_reached",
      smallestByteSize: 3 * MIB
    });
    expect(claimed.createSession).toEqual([]);
  });

  test("an unknown cap (null) sends the file as chosen and leaves the decision to the server", async () => {
    const claimed: Claimed = { createSession: [], put: [] };

    const outcome = await uploadMediaFile(
      chosenFile(5 * MIB, "image/jpeg", "big.jpg"),
      {
        transport: recordingTransport(claimed),
        maxBytes: null,
        loadPorts: async () => {
          throw new Error("must not compress without a known cap");
        }
      }
    );

    expect(outcome.ok).toBe(true);
    expect(claimed.createSession).toEqual([
      { fileName: "big.jpg", mimeType: "image/jpeg", byteSize: 5 * MIB }
    ]);
  });

  test("a server-side failure after compression still cancels the session", async () => {
    const calls: string[] = [];
    const transport = recordingTransport({ createSession: [], put: [] });

    const outcome = await uploadMediaFile(
      chosenFile(5 * MIB, "image/jpeg", "big.jpg"),
      {
        transport: {
          ...transport,
          async finalize() {
            return { ok: false, errorCode: "VALIDATION_ERROR" };
          },
          async cancel() {
            calls.push("cancel");
          }
        },
        maxBytes: CAP,
        loadPorts: async () => portsProducing(MIB)
      }
    );

    expect(outcome).toEqual({
      ok: false,
      step: "finalize",
      errorCode: "VALIDATION_ERROR"
    });
    expect(calls).toEqual(["cancel"]);
  });

  test("a session refusal passes through unchanged (the server stays the source of truth)", async () => {
    const transport = recordingTransport({ createSession: [], put: [] });

    const outcome = await uploadMediaFile(
      chosenFile(900_000, "image/jpeg", "ok.jpg"),
      {
        transport: {
          ...transport,
          async createSession() {
            return { ok: false, data: null, errorCode: "VALIDATION_ERROR" };
          }
        },
        maxBytes: CAP,
        loadPorts: async () => null
      }
    );

    expect(outcome).toEqual({
      ok: false,
      step: "session",
      errorCode: "VALIDATION_ERROR"
    });
  });
});

describe("compression messages", () => {
  const failure = (
    reason: Extract<UploadMediaFileOutcome, { step: "compress" }>["reason"],
    smallestByteSize: number | null = null
  ): Extract<UploadMediaFileOutcome, { step: "compress" }> => ({
    ok: false,
    step: "compress",
    reason,
    maxBytes: CAP,
    originalByteSize: Math.round(3.4 * MIB),
    smallestByteSize
  });

  test("every failure reason has a message that names the cap", () => {
    const reasons = [
      "gif_over_cap",
      "animated_over_cap",
      "type_not_compressible",
      "invalid_input",
      "unsupported_browser",
      "decode_failed",
      "source_too_large",
      "invalid_dimensions",
      "no_encoder",
      "alpha_needs_webp",
      "floor_reached"
    ] as const;

    for (const reason of reasons) {
      const text = describeCompressionFailure(failure(reason), undefined, "en");
      expect(text.length).toBeGreaterThan(20);
      // No unfilled placeholder may reach a person's screen.
      expect(text).not.toMatch(/\{\w+\}/);
    }
  });

  test("the GIF refusal names both the file size and the cap", () => {
    const text = describeCompressionFailure(
      failure("gif_over_cap"),
      undefined,
      "en"
    );
    expect(text).toContain("3.4 MiB");
    expect(text).toContain("2 MiB");
    expect(text).toContain("GIF");
  });

  test("a GIF just over the cap never reads as a contradiction (#1238)", () => {
    const justOver = {
      ...failure("gif_over_cap"),
      originalByteSize: CAP + 1024
    };

    expect(describeCompressionFailure(justOver, undefined, "en")).toContain(
      "This GIF is 2,049 KiB, over the 2,048 KiB limit."
    );
    // Same finer unit in Indonesian, with that locale's grouping separator.
    expect(describeCompressionFailure(justOver, undefined, "id")).toContain(
      "2.049 KiB"
    );
    expect(describeCompressionFailure(justOver, undefined, "id")).toContain(
      "2.048 KiB"
    );

    // A file that differs from the cap by under 1 KiB falls back to bytes.
    const sliver = { ...failure("gif_over_cap"), originalByteSize: CAP + 1 };
    expect(describeCompressionFailure(sliver, undefined, "en")).toContain(
      "This GIF is 2,097,153 B, over the 2,097,152 B limit."
    );
  });

  test("the floor message also avoids an equal-looking size and cap (#1238)", () => {
    const text = describeCompressionFailure(
      failure("floor_reached", CAP + 2048),
      undefined,
      "en"
    );
    expect(text).toContain("still 2,050 KiB, over the 2,048 KiB limit");
  });

  test("the floor message shows the smallest size reached", () => {
    const text = describeCompressionFailure(
      failure("floor_reached", Math.round(2.6 * MIB)),
      undefined,
      "en"
    );
    expect(text).toContain("2.6 MiB");
  });

  test("the success message shows the original and the final size", () => {
    const text = describeCompressionSuccess(
      {
        originalByteSize: Math.round(4.2 * MIB),
        byteSize: Math.round(1.6 * MIB),
        mimeType: "image/webp",
        name: "a.webp",
        width: 2560,
        height: 1920
      },
      undefined,
      "en"
    );
    expect(text).toContain("4.2 MiB");
    expect(text).toContain("1.6 MiB");
    expect(text).toContain("EXIF");
  });

  test("server-translated templates are used when present, English when absent or blank", () => {
    const messages = readCompressionMessages({
      msgCompressing: "Mengompres ({original})",
      msgGifOverCap: "   "
    });

    expect(messages.compressing).toBe("Mengompres ({original})");
    expect(messages.gifOverCap).toBe(DEFAULT_COMPRESSION_MESSAGES.gifOverCap);
    expect(messages.floorReached).toBe(
      DEFAULT_COMPRESSION_MESSAGES.floorReached
    );
  });

  test("translated templates fill the same placeholders", () => {
    const messages = readCompressionMessages({
      msgGifOverCap: "GIF {original} melebihi {cap}"
    });

    expect(
      describeCompressionFailure(failure("gif_over_cap"), messages, "id")
    ).toBe("GIF 3,4 MiB melebihi 2 MiB");
  });
});
