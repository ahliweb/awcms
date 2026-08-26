/**
 * `bun run blog:legacy:import --images` — the upload set, DRIVEN rather than
 * read.
 *
 * ## Why this file exists at all
 *
 * The upload set was wrong by the entire archive, and every existing test was
 * green. Two defects, both invisible from a unit test of a pure function:
 *
 *  - **The lead photograph was never collected.** `--images` scanned body HTML
 *    only. The SeputarBorneo archive has 2 body images and 25,029 lead
 *    photographs (`foto_berita`), so the flag whose whole job is "tell me what
 *    to upload" reported 2 — a number that reads as "almost nothing to do" and
 *    was short by ~25,029 files / 4.1 GB. `LegacyPostImportInput` had no media
 *    field either, so an import that somehow got past it would have written
 *    `featured_media_id` NULL for every article (ADR-0114).
 *
 *  - **The collection sat BELOW the category gate.** A row naming a category
 *    the run cannot map is refused with `continue`, and the image scan was
 *    after that `continue`. So a FIRST run — which by definition has no
 *    `--term-map`, because `--terms` is how you get one — refused every
 *    categorised row and reported ZERO images. The exact same ordering bug had
 *    already been found and fixed one gate earlier for `categoriesPerArticle`,
 *    and was left in place for this one.
 *
 * The second is why these run a real process instead of asserting on the
 * source: the bug is entirely in the ORDER of two statements, both of which are
 * present and both of which look right in isolation.
 *
 * No database is required or used. `--terms`/`--images` read one file, write
 * one file and issue no query — the script now opens its client lazily so that
 * is actually true, which is what lets this run in the DB-free CI suite
 * alongside everything else rather than only in `tests/integration/`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "scripts", "blog-legacy-import.ts");
const TENANT = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";

type UploadSetEntry = {
  src: string;
  articles: number;
  bodyArticles: number;
  featuredArticles: number;
};

let workDir = "";

function writeArchive(name: string, rows: Record<string, unknown>[]): string {
  const path = join(workDir, name);
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return path;
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    legacyId: "48213",
    title: "Banjir melanda Kobar",
    slug: "banjir-melanda-kobar",
    bodyHtml: "<p>Air naik.</p>",
    publishedAt: "2019-03-04T02:11:00Z",
    ...overrides
  };
}

/** Run the script for real, with NO database reachable, and read what it wrote. */
function runImages(
  archive: string,
  outName: string,
  extraArgs: string[] = []
): { code: number; stdout: string; stderr: string; set: UploadSetEntry[] } {
  const out = join(workDir, outName);
  const result = Bun.spawnSync(
    [
      "bun",
      SCRIPT,
      `--file=${archive}`,
      `--tenant=${TENANT}`,
      `--author=${AUTHOR}`,
      "--system=seputarborneo",
      `--images=${out}`,
      ...extraArgs
    ],
    {
      // Empty, not absent. A report-only run must not need a database at all;
      // if it ever reaches `getDatabaseClient()` again this throws and every
      // case below goes red rather than quietly passing on a developer machine
      // that happens to have one.
      env: { ...process.env, DATABASE_URL: "" },
      stdout: "pipe",
      stderr: "pipe"
    }
  );

  let set: UploadSetEntry[] = [];
  try {
    set = JSON.parse(readFileSync(out, "utf8")) as UploadSetEntry[];
  } catch {
    set = [];
  }

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    set
  };
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "blog-legacy-import-cli-"));
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("the upload set includes the lead photograph", () => {
  test("an archive whose bodies contain no image still has work to do", () => {
    // This is the SeputarBorneo shape: clean bodies, one `foto_berita` each.
    // The old scan reported an EMPTY upload set for it and the operator would
    // have concluded there was nothing to migrate.
    const archive = writeArchive("leads-only.ndjson", [
      row({ legacyId: "1", slug: "satu", featuredImageSrc: "foto_1.jpg" }),
      row({ legacyId: "2", slug: "dua", featuredImageSrc: "foto_2.jpg" }),
      row({ legacyId: "3", slug: "tiga", featuredImageSrc: "foto_1.jpg" })
    ]);

    const result = runImages(archive, "leads-only.json");

    expect(result.code).toBe(0);
    expect(result.set).toEqual([
      { src: "foto_1.jpg", articles: 2, bodyArticles: 0, featuredArticles: 2 },
      { src: "foto_2.jpg", articles: 1, bodyArticles: 0, featuredArticles: 1 }
    ]);
  });

  test("the summary says which part is body and which is lead", () => {
    const archive = writeArchive("both-kinds.ndjson", [
      row({
        legacyId: "1",
        slug: "satu",
        bodyHtml: '<p>x</p><img src="body_1.jpg">',
        featuredImageSrc: "foto_1.jpg"
      })
    ]);

    const result = runImages(archive, "both-kinds.json");

    // A single total would let "2" stand for either "2 inline images" or "2
    // photographs", which is precisely the ambiguity that hid the real task.
    expect(result.stdout).toContain("lead photographs    1");
    expect(result.stdout).toContain("body images         1");
    expect(result.set.map((entry) => entry.src).sort()).toEqual([
      "body_1.jpg",
      "foto_1.jpg"
    ]);
  });

  test("a row with no lead photograph contributes none", () => {
    const archive = writeArchive("no-lead.ndjson", [
      row({ legacyId: "1", slug: "satu" }),
      row({ legacyId: "2", slug: "dua", featuredImageSrc: "" }),
      row({ legacyId: "3", slug: "tiga", featuredImageSrc: null })
    ]);

    // An export writes `""` for "this row has no photo"; refusing that would
    // refuse the rows that are FINE.
    expect(runImages(archive, "no-lead.json").set).toEqual([]);
  });
});

