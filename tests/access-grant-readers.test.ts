/**
 * `access:grant-readers:check` (Gelombang 3 prasyarat, #423).
 *
 * The gate is green today by construction, so a test that only ran it would
 * prove nothing. Everything below drives the evaluator with sources it has never
 * seen, so the assertions are about what it REFUSES rather than about the repo
 * happening to be tidy right now.
 *
 * Pure: no database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  findGrantReaderProblems,
  GRANT_READERS,
  GRANT_TABLES
} from "../scripts/access-grant-readers-check";

const ALLOWED = [
  { file: "a.ts", reason: "the one reader" },
  { file: "b.ts", reason: "the writer" }
];

/**
 * The two allowed files, present and still naming a table.
 *
 * Every case below starts from these, because an allow-list entry whose file is
 * missing from `sources` is itself a finding — as the stale-entry tests show.
 */
function withAllowedPresent(
  extra: Record<string, string> = {}
): Map<string, string> {
  return new Map([
    ["a.ts", "FROM awcms_access_assignments"],
    ["b.ts", "INSERT INTO awcms_role_permissions"],
    ...Object.entries(extra)
  ]);
}

describe("an unrecorded file that names a grant table is refused", () => {
  test("a new file assembling its own join fails the gate", () => {
    const problems = findGrantReaderProblems(
      withAllowedPresent({
        "c.ts": "SELECT 1 FROM awcms_access_assignments aa"
      }),
      ALLOWED
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.file).toBe("c.ts");
    // The message must name the alternative, not merely deny: a gate that says
    // "no" without saying "instead" gets satisfied by adding an exception.
    expect(problems[0]!.message).toContain("fetchGrantedPermissionKeys");
  });

  test("it names WHICH table was found, so the fix does not need a second grep", () => {
    const problems = findGrantReaderProblems(
      withAllowedPresent({ "c.ts": "awcms_role_permissions rp" }),
      ALLOWED
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("awcms_role_permissions");
    expect(problems[0]!.message).not.toContain("awcms_access_assignments");
  });

  test("an .astro screen is scanned like any other source", () => {
    // Screens are where PROJECT_STATE §4 R3 lived. A gate that skipped them
    // would be green for the exact file class that already went wrong once.
    const problems = findGrantReaderProblems(
      withAllowedPresent({
        "src/pages/admin/roles.astro": "FROM awcms_access_assignments"
      }),
      ALLOWED
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.file).toBe("src/pages/admin/roles.astro");
  });
});

describe("comments cannot decide the outcome", () => {
  test("a docblock discussing the tables does NOT put a file on the hook", () => {
    // Three real files in this repo do exactly this, and the fix for a drifting
    // reader is always the thing that plants the false positive — a fix
    // explains what it removed.
    const problems = findGrantReaderProblems(
      withAllowedPresent({
        "c.ts": [
          "/**",
          " * Reads roles through fetchGrantedPermissionKeys, never from",
          " * awcms_access_assignments directly.",
          " */",
          "export const x = 1;"
        ].join("\n")
      }),
      ALLOWED
    );

    expect(problems).toHaveLength(0);
  });

  test("and a comment cannot SATISFY the list either — a stale entry is reported", () => {
    // The mirror case. If prose counted, a file could keep its allow-list slot
    // by mentioning the table in a comment after the query was removed, and the
    // list would quietly stop describing the repo.
    const problems = findGrantReaderProblems(
      new Map([
        ["a.ts", "// awcms_access_assignments is no longer read here\n"]
      ]),
      [{ file: "a.ts", reason: "the one reader" }]
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("stale entry");
  });
});

describe("the list may not outlive its reasons", () => {
  test("an entry naming a file that no longer exists is reported", () => {
    const problems = findGrantReaderProblems(new Map(), ALLOWED);

    expect(problems.map((problem) => problem.file).sort()).toEqual([
      "a.ts",
      "b.ts"
    ]);
  });

  test("every recorded reader carries a reason of substance", () => {
    for (const entry of GRANT_READERS) {
      expect(entry.reason.length).toBeGreaterThan(60);
    }
  });

  test("the three readers outside identity_access say so in their reason", () => {
    // Being on the list is not an endorsement, and the entries that cross a
    // module boundary are the ones a future grant-shape change must read first.
    const outsiders = GRANT_READERS.filter(
      (entry) => !entry.file.startsWith("src/modules/identity-access/")
    );

    expect(outsiders).toHaveLength(3);

    for (const entry of outsiders) {
      expect(entry.reason).toContain("OUTSIDE identity_access");
    }
  });
});

describe("the table list is the grant tables and nothing else", () => {
  test("the global permission catalogue is NOT a grant table", () => {
    // `awcms_permissions` says what a permission IS. Adding it would put every
    // seed migration and admin picker on a list about grants, and a list that
    // long is one nobody reads.
    expect(GRANT_TABLES).not.toContain("awcms_permissions");
    expect(GRANT_TABLES).not.toContain("awcms_roles");
  });

  test("it covers both halves of the join a guard actually walks", () => {
    // Assignment alone answers "holds the role"; role-permission alone answers
    // "the role implies the key". A reader that drifts needs only one of them.
    expect(GRANT_TABLES).toContain("awcms_access_assignments");
    expect(GRANT_TABLES).toContain("awcms_role_permissions");
  });
});
