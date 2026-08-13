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
  GRANT_TABLES,
  namesOnlyAsDescriptor
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
        "c.ts": "SELECT 1 FROM awcms_access_policies ap"
      }),
      ALLOWED
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.file).toBe("c.ts");
    // The message must name the alternative, not merely deny: a gate that says
    // "no" without saying "instead" gets satisfied by adding an exception.
    expect(problems[0]!.message).toContain("fetchGrantedPermissionKeys");
  });

  test("a file naming a RETIRED table is told why, not just refused", () => {
    // `awcms_access_assignments` is read-only history since `sql/103`
    // (ADR-0079). The generic message would send the reader to add an
    // allow-list entry — which is the one fix that must NOT be available here,
    // because a row in that table can no longer be revoked. So the retired case
    // names the live source instead.
    const problems = findGrantReaderProblems(
      withAllowedPresent({
        "c.ts": "SELECT 1 FROM awcms_access_assignments aa"
      }),
      ALLOWED
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("RETIRED");
    expect(problems[0]!.message).toContain("activeRoleGrants");
    expect(problems[0]!.message).not.toContain("add an entry to GRANT_READERS");
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

  test("the readers outside identity_access say so in their reason", () => {
    // Being on the list is not an endorsement, and the entries that cross a
    // module boundary are the ones a future grant-shape change must read first.
    //
    // It was three. `email/application/announcement-directory.ts` left in
    // ADR-0079 — it now embeds `activeRoleGrants` instead of writing its own
    // join, which is what this whole list is meant to produce.
    const outsiders = GRANT_READERS.filter(
      (entry) => !entry.file.startsWith("src/modules/identity-access/")
    );

    expect(outsiders).toHaveLength(2);

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

  test("it covers every half of the join a guard actually walks", () => {
    // Assignment alone answers "holds the role"; role-permission alone answers
    // "the role implies the key". A reader that drifts needs only one of them.
    expect(GRANT_TABLES).toContain("awcms_access_assignments");
    expect(GRANT_TABLES).toContain("awcms_role_permissions");
  });

  test("the SCOPED grant table is covered too (ADR-0078)", () => {
    // The entire reason this gate landed a wave early. A reader that walks only
    // `awcms_access_assignments` after Gelombang 3 gives the OLD, wider answer
    // while looking untouched.
    expect(GRANT_TABLES).toContain("awcms_access_policies");
  });
});

describe("the subject-data descriptor allowance is narrow (ADR-0094 wave 2)", () => {
  // Issue #557 drove the subject-data ledger to zero, so even a RETIRED grant
  // table must declare how it answers about a person. The allowance exists for
  // that one shape and must not become a way back onto the table.
  const RETIRED = "awcms_access_assignments";

  test("a `tableName:` declaration is allowed", () => {
    const source = `{ tableName: "${RETIRED}", exportable: true }`;

    expect(namesOnlyAsDescriptor(source, RETIRED)).toBe(true);
    expect(
      findGrantReaderProblems(
        withAllowedPresent({ "src/modules/x/module.ts": source }),
        ALLOWED
      )
    ).toEqual([]);
  });

  test("a SQL read of the same table still FAILS", () => {
    // The failure ADR-0079 exists to record — five files at once, invisible in
    // every one of them.
    const source = `const rows = await tx\`SELECT role_id FROM ${RETIRED}\`;`;

    expect(namesOnlyAsDescriptor(source, RETIRED)).toBe(false);
    expect(
      findGrantReaderProblems(
        withAllowedPresent({ "src/modules/x/reader.ts": source }),
        ALLOWED
      )
    ).toHaveLength(1);
  });

  test("a declaration does NOT license a read elsewhere in the same file", () => {
    // The whole reason this is keyed on the shape of every mention rather than
    // on the file: one legitimate descriptor must not buy the file a join.
    const source = [
      `{ tableName: "${RETIRED}" }`,
      `const rows = await tx\`SELECT 1 FROM ${RETIRED}\`;`
    ].join("\n");

    expect(namesOnlyAsDescriptor(source, RETIRED)).toBe(false);
    expect(
      findGrantReaderProblems(
        withAllowedPresent({ "src/modules/x/module.ts": source }),
        ALLOWED
      )
    ).toHaveLength(1);
  });

  test("a descriptor for a DIFFERENT table does not cover this one", () => {
    const source = [
      `{ tableName: "awcms_access_policies" }`,
      `const rows = await tx\`SELECT 1 FROM ${RETIRED}\`;`
    ].join("\n");

    expect(namesOnlyAsDescriptor(source, RETIRED)).toBe(false);
  });
});
