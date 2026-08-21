/**
 * Issue #641 — `${JSON.stringify(x)}::jsonb` stores a jsonb STRING.
 *
 * ## Why this needed a gate rather than another comment
 *
 * Four files already carried a comment warning about this trap. Seven other
 * call sites kept the broken spelling anyway — including
 * `blog:portable-text:backfill`, the job whose entire purpose is to populate the
 * canonical column ADR-0100 introduced. A comment in four files told four files.
 *
 * ## Why it was invisible
 *
 * Nothing throws. `jsonb_typeof` reports `string`, `@>` matches nothing, `->`
 * returns null, and a reader that happens to `JSON.parse` the value back makes
 * the round trip look correct. The consequence on the public blog path was that
 * `hasCanonicalPortableTextBody` — which asks `Array.isArray` — was ALWAYS
 * false, so every page rendered the lossy `content_json` projection instead of
 * the canonical body. That is the defect Issue #624 exists to prevent, present
 * the whole time.
 *
 * Pure — no database. The proof that a real write now stores a real array is in
 * `tests/integration/jsonb-binding.integration.test.ts`, because only Postgres
 * can answer what the stored value actually IS.
 */
import { describe, expect, test } from "bun:test";

import { findJsonbBindingOffenders } from "../scripts/jsonb-binding-check";

describe("the gate catches the spelling", () => {
  test("a direct offender is found", () => {
    const findings = findJsonbBindingOffenders([
      {
        path: "src/x.ts",
        source:
          "await tx`INSERT INTO t (c) VALUES (${JSON.stringify(v)}::jsonb)`;"
      }
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(1);
  });

  test("an offender Prettier wrapped across lines is still found", () => {
    // This is how the real ones looked. A single-line regex would have missed
    // `blog-post-directory.ts:497`, which is a ternary spanning two lines.
    const findings = findJsonbBindingOffenders([
      {
        path: "src/x.ts",
        source: [
          "        body = CASE",
          "          WHEN ${a !== undefined}",
          "            THEN ${a === undefined ? null : JSON.stringify(a)}::jsonb",
          "          ELSE body",
          "        END,"
        ].join("\n")
      }
    ]);

    expect(findings).toHaveLength(1);
  });

  test("the correct spelling is not flagged", () => {
    expect(
      findJsonbBindingOffenders([
        { path: "src/x.ts", source: "VALUES (${value}::jsonb)" }
      ])
    ).toEqual([]);
    expect(
      findJsonbBindingOffenders([
        { path: "src/x.ts", source: "VALUES (${value ?? null}::jsonb)" }
      ])
    ).toEqual([]);
  });

  test("a comment EXPLAINING the trap is not flagged", () => {
    // A gate that reddened on its own documentation would teach people to
    // delete the documentation.
    expect(
      findJsonbBindingOffenders([
        {
          path: "src/x.ts",
          source:
            " * never `${JSON.stringify(x)}::jsonb` — Bun encodes it twice"
        },
        {
          path: "src/y.ts",
          source: "// `${JSON.stringify(x)}::jsonb` stores a string"
        }
      ])
    ).toEqual([]);
  });

  test("`JSON.stringify` NOT bound to a jsonb slot is not flagged", () => {
    // The rule is about the binding, not about the function. Logging, hashing
    // and checksum code uses it correctly everywhere.
    expect(
      findJsonbBindingOffenders([
        {
          path: "src/x.ts",
          source: "const checksum = hash(JSON.stringify(fields));"
        }
      ])
    ).toEqual([]);
  });

  test("the repo is clean", async () => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("bun", ["run", "db:jsonb-binding:check"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
  });
});

describe("the repair migration", () => {
  test("uses `#>> '{}'`, not `::text::jsonb`", async () => {
    const sql = await Bun.file(
      "sql/141_awcms_repair_jsonb_string_bodies.sql"
    ).text();

    // `::text` gives the QUOTED JSON representation, so re-casting it returns
    // the same string. `#>> '{}'` extracts a jsonb scalar's unquoted text and is
    // the only spelling that unwraps.
    expect(sql).toContain("(body_portable_text #>> '{}')::jsonb");
    expect(sql).not.toContain("body_portable_text::text::jsonb");
  });

  test("drops FORCE RLS for the tenant-wide UPDATE and puts it back", async () => {
    const sql = await Bun.file(
      "sql/141_awcms_repair_jsonb_string_bodies.sql"
    ).text();

    // FORCE applies to the table owner too, so a tenant-wide UPDATE inside a
    // migration silently matches ZERO rows — green on an empty CI database,
    // inert on a populated one. `sql/018`, `sql/103` and `sql/112` set the
    // pattern.
    for (const table of [
      "awcms_blog_posts",
      "awcms_blog_pages",
      "awcms_blog_revisions",
      "awcms_email_messages"
    ]) {
      expect(sql).toContain(
        `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;`
      );
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    }
  });

  test("guards the shape so one unexpected row cannot abort a deployment", async () => {
    const sql = await Bun.file(
      "sql/141_awcms_repair_jsonb_string_bodies.sql"
    ).text();

    // Casting an unparseable string would abort the whole migration, which on a
    // populated production database means the deployment stops.
    expect(sql).toContain("~ '^\\s*\\['");
    expect(sql).toContain("~ '^\\s*\\{'");
    // ...and what the guard skipped is NAMED rather than left silent, which is
    // the same failure mode the whole issue is about.
    expect(sql).toContain("RAISE WARNING");
  });
});
