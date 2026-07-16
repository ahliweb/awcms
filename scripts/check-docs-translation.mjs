#!/usr/bin/env bun
/**
 * check-docs-translation.mjs — gate staleness terjemahan docs (ADR-0023).
 *
 * Untuk setiap `<nama>.id.md` (sumber Indonesia) yang di-track git, wajib
 * ada `<nama>.md` (hasil generate Inggris, default) dengan penanda hash
 * yang cocok dengan konten sumber ID saat ini. Logika murni ada di
 * `scripts/lib/docs-i18n-checks.mjs`; berkas ini menangani I/O dan exit
 * code. Jalankan: `bun run check:docs:translation`.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkTranslationPair,
  deriveEnglishPath
} from "./lib/docs-i18n-checks.mjs";

const ROOT = resolve(import.meta.dirname, "..");

/** @typedef {import("./lib/docs-i18n-checks.mjs").Problem} Problem */

/** @returns {string[]} */
function listIdSources() {
  const out = execFileSync("git", ["ls-files", "*.id.md"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  return out
    .split("\n")
    .filter(Boolean)
    .filter((file) => existsSync(join(ROOT, file)));
}

/** @returns {Problem[]} */
export function runChecks() {
  /** @type {Problem[]} */
  const problems = [];

  for (const idPath of listIdSources()) {
    const enPath = deriveEnglishPath(idPath);
    if (!enPath) continue; // tidak mungkin (listIdSources sudah filter *.id.md), jaga-jaga.

    const idContent = readFileSync(join(ROOT, idPath), "utf8");
    const enFull = join(ROOT, enPath);
    const enContent = existsSync(enFull) ? readFileSync(enFull, "utf8") : null;

    problems.push(
      ...checkTranslationPair(idPath, idContent, enPath, enContent)
    );
  }

  return problems;
}

if (import.meta.main) {
  const problems = runChecks();
  if (problems.length > 0) {
    console.error(`check:docs:translation GAGAL — ${problems.length} temuan:`);
    for (const p of problems) console.error(`  - ${p.file}: ${p.message}`);
    process.exit(1);
  }
  console.log(
    "check:docs:translation OK — semua sumber *.id.md punya padanan Inggris yang sinkron."
  );
}
