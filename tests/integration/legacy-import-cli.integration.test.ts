/**
 * `bun run blog:legacy:import --commit` driven as a real process against a real
 * PostgreSQL (Issue #599, ADR-0114).
 *
 * ## What only this can prove
 *
 * Two of the four importer defects live below every seam a unit test can reach:
 *
 *  1. **The lead photograph never got written.** `LegacyPostImportInput` had 12
 *     fields and none of them was media; the INSERT named 16 columns and
 *     `featured_media_id` — a column `sql/035:46` has had since the schema was
 *     created, and one `public-content-port-adapter.ts` serves to
 *     `awcms-astro` — was not among them. 25,029 of 25,029 SeputarBorneo
 *     articles have a `foto_berita`, so a real run would have landed the whole
 *     archive without the picture each page led with, reporting success. What
 *     is at stake is a COLUMN in a row, so the assertion has to read that row.
 *
 *  2. **Two rows of one file could claim one slug.** `findTakenSlugs` asks the
 *     database what is already taken and cannot see a collision inside the file
 *     it has not written yet. The real archive has 84 collision groups across
 *     171 rows, and `awcms_blog_posts` has its own slug uniqueness — so the
 *     second row raised 23505 in the middle of a committing batch, AFTER
 *     earlier batches had landed. A source-level test cannot tell you whether a
 *     23505 is raised; only a database can.
 *
 * The registry sweep is here for a third reason: the fix reuses the EXISTING
 * `isMediaReferenceSafe` check rather than adding a second, weaker one, and the
 * only way to show a featured id really goes through it is to hand the job a
 * map whose sole entry is a featured `src` pointing at another tenant's media
 * and watch the whole run abort.
 *
 * ## WORLD 2 (harness §"two databases")
 *
 * The script calls `getDatabaseClient()` internally — it is a separate process,
 * so it resolves `DATABASE_URL` for itself and there is no way to point it at
 * world 1's ephemeral database. That is exactly the case world 2 exists for:
 * the subprocess and `getHandlerAdminSql()` act on the same database, seeded
 * and read through the admin connection.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";

const SCRIPT = join(
  import.meta.dir,
  "..",
  "..",
  "scripts",
  "blog-legacy-import.ts"
);

const TENANT = "c7777777-7777-4777-8777-777777777777";
const OTHER_TENANT = "c8888888-8888-4888-8888-888888888888";
const AUTHOR = "c9999999-9999-4999-8999-999999999999";
const UPLOADER = "ca000000-0000-4000-8000-000000000000";
const OTHER_UPLOADER = "cb000000-0000-4000-8000-000000000000";
const SYSTEM = "seputarborneo";

let workDir = "";
let ready = false;

type Run = { code: number; stdout: string; stderr: string };

function writeJson(name: string, value: unknown): string {
  const path = join(workDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

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

/**
 * Runs the real CLI. The environment is inherited untouched, so the subprocess
 * resolves the SAME `DATABASE_URL` the fixtures below are written through.
 */
function run(args: string[]): Run {
  const result = Bun.spawnSync(["bun", SCRIPT, ...args], {
    env: process.env,
    stdout: "pipe",
    stderr: "pipe"
  });

  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString()
  };
}

function importArgs(archive: string, extra: string[] = []): string[] {
  return [
    `--file=${archive}`,
    `--tenant=${TENANT}`,
    `--author=${AUTHOR}`,
    `--system=${SYSTEM}`,
    "--commit",
    ...extra
  ];
}

