/**
 * `bun run blog:legacy:cutover:verify` — the CLI contract and the target
 * classifier, both driven rather than read.
 *
 * ## Why this file exists at all
 *
 * The verdict logic next door (`cutover-verification.test.ts`) was green
 * throughout, and the gate still could not fail. Two defects lived entirely
 * outside the pure domain:
 *
 *  - `usage()` printed a banner and did NOT set `process.exitCode`, so EVERY
 *    usage error exited 0 — no args, a missing flag, a misspelled flag,
 *    `--limit=abc`. `bun run blog:legacy:cutover:verify --sitemap=$F && deploy`
 *    therefore deployed when `$F` was empty or the flag mistyped, having
 *    verified nothing, while the last line of that same banner promised the
 *    opposite.
 *
 *  - the script could only decide liveness for `/blog/{tenantCode}/{slug}`, so
 *    every archive target answered "undecidable", and undecidable was `ok`.
 *
 * Neither is visible from a unit test of a pure function, which is exactly how
 * both survived. The exit codes below come from a real process; the classifier
 * is exercised with the paths that actually appear in the SeputarBorneo map.
 *
 * No database is required or used: every case here either fails before
 * `getDatabaseClient()` is reached, or is a pure classification.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyPublicBlogTarget,
  type PublicBlogTarget
} from "../scripts/blog-legacy-cutover-verify";

const SCRIPT = join(
  import.meta.dir,
  "..",
  "scripts",
  "blog-legacy-cutover-verify.ts"
);
const TENANT = "11111111-1111-4111-8111-111111111111";
const TENANT_CODE = "seputarborneo";

let workDir = "";
let sitemapFile = "";
let urlsFile = "";

/** Run the script for real and report what a shell `&&` would see. */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", SCRIPT, ...args], {
    // Empty, not absent: the control case must reach `getDatabaseClient()` and
    // be refused THERE, which proves the arguments were accepted.
    env: { ...process.env, DATABASE_URL: "" },
    stdout: "pipe",
    stderr: "pipe"
  });

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  };
}

