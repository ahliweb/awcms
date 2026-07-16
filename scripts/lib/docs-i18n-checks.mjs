/**
 * docs-i18n-checks.mjs — logika murni untuk gate staleness terjemahan docs.
 *
 * ADR-0023: dokumen berbahasa Indonesia di path `<nama>.id.md` adalah
 * **sumber otoritatif**; dokumen Inggris di path bare `<nama>.md` adalah
 * **hasil generate** (default yang tampil, mis. README.md root). Setiap
 * berkas Inggris yang dipasangkan wajib menyimpan penanda
 * `<!-- i18n-source-hash: sha256:<hex> -->` yang cocok dengan hash konten
 * sumber ID saat ini — bila tidak cocok (atau berkas Inggris tak ada),
 * artinya terjemahan basi dan belum disinkronkan ulang.
 *
 * Skrip ini TIDAK menerjemahkan (tidak ada pemanggilan API terjemahan) —
 * ia hanya MENDETEKSI drift antara sumber ID dan hasil EN, mendorong
 * penerjemah (manusia atau agent) meregenerasi EN + memperbarui penanda
 * hash sebagai bagian dari perubahan yang sama. Lihat `docs/adr/0023-*.md`
 * untuk alasan lengkap kenapa bukan panggilan API langsung di CI.
 */

import { createHash } from "node:crypto";

/** @typedef {{ file: string, line: number, message: string }} Problem */

export const MARKER_REGEX =
  /<!--\s*i18n-source-hash:\s*(sha256:[0-9a-f]{64})\s*-->/;

/**
 * @param {string} idContent
 * @returns {string} `sha256:<hex>`
 */
export function computeSourceHash(idContent) {
  return `sha256:${createHash("sha256").update(idContent).digest("hex")}`;
}

/**
 * @param {string} enContent
 * @returns {string | null}
 */
export function extractRecordedHash(enContent) {
  const match = enContent.match(MARKER_REGEX);
  return match ? (match[1] ?? null) : null;
}

/**
 * Turunkan path EN kanonis dari path sumber ID (`README.id.md` ->
 * `README.md`, `docs/awcms/README.id.md` -> `docs/awcms/README.md`).
 * @param {string} idPath
 * @returns {string | null} null bila `idPath` bukan pola `*.id.md`.
 */
export function deriveEnglishPath(idPath) {
  if (!idPath.endsWith(".id.md")) return null;
  return `${idPath.slice(0, -".id.md".length)}.md`;
}

/**
 * @param {string} idPath
 * @param {string} idContent
 * @param {string} enPath
 * @param {string | null} enContent - null bila berkas EN tidak ada di disk.
 * @returns {Problem[]}
 */
export function checkTranslationPair(idPath, idContent, enPath, enContent) {
  /** @type {Problem[]} */
  const problems = [];

  if (enContent === null) {
    problems.push({
      file: idPath,
      line: 1,
      message: `sumber terjemahan tanpa berkas Inggris pasangan (${enPath} tidak ada) — jalankan regenerasi terjemahan.`
    });
    return problems;
  }

  const recorded = extractRecordedHash(enContent);
  if (!recorded) {
    problems.push({
      file: enPath,
      line: 1,
      message: `tidak ada penanda <!-- i18n-source-hash: sha256:... --> — tambahkan setelah menerjemahkan dari ${idPath}.`
    });
    return problems;
  }

  const current = computeSourceHash(idContent);
  if (recorded !== current) {
    problems.push({
      file: enPath,
      line: 1,
      message: `terjemahan basi — sumber ${idPath} berubah sejak terakhir digenerate (penanda ${recorded}, seharusnya ${current}). Regenerasi EN lalu perbarui penanda.`
    });
  }

  return problems;
}
