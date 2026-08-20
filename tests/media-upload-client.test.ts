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
  describeUploadFailure,
  formatProgress,
  uploadMediaBytes,
  type UploadSessionData,
  type UploadTransport
} from "../src/lib/ui/media-upload-client";

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
