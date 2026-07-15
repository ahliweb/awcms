/**
 * logging-lint-check.ts — `bun run logging:lint:check`.
 *
 * Gate regresi (diadaptasi dari awcms-mini): mencegah pola logging error
 * tidak aman merayap masuk ke root yang dipindai. Data ERP sensitif
 * (finansial/personal) tidak boleh bocor lewat pesan exception mentah ke
 * `console.error`/`console.warn`. Dua cek independen, keduanya berbasis
 * teks/regex (tanpa TypeScript AST — mengikuti gate parity/kontrak lain di
 * repo ini):
 *
 * 1. Nilai exception yang di-extract manual dengan pola lama
 *    branch-on-`instanceof Error`-dengan-`String(...)`-fallback, ditugaskan
 *    ke variabel lokal, lalu variabel itu mengalir langsung ke
 *    `console.error`/`console.warn`.
 * 2. Panggilan `console.error(...)`/`console.warn(...)` yang meneruskan
 *    identifier bernama-caught-value (`error`/`err`/`exception`/`exc`/`ex`/
 *    `e`) mentah sebagai argumen, atau mengakses `.message`/`.stack` inline —
 *    kecuali panggilan itu juga memanggil salah satu `ALLOWED_SANITIZER_CALLS`.
 *
 * Ganti pola tidak aman dengan helper redaksi yang sudah ditinjau:
 * `safeErrorDetail` (`src/lib/logging/error-sanitizer.ts`),
 * `redactSecretsInText`/`redactSensitiveAttributes`
 * (`src/modules/_shared/redaction.ts`), atau `safeErrorMessage`/
 * `redactDatabaseUrl` (`scripts/db-migrate.ts`).
 *
 * Escape hatch: `LOGGING_LINT_EXEMPTIONS` di bawah, di-key `"path:line"`,
 * untuk false-positive nyata yang tak bisa ditulis ulang — kosong saat ini.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LoggingLintProblem = {
  file: string;
  line: number;
  message: string;
};

const SCAN_ROOTS: ReadonlyArray<{ dir: string; extensions: string[] }> = [
  { dir: "src/pages/admin", extensions: [".astro"] },
  { dir: "src/pages/api/v1", extensions: [".ts"] },
  { dir: "scripts", extensions: [".ts"] },
  { dir: "src/lib", extensions: [".ts"] },
  { dir: "src/modules", extensions: [".ts"] }
];

/** Lihat header §escape hatch. */
export const LOGGING_LINT_EXEMPTIONS: ReadonlySet<string> = new Set([]);

/**
 * Nama fungsi yang sudah merutekan error lewat redaksi tertinjau. Panggilan
 * `console.error`/`console.warn` yang memanggil salah satunya di argumen
 * mana pun tidak pernah ditandai oleh cek 2.
 */
const ALLOWED_SANITIZER_CALLS: readonly string[] = [
  "safeErrorDetail",
  "safeErrorMessage",
  "redactSecretsInText",
  "redactSensitiveAttributes",
  "redactDatabaseUrl"
];

function lineNumberAt(source: string, index: number): number {
  let line = 1;

  for (let i = 0; i < index; i++) {
    if (source[i] === "\n") {
      line += 1;
    }
  }

  return line;
}

/**
 * Cocok dengan `const NAME = CAUGHT instanceof Error ? CAUGHT.message :
 * String(CAUGHT);` (atau `let`). Menangkap nama variabel yang DITUGASKAN
 * (grup 1) agar cek 1 tahu apa yang dicari di panggilan console hilir.
 */
const RAW_IDIOM_ASSIGNMENT =
  /(?:const|let)\s+(\w+)\s*=\s*(\w+)\s+instanceof\s+Error\s*\?\s*\2\.message\s*:\s*String\(\2\)\s*;/g;

export function findRawIdiomAssignments(
  source: string
): Array<{ variableName: string; line: number }> {
  const results: Array<{ variableName: string; line: number }> = [];
  RAW_IDIOM_ASSIGNMENT.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = RAW_IDIOM_ASSIGNMENT.exec(source)) !== null) {
    results.push({
      variableName: match[1]!,
      line: lineNumberAt(source, match.index)
    });
  }

  return results;
}

type ConsoleCall = { line: number; text: string };

/**
 * Mengekstrak teks argumen penuh tiap panggilan `console.error(...)`/
 * `console.warn(...)` via pencocokan tanda kurung berimbang (bukan regex
 * satu baris) agar panggilan yang terbentang beberapa baris tetap tertangkap
 * utuh.
 */
export function findConsoleErrorWarnCalls(source: string): ConsoleCall[] {
  const calls: ConsoleCall[] = [];
  const callStart = /console\.(?:error|warn)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = callStart.exec(source)) !== null) {
    const openParenIndex = match.index + match[0].length - 1;
    let depth = 1;
    let i = openParenIndex + 1;

    while (i < source.length && depth > 0) {
      if (source[i] === "(") {
        depth += 1;
      } else if (source[i] === ")") {
        depth -= 1;
      }
      i += 1;
    }

    calls.push({
      line: lineNumberAt(source, match.index),
      text: source.slice(match.index, i)
    });
  }

  return calls;
}