async function seedTenants(): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT}, 'lentera', 'Lentera', 'active'),
      (${OTHER_TENANT}, 'seputar', 'Seputar', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

/** Same shape `legacy-import.integration.test.ts` uses — the media row needs a real uploader. */
async function seedUploader(
  tenantId: string,
  userId: string,
  label: string
): Promise<void> {
  const admin = getHandlerAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', 'Uploader')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
  `;
}

async function seedMedia(
  tenantId: string,
  userId: string,
  status: string
): Promise<string> {
  const objectKey = `news-media/${tenantId}/2026/08/${crypto.randomUUID()}.png`;
  const rows = (await getHandlerAdminSql()`
    INSERT INTO awcms_news_media_objects
      (tenant_id, module_key, storage_driver, bucket_name, object_key,
       public_url, mime_type, status, created_by_tenant_user_id)
    VALUES (
      ${tenantId}, 'news_portal', 'cloudflare_r2', 'bucket', ${objectKey},
      'https://cdn.example.test/photo.png', 'image/png', ${status}, ${userId}
    )
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function posts(): Promise<
  { slug: string; featured_media_id: string | null; legacy_source_id: string }[]
> {
  return (await getHandlerAdminSql()`
    SELECT slug, featured_media_id, legacy_source_id
    FROM awcms_blog_posts
    WHERE tenant_id = ${TENANT}
    ORDER BY legacy_source_id
  `) as {
    slug: string;
    featured_media_id: string | null;
    legacy_source_id: string;
  }[];
}

const suite = integrationEnabled ? describe : describe.skip;

suite("blog:legacy:import driven end to end (integration, Issue #599)", () => {
  beforeAll(async () => {
    ready = await ensureHandlerDatabaseReady();
    workDir = mkdtempSync(join(tmpdir(), "legacy-import-cli-"));
  });

  afterAll(async () => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!ready) return;
    await resetHandlerDatabase();
    await seedTenants();
  });

  test("a mapped lead photograph is written to featured_media_id", async () => {
    if (!ready) return;
    await seedUploader(TENANT, UPLOADER, "lentera");
    const mediaId = await seedMedia(TENANT, UPLOADER, "verified");

    const archive = writeArchive("mapped.ndjson", [
      row({ featuredImageSrc: "foto_48213.jpg" })
    ]);
    const mediaMap = writeJson("mapped.map.json", {
      "foto_48213.jpg": mediaId
    });

    const result = run(importArgs(archive, [`--media-map=${mediaMap}`]));

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("inserted         1");

    const rows = await posts();
    expect(rows).toHaveLength(1);
    // The whole of F6 in one assertion: before the fix this column was NULL for
    // every imported article, because the INSERT did not name it.
    expect(rows[0]!.featured_media_id).toBe(mediaId);
  });

  test("an UNMAPPED lead photograph refuses the row rather than importing it stripped", async () => {
    if (!ready) return;
    await seedUploader(TENANT, UPLOADER, "lentera");
    const mediaId = await seedMedia(TENANT, UPLOADER, "verified");

    // A map that exists and simply does not cover this row's photograph — the
    // realistic case, an operator who uploaded most of the archive.
    const archive = writeArchive("unmapped.ndjson", [
      row({ legacyId: "1", slug: "sudah-ada-foto", featuredImageSrc: "a.jpg" }),
      row({ legacyId: "2", slug: "belum-ada-foto", featuredImageSrc: "b.jpg" })
    ]);
    const mediaMap = writeJson("unmapped.map.json", { "a.jpg": mediaId });

    const result = run(importArgs(archive, [`--media-map=${mediaMap}`]));

    expect(result.code).toBe(0);
    // Refused and REPORTED — not imported without the photograph, and not
    // silently repaired to NULL.
    expect(result.stdout).toContain('featuredImageSrc "b.jpg" is not in');
    expect(result.stdout).toContain("refused          1");

    const rows = await posts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.legacy_source_id).toBe("1");
    expect(rows[0]!.featured_media_id).toBe(mediaId);
  });

  test("a lead photograph mapped to ANOTHER tenant's media aborts the whole run", async () => {
    if (!ready) return;
    await seedUploader(TENANT, UPLOADER, "lentera");
    await seedUploader(OTHER_TENANT, OTHER_UPLOADER, "seputar");
    const foreign = await seedMedia(OTHER_TENANT, OTHER_UPLOADER, "verified");

    // The map's ONLY entry is a featured `src`. If the featured path ever grew
    // its own, weaker check — or skipped the sweep because "it is not a body
    // image" — this run would proceed and write a foreign id into
    // `featured_media_id`, which has no FK to stop it (`sql/035`).
    const archive = writeArchive("foreign.ndjson", [
      row({ featuredImageSrc: "foto_48213.jpg" })
    ]);
    const mediaMap = writeJson("foreign.map.json", {
      "foto_48213.jpg": foreign
    });

    const result = run(importArgs(archive, [`--media-map=${mediaMap}`]));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("are not verified media of this tenant");
    expect(await posts()).toHaveLength(0);
  });

  test("an UNVERIFIED media object of this tenant aborts it too", async () => {
    if (!ready) return;
    await seedUploader(TENANT, UPLOADER, "lentera");
    // The bytes arrived and nothing has vouched for them. `renderGalleryBlock`
    // and the public detail read both resolve this to nothing.
    const unverified = await seedMedia(TENANT, UPLOADER, "uploaded");

    const archive = writeArchive("unverified.ndjson", [
      row({ featuredImageSrc: "foto_48213.jpg" })
    ]);
    const mediaMap = writeJson("unverified.map.json", {
      "foto_48213.jpg": unverified
    });

    const result = run(importArgs(archive, [`--media-map=${mediaMap}`]));

    expect(result.code).toBe(1);
    expect(await posts()).toHaveLength(0);
  });

  test("two rows of one file claiming one slug: one insert, one report line, no 23505", async () => {
    if (!ready) return;

    const archive = writeArchive("slug-collision.ndjson", [
      row({ legacyId: "1", title: "Banjir 2019", slug: "banjir-kobar" }),
      row({ legacyId: "2", title: "Banjir 2021", slug: "banjir-kobar" }),
      row({ legacyId: "3", title: "Kabut asap", slug: "kabut-asap" })
    ]);

    const result = run(importArgs(archive));

    // The defect was a crash mid-batch. Exit 0 with a report is the contract:
    // a refusal is not a failure of the run.
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    // SQLSTATE lives on `error.errno`, not `error.code`, so grep the text the
    // driver actually prints rather than trusting a classifier.
    expect(result.stdout).not.toContain("23505");
    expect(result.stderr).not.toContain("23505");
    expect(result.stdout).not.toContain("duplicate key value");

    expect(result.stdout).toContain(
      'slug "banjir-kobar" is already claimed by line 1 of this file'
    );
    expect(result.stdout).toContain("refused          1");
    expect(result.stdout).toContain("inserted         2");

    const rows = await posts();
    expect(rows.map((entry) => entry.legacy_source_id)).toEqual(["1", "3"]);
  });

  test("the intra-file slug check does not swallow the DATABASE's own collision", async () => {
    if (!ready) return;

    // Both checks have to survive: this file is internally consistent, and the
    // slug is taken by a post that is already here. `findTakenSlugs` answers
    // that one, and its message must stay distinguishable from the new one so a
    // reader can tell "your export is wrong" from "this tenant already has it".
    await run(
      importArgs(
        writeArchive("first.ndjson", [row({ legacyId: "1", slug: "banjir" })])
      )
    );

    const result = run(
      importArgs(
        writeArchive("second.ndjson", [row({ legacyId: "2", slug: "banjir" })])
      )
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'slug "banjir" is already used by another post in this tenant'
    );
    expect(await posts()).toHaveLength(1);
  });
});
