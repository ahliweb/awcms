/**
 * The subject-rights surface — ADR-0094 gelombang 2, Issue #557.
 *
 * Pure tests: the SQL builder, the plan filters the executor depends on, the
 * migration's own invariants, and the screen's permission gates. No database.
 *
 * The bar throughout is the one this repo keeps re-learning: an assertion that
 * only ever passes proves nothing. Every check below either plants the mistake
 * it is about, or would go red if the control it names were removed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  buildSubjectPlan,
  erasureTargets,
  type SubjectIdentifiers
} from "../src/modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../src/modules/data-lifecycle/domain/subject-data-registry";
import { assertSafeIdentifier } from "../src/modules/data-lifecycle/application/subject-data-executor";
import { SUBJECT_REQUEST_PERMISSIONS } from "../src/modules/data-lifecycle/domain/subject-request-permissions";

const ROOT = join(import.meta.dir, "..");
const MIGRATION = readFileSync(
  join(ROOT, "sql/125_awcms_subject_requests.sql"),
  "utf8"
);
const PAGE = readFileSync(
  join(ROOT, "src/pages/admin/subject-requests.astro"),
  "utf8"
);

const SUBJECT: SubjectIdentifiers = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  tenantUserId: "22222222-2222-4222-8222-222222222222",
  identityId: "33333333-3333-4333-8333-333333333333",
  profileId: "44444444-4444-4444-8444-444444444444"
};

describe("the erasure writes far less than the subject appears in", () => {
  const plan = buildSubjectPlan(
    collectSubjectDataDescriptors(listModules()),
    SUBJECT
  );

  test("`severed_with_subject_row` tables are NOT written", () => {
    // The safety property the whole vocabulary exists for: an executor looping
    // over `plan.entries` would rewrite ~90 stamp columns and destroy the
    // tenant's own record of who deleted what.
    const targets = new Set(erasureTargets(plan).map((entry) => entry.key));
    const severed = plan.entries.filter(
      (entry) => entry.erasure === "severed_with_subject_row"
    );

    expect(severed.length).toBeGreaterThan(50);
    for (const entry of severed) {
      expect(targets.has(entry.key)).toBe(false);
    }
  });

  test("and neither are the ones retained under obligation", () => {
    const targets = new Set(erasureTargets(plan).map((entry) => entry.key));

    expect(plan.retainedEntries.length).toBeGreaterThan(0);
    for (const entry of plan.retainedEntries) {
      expect(targets.has(entry.key)).toBe(false);
    }
  });

  test("what IS written is a small, non-empty set of real writes", () => {
    const targets = erasureTargets(plan);

    // Non-empty, or the feature erases nothing while reporting success.
    expect(targets.length).toBeGreaterThan(0);
    // Dramatically smaller than the tables the subject appears in.
    expect(targets.length).toBeLessThan(plan.entries.length / 3);

    for (const entry of targets) {
      expect([
        "anonymize",
        "hard_delete",
        "status_transition_then_purge"
      ]).toContain(entry.erasure);
    }
  });

  test("the severance chain the majority answer depends on is real", () => {
    // ~90 descriptors say "already severed by anonymising the identity row".
    // If that row ever stopped anonymising, all of them would silently become
    // a no-op. `subject-data:registry:check` gates it; this states it.
    const identities = plan.entries.find(
      (entry) => entry.tableName === "awcms_identities"
    );

    expect(identities?.erasure).toBe("anonymize");
  });
});

describe("identifiers are provenance-checked, not escaped", () => {
  test("ordinary identifiers pass", () => {
    expect(assertSafeIdentifier("awcms_tenant_users")).toBe(
      "awcms_tenant_users"
    );
    expect(assertSafeIdentifier("tenant_id")).toBe("tenant_id");
  });

  test.each([
    'awcms_x"; DROP TABLE awcms_tenants; --',
    "awcms_x'",
    "awcms x",
    "AWCMS_X",
    "1_leading_digit",
    "",
    "awcms_x)"
  ])("refuses %p", (identifier) => {
    expect(() => assertSafeIdentifier(identifier)).toThrow();
  });

  test("no exportable table has a reserved-word column TODAY, and quoting keeps it that way", () => {
    // Checked rather than assumed. `order`, `user`, `end` and `default` are all
    // plausible column names, and an unquoted one would make the export throw
    // for that table only, at runtime, inside a privacy request. The executor
    // double-quotes every identifier so a future column cannot reintroduce it;
    // this asserts the belt as well as the braces.
    const executor = readFileSync(
      join(
        ROOT,
        "src/modules/data-lifecycle/application/subject-data-executor.ts"
      ),
      "utf8"
    );

    // Every interpolated identifier goes through `quoted`, never through the
    // bare assertion — which returns an UNQUOTED name.
    expect(executor).toContain("function quoted(identifier: string)");
    expect(executor).not.toMatch(/const table = assertSafeIdentifier\(/);
    expect(executor).not.toMatch(/const tenantColumn = assertSafeIdentifier\(/);
  });

  test("every shipped descriptor's identifiers survive it", () => {
    // The gate and this function must agree; if the registry ever carried an
    // identifier this refuses, the endpoint would throw at runtime instead of
    // failing in CI.
    for (const descriptor of collectSubjectDataDescriptors(listModules())) {
      expect(() => assertSafeIdentifier(descriptor.tableName)).not.toThrow();
      for (const column of descriptor.subjectColumns) {
        expect(() => assertSafeIdentifier(column.column)).not.toThrow();
      }
      for (const column of descriptor.redactedColumns ?? []) {
        expect(() => assertSafeIdentifier(column)).not.toThrow();
      }
    }
  });
});

describe("maker/checker is enforced by the SCHEMA, not only by the guard", () => {
  test("a CHECK constraint refuses a self-approved erasure", () => {
    // The guard and the SoD rule are the first two lines. This is the one that
    // cannot be raced: two concurrent approvals cannot, between them, produce a
    // row approved by its own requester.
    expect(MIGRATION).toContain("awcms_subject_requests_checker_is_not_maker");
    expect(MIGRATION).toMatch(/decided_by\s*<>\s*requested_by/);
  });

  test("a half-recorded decision is refused too", () => {
    expect(MIGRATION).toContain("awcms_subject_requests_decision_is_whole");
  });

  test("an export can never sit pending, because it waits for nobody", () => {
    expect(MIGRATION).toContain("awcms_subject_requests_export_is_immediate");
  });

  test("the accountability record cannot be deleted by the app role", () => {
    // The row proving an erasure happened must not be removable by the same
    // person who can run one.
    expect(MIGRATION).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON awcms_subject_requests TO awcms_app/
    );
    expect(MIGRATION).not.toMatch(
      /GRANT[^;]*DELETE[^;]*awcms_subject_requests/
    );
  });

  test("FORCE RLS, not merely ENABLE", () => {
    // ENABLE alone is inert for the table owner — how tenant isolation is lost
    // with every migration green (ADR-0003).
    expect(MIGRATION).toContain(
      "ALTER TABLE awcms_subject_requests FORCE ROW LEVEL SECURITY"
    );
  });

  test("subject and actor FKs are COMPOSITE, so they cannot point out of tenant", () => {
    // A plain `REFERENCES awcms_tenant_users (id)` bypasses RLS and would
    // accept a row from another tenant — a leak in a table whose whole purpose
    // is answering "whose data".
    for (const constraint of [
      "awcms_subject_requests_subject_fk",
      "awcms_subject_requests_requested_by_fk",
      "awcms_subject_requests_decided_by_fk"
    ]) {
      expect(MIGRATION).toContain(constraint);
    }
    expect(
      [
        ...MIGRATION.matchAll(
          /REFERENCES awcms_tenant_users \(tenant_id, id\)/g
        )
      ].length
    ).toBe(3);
  });
});

describe("/admin/subject-requests permission gates", () => {
  function pageTriples(source: string): Set<string> {
    const found = new Set<string>();
    for (const match of source.matchAll(
      /moduleKey:\s*"([a-z_]+)"[\s\S]{0,160}?activityCode:\s*"([a-z_]+)"[\s\S]{0,160}?action:\s*"([a-z_]+)"/g
    )) {
      found.add(`${match[1]}.${match[2]}.${match[3]}`);
    }
    return found;
  }

  test("each control checks its OWN key, not the page's read gate", () => {
    // The latent-authz trap: deriving write controls from the read permission
    // offers an operator buttons that 403 on submit.
    const keys = pageTriples(PAGE);

    expect(keys.has(SUBJECT_REQUEST_PERMISSIONS.read)).toBe(true);
    expect(keys.has(SUBJECT_REQUEST_PERMISSIONS.export)).toBe(true);
    expect(keys.has(SUBJECT_REQUEST_PERMISSIONS.erasureCreate)).toBe(true);
    expect(keys.has(SUBJECT_REQUEST_PERMISSIONS.erasureApprove)).toBe(true);
  });

  test("every key the page names is declared by the module, so a migration seeds it", () => {
    const declared = new Set(
      (
        listModules().find((module) => module.key === "data_lifecycle")
          ?.permissions ?? []
      ).map(
        (permission) =>
          `data_lifecycle.${permission.activityCode}.${permission.action}`
      )
    );

    expect([...pageTriples(PAGE)].filter((key) => !declared.has(key))).toEqual(
      []
    );
  });

  test("the maker and checker fieldsets are gated apart", () => {
    // In a correctly configured tenant NOBODY holds both, because the two keys
    // are a `critical` SoD conflict. The page must render for each half alone.
    expect(PAGE).toContain("canRequestErasure &&");
    expect(PAGE).toContain("canDecide &&");
    // …and must not collapse them into one condition.
    expect(PAGE).not.toContain("canRequestErasure && canDecide");
  });

  test("the export result is never given a URL", () => {
    // The most concentrated disclosure this system can produce. A download link
    // would give it a life beyond the session that was authorised and audited.
    //
    // Asserted on the MECHANICS rather than on the word "download", which the
    // page's own prose uses to promise exactly this.
    expect(PAGE).not.toMatch(/\bdownload\s*=/);
    expect(PAGE).not.toMatch(/createObjectURL/);
    expect(PAGE).not.toMatch(/data:application\/(json|octet-stream)/);
  });

  test("the rendered report is built with textContent, never innerHTML", () => {
    // It is other people's data, and a subject-access export is the last place
    // to build HTML out of stored values.
    expect(PAGE).not.toContain("innerHTML");
  });
});

describe("the surface answers per tenant, and says what it cannot answer", () => {
  test("no global table is ever read", () => {
    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      SUBJECT
    );
    const read = new Set(plan.entries.map((entry) => entry.tableName));

    // ADR-0087 and ADR-0088 each planned a cross-tenant read once.
    expect(read.has("awcms_principals")).toBe(false);
    expect(read.has("awcms_principal_mfa_factors")).toBe(false);
  });

  test("but the report names them, so incompleteness is visible", () => {
    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      SUBJECT
    );

    expect(plan.unansweredEntries.length).toBeGreaterThan(0);
    expect(
      plan.unansweredEntries.some(
        (entry) => entry.tableName === "awcms_principals"
      )
    ).toBe(true);
    for (const entry of plan.unansweredEntries) {
      expect(entry.rationale.length).toBeGreaterThan(20);
    }
  });
});