/** The banner is unmistakable — no other output names every flag. */
function printedUsage(result: { stderr: string }): boolean {
  return result.stderr.includes("--tenant=<uuid>");
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "cutover-verify-cli-"));
  sitemapFile = join(workDir, "sitemap.xml");
  urlsFile = join(workDir, "urls.txt");

  writeFileSync(
    sitemapFile,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <url><loc>https://seputarborneo.test/news/48213_Banjir_Kobar.html</loc></url>",
      "  <url><loc>https://seputarborneo.test/Kalteng/Sampit.html</loc></url>",
      "</urlset>"
    ].join("\n")
  );

  writeFileSync(
    urlsFile,
    [
      "# no legacy sitemap exists — this corpus came from a crawl",
      "",
      "https://seputarborneo.test/news/48213_Banjir_Kobar.html",
      "https://seputarborneo.test/Kalteng/Sampit.html"
    ].join("\n")
  );
});

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("usage errors fail the run", () => {
  // Every one of these was reproduced exiting 0 before the fix. Remove
  // `process.exitCode = 1` from `usage()` and all five go red.
  const cases: [string, string[]][] = [
    ["no arguments at all", []],
    ["missing --tenant", ["--tenant-code=x", "--sitemap=SITEMAP"]],
    ["missing --tenant-code", ["--tenant=TENANT", "--sitemap=SITEMAP"]],
    ["missing --sitemap and --urls", ["--tenant=TENANT", "--tenant-code=x"]],
    [
      "a MISSPELLED --sitemap flag, which looks like it was passed",
      ["--tenant=TENANT", "--tenant-code=x", "--sitemp=SITEMAP"]
    ],
    [
      "--limit=abc",
      ["--tenant=TENANT", "--tenant-code=x", "--sitemap=SITEMAP", "--limit=abc"]
    ],
    [
      "--limit=0",
      ["--tenant=TENANT", "--tenant-code=x", "--sitemap=SITEMAP", "--limit=0"]
    ],
    [
      "an EMPTY --sitemap= value, the `$F` a shell expands to nothing",
      ["--tenant=TENANT", "--tenant-code=x", "--sitemap="]
    ]
  ];

  test.each(cases)("exits 1 — %s", (_name, args) => {
    const result = run(
      args.map((arg) =>
        arg.replace("SITEMAP", sitemapFile).replace("TENANT", TENANT)
      )
    );

    expect(result.code).toBe(1);
    expect(printedUsage(result)).toBe(true);
  });

  test("the banner's own promise matches the behaviour", () => {
    // The sentence was already there, inside `usage()`, while `usage()` was the
    // one path that could not keep it.
    const result = run([]);
    expect(result.stderr).toContain("Exits non-zero");
    expect(result.code).toBe(1);
  });

  test("a --sitemap path that does not exist is a failure, not a skip", () => {
    const result = run([
      `--tenant=${TENANT}`,
      "--tenant-code=x",
      `--sitemap=${join(workDir, "absent.xml")}`
    ]);

    expect(result.code).toBe(1);
  });

  test("a corpus of only blanks and comments is refused", () => {
    const emptyList = join(workDir, "empty.txt");
    writeFileSync(emptyList, "\n# nothing here\n\n");

    const result = run([
      `--tenant=${TENANT}`,
      "--tenant-code=x",
      `--urls=${emptyList}`
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no URL lines");
  });
});

describe("a legitimate invocation is NOT refused as a usage error", () => {
  // The control. Without it, "make usage() exit 1" could be satisfied by a
  // script that refuses everything — which would also be a gate that cannot
  // pass, and just as useless as one that cannot fail.
  test("--sitemap gets past argument validation and reaches the database", () => {
    const result = run([
      `--tenant=${TENANT}`,
      `--tenant-code=${TENANT_CODE}`,
      `--sitemap=${sitemapFile}`
    ]);

    expect(printedUsage(result)).toBe(false);
    expect(result.stdout).toContain("Verifying 2 legacy URL(s)");
    // It stops at the connection, which is as far as this test can go without
    // a Postgres — but the two URLs were parsed and accepted first.
    expect(result.stderr).toContain("DATABASE_URL");
  });

  test("--urls parses to the SAME corpus as the equivalent sitemap", () => {
    const result = run([
      `--tenant=${TENANT}`,
      `--tenant-code=${TENANT_CODE}`,
      `--urls=${urlsFile}`
    ]);

    expect(printedUsage(result)).toBe(false);
    expect(result.stdout).toContain("Verifying 2 legacy URL(s)");
  });

  test("--sitemap and --urls combine rather than compete", () => {
    const result = run([
      `--tenant=${TENANT}`,
      `--tenant-code=${TENANT_CODE}`,
      `--sitemap=${sitemapFile}`,
      `--urls=${urlsFile}`
    ]);

    expect(result.stdout).toContain("Verifying 4 legacy URL(s)");
  });

  test("--limit still marks the run as a sample, not a decision", () => {
    const result = run([
      `--tenant=${TENANT}`,
      `--tenant-code=${TENANT_CODE}`,
      `--sitemap=${sitemapFile}`,
      "--limit=1"
    ]);

    expect(result.stdout).toContain("SAMPLE of 2");
    expect(result.stdout).toContain("not a cutover decision");
  });
});

describe("classifyPublicBlogTarget", () => {
  const classify = (path: string): PublicBlogTarget | null =>
    classifyPublicBlogTarget(path, TENANT_CODE);

  test("a /kategori/* target is NOT this deployment's surface", () => {
    // THE assertion whose absence let 62 rules look verified. `/kategori/**` is
    // served by `ahliweb/awcms-astro` — a separate `output: "static"`
    // deployment with no middleware — so nothing this job can look up will ever
    // say whether the page exists. `null` is the honest answer, and the caller
    // turns it into `target_unverifiable`, never `ok`.
    expect(classify("/kategori/nope")).toBeNull();
    expect(classify("/kategori/kalteng")).toBeNull();
    expect(classify("/berita/48213")).toBeNull();
    expect(classify("https://seputarborneo.com/kategori/kalteng")).toBeNull();
  });

  test("the archive families this repo DOES serve are recognised", () => {
    expect(classify(`/blog/${TENANT_CODE}/category/kalteng`)).toEqual({
      kind: "term",
      taxonomyType: "category",
      slug: "kalteng"
    });
    expect(classify(`/blog/${TENANT_CODE}/tag/banjir`)).toEqual({
      kind: "term",
      taxonomyType: "tag",
      slug: "banjir"
    });
    expect(classify(`/blog/${TENANT_CODE}/pages/tentang-kami`)).toEqual({
      kind: "page",
      slug: "tentang-kami"
    });
  });

  test("a post detail URL is still a post", () => {
    expect(classify(`/blog/${TENANT_CODE}/banjir-kobar`)).toEqual({
      kind: "post",
      slug: "banjir-kobar"
    });
  });

  test("the index and the three fixed routes are each named", () => {
    expect(classify(`/blog/${TENANT_CODE}`)).toEqual({ kind: "index" });
    expect(classify(`/blog/${TENANT_CODE}/`)).toEqual({ kind: "index" });
    expect(classify(`/blog/${TENANT_CODE}/search`)).toEqual({ kind: "search" });
    expect(classify(`/blog/${TENANT_CODE}/feed.xml`)).toEqual({ kind: "feed" });
    expect(classify(`/blog/${TENANT_CODE}/sitemap-blog.xml`)).toEqual({
      kind: "sitemap"
    });
  });

  test("a path under the tenant that NO route matches is a predictable 404", () => {
    // `src/pages/[...path].ts` answers 404 for these. Knowing that without a
    // lookup is the difference between `target_missing` (fix the map) and
    // `target_unverifiable` (go and look at another layer).
    expect(classify(`/blog/${TENANT_CODE}/category/a/b`)).toEqual({
      kind: "unrouted"
    });
    expect(classify(`/blog/${TENANT_CODE}/rubrik/kalteng`)).toEqual({
      kind: "unrouted"
    });
    expect(classify(`/blog/${TENANT_CODE}/category/`)).toEqual({
      kind: "unrouted"
    });
  });

  test("another tenant's blog is not this tenant's surface", () => {
    expect(classify("/blog/other-tenant/category/kalteng")).toBeNull();
    // A prefix that merely starts the same is not a match either.
    expect(classify(`/blog/${TENANT_CODE}-lain/category/x`)).toBeNull();
  });

  test("the locale prefix is stripped, not treated as a segment", () => {
    expect(classify(`/id/blog/${TENANT_CODE}/category/kalteng`)).toEqual({
      kind: "term",
      taxonomyType: "category",
      slug: "kalteng"
    });
  });

  test("a query or fragment on the target does not hide the slug", () => {
    // `normalizeRedirectPath` keeps a query on a relative TARGET (it drops it
    // only on a source), and the route serving it reads the path segments
    // alone — so comparing `…/kalteng?page=2` against a slug would report a
    // working destination as missing.
    expect(classify(`/blog/${TENANT_CODE}/category/kalteng?page=2`)).toEqual({
      kind: "term",
      taxonomyType: "category",
      slug: "kalteng"
    });
    expect(classify(`/blog/${TENANT_CODE}/banjir-kobar#isi`)).toEqual({
      kind: "post",
      slug: "banjir-kobar"
    });
  });

  test("the retired-/news fallback target is classified, and it is a post slug", () => {
    // `buildLegacyBlogPath` produces `/blog/{code}/{id}_{Raw_Slug}.html`, and
    // the classifier calls it a post — which is the point: the lookup then
    // MISSES (no slug containing `_` or an uppercase letter can pass the
    // importer's inline slug regex in `legacy-import-record.ts` — the rule that
    // decides what is IN the column, not the shared `SLUG_PATTERN` in
    // `slug-policy.ts`), and the URL is reported `target_missing` rather than
    // waved through. ADR-0114 decision 2 is the fix for the miss itself.
    expect(classify(`/blog/${TENANT_CODE}/48213_Banjir_Kobar.html`)).toEqual({
      kind: "post",
      slug: "48213_Banjir_Kobar.html"
    });
  });
});