describe("the upload set is collected BEFORE the gates that refuse a row", () => {
  test("categories with no --term-map do not empty the upload set", () => {
    // The regression, stated as the operator sees it: the same archive, once
    // with its `categories` field and once without, must produce the same
    // upload set. With the collection below the category gate the first is
    // EMPTY and the second is complete.
    const rows = [
      row({
        legacyId: "1",
        slug: "satu",
        bodyHtml: '<p>x</p><img src="body_1.jpg">',
        featuredImageSrc: "foto_1.jpg"
      }),
      row({ legacyId: "2", slug: "dua", featuredImageSrc: "foto_2.jpg" })
    ];

    const withCategories = runImages(
      writeArchive(
        "with-categories.ndjson",
        rows.map((entry) => ({ ...entry, categories: ["Daerah", "Politik"] }))
      ),
      "with-categories.json"
    );
    const withoutCategories = runImages(
      writeArchive("without-categories.ndjson", rows),
      "without-categories.json"
    );

    expect(withoutCategories.set.length).toBe(3);
    expect(withCategories.set).toEqual(withoutCategories.set);
  });

  test("a body the converter REJECTS still reports its images", () => {
    // `<script>` makes the whole body unimportable, and the article still needs
    // its photographs uploaded before the export can be fixed and re-run.
    const archive = writeArchive("rejected-body.ndjson", [
      row({
        legacyId: "1",
        slug: "satu",
        bodyHtml: '<p><img src="body_1.jpg"></p><script>x()</script>',
        featuredImageSrc: "foto_1.jpg"
      })
    ]);

    expect(
      runImages(archive, "rejected-body.json").set.map((e) => e.src)
    ).toEqual(["body_1.jpg", "foto_1.jpg"]);
  });

  test("a row refused by the RECORD validator contributes nothing, and does not stop the rest", () => {
    // The line never became a record, so there is nothing to read a `src` off.
    // What matters is that it does not take the file down with it.
    const archive = writeArchive("mixed-validity.ndjson", [
      row({ legacyId: "", slug: "satu", featuredImageSrc: "foto_1.jpg" }),
      row({ legacyId: "2", slug: "dua", featuredImageSrc: "foto_2.jpg" })
    ]);

    expect(runImages(archive, "mixed-validity.json").set).toEqual([
      { src: "foto_2.jpg", articles: 1, bodyArticles: 0, featuredArticles: 1 }
    ]);
  });
});

describe("a report-only run needs no database", () => {
  test("--images with DATABASE_URL empty exits 0 and writes the file", () => {
    // Not incidental. `getDatabaseClient()` used to be called unconditionally,
    // so the one flag an operator runs FIRST — before the tenant exists, before
    // anything is wired — died on `DATABASE_URL … is required`.
    const result = runImages(
      writeArchive("no-db.ndjson", [
        row({ legacyId: "1", slug: "satu", featuredImageSrc: "foto_1.jpg" })
      ]),
      "no-db.json"
    );

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("DATABASE_URL");
    expect(result.set).toHaveLength(1);
  });
});
