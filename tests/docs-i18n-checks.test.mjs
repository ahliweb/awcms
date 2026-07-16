/**
 * Unit test untuk logika murni gate staleness terjemahan docs
 * (`scripts/lib/docs-i18n-checks.mjs`). Dijalankan dengan `bun test`.
 */
import { describe, expect, test } from "bun:test";
import {
  computeSourceHash,
  extractRecordedHash,
  deriveEnglishPath,
  checkTranslationPair
} from "../scripts/lib/docs-i18n-checks.mjs";

describe("computeSourceHash", () => {
  test("deterministik untuk konten yang sama", () => {
    expect(computeSourceHash("halo dunia")).toBe(
      computeSourceHash("halo dunia")
    );
  });

  test("berbeda untuk konten berbeda", () => {
    expect(computeSourceHash("halo dunia")).not.toBe(
      computeSourceHash("halo dunia!")
    );
  });

  test("berformat sha256:<hex 64 karakter>", () => {
    expect(computeSourceHash("x")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("extractRecordedHash", () => {
  test("mengambil hash dari penanda yang valid", () => {
    const hash = computeSourceHash("sumber");
    const en = `# Title\n\n<!-- i18n-source-hash: ${hash} -->\n\nBody.`;
    expect(extractRecordedHash(en)).toBe(hash);
  });

  test("null bila tidak ada penanda", () => {
    expect(extractRecordedHash("# Title\n\nBody tanpa penanda.")).toBeNull();
  });
});

describe("deriveEnglishPath", () => {
  test("mengubah *.id.md jadi *.md", () => {
    expect(deriveEnglishPath("README.id.md")).toBe("README.md");
    expect(deriveEnglishPath("docs/awcms/README.id.md")).toBe(
      "docs/awcms/README.md"
    );
  });

  test("null untuk path yang bukan *.id.md", () => {
    expect(deriveEnglishPath("README.md")).toBeNull();
    expect(deriveEnglishPath("docs/awcms/01_canvas_induk.md")).toBeNull();
  });
});

describe("checkTranslationPair", () => {
  const idContent = "Konten sumber Indonesia.";
  const currentHash = computeSourceHash(idContent);

  test("tidak ada temuan bila hash penanda EN cocok dengan sumber ID", () => {
    const en = `<!-- i18n-source-hash: ${currentHash} -->\n\nEnglish content.`;
    expect(
      checkTranslationPair("README.id.md", idContent, "README.md", en)
    ).toEqual([]);
  });

  test("melapor bila berkas EN tidak ada", () => {
    const problems = checkTranslationPair(
      "README.id.md",
      idContent,
      "README.md",
      null
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe("README.id.md");
    expect(problems[0]?.message).toContain("tidak ada");
  });

  test("melapor bila berkas EN tidak punya penanda hash", () => {
    const problems = checkTranslationPair(
      "README.id.md",
      idContent,
      "README.md",
      "English content without a marker."
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe("README.md");
    expect(problems[0]?.message).toContain("penanda");
  });

  test("melapor bila hash penanda basi (sumber ID sudah berubah)", () => {
    const staleEn = `<!-- i18n-source-hash: sha256:${"0".repeat(64)} -->\n\nOld translation.`;
    const problems = checkTranslationPair(
      "README.id.md",
      idContent,
      "README.md",
      staleEn
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.file).toBe("README.md");
    expect(problems[0]?.message).toContain("basi");
  });
});
