/**
 * Finding A7 of the 17 August 2026 audit round — sync-storage used
 * node-supplied strings verbatim as a server filesystem path and as an
 * object-store key.
 *
 * Two pure functions and one theme: a string that arrives over the wire from an
 * HMAC-authenticated node ends up in `Bun.file(…)` on the server and in
 * `Bun.S3Client.write(…)` as the destination. Neither had a shape.
 *
 * The end-to-end behaviour lives in
 * `tests/integration/object-storage-uploader.integration.test.ts`, which drives
 * a real `Bun.S3Client` against a loopback server. What is here is the rule
 * itself, enumerated — because the interesting property of a confinement check
 * is the set of strings it REFUSES, and that set is only visible by naming its
 * members.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  confinedPathRefusalMessage,
  resolveConfinedPath
} from "../src/lib/security/confined-path";
import {
  isSafeObjectKey,
  objectSyncStorageKey,
  validateObjectSyncEnqueueRequestBody
} from "../src/modules/sync-storage/domain/object-queue";
import {
  DEFAULT_OBJECT_SYNC_LOCAL_ROOT_PATH,
  resolveObjectSyncConfig
} from "../src/modules/sync-storage/domain/object-sync-config";

const ROOT = "/srv/awcms/var/object-sync";

describe("resolveConfinedPath refuses everything that could leave the root", () => {
  const refused: [string, string, string][] = [
    ["an absolute POSIX path", "/etc/passwd", "absolute"],
    ["a path that only LOOKS relative", "./../../etc/passwd", "traversal"],
    ["a bare parent segment", "..", "traversal"],
    ["a parent segment in the middle", "a/../../etc/passwd", "traversal"],
    [
      "a traversal that comes back inside — accepted by a resolve-only check",
      "../object-sync/x",
      "traversal"
    ],
    ["a Windows drive path", "C:\\Windows\\System32\\config\\SAM", "absolute"],
    ["a UNC path", "\\\\server\\share\\x", "absolute"],
    ["a backslash anywhere", "receipts\\..\\..\\etc\\passwd", "absolute"],
    ["a NUL truncation attempt", "receipt.pdf\u0000.png", "control_character"],
    ["a newline", "receipt\n.pdf", "control_character"],
    ["an empty string", "", "empty"],
    ["whitespace only", "   ", "empty"]
  ];

  for (const [label, value, refusal] of refused) {
    test(`refuses ${label}`, () => {
      const result = resolveConfinedPath(ROOT, value);

      expect(result.ok).toBe(false);
      expect((result as { refusal: string }).refusal).toBe(refusal);
    });
  }

  test("refuses a non-string", () => {
    expect(resolveConfinedPath(ROOT, undefined).ok).toBe(false);
    expect(resolveConfinedPath(ROOT, 42).ok).toBe(false);
    expect(resolveConfinedPath(ROOT, { toString: () => "x" }).ok).toBe(false);
  });

  test("the traversal-that-returns case is refused BEFORE resolution, and that is the point", () => {
    // This is the one a resolve-then-`startsWith` check accepts: it collapses to
    // a path inside the root. Nothing reads the directories it named on the way,
    // so it is not itself an exploit — but a rule that accepts it is one
    // refactor away from a rule that follows it, and "a relative path of
    // ordinary segments, under the root" is a rule that can be stated in one
    // sentence.
    const sneaky = "../object-sync/x";

    expect(path.resolve(ROOT, sneaky).startsWith(ROOT)).toBe(true);
    expect(resolveConfinedPath(ROOT, sneaky).ok).toBe(false);
  });

  test("accepts an ordinary relative path and returns it resolved", () => {
    // NON-VACUOUS: a check that refused everything would pass every test above.
    const result = resolveConfinedPath(ROOT, "receipts/2026/1.pdf");

    expect(result).toEqual({
      ok: true,
      absolutePath: `${ROOT}/receipts/2026/1.pdf`
    });
  });

  test("a relative root is resolved against the CWD, like the archive root is", () => {
    const result = resolveConfinedPath("./var/object-sync", "a/b.pdf");

    expect(result.ok).toBe(true);
    expect((result as { absolutePath: string }).absolutePath).toBe(
      path.resolve("./var/object-sync", "a/b.pdf")
    );
  });

  test("the root itself is not an accepted answer", () => {
    // Not a file to upload, and accepting it would make a near-empty candidate
    // resolve to something openable.
    expect(resolveConfinedPath(ROOT, ".").ok).toBe(false);
  });

  test("every refusal reports the SAME sentence to the caller", () => {
    // The reason goes to the server log. Telling a node which rule it broke is
    // telling it what the rules are, which is most of what an oracle needs.
    const message = confinedPathRefusalMessage();

    expect(message).not.toContain("traversal");
    expect(message).not.toContain("absolute");
    expect(message).not.toContain("root_");
    expect(message).toContain("relative path");
  });
});

describe("isSafeObjectKey", () => {
  test("accepts ordinary keys", () => {
    expect(isSafeObjectKey("receipt.pdf")).toBe(true);
    expect(isSafeObjectKey("receipts/2026/01/inv-1.pdf")).toBe(true);
    expect(isSafeObjectKey("a_b-c.d/e")).toBe(true);
  });

  const bad: [string, string][] = [
    ["a leading slash", "/receipt.pdf"],
    ["a trailing slash", "receipts/"],
    ["a doubled slash", "receipts//1.pdf"],
    ["a parent segment", "../other-tenant/1.pdf"],
    ["a dot segment", "receipts/./1.pdf"],
    ["a backslash", "receipts\\1.pdf"],
    ["a NUL", "receipt\u0000.pdf"],
    ["a space", "my receipt.pdf"],
    ["a segment starting with a dot", "receipts/.hidden"],
    ["an empty key", ""]
  ];

  for (const [label, value] of bad) {
    test(`refuses ${label}`, () => {
      expect(isSafeObjectKey(value)).toBe(false);
    });
  }

  test("refuses an absurdly long key", () => {
    expect(isSafeObjectKey("a".repeat(512))).toBe(true);
    expect(isSafeObjectKey("a".repeat(513))).toBe(false);
  });
});

describe("objectSyncStorageKey", () => {
  test("namespaces the destination by tenant", () => {
    expect(objectSyncStorageKey("tenant-1", "receipts/1.pdf")).toBe(
      "tenant-1/receipts/1.pdf"
    );
  });
});

describe("the enqueue boundary refuses a bad objectKey", () => {
  test("a traversal key is a 400 field error, not a queue row", () => {
    const result = validateObjectSyncEnqueueRequestBody({
      objects: [
        {
          objectKey: "../other-tenant/1.pdf",
          localPath: "receipts/1.pdf",
          checksumSha256: "a".repeat(64),
          byteSize: 1
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(
      (result as { errors: { field: string }[] }).errors.map((e) => e.field)
    ).toEqual(["objects[0].objectKey"]);
  });

  test("a valid body still validates — the rule did not swallow the happy path", () => {
    const result = validateObjectSyncEnqueueRequestBody({
      objects: [
        {
          objectKey: "receipts/1.pdf",
          localPath: "receipts/1.pdf",
          checksumSha256: "a".repeat(64),
          byteSize: 11
        }
      ]
    });

    expect(result.valid).toBe(true);
  });
});

describe("resolveObjectSyncConfig", () => {
  test("defaults rather than requiring the variable", () => {
    // A required variable would be stricter and worse: this ships into
    // deployments with queued rows and a working node protocol, and a config
    // gate that stops the app on upgrade is a larger event than the finding.
    expect(resolveObjectSyncConfig({} as NodeJS.ProcessEnv).localRootPath).toBe(
      DEFAULT_OBJECT_SYNC_LOCAL_ROOT_PATH
    );
    expect(
      resolveObjectSyncConfig({
        OBJECT_SYNC_LOCAL_ROOT_PATH: "   "
      } as unknown as NodeJS.ProcessEnv).localRootPath
    ).toBe(DEFAULT_OBJECT_SYNC_LOCAL_ROOT_PATH);
  });

  test("honours a configured root", () => {
    expect(
      resolveObjectSyncConfig({
        OBJECT_SYNC_LOCAL_ROOT_PATH: " /mnt/objects "
      } as unknown as NodeJS.ProcessEnv).localRootPath
    ).toBe("/mnt/objects");
  });
});
