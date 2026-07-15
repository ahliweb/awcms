/**
 * Integration test: jalankan pemeriksa docs penuh terhadap repo nyata.
 * Mengeksekusi jalur I/O (git ls-files + resolusi tautan filesystem) dan
 * memastikan seluruh dokumentasi repo tetap valid. Impor `check-docs.mjs`
 * TIDAK menjalankan CLI-nya (dijaga `import.meta.main`).
 */
import { describe, expect, test } from "bun:test";
import { runChecks } from "../scripts/check-docs.mjs";

describe("runChecks (integration, repo nyata)", () => {
  test("seluruh dokumentasi lolos: mermaid, tautan internal, penamaan", () => {
    const problems = runChecks();
    if (problems.length > 0) {
      // Pesan gagal yang informatif bila ada regresi.
      const detail = problems
        .map((p) => `${p.file}:${p.line}: ${p.message}`)
        .join("\n");
      throw new Error(
        `Ditemukan ${problems.length} masalah dokumentasi:\n${detail}`
      );
    }
    expect(problems).toEqual([]);
  });

  test("mengembalikan array Problem berbentuk { file, line, message }", () => {
    const problems = runChecks();
    // Array (mungkin kosong). Bila ada isi, bentuknya harus benar.
    expect(Array.isArray(problems)).toBe(true);
    for (const p of problems) {
      expect(typeof p.file).toBe("string");
      expect(typeof p.line).toBe("number");
      expect(typeof p.message).toBe("string");
    }
  });
});
