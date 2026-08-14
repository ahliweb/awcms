/**
 * Unit tests for the pure logic behind the documentation translation gates
 * (`scripts/lib/docs-i18n-checks.mjs`). Run with `bun test`.
 *
 * These were written for ADR-0023, where INDONESIAN was the source and the
 * staleness marker lived in the generated English file. ADR-0097 inverts that:
 * English at the bare path is the source, Indonesian at `.id.md` is the mirror,
 * and the marker moves to the mirror. The assertions are inverted with it —
 * a test suite that still passed after the direction flipped would be proving
 * nothing about the direction.
 */
import { describe, expect, test } from "bun:test";
import {
  checkMirrorCoverage,
  checkTranslationPair,
  computeSourceHash,
  deriveMirrorPath,
  deriveSourcePath,
  extractRecordedHash
} from "../scripts/lib/docs-i18n-checks.mjs";

describe("computeSourceHash", () => {
  test("is deterministic for identical content", () => {
    expect(computeSourceHash("hello world")).toBe(
      computeSourceHash("hello world")
    );
  });

  test("differs for different content", () => {
    expect(computeSourceHash("hello world")).not.toBe(
      computeSourceHash("hello worlds")
    );
  });

  test("is a sha256 marker value", () => {
    expect(computeSourceHash("x")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("extractRecordedHash", () => {
  test("reads the marker out of a mirror", () => {
    const hash = computeSourceHash("source");
    expect(
      extractRecordedHash(`<!-- i18n-source-hash: ${hash} -->\n\n# Doc`)
    ).toBe(hash);
  });

  test("returns null when there is no marker", () => {
    expect(extractRecordedHash("# Doc\n\nNo marker here.")).toBeNull();
  });
});

describe("path derivation", () => {
  test("source -> mirror", () => {
    expect(deriveMirrorPath("docs/awcms/README.md")).toBe(
      "docs/awcms/README.id.md"
    );
  });

  test("mirror -> source", () => {
    expect(deriveSourcePath("docs/awcms/README.id.md")).toBe(
      "docs/awcms/README.md"
    );
  });

  /** A mirror is not itself a source; deriving one from it would produce `X.id.id.md`. */
  test("a mirror has no mirror", () => {
    expect(deriveMirrorPath("docs/awcms/README.id.md")).toBeNull();
  });

  test("non-markdown is not a source", () => {
    expect(deriveMirrorPath("docs/awcms/diagram.svg")).toBeNull();
    expect(deriveSourcePath("docs/awcms/README.md")).toBeNull();
  });
});

describe("checkTranslationPair — is this mirror current?", () => {
  const source = "# Title\n\nEnglish body.\n";
  const hash = computeSourceHash(source);
  const mirror = `<!-- i18n-source-hash: ${hash} -->\n\n# Judul\n`;

  test("accepts a mirror whose marker matches the English source", () => {
    expect(checkTranslationPair("doc.md", source, "doc.id.md", mirror)).toEqual(
      []
    );
  });

  /**
   * The direction test. The marker records the hash of the ENGLISH source, so
   * editing English must invalidate the mirror. Under ADR-0023 it was the other
   * way round and this case was green.
   */
  test("rejects a mirror after the English source changes", () => {
    const problems = checkTranslationPair(
      "doc.md",
      `${source}One more English sentence.\n`,
      "doc.id.md",
      mirror
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe("doc.id.md");
    expect(problems[0]?.message).toContain("stale mirror");
  });

  test("rejects a mirror carrying no marker", () => {
    const problems = checkTranslationPair(
      "doc.md",
      source,
      "doc.id.md",
      "# Judul\n"
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("no <!-- i18n-source-hash");
  });

  /** Reported against the mirror: that is the file which exists to be acted on. */
  test("rejects an orphan mirror whose English source is gone", () => {
    const problems = checkTranslationPair("doc.md", null, "doc.id.md", mirror);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe("doc.id.md");
    expect(problems[0]?.message).toContain("no English source");
  });
});

describe("checkMirrorCoverage — which documents have no mirror at all?", () => {
  test("accepts a document that has its mirror", () => {
    expect(checkMirrorCoverage(["a.md"], new Set(["a.id.md"]), [])).toEqual([]);
  });

  test("accepts an unmirrored document that is on the ledger", () => {
    expect(checkMirrorCoverage(["a.md"], new Set(), ["a.md"])).toEqual([]);
  });

  test("rejects an unmirrored document that is not on the ledger", () => {
    const problems = checkMirrorCoverage(["a.md"], new Set(), []);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("no Indonesian mirror");
  });

  /**
   * The ledger may only SHRINK. An entry whose mirror now exists overstates the
   * debt, and a counter that overstates is a counter nobody believes — which is
   * how a migration stalls while still reading as deliberate.
   */
  test("rejects a ledger entry whose mirror now exists", () => {
    const problems = checkMirrorCoverage(["a.md"], new Set(["a.id.md"]), [
      "a.md"
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("may only shrink");
  });

  test("rejects a ledger entry that is not a document in scope", () => {
    const problems = checkMirrorCoverage(["a.md"], new Set(["a.id.md"]), [
      "gone.md"
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain("not a tracked document in scope");
  });
});
