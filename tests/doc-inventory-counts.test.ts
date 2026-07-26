/**
 * Documented module and migration counts must match reality.
 *
 * ## Why this one keeps rotting
 *
 * Every port lands a module and two migrations, and every doc that states a
 * total goes stale in the same commit. It has happened repeatedly, and the
 * 2026-07-26 sweep found five live documents disagreeing with the registry at
 * once:
 *
 * - `ARCHITECTURE.md` — "migration `sql/001`-`sql/067`" (70 exist)
 * - `13_final_master_index_traceability.md` — "65 file migration", "20 modul"
 * - `21_module_admission_governance.md` — "20 modul aktif"
 * - `repo-inventory.md` — "20 modul", "65 migrasi", twice, in a paragraph whose
 *   own job is to CORRECT a stale claim. A correction that is itself stale is
 *   worse than the original: it reads as freshly verified.
 *
 * A wrong total is not cosmetic. These files are what an agent reads to decide
 * whether a module exists before searching for it, and `sql/NNN` range claims
 * are what someone reads to pick the next migration number.
 *
 * ## Scope
 *
 * Only two mechanical, unambiguous claim shapes are checked — bolded module
 * totals and `sql/001`-to-`sql/NNN` ranges. `check:docs` already verifies that
 * individual `sql/NNN` references point at files that exist; what it cannot
 * see is a range whose endpoint is simply behind.
 *
 * Frozen documents are exempt by marker, not by filename: generated snapshots
 * and anything already flagged DEPRECATED are records of a past state.
 *
 * No database, no network — runs in `quality` on every PR.
 */
import { readdir, readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

/**
 * A bolded TOTAL: `**21 modul aktif**`, `**21 modul terdaftar**`, `**21
 * modul** yang terdaftar. The qualifier is required.
 *
 * A bare `**N modul**` is NOT matched, because subset counts are legitimate
 * and common — "**20 dari 21 modul** sudah mendeklarasikan `permissions`" is a
 * true statement that a total-matching gate would have to reject. Requiring
 * the qualifier is what separates "how many modules exist" from "how many of
 * them do X".
 */
const MODULE_TOTAL =
  /\*\*(\d+)\s+modul(?:e)?s?(?:\s+(?:aktif|base|terdaftar))?\*\*(?:\s+(?:aktif|terdaftar|yang terdaftar))?/gi;

/** `` `sql/001`-`sql/070` `` or `` `sql/001`–`070` `` — an inclusive range. */
const MIGRATION_RANGE = /`sql\/001`\s*[–-]\s*`(?:sql\/)?(\d{3})`/g;

/** See the header: generated or explicitly deprecated files state the past. */
const FROZEN = /\*\*File ini di-generate\.\*\*|⚠️ DEPRECATED/;

async function currentStateDocs(): Promise<string[]> {
  const files: string[] = [];

  // `dot: true` — `.claude` is a dot-directory and is skipped without it.
  for (const pattern of [
    "docs/*.md",
    "docs/awcms/*.md",
    ".claude/skills/*/SKILL.md",
    ".claude/skills/README.md"
  ]) {
    for await (const file of new Bun.Glob(pattern).scan({
      cwd: process.cwd(),
      dot: true
    })) {
      files.push(file);
    }
  }

  return [...new Set(files)].sort();
}

async function highestMigration(): Promise<number> {
  const names = (await readdir("sql")).filter((name) => name.endsWith(".sql"));
  const numbers = names
    .map((name) => Number.parseInt(name.slice(0, 3), 10))
    .filter((value) => Number.isFinite(value));

  return Math.max(...numbers);
}

describe("documented inventory counts match the repository", () => {
  test("every bolded module total equals listModules().length", async () => {
    const actual = listModules().length;
    const files = await currentStateDocs();
    const offenders: string[] = [];
    let claims = 0;

    expect(files.length).toBeGreaterThan(40);

    for (const file of files) {
      const body = await readFile(file, "utf8");

      if (FROZEN.test(body.slice(0, 2000))) {
        continue;
      }

      for (const [index, line] of body.split("\n").entries()) {
        for (const match of line.matchAll(MODULE_TOTAL)) {
          claims += 1;

          if (Number(match[1]) !== actual) {
            offenders.push(
              `${file}:${index + 1}: claims ${match[1]} modules, registry has ${actual}.`
            );
          }
        }
      }
    }

    // Without this the test passes trivially the day the phrasing changes.
    expect(claims).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test("every sql/001-sql/NNN range ends at the newest migration", async () => {
    const newest = await highestMigration();
    const files = await currentStateDocs();
    const offenders: string[] = [];
    let claims = 0;

    for (const file of files) {
      const body = await readFile(file, "utf8");

      if (FROZEN.test(body.slice(0, 2000))) {
        continue;
      }

      for (const [index, line] of body.split("\n").entries()) {
        for (const match of line.matchAll(MIGRATION_RANGE)) {
          claims += 1;

          if (Number(match[1]) !== newest) {
            offenders.push(
              `${file}:${index + 1}: range ends at sql/${match[1]}, newest is ` +
                `sql/${String(newest).padStart(3, "0")}.`
            );
          }
        }
      }
    }

    expect(claims).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