/**
 * Nama variabel catch-clause yang dikenali. Sengaja berbasis-nama, bukan
 * benar-benar catch-clause-aware — nilai caught yang di-bind ke nama lain
 * yang tidak umum masih lolos cek 2 (lihat `LOGGING_LINT_EXEMPTIONS` sebagai
 * residual gap terdokumentasi).
 */
const CAUGHT_VALUE_NAMES = "error|err|exception|exc|ex|e";
const RAW_ERROR_ARGUMENT = new RegExp(
  `[(,]\\s*(?:${CAUGHT_VALUE_NAMES})\\s*[,)]`
);
const RAW_ERROR_PROPERTY_ACCESS = new RegExp(
  `\\b(?:${CAUGHT_VALUE_NAMES})\\.(?:message|stack)\\b`
);

/**
 * Mengembalikan alasan sebuah panggilan `console.error`/`console.warn`
 * berbahaya, atau `null` bila aman. `callText` adalah teks argumen penuh
 * satu panggilan dari `findConsoleErrorWarnCalls`.
 */
export function isDangerousConsoleCall(callText: string): string | null {
  const usesAllowedSanitizer = ALLOWED_SANITIZER_CALLS.some((name) =>
    callText.includes(`${name}(`)
  );

  if (usesAllowedSanitizer) {
    return null;
  }

  if (RAW_ERROR_ARGUMENT.test(callText)) {
    return "meneruskan nilai caught mentah (error/err/exception/exc/ex/e) langsung sebagai argumen";
  }

  if (RAW_ERROR_PROPERTY_ACCESS.test(callText)) {
    return "membaca .message/.stack dari identifier bernama-caught-value (error/err/exception/exc/ex/e) inline, tanpa sanitizer tertinjau di panggilan yang sama";
  }

  return null;
}

export function scanSourceForLoggingProblems(
  relativePath: string,
  source: string
): LoggingLintProblem[] {
  const problems: LoggingLintProblem[] = [];
  const consoleCalls = findConsoleErrorWarnCalls(source);

  for (const idiom of findRawIdiomAssignments(source)) {
    const flowsIntoConsoleCall = consoleCalls.some((call) =>
      new RegExp(`\\b${idiom.variableName}\\b`).test(call.text)
    );

    if (!flowsIntoConsoleCall) {
      continue;
    }

    const key = `${relativePath}:${idiom.line}`;
    if (LOGGING_LINT_EXEMPTIONS.has(key)) {
      continue;
    }

    problems.push({
      file: relativePath,
      line: idiom.line,
      message:
        `pesan nilai caught di-extract manual ke "${idiom.variableName}" (pola lama ` +
        "instanceof-Error-dengan-String()-fallback) lalu variabel itu diteruskan ke " +
        "console.error/warn — pakai safeErrorDetail() dari " +
        "src/lib/logging/error-sanitizer.ts."
    });
  }

  for (const call of consoleCalls) {
    const reason = isDangerousConsoleCall(call.text);

    if (!reason) {
      continue;
    }

    const key = `${relativePath}:${call.line}`;
    if (LOGGING_LINT_EXEMPTIONS.has(key)) {
      continue;
    }

    problems.push({
      file: relativePath,
      line: call.line,
      message: `panggilan console.error/warn tidak aman — ${reason}.`
    });
  }

  return problems;
}

async function walkFiles(dir: string, extensions: string[]): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full, extensions)));
    } else if (
      extensions.some((ext) => entry.name.endsWith(ext)) &&
      !entry.name.endsWith(".test.ts")
    ) {
      files.push(full);
    }
  }

  return files;
}

export async function runLoggingLintCheck(
  rootDir = process.cwd()
): Promise<LoggingLintProblem[]> {
  const problems: LoggingLintProblem[] = [];

  for (const root of SCAN_ROOTS) {
    const files = await walkFiles(
      path.join(rootDir, root.dir),
      root.extensions
    );

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const relativePath = path.relative(rootDir, file);

      problems.push(...scanSourceForLoggingProblems(relativePath, source));
    }
  }

  return problems;
}

if (import.meta.main) {
  const problems = await runLoggingLintCheck();

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`${problem.file}:${problem.line}: ${problem.message}`);
    }

    console.error(
      `\nlogging:lint:check GAGAL — ${problems.length} temuan pola logging error tidak aman ` +
        "di src/pages/admin, src/pages/api/v1, scripts/, src/lib, atau src/modules. Ganti dengan " +
        "safeErrorDetail() (src/lib/logging/error-sanitizer.ts) atau redactSecretsInText()/" +
        "redactSensitiveAttributes() (src/modules/_shared/redaction.ts). Bila ini false-positive " +
        'nyata, tambahkan "path:line" ke LOGGING_LINT_EXEMPTIONS di ' +
        "scripts/logging-lint-check.ts dengan alasan tercatat."
    );
    process.exitCode = 1;
  } else {
    console.log(
      "logging:lint:check OK — tidak ada pola raw error/console.error tidak aman di " +
        "src/pages/admin, src/pages/api/v1, scripts/, src/lib, dan src/modules."
    );
  }
}
