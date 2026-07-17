#!/usr/bin/env bun
/**
 * check-docs.mjs — pemeriksa kualitas dokumentasi (Bun-only, tanpa dependency).
 * Diadaptasi dari awcms-mini (`scripts/check-docs.mjs`).
 *
 * Memeriksa seluruh berkas Markdown yang di-track git:
 *  1. Mermaid: setiap blok ```mermaid tertutup dan diawali tipe diagram dikenal.
 *  2. Tautan relatif Markdown menunjuk ke berkas/anchor yang ada.
 *  3. Regresi penamaan: sisa identifier repo acuan (`awcms_mini_`/`AWCMS_MINI_`)
 *     yang belum diadaptasi ke prefix repo ini (`awcms_`/`AWCMS_`).
 *  4. Rujukan migration hantu: setiap `sql/NNN` yang disebut dokumentasi
 *     (termasuk `.claude/skills/`, yang DIIKUTI agen) benar-benar ada di
 *     `sql/` — penomoran awcms-mini yang terbawa saat adaptasi dokumen
 *     membuat agen menulis migration/query terhadap file yang tak pernah ada
 *     di sini (Issue #156).
 *  5. Nama service `docker compose`/`docker-compose` dalam prosa benar-benar
 *     ada di `docker-compose*.yml` — HANYA dijalankan begitu minimal satu
 *     `docker-compose*.yml` sungguhan ada di repo (belum ada saat ini; docs
 *     terkait masih deskripsi rencana deployment, bukan konfigurasi yang
 *     sudah dibuat, jadi belum ada sumber kebenaran untuk divalidasi).
 *
 * Logika murni ada di `scripts/lib/docs-checks.mjs`; berkas ini menangani
 * I/O (git, filesystem) dan exit code. Jalankan: `bun run check:docs`.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkMermaid,
  checkNaming,
  checkKnownScripts,
  checkSqlMigrationReferences,
  AUTHORITATIVE_SCRIPT_DOC_FILES,
  extractLinks,
  classifyLink,
  splitTarget,
  headingSlugs,
  parseComposeServiceNames,
  checkComposeServiceNames
} from "./lib/docs-checks.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const COMPOSE_FILE_CANDIDATES = [
  "docker-compose.yml",
  "docker-compose.prod.yml"
];

/**
 * Union of service names from every `docker-compose*.yml` at repo root. Both
 * files are read once at startup; a service defined in either is considered
 * valid in prose (docs don't distinguish which compose file a given
 * walkthrough targets).
 * @returns {Set<string>}
 */
function loadComposeServiceNames() {
  /** @type {Set<string>} */
  const names = new Set();
  for (const file of COMPOSE_FILE_CANDIDATES) {
    const full = join(ROOT, file);
    if (!existsSync(full)) continue;
    for (const name of parseComposeServiceNames(readFileSync(full, "utf8"))) {
      names.add(name);
    }
  }
  return names;
}

/** @returns {boolean} */
function anyComposeFileExists() {
  return COMPOSE_FILE_CANDIDATES.some((file) => existsSync(join(ROOT, file)));
}

/** @typedef {import("./lib/docs-checks.mjs").Problem} Problem */

/** @returns {string[]} */
function listMarkdown() {
  const out = execFileSync("git", ["ls-files", "*.md"], {
    cwd: ROOT,
    encoding: "utf8"
  });
  // `git ls-files` mencerminkan index, bukan working tree — berkas yang
  // dihapus tapi belum di-stage masih muncul di sini. Saring agar hanya
  // berkas yang benar-benar ada di disk.
  return out
    .split("\n")
    .filter(Boolean)
    .filter((file) => existsSync(join(ROOT, file)));
}

/**
 * Verifikasi tautan relatif menunjuk berkas (dan anchor) yang ada di disk.
 * @param {string} file
 * @param {string} content
 * @returns {Problem[]}
 */
function checkLinks(file, content) {
  /** @type {Problem[]} */
  const problems = [];
  const dir = dirname(join(ROOT, file));
  for (const { target, line } of extractLinks(content)) {
    if (classifyLink(target) !== "relative") continue;
    const { path, hash } = splitTarget(target);
    if (!path) continue;
    const resolved = path.startsWith("/")
      ? join(ROOT, path)
      : resolve(dir, path);

    let targetContent;
    try {
      targetContent = readFileSync(resolved, "utf8");
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "EISDIR") {
        continue;
      }
      problems.push({ file, line, message: `tautan rusak: ${target}` });
      continue;
    }

    if (hash && resolved.endsWith(".md")) {
      const slugs = headingSlugs(targetContent);
      if (!slugs.has(hash.toLowerCase())) {
        problems.push({
          file,
          line,
          message: `anchor tidak ditemukan: #${hash}`
        });
      }
    }
  }
  return problems;
}

/**
 * Nama script yang terdaftar di `package.json` root.
 * @returns {Set<string>}
 */
function loadPackageScripts() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return new Set(Object.keys(pkg.scripts ?? {}));
}

/**
 * Basename setiap migration di `sql/` — sumber kebenaran untuk
 * `checkSqlMigrationReferences`. Dibaca dari disk (bukan git index) supaya
 * migration yang baru ditulis tapi belum di-stage tetap dianggap ada.
 * @returns {Set<string>}
 */
function loadSqlFileNames() {
  const dir = join(ROOT, "sql");
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).filter((name) => name.endsWith(".sql")));
}

/** @returns {Problem[]} */
export function runChecks() {
  /** @type {Problem[]} */
  const problems = [];
  const hasComposeFiles = anyComposeFileExists();
  const composeServiceNames = hasComposeFiles
    ? loadComposeServiceNames()
    : null;
  const knownScripts = loadPackageScripts();
  const sqlFileNames = loadSqlFileNames();

  for (const file of listMarkdown()) {
    const content = readFileSync(join(ROOT, file), "utf8");
    const lines = content.split("\n");
    problems.push(...checkMermaid(file, lines));
    problems.push(...checkLinks(file, content));
    problems.push(...checkNaming(file, lines));
    problems.push(...checkSqlMigrationReferences(file, lines, sqlFileNames));
    if (AUTHORITATIVE_SCRIPT_DOC_FILES.has(file)) {
      problems.push(...checkKnownScripts(file, lines, knownScripts));
    }
    if (composeServiceNames) {
      problems.push(
        ...checkComposeServiceNames(file, content, composeServiceNames)
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = runChecks();
  if (problems.length > 0) {
    console.error(`check:docs GAGAL — ${problems.length} temuan:`);
    for (const p of problems)
      console.error(`  - ${p.file}:${p.line}: ${p.message}`);
    process.exit(1);
  }
  console.log(
    "check:docs OK — mermaid, tautan internal, penamaan, rujukan migration `sql/NNN`, dan rujukan `bun run` di dokumen current-state valid (cek nama service docker compose menyusul begitu docker-compose*.yml ada)."
  );
}
