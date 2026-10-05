/**
 * Issue #911 / ADR-0130 — `db-migrate` accepts three- or four-digit prefixes
 * and applies them in NUMERIC order, so a derived application can grow past
 * `999` without a gap file running before the tables it depends on.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverMigrationFiles } from "../scripts/db-migrate";
import {
  assertValidMigrationNames,
  compareMigrationNames,
  listMigrationNames,
  migrationPrefix,
  MIGRATIONS_DIR
} from "../scripts/lib/migrations";

const tempDirs: string[] = [];

async function migrationsDirWith(names: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "awcms-migrate-order-"));
  tempDirs.push(dir);
  await Promise.all(
    names.map((name) => writeFile(path.join(dir, name), "SELECT 1;\n"))
  );
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe("compareMigrationNames", () => {
  test("1000_ sorts after 999_ — the lexical order this replaces put it first", () => {
    expect("1000_awcms_x.sql".localeCompare("999_awcms_y.sql")).toBeLessThan(0);
    expect(
      compareMigrationNames("1000_awcms_x.sql", "999_awcms_y.sql")
    ).toBeGreaterThan(0);
  });

  test("equal prefixes fall back to the full name", () => {
    expect(
      compareMigrationNames("042_awcms_b.sql", "042_awcms_a.sql")
    ).toBeGreaterThan(0);
    expect(compareMigrationNames("042_awcms_a.sql", "042_awcms_a.sql")).toBe(0);
  });
});

describe("assertValidMigrationNames", () => {
  test("refuses the same number written at two widths", () => {
    expect(() =>
      assertValidMigrationNames(["100_awcms_a.sql", "0100_awcms_b.sql"])
    ).toThrow(/same numeric value/);
  });

  test("refuses a name the runner would refuse", () => {
    expect(() => assertValidMigrationNames(["README.sql"])).toThrow(
      /Invalid migration file name: README\.sql/
    );
  });

  test("accepts mixed three- and four-digit prefixes", () => {
    expect(() =>
      assertValidMigrationNames(["999_awcms_a.sql", "1000_awcms_b.sql"])
    ).not.toThrow();
  });
});

describe("migrationPrefix", () => {
  test("returns the whole prefix, not the first three characters", () => {
    expect(migrationPrefix("046_awcms_x.sql")).toBe("046");
    expect(migrationPrefix("1000_awcms_x.sql")).toBe("1000");
  });
});

describe("discoverMigrationFiles", () => {
  test("applies four-digit files after every three-digit file", async () => {
    const dir = await migrationsDirWith([
      "1001_awcms_commerce_c.sql",
      "999_awcms_commerce_b.sql",
      "1000_awcms_commerce_x.sql",
      "001_awcms_core.sql"
    ]);

    const names = (await discoverMigrationFiles(dir)).map((m) => m.name);

    expect(names).toEqual([
      "001_awcms_core.sql",
      "999_awcms_commerce_b.sql",
      "1000_awcms_commerce_x.sql",
      "1001_awcms_commerce_c.sql"
    ]);
  });

  test("still refuses a five-digit prefix", async () => {
    const dir = await migrationsDirWith(["10000_awcms_too_wide.sql"]);

    await expect(discoverMigrationFiles(dir)).rejects.toThrow(
      /Invalid migration file name: 10000_awcms_too_wide\.sql/
    );
  });

  test("still refuses a two-digit prefix", async () => {
    const dir = await migrationsDirWith(["01_awcms_too_narrow.sql"]);

    await expect(discoverMigrationFiles(dir)).rejects.toThrow(
      /Invalid migration file name/
    );
  });

  test("the repo's own sql/ keeps its byte-identical lexical order", async () => {
    const onDisk = (await readdir(MIGRATIONS_DIR)).filter((name) =>
      name.endsWith(".sql")
    );
    const lexical = [...onDisk].sort((a, b) => a.localeCompare(b));
    const applied = (await discoverMigrationFiles(MIGRATIONS_DIR)).map(
      (m) => m.name
    );

    expect(applied).toEqual(lexical);
  });

  test("the gate loader folds in the same order the runner applies", async () => {
    const applied = (await discoverMigrationFiles(MIGRATIONS_DIR)).map(
      (m) => m.name
    );

    expect(listMigrationNames()).toEqual(applied);
  });
});
