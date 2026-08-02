/**
 * A Postgres SQLSTATE is read from `error.errno`, never from `error.code`.
 *
 * Bun's `PostgresError` sets `code` to its own constant
 * `"ERR_POSTGRES_SERVER_ERROR"` for EVERY server error alike, and puts the
 * five-character SQLSTATE on `errno` (verified against PostgreSQL 18 + Bun
 * 1.3.14: a `23503` arrives as `{code: "ERR_POSTGRES_SERVER_ERROR", errno:
 * "23503", constraint: "...", detail: "..."}`).
 *
 * So `error.code === "23505"` is not a subtly wrong check — it is a check that
 * can never be true. Everything downstream of it is dead code: the error is
 * rethrown, and an endpoint that promised a caller-actionable 409 serves a 500
 * instead.
 *
 * ## Why a gate rather than a code review note
 *
 * It reads correctly. `error.code` is exactly where a SQLSTATE lives in
 * `node-postgres`, `pg`, and most Node ecosystem drivers, so the wrong version
 * is what an experienced reviewer expects to see. Ten sites in this repo got it
 * right; two got it wrong, and both were found by probing a live database, not
 * by reading. `tenant-provisioning.ts` had shipped with it — its pre-check
 * SELECT hid the ordinary case, leaving only the concurrent-duplicate race
 * answering 500 where the contract says 409.
 *
 * Pure — no database. Runs in `quality` on every PR.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

/** A five-digit SQLSTATE literal, or a constant named after one. */
const SQLSTATE_OPERAND =
  /(["'`]\d{5}["'`]|[A-Z][A-Z0-9_]*(?:VIOLATION|SQLSTATE|ERROR_CODE))/;

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];

  for await (const file of new Bun.Glob("src/**/*.ts").scan({
    cwd: process.cwd()
  })) {
    files.push(file);
  }

  return files;
}

describe("Postgres SQLSTATE detection", () => {
  test("no source compares `.code` against a SQLSTATE", async () => {
    const files = await sourceFiles();

    // Non-vacuous: an empty scan would make the assertion below pass while
    // checking nothing — the shape of gate this repo has been burned by.
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];

    for (const file of files) {
      const lines = (await readFile(file, "utf8")).split("\n");

      lines.forEach((line, index) => {
        const match = line.match(/\.code\s*===?=?\s*(.+)$/);

        if (match && SQLSTATE_OPERAND.test(match[1]!)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  test("every violation constant in the repo is compared against `errno`", async () => {
    const files = await sourceFiles();
    let comparisons = 0;

    for (const file of files) {
      const source = await readFile(file, "utf8");

      for (const match of source.matchAll(
        /String\(\s*\(?\s*error(?: as \{[^}]*\})?\s*\)?\.errno\s*\)\s*===\s*([A-Z][A-Z0-9_]*)/g
      )) {
        expect(match[1]).toMatch(/VIOLATION/);
        comparisons += 1;
      }
    }

    // Guards the guard: if the idiom is ever refactored into a helper this
    // count collapses, and the assertion above would silently stop covering
    // anything.
    expect(comparisons).toBeGreaterThanOrEqual(10);
  });
});
